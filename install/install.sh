#!/usr/bin/env bash
# AI Kubernetes Agent -- installer.
#
#   curl -sSL https://<your-backend>/install.sh | bash -s -- --token aika_...
#
# Installs a read-only agent into the cluster your current kubectl context
# points at. The agent dials OUT to the backend; nothing is exposed.
#
# Read before you run it:
#   bash install.sh --token aika_... --dry-run    # prints every object, applies nothing
#
# What it creates (all named aika-agent, in namespace aika-system):
#   Namespace, ServiceAccount, Secret (your token), Deployment,
#   ClusterRole + ClusterRoleBinding (list, plus get on pods/log -- nothing else),
#   or with --namespaces a Role + RoleBinding in each listed namespace
set -euo pipefail

# Substituted by the backend when it serves this script, so the one-liner
# needs no --server. Left as-is when the script is run from a checkout.
DEFAULT_SERVER="__AIKA_DEFAULT_SERVER__"
# 0.2.0 is the first agent that redacts secrets; 0.3.0 adds --namespaces.
DEFAULT_IMAGE="ghcr.io/pushkal-vashishtha/aika-agent:0.3.0"

NAMESPACE="aika-system"
NAME="aika-agent"
MIN_K8S_MINOR=24

TOKEN="${AIKA_TOKEN:-}"
SERVER=""
IMAGE="$DEFAULT_IMAGE"
NAMESPACES=""
DRY_RUN=0
UNINSTALL=0

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

say()  { printf '%s\n' "$*" >&2; }
ok()   { say "${GREEN}✓${RESET} $*"; }
warn() { say "${YELLOW}!${RESET} $*"; }
die()  { say "${RED}✗ $*${RESET}"; exit 1; }

usage() {
  cat >&2 <<'EOF'
Usage: install.sh --token <aika_token> [options]

  --token <token>    Agent token from "Add cluster" (or set AIKA_TOKEN)
  --server <url>     Backend URL (default: the server this script came from)
  --image <image>    Agent image (default: the published release)
  --namespaces <a,b> Read only these namespaces (Roles instead of a ClusterRole);
                     default: the whole cluster
  --dry-run          Print the manifest and exit; changes nothing
  --uninstall        Remove the agent and everything this script created
  -h, --help         Show this help

Installs into the cluster of your CURRENT kubectl context:
  kubectl config current-context
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --token)     TOKEN="${2:-}"; shift 2 ;;
    --token=*)   TOKEN="${1#*=}"; shift ;;
    --server)    SERVER="${2:-}"; shift 2 ;;
    --server=*)  SERVER="${1#*=}"; shift ;;
    --image)     IMAGE="${2:-}"; shift 2 ;;
    --image=*)   IMAGE="${1#*=}"; shift ;;
    --namespaces)   NAMESPACES="${2:-}"; shift 2 ;;
    --namespaces=*) NAMESPACES="${1#*=}"; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           usage; die "Unknown option: $1" ;;
  esac
done

case "$DEFAULT_SERVER" in __AIKA_*) DEFAULT_SERVER="" ;; esac
SERVER="${SERVER:-$DEFAULT_SERVER}"
SERVER="${SERVER%/}"

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

command -v kubectl >/dev/null 2>&1 || die "kubectl not found on PATH"

if [ "$DRY_RUN" -eq 0 ]; then
  CONTEXT="$(kubectl config current-context 2>/dev/null)" || die "No current kubectl context. Pick one: kubectl config use-context <name>"

  VERSION_JSON="$(kubectl version -o json 2>/dev/null)" || die "Cannot reach the cluster for context \"$CONTEXT\""
  SERVER_MINOR="$(printf '%s' "$VERSION_JSON" | tr -d '\n ' | sed -n 's/.*"serverVersion":{[^}]*"minor":"\([0-9]*\).*/\1/p')"
  if [ -z "$SERVER_MINOR" ]; then
    die "Cannot reach the cluster for context \"$CONTEXT\""
  fi
  if [ "$SERVER_MINOR" -lt "$MIN_K8S_MINOR" ]; then
    die "Kubernetes 1.$SERVER_MINOR is too old; the agent needs 1.$MIN_K8S_MINOR or newer"
  fi
  ok "Cluster reachable: context ${BOLD}$CONTEXT${RESET} (Kubernetes 1.$SERVER_MINOR)"
fi

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------

