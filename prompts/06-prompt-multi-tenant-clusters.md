# 06-prompt-multi-tenant-clusters.md

## Context

The application is deployed and working (prompts 01–05): a signed-in user
picks a cluster, the backend collects evidence with `kubectl`, an LLM returns
a root cause and fix, and history and progress flow through InsForge.

The limitation: the backend can only investigate clusters in **its own
kubeconfig**. Nobody else can use it for their clusters, and the obvious fix —
users uploading kubeconfigs — means holding admin credentials and exposing
API servers to the internet.

Goal:

```text
Any user
        ↓
"Add cluster" → one install command
        ↓
Read-only agent in THEIR cluster dials out to us
        ↓
Investigate it like any other cluster
        ↓
Only they can see it
```

## Constraints (do not break)

- Stay **on-demand**: no controller, no CRDs, no watch loops, no
  auto-remediation, no write access to user clusters.
- The existing kubeconfig path, deployment, and demo must keep working at
  every step.
- The repository is **public**: never commit keys; agent tokens are secrets.
- Work in verifiable phases; tick a checklist as each is proven.

## Phases

### 1. Tenancy foundation

- `clusters` table owned by a user (`mode`: `local` | `agent`, `status`,
  `host`, `agent_version`, `agent_token_hash`), `cluster_id` on
  investigations, RLS so users read only their own rows.
- Routes resolve clusters by owner; unknown or foreign ids → `404`.
- The operator's kubeconfig contexts are registered at boot for
  `LOCAL_CLUSTER_OWNER`, scoped by `LOCAL_CLUSTER_HOST`.

### 2. Extract the collector

- Move the inspectors into `packages/collector` behind a client interface
  (`listPods`, `listEvents`, `listDeployments`, `listServices`,
  `listEndpoints`, `podLogs`).
- Two clients producing identical evidence: `kubectl` (backend) and
  `@kubernetes/client-node` with a ServiceAccount (agent).

### 3. Agent and control plane

- `packages/protocol`: versioned messages and close codes, contract only grows.
- Backend hub at `/agent/connect`: `aika_` bearer token in the header,
  verified against a SHA-256 hash **before** accepting the upgrade;
  heartbeats; job dispatch; online/offline status.
- `agent/`: one outbound WebSocket, jittered reconnect, fatal close codes
  exit instead of retrying, runs the collector on request.

### 4. Install script

- `GET /install.sh` with the server URL substituted.
- Creates `aika-system` (restricted Pod Security), ServiceAccount, Secret,
  non-root read-only Deployment, read-only RBAC. `--dry-run`, `--uninstall`,
  idempotent re-runs, strict input validation.
- Publish a multi-arch agent image to GHCR; never overwrite a version tag.

### 5. Frontend

- Add cluster dialog showing the install command once; live
  Waiting → Connected → Offline over realtime; remove cluster.

### 6. Hardening

- Secret redaction in the collector (built-in rules + custom patterns), and
  again on the backend for agent evidence.
- Per-user limits: one running investigation, N per hour, `429` +
  `Retry-After`.
- Token rotation that disconnects the old agent.
- Evidence list caps with the truncation stated in the prompt.
- Agent "out of date" notice; a test keeping version strings in sync.
- `--namespaces a,b`: per-namespace Roles, per-namespace listing, DNS "not
  checked" outside kube-system, scope stated in the prompt, and removal of the
  other mode's grant when switching.

### 7. Docs and release

- Architecture, deployment, demo runbook, project mastery, README.
- Security review of the agent RBAC: grant only the verbs the collector calls.

## Verification

Each phase is proven against real clusters (kind locally, k3s on EC2) before
moving on, and recorded in `docs/multi-tenant-checklist.md`. A manual
walkthrough covers the Add cluster flow, the out-of-date notice, namespace
scoping and uninstall.
