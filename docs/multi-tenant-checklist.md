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
- [~] EC2 demo still investigates the k3s cluster end to end
  - [x] `LOCAL_CLUSTER_OWNER` set in the instance's `backend/.env` (2026-09-12, ahead of the deploy; box has one context, `aws-k3s`)
  - [ ] Deploy Phase 1 code and re-verify the picker + an investigation on the live site
- [x] All 5 `test-scenarios/*.yaml` still diagnose correctly against kind (re-run 2026-09-12: 01 crashloop/DATABASE_URL 98%, 02 image tag 98%, 03 OOMKilled 95%, 04 selector mismatch 95%, 05 readiness probe on 8080 95%)

---

## Phase 2 — Extract the collector

- [ ] Create `packages/collector/` (own `package.json`, ESM, no Express deps)
- [ ] Move `backend/src/kubernetes/{pod,logs,events,deployment,network}.*.js` into it
- [ ] Backend imports the package; **evidence JSON shape unchanged**
- [ ] Define the client interface: `createKubectlClient({ context })` (today's execFile path)
- [ ] Implement `createApiClient()` on `@kubernetes/client-node` (in-cluster ServiceAccount)
- [ ] Both clients return identical objects (raw K8s API JSON) — inspectors untouched
- [ ] `investigation.service.js` takes a `source` instead of a bare `context`
- [ ] `ai/prompt.builder.js` and the rest of `ai/` must have **zero diff**
- [ ] Re-run all 5 scenarios — byte-identical evidence vs. before the refactor

---

## Phase 3 — Agent + control plane

### Agent (`agent/`)
- [ ] Scaffold Node 20 project, `node:20-alpine` image
- [ ] Read `AIKA_TOKEN` / `AIKA_SERVER` from env (mounted Secret)
- [ ] Outbound WSS connection to backend + 30s heartbeat
- [ ] Reconnect with exponential backoff + jitter
- [ ] Handle `{type:'investigate', job_id}` → run collector → POST evidence
- [ ] Stream per-step progress so the existing realtime UI keeps animating
- [ ] Send `agent_version` on connect
- [ ] Graceful shutdown on SIGTERM
- [ ] Resource limits in the manifest (128Mi / 100m is plenty)

### Backend
- [ ] `POST /clusters` — create row, mint `aika_<clusterid>_<random>`, store `sha256(token)` only
- [ ] Return the token exactly once, in the install command; never retrievable again
- [ ] `WS /agent/connect` — authenticate against the hash, mark online, hold the socket
- [ ] Heartbeat watchdog → mark `offline` after 90s of silence
- [ ] `remoteAgentSource(clusterId)` — dispatch job, await evidence, 60s timeout
- [ ] Clean failure path: "agent offline, last seen X" instead of a hung request
- [ ] `DELETE /clusters/:id` — delete row **and** close the socket
- [ ] Reject agents below a minimum protocol version with a clear message

---

## Phase 4 — Install script

- [ ] `install/aika-agent.yaml`: Namespace, ServiceAccount, Secret, Deployment
- [ ] Read-only ClusterRole: get/list/watch on pods, pods/log, events, deployments, replicasets, services, endpoints, nodes
- [ ] ClusterRoleBinding
- [ ] `install/install.sh` served from the backend at `/install.sh`
- [ ] Preflight: kubectl on PATH, cluster reachable, RBAC create allowed, k8s ≥ 1.24
- [ ] Flags: `--token`, `--server`, `--dry-run`, `--namespaces a,b` (Role instead of ClusterRole), `--uninstall`
- [ ] Idempotent (`kubectl apply`), safe to re-run
- [ ] Waits for rollout, prints `✓ cluster registered`
- [ ] Detect distro (k3s / EKS / GKE / AKS / kind / OpenShift) and report it on connect
- [ ] Test on kind
- [ ] Test on the EC2 k3s cluster
- [ ] Test on one managed cluster (EKS/GKE free tier) if available

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
