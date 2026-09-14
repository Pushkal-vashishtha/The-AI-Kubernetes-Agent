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
#   ClusterRole (get/list/watch only -- no write verbs anywhere), ClusterRoleBinding
set -euo pipefail

# Substituted by the backend when it serves this script, so the one-liner
# needs no --server. Left as-is when the script is run from a checkout.
DEFAULT_SERVER="__AIKA_DEFAULT_SERVER__"
DEFAULT_IMAGE="ghcr.io/pushkal-vashishtha/aika-agent:0.1.0"

NAMESPACE="aika-system"
NAME="aika-agent"
MIN_K8S_MINOR=24

TOKEN="${AIKA_TOKEN:-}"
SERVER=""
IMAGE="$DEFAULT_IMAGE"
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
  kubectl delete clusterrolebinding "$NAME" --ignore-not-found >/dev/null
  kubectl delete clusterrole "$NAME" --ignore-not-found >/dev/null
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
# Read-only. The only verbs anywhere in this role are get, list and watch.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: $NAME
  labels:
    app.kubernetes.io/name: $NAME
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/log", "events", "services", "endpoints", "nodes"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch"]
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

kubectl auth can-i create clusterroles >/dev/null 2>&1 \
  || die "Your kubectl user cannot create ClusterRoles -- ask a cluster admin to run this"

say "Installing the agent into ${BOLD}$CONTEXT${RESET}..."
manifest | kubectl apply -f - >/dev/null
ok "Applied manifest (namespace $NAMESPACE)"

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
