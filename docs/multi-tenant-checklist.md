# Multi-Tenant / Any-Cluster Migration — Checklist

Turning the agent from a single-tenant appliance (one kubeconfig on the backend box)
into a multi-tenant product where any user installs a read-only agent into any cluster.

**Rule for every phase: nothing that works today may break.** The EC2 demo at
https://ai-k8s-agent.duckdns.org must stay green after each phase.

Legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[-]` skipped (note why)

---

## Phase 1 — Tenancy foundation (no functional change)

Close the ownership holes while the app still behaves exactly as it does today.

### Database
- [x] Write migration `migrations/<ts>_clusters-and-tenancy.sql`
- [x] `public.clusters` table: `id, user_id, name, mode('local'|'agent'), context, agent_token_hash, agent_version, distro, status('pending'|'online'|'offline'), last_seen_at, created_at, updated_at`
- [x] Unique constraint on `(user_id, name)`
- [x] Index on `(user_id, created_at DESC)`
- [x] `updated_at` trigger (reuse `system.update_updated_at()`)
- [x] RLS: `users_read_own_clusters` SELECT policy; REVOKE INSERT/UPDATE/DELETE from `authenticated`
- [x] Never expose `agent_token_hash` to the client (column-level grant or a view)
- [x] `ALTER TABLE investigations ADD COLUMN cluster_id uuid REFERENCES clusters(id) ON DELETE SET NULL`
- [x] Keep the existing `investigations.cluster` text column (old rows must stay readable)
- [x] Realtime channel pattern `clusters:user:%` + publish trigger + subscribe-own RLS policy (mirror the investigations one)
- [x] Apply migration and verify with a second test user

### Backend
- [x] New `backend/src/services/cluster.service.js` — all queries scoped by `userId`
- [x] Rewrite `GET /clusters` to read the table, not the kubeconfig
- [x] `POST /investigate` accepts `{ cluster_id }`
- [x] Ownership check: 404 (not 403) when `cluster.user_id !== req.user.id` -- same answer as "does not exist", so ids cannot be probed
- [x] Backwards-compat: still accept legacy `{ context }` for one release
- [x] Write `cluster_id` (and keep writing `cluster` name) in `history.service.js`
- [x] Local-mode preservation: `LOCAL_CLUSTER_OWNER=<user-uuid>` env syncs kubeconfig contexts into `clusters` as `mode='local'` rows on boot
- [x] Add `LOCAL_CLUSTER_OWNER` to `core/config.js`, `.env.example`, and `docs/deployment-ec2.md`

### Verification
- [x] Sign in as user A → sees their clusters; user B → empty list
- [x] User B investigating user A's `cluster_id` → 404 (verified 2026-09-12)
- [x] EC2 demo still investigates the k3s cluster end to end
  - [x] `LOCAL_CLUSTER_OWNER` set in the instance's `backend/.env` (2026-09-12, ahead of the deploy; box has one context, `aws-k3s`)
  - [x] Deployed dcfdaad 2026-09-12; boot sync registered `aws-k3s`; live `GET /clusters` + `POST /investigate` verified against the real k3s cluster (reachable, 0 issues, healthy)
- [x] All 5 `test-scenarios/*.yaml` still diagnose correctly against kind (re-run 2026-09-12: 01 crashloop/DATABASE_URL 98%, 02 image tag 98%, 03 OOMKilled 95%, 04 selector mismatch 95%, 05 readiness probe on 8080 95%)

---

## Phase 1 follow-ups (found during the deploy)

- [ ] **Local-cluster status flaps between machines.** `syncLocalClusters()` marks
      any of the owner's `mode='local'` rows offline when they are absent from
      *this* machine's kubeconfig -- so the EC2 box marked the three kind
      contexts offline, and the laptop will mark `aws-k3s` offline on its next
      restart. Harmless today (nothing reads `status` yet) but it must be fixed
      before Phase 5 shows status in the UI. Fix: tag local rows with the host
      that owns them (`LOCAL_CLUSTER_HOST`/hostname column) and reconcile only
      that host's rows.
- [ ] Move `migrations/` into the repo -- it currently lives in `D:\Devops\`,
      outside version control, so schema history exists only on the laptop.

---

## Phase 2 — Extract the collector

- [x] Create `packages/collector/` (own `package.json`, ESM, no Express deps)
- [x] Move `backend/src/kubernetes/{pod,logs,events,deployment,network}.*.js` into it
- [x] Backend imports the package; **evidence JSON shape unchanged**
- [x] Define the client interface: `createKubectlClient({ context })` (today's execFile path)
- [x] Implement `createApiClient()` on `@kubernetes/client-node` (in-cluster ServiceAccount)
- [x] Both clients return identical objects (raw K8s API JSON) — inspectors untouched
- [x] Deploy plumbing for workspaces: Dockerfile builds from repo root, `.dockerignore`
      moved to the context root, compose `context: .`, CI + EC2 `npm ci` at the root
- [x] `investigation.service.js` takes a `source` instead of a bare `context`
- [x] `ai/prompt.builder.js` and the rest of `ai/` must have **zero diff**
- [x] Byte-identical evidence vs. before the refactor -- verified by restoring the
      pre-refactor modules at their original paths and running old and new
      collectors back to back against the same quiesced cluster (`diff` clean)
- [x] Bonus: kubectl client and API client produce byte-identical evidence too,
      so the Phase 3 agent's collection path is already proven

---

## Phase 3 — Agent + control plane

### Agent (`agent/`)
- [x] Scaffold Node 20 project, `node:20-alpine` image -- ~60 MB, runs as UID 1000,
      no Express / InsForge SDK / kubectl in the image (verified by listing it)
- [x] Read `AIKA_TOKEN` / `AIKA_SERVER` from env (`AIKA_KUBECONFIG` for dev only)
- [x] Outbound WebSocket to backend; server-side ping every 30s, dead peers terminated
- [x] Reconnect with exponential backoff + full jitter (observed 0.7s -> 15.1s while backend was down)
- [x] Handle `investigate` -> run collector -> send evidence back
      (deviation: evidence returns over the same socket, not a separate POST --
      the socket is already authenticated, so a second auth path would only add surface)
- [x] Stream per-step progress -- all 6 steps landed in the history row
- [x] Send `agent_version`, `distro`, `kubernetes_version` in `hello`
- [x] Graceful shutdown on SIGTERM/SIGINT (5s cap) -- **SIGTERM path itself untested:
      Windows `Stop-Process` is a hard kill. Verify in-pod in Phase 4.**
- [ ] Resource limits in the manifest (moves to Phase 4 -- no manifest exists yet)
- [x] Shared wire contract in `packages/protocol` (message types, close codes,
      `PROTOCOL_VERSION` / `MIN_PROTOCOL_VERSION`, 10 MB frame cap)

### Backend
- [x] `POST /clusters` -- creates row, mints `aika_<43 chars base64url>`, stores `sha256(token)` only
      (verified: stored hash == sha256(token); plaintext appears nowhere in the row)
- [x] Token returned exactly once in the 201 response; name validation + 409 on duplicate
- [x] `/agent/connect` -- authenticates **before** accepting the upgrade
      (no token / garbage / well-formed-unknown -> 401; wrong path -> 404)
- [x] Offline detection: close handler + missed-pong termination; boot marks all agent rows offline
- [x] `remoteAgentSource(cluster)` -- dispatch job, await evidence, 60s timeout
- [x] Clean failure path: 503 "offline; it has never connected" / "last seen N minute(s) ago"
- [x] `DELETE /clusters/:id` -- deletes row **and** closes the socket (4004); agent exits, does not redial;
      revoked token redial -> 401; history rows survive with `cluster_id` nulled
- [x] Reject agents below `MIN_PROTOCOL_VERSION` (close 4002 + reason) -- **implemented, not exercised**
      (only one protocol version exists)
- [x] One live connection per cluster; a newer one replaces the older (4003) without
      the old socket's close marking the cluster offline

### Verified end to end (2026-09-14, local backend + agent process against kind)
- [x] Investigation through the agent: ImagePullBackOff, correct root cause, 98%
- [x] Backend restart -> agent reconnects on its own, cluster back online
- [x] Agent killed -> row offline with `last_seen_at`, investigate returns 503
- [x] Local kubeconfig clusters unaffected (regression run: 98%)

### Before this reaches production
- [x] Caddy on EC2 routes `/agent/*` (and `/install.sh`) to the backend -- applied
      2026-09-14 (backup `/etc/caddy/Caddyfile.bak.20260914112225`, validated, reloaded).
      Phase 3 had already been deployed (6216f82) before this fix, so for a few hours
      in production agents could not connect and cluster removal did not revoke
- [ ] Single-instance assumption: connections live in process memory. Fine for one
      EC2 box; horizontal scaling needs job routing to the instance holding the socket

---

## Phase 4 — Install script

- [x] ~~`install/aika-agent.yaml`~~ -- **deviation:** the manifest is generated by
      `install.sh` (single source; `--dry-run` prints it for review or GitOps)
      instead of a YAML file that would drift from the script
- [x] Namespace (`pod-security.kubernetes.io/enforce: restricted`), ServiceAccount,
      Secret (`stringData`, token never on a command line), Deployment
- [x] Read-only ClusterRole: get/list/watch on pods, pods/log, events, services,
      endpoints, nodes, deployments, replicasets -- verified with `auth can-i` as the SA:
      create/delete pods, patch deployments, **get secrets** all `no`
- [x] ClusterRoleBinding
- [x] `install/install.sh` served at `/install.sh`, with the backend's public origin
      substituted as the default `--server` (strictly validated -- a spoofed
      `X-Forwarded-Host` carrying a shell payload yields an empty default, not injection)
- [x] Preflight: kubectl on PATH, context set, cluster reachable, k8s >= 1.24,
      `auth can-i create clusterroles`; token/server/image validated before templating
      (token with `"; rm -rf /`, server with `$(id)`, non-`aika_` token all refused)
- [x] Flags: `--token` (or `AIKA_TOKEN`), `--server`, `--image`, `--dry-run`, `--uninstall`
- [-] `--namespaces` -- **not shipped:** the collector uses cluster-wide list calls, so a
      namespace-scoped Role would install cleanly and then fail every investigation.
      Needs per-namespace listing in the collector first (Phase 6 item)
- [x] Idempotent: re-run exits 0, same 5 labelled objects, 1 pod; bounces the pod so a
      changed token/server in the Secret takes effect
- [x] Waits for rollout, then for "registered as cluster" in the logs; fails loudly with
      the agent's own error on a rejected token (exit 1)
- [x] `--uninstall` removes namespace, ClusterRole and binding; backend sees the disconnect
- [x] Distro detection moved to node `providerID` (the kubeconfig context does not exist
      inside a pod) -- reports `kind` from a real pod
- [x] Test on kind -- one-liner `curl .../install.sh | bash` to registered in 16.7s;
      investigation through the pod agent: correct root cause, 98%
- [x] Deployed to production (3cc1473, 2026-09-14 11:23 UTC). Through Caddy on the box:
      `/install.sh` served as `text/x-shellscript`, `no-store`, 282 lines, 0 CR bytes,
      valid bash, default server substituted as `https://ai-k8s-agent.duckdns.org`;
      local-mode investigation of `aws-k3s` still succeeds after the deploy
- [ ] Test the agent on the EC2 k3s cluster -- blocked on publishing the image (the
      production cluster has no way to pull `aika-agent:dev`), and it cannot be
      driven from the office network, which blocks `*.duckdns.org`
- [ ] Test on one managed cluster (EKS/GKE free tier) if available
- [ ] Publish the agent image -- default `ghcr.io/pushkal-vashishtha/aika-agent:0.1.0`
      **does not exist yet**; kind tests used `--image aika-agent:dev` + `kind load`

### Moved here from Phase 3, now verified in-pod
- [x] Resource limits: requests 50m/64Mi, limits 250m/256Mi
- [x] Hardened pod: UID 1000 (confirmed with `id`), read-only root FS (write fails),
      no privilege escalation, all capabilities dropped, seccomp RuntimeDefault
- [x] SIGTERM path: `rollout restart` -> old pod logs "SIGTERM received", backend sees a
      clean close 11 ms later, replacement reconnects 9s after
- [x] Rejected token in a pod: process exits 1, Kubernetes restarts it with its own
      capped backoff -- visible as climbing restarts, never a silent Running-but-dead pod

### Production blockers found while documenting Caddy
- [x] **Caddy `@api` matcher fixed in production**:
      `/health /clusters /clusters/* /investigate /agent/* /install.sh`.
      Before the fix, probing through Caddy on the box confirmed the bug:
      `DELETE /clusters/<id>` -> 405 from the file server, agent upgrade -> SPA HTML.
      After: both reach the backend (401), SPA and `/health` unaffected

---

## Phase 5 — Frontend

- [ ] "Add Cluster" modal: name → copyable install command
- [ ] Live "waiting for agent…" state via the `clusters:user:<id>` channel
- [ ] `ClusterSelector.tsx`: status dots (online / offline / pending), offline cards disabled
- [ ] Empty state → "Add your first cluster" (replaces "No clusters found in the kubeconfig on the backend machine")
- [ ] `useClusters.ts` and `useInvestigation.ts` switch to `cluster_id`
- [ ] Cluster detail: last seen, agent version, distro, rotate token, remove cluster
- [ ] Friendly error mapping for agent-offline / job-timeout in `lib/errors.ts`
- [ ] `npm run build` clean

---

## Phase 6 — Hardening

- [ ] Log redaction **at the agent**: JWTs, `AWS_*`, connection strings, bearer tokens
- [ ] User-extendable redaction patterns, documented
- [ ] Evidence caps: top N problematic pods, ~100 log lines each, 1h event window
- [ ] Tell the LLM explicitly what was truncated
- [ ] Namespace-scoped install path verified (Role, not ClusterRole)
- [ ] Token rotation endpoint + UI
- [ ] Per-tenant rate limit on `/investigate` (protects the OpenRouter key)
- [ ] Agent upgrade notice when a newer version exists

---

## Docs & release

- [ ] `prompts/06-prompt-multi-tenant-clusters.md` (keep the prompt-driven history intact)
- [ ] `docs/architecture.md` — new agent topology diagram
- [ ] `docs/deployment-ec2.md` — `LOCAL_CLUSTER_OWNER`, serving `/install.sh`, WSS through Caddy
- [ ] `docs/project-mastery.md` — why outbound agent over kubeconfig upload; RBAC + revocation reasoning
- [ ] `docs/demo-runbook.md` — add the "install on a fresh cluster in 60 seconds" demo
- [ ] README: multi-tenant section, updated roadmap
- [ ] Security review of the agent RBAC before publishing the manifest
- [ ] Commit + push to `Pushkal-vashishtha/The-AI-Kubernetes-Agent` (personal identity only — never the work account)

---

## Explicit non-goals

- [-] Kubernetes controller / operator / CRDs — this stays on-demand by design
- [-] Auto-remediation (write access to customer clusters)
- [-] Continuous watch loops in the agent — it is a dumb job runner