if [ "$UNINSTALL" -eq 1 ]; then
  [ "$DRY_RUN" -eq 1 ] && die "--uninstall and --dry-run cannot be combined"
  say "Removing the agent from ${BOLD}$CONTEXT${RESET}..."
  kubectl delete clusterrolebinding "$NAME" --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete clusterrole "$NAME" --ignore-not-found >/dev/null 2>&1 || true
  kubectl delete rolebinding,role -A -l "app.kubernetes.io/name=$NAME" --ignore-not-found >/dev/null 2>&1 \
    || warn "Could not list Roles cluster-wide; remove any left in scoped namespaces: kubectl -n <ns> delete role,rolebinding $NAME"
  kubectl delete namespace "$NAMESPACE" --ignore-not-found --wait=true >/dev/null
  ok "Agent removed. The cluster will show as offline; remove it in the dashboard to revoke its token."
  exit 0
fi

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------

[ -n "$TOKEN" ] || { usage; die "--token is required (copy it from \"Add cluster\" in the dashboard)"; }
case "$TOKEN" in
  aika_*) ;;
  *) die "That doesn't look like an agent token (they start with aika_)" ;;
esac
# The token lands inside YAML below; refuse anything that could break out of
# a double-quoted scalar rather than trying to escape it.
printf '%s' "$TOKEN" | grep -Eq '^aika_[A-Za-z0-9_-]+$' || die "Token contains unexpected characters -- was it copied whole?"

[ -n "$SERVER" ] || die "--server is required when running a local copy of this script"
printf '%s' "$SERVER" | grep -Eq '^https?://[A-Za-z0-9.-]+(:[0-9]+)?$' \
  || die "--server must look like https://host or http://host:port (got: $SERVER)"
case "$SERVER" in
  http://*) warn "Using plain http:// -- fine for local testing, never for a real cluster" ;;
esac
printf '%s' "$IMAGE" | grep -Eq '^[A-Za-z0-9./:@_-]+$' || die "--image contains unexpected characters"

# "shop, payments" -> "payments shop": split on commas/spaces, validate, dedupe.
SCOPED_NAMESPACES=""
if [ -n "$NAMESPACES" ]; then
  for ns in $(printf '%s' "$NAMESPACES" | tr ',' ' '); do
    printf '%s' "$ns" | grep -Eq '^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$' \
      || die "--namespaces: \"$ns\" is not a valid namespace name"
    SCOPED_NAMESPACES="$SCOPED_NAMESPACES $ns"
  done
  SCOPED_NAMESPACES="$(printf '%s\n' $SCOPED_NAMESPACES | sort -u | tr '\n' ' ')"
  SCOPED_NAMESPACES="${SCOPED_NAMESPACES% }"
  [ -n "$SCOPED_NAMESPACES" ] || die "--namespaces was given but names no namespace"
fi
# Comma-separated, as the agent reads AIKA_NAMESPACES.
SCOPED_CSV="$(printf '%s' "$SCOPED_NAMESPACES" | tr ' ' ',')"

# Read-only and exactly what the collector calls: "list" on each resource and
# "get" on pods/log -- no watch, no Secrets/ConfigMaps. Widen only alongside a
# collector change. "nodes" is cluster-scoped, so only the cluster-wide role can have it; the
# agent uses it just to guess the distro and copes without.
rbac() {
  if [ -z "$SCOPED_NAMESPACES" ]; then
    cat <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: $NAME
  labels:
    app.kubernetes.io/name: $NAME
rules:
  - apiGroups: [""]
    resources: ["pods", "events", "services", "endpoints", "nodes"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: $NAME
  labels:
    app.kubernetes.io/name: $NAME
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: $NAME
subjects:
  - kind: ServiceAccount
    name: $NAME
    namespace: $NAMESPACE
---
EOF
    return
  fi

  for ns in $SCOPED_NAMESPACES; do
    cat <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: $NAME
  namespace: $ns
  labels:
    app.kubernetes.io/name: $NAME
rules:
  - apiGroups: [""]
    resources: ["pods", "events", "services", "endpoints"]
    verbs: ["list"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: $NAME
  namespace: $ns
  labels:
    app.kubernetes.io/name: $NAME
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: $NAME
subjects:
  - kind: ServiceAccount
    name: $NAME
    namespace: $NAMESPACE
---
EOF
  done
}

# Only emitted when scoped; an unscoped agent reads the whole cluster.
scope_env() {
  [ -n "$SCOPED_CSV" ] || return 0
  cat <<EOF
          env:
            - name: AIKA_NAMESPACES
              value: "$SCOPED_CSV"
EOF
}

manifest() {
  cat <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: $NAMESPACE
  labels:
    app.kubernetes.io/name: $NAME
    pod-security.kubernetes.io/enforce: restricted
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: $NAME
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/name: $NAME
---
apiVersion: v1
kind: Secret
metadata:
  name: $NAME
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/name: $NAME
type: Opaque
stringData:
  AIKA_TOKEN: "$TOKEN"
  AIKA_SERVER: "$SERVER"
---
$(rbac)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: $NAME
  namespace: $NAMESPACE
  labels:
    app.kubernetes.io/name: $NAME
spec:
  # Exactly one: the backend keeps one connection per cluster, and a second
  # replica would just keep replacing the first.
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: $NAME
  template:
    metadata:
      labels:
        app.kubernetes.io/name: $NAME
    spec:
      serviceAccountName: $NAME
      terminationGracePeriodSeconds: 15
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: agent
          image: $IMAGE
          imagePullPolicy: IfNotPresent
          envFrom:
            - secretRef:
                name: $NAME
$(scope_env)
          resources:
            requests:
              cpu: 50m
              memory: 64Mi
            limits:
              cpu: 250m
              memory: 256Mi
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities:
              drop: ["ALL"]
EOF
}

if [ "$DRY_RUN" -eq 1 ]; then
  manifest
  exit 0
fi

if [ -z "$SCOPED_NAMESPACES" ]; then
  kubectl auth can-i create clusterroles >/dev/null 2>&1 \
    || die "Your kubectl user cannot create ClusterRoles -- ask a cluster admin, or limit the agent with --namespaces"
else
  for ns in $SCOPED_NAMESPACES; do
    kubectl get namespace "$ns" >/dev/null 2>&1 || die "Namespace \"$ns\" does not exist"
    kubectl auth can-i create roles -n "$ns" >/dev/null 2>&1 \
      || die "Your kubectl user cannot create Roles in namespace \"$ns\""
  done
fi

say "Installing the agent into ${BOLD}$CONTEXT${RESET}..."
manifest | kubectl apply -f - >/dev/null
if [ -z "$SCOPED_NAMESPACES" ]; then
  # Switching back from a scoped install: drop the per-namespace grants.
  kubectl delete rolebinding,role -A -l "app.kubernetes.io/name=$NAME" --ignore-not-found >/dev/null 2>&1 || true
  ok "Applied manifest (namespace $NAMESPACE, read-only across the cluster)"
else
  # Switching from a cluster-wide install: a leftover ClusterRoleBinding would
  # quietly keep cluster-wide read access, so it must go.
  kubectl delete clusterrolebinding "$NAME" --ignore-not-found >/dev/null 2>&1 \
    || warn "Could not check for an old cluster-wide binding; if one exists: kubectl delete clusterrolebinding,clusterrole $NAME"
  kubectl delete clusterrole "$NAME" --ignore-not-found >/dev/null 2>&1 || true
  # Roles from an earlier install in namespaces no longer listed.
  for ns in $(kubectl get role -A -l "app.kubernetes.io/name=$NAME" -o jsonpath='{range .items[*]}{.metadata.namespace}{" "}{end}' 2>/dev/null); do
    case " $SCOPED_NAMESPACES " in
      *" $ns "*) ;;
      *) kubectl -n "$ns" delete role,rolebinding "$NAME" --ignore-not-found >/dev/null 2>&1 || true ;;
    esac
  done
  ok "Applied manifest (namespace $NAMESPACE, read-only in: $SCOPED_NAMESPACES)"
fi

# A changed token or server lives in the Secret, which does not by itself
# restart the pod -- bounce it so re-running the installer takes effect.
kubectl -n "$NAMESPACE" rollout restart "deployment/$NAME" >/dev/null

if ! kubectl -n "$NAMESPACE" rollout status "deployment/$NAME" --timeout=180s >/dev/null 2>&1; then
  say ""
  kubectl -n "$NAMESPACE" get pods -l "app.kubernetes.io/name=$NAME" >&2 || true
  die "The agent pod did not become ready. Check: kubectl -n $NAMESPACE logs deploy/$NAME"
fi
ok "Agent pod running"

say "Waiting for the agent to register with $SERVER..."
for _ in $(seq 1 30); do
  LOGS="$(kubectl -n "$NAMESPACE" logs "deploy/$NAME" --tail=50 2>/dev/null || true)"
  if printf '%s' "$LOGS" | grep -q "registered as cluster"; then
    ok "${BOLD}Cluster registered${RESET} -- it is ready to investigate from the dashboard"
    exit 0
  fi
  if printf '%s' "$LOGS" | grep -qE "token rejected|disconnected permanently"; then
    printf '%s\n' "$LOGS" | tail -5 >&2
    die "The backend rejected this agent. Check the token, or re-add the cluster for a fresh one."
  fi
  sleep 2
done

printf '%s\n' "$LOGS" | tail -5 >&2
die "The agent is running but has not registered. Can the cluster reach $SERVER? Logs: kubectl -n $NAMESPACE logs deploy/$NAME"
