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

- [x] **Local-cluster status flapped between machines** -- fixed in 78608b5: local rows carry
      `host` (migration 20260914125007, `LOCAL_CLUSTER_HOST`, default hostname); each backend
      reconciles only its own rows and claims unclaimed legacy rows it can see. `GET /clusters`
      reports `available`; investigating another host's local cluster is a clear 503.
      Verified locally: laptop claimed its 3 kind contexts, left `aws-k3s` untouched and online.
      Verified in production after deploy: EC2 sync "1 claimed, 0 offline" (claimed `aws-k3s` as
      `ip-172-31-17-13`, laptop rows untouched); through Caddy, `available` true for EC2's cluster
      and false for a laptop-tagged one, 503 naming `DESKTOP-SGN6CML` for the latter, and EC2's
      own cluster still diagnosed at 100%
- [x] Production demo re-seeded (`failure-lab/web-frontend`, ImagePullBackOff); live app
      diagnoses it at 100%
- [x] Migrations moved into the repo (`ai-kubernetes-agent/migrations/`, byte-identical);
      InsForge CLI linked from the repo root; old folder renamed
      `D:\Devops\migrations.moved-to-repo` with a pointer README

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
- [x] Test the agent on the EC2 k3s cluster -- from inside EC2, the served installer with
      **default image and server** pulled `ghcr.io/pushkal-vashishtha/aika-agent:0.1.0`,
      registered over `wss://` through Caddy in 23s, and an investigation through it found
      the demo's root cause at 100%; uninstalled and deleted afterwards
- [ ] Test on one managed cluster (EKS/GKE free tier) if available
- [x] Publish the agent image -- `.github/workflows/agent-image.yml` (5b5f075) builds amd64+arm64
      with `GITHUB_TOKEN`; `:edge` tracks main, a version tag is never overwritten.
      `0.1.0` and `edge` confirmed anonymously pullable (package is public)

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

- [x] "Add Cluster" dialog: name -> one-time install command with copy button; token held only in
      component state (never storage), dropped on close; localhost-API hint for kind
- [x] Live "waiting for agent…" -> "Connected" via the `clusters:user:<id>` channel
      (probed with the frontend SDK + a real agent on kind: pending/online/offline delivered
      ~2s after each change; `realtime.messages.ws_audience_count` = 1 for each)
- [x] `ClusterSelector.tsx`: status dot + label (Ready / Connected / Waiting for agent /
      Offline with last-seen / other backend), `agent` vs `kubeconfig` badge, unusable cards
      disabled with the reason
- [x] Empty state -> "Add your first cluster"
- [x] `useClusters` / `useInvestigation` switched to `cluster_id`; default target = the only
      available cluster
- [x] Remove cluster (agent clusters) with inline confirmation -- no browser `confirm()`
- [ ] Cluster detail view (agent version, distro, rotate token) -- rotation is a Phase 6 backend item
- [x] Friendly errors: 409 duplicate name, 503 offline / other backend surface via the API `message`
- [x] `npm run build` clean (tsc + vite)
- [x] Deletions published too: migration 20260914130704 adds an AFTER DELETE trigger
      (`status: "deleted"`); probed arriving ~0.8s after the DELETE
- [ ] **Browser walkthrough** -- not done: the Claude-in-Chrome extension was not connected.
      Dev servers left running at http://localhost:3000 for a manual check
- [ ] Deploy (push) -- held until the UI has been looked at

---

## Phase 6 — Hardening

- [x] **Evidence redaction in the collector** (`packages/collector/src/redact.js`), applied to every
      string in all five evidence sections at the end of `collectEvidence()` -- so the agent strips
      secrets *inside the user's cluster*, before anything is sent. Rules: private keys, JWTs,
      bearer tokens, `scheme://user:PASSWORD@host`, AWS access keys, GitHub / Slack / Google /
      `sk-` API keys, `aika_` agent tokens, InsForge `ik_` keys, and `*PASSWORD*/*SECRET*/*TOKEN*/*KEY*`
      assignments. Keeps the key name and host; drops only the value
- [x] Redaction cannot be switched off; `AIKA_REDACT_PATTERNS` (JSON array or one regex per line)
      only adds rules, read by both the agent and the backend. An invalid pattern is skipped with a
      warning, never a crash
- [x] `investigation.redactions` = `{ total, by_kind }` -- counts only, not sent to the LLM
- [x] **Gap found after deploy, fixed:** pushing redaction rebuilt only `:edge` -- the publish
      workflow never overwrites a version tag, and the agent was still `0.1.0` -- so the installer's
      default image (`0.1.0`, digest `979d9d…`, no `redact.js`) shipped an agent that did not redact,
      while the backend trusted agent evidence as already redacted. Production exposure: none
      (0 agent clusters in the database, no `aika-system` namespace on the production cluster).
      Fix: the backend now also redacts evidence that arrives from agents (defense in depth; a no-op
      for clean text), and the agent is bumped to `0.2.0` with the installer defaulting to it.
      3 tests in `backend/test/agent-evidence-redaction.test.js`.
      **Lesson:** any change under `agent/` or `packages/` must bump `agent/package.json`, or the
      published version tag silently stays stale
- [x] Unit tests: 29 (`npm test`), including text that must survive (`DATABASE_URL is missing`,
      `secret "db-creds" not found`, image tags, probe URLs)
- [x] **Verified live** with `test-scenarios/06-leaky-secrets.yaml` (secrets on the error lines the
      log filter keeps): `redactions.total = 3` (url_password, jwt, api_key); none of the planted
      values in the API response, the stored `investigations` row, or the LLM output; diagnosis
      still correct (98%). A first attempt with secrets on non-error lines redacted nothing because
      the log filter had already dropped them -- the scenario now documents why
- [x] **Per-user investigation limit** (`backend/src/api/investigation.limiter.js`): one running at
      a time, `INVESTIGATE_MAX_PER_HOUR` (default 20) in a rolling hour; 429 + `Retry-After`.
      Counted only once the investigation will really run (a bad cluster id or offline agent costs
      nothing). 5 unit tests with a fake clock; verified live: concurrent second request -> 429,
      next request after the first finished -> 200
- [x] Evidence caps: `problematic_pods`, `unhealthy_deployments` and network `issues` capped at
      `EVIDENCE_LIST_CAP` (20) in `collectEvidence`, *after* `issues_found` is counted so counts stay
      exact; logs (5 pods / 50 tail / 20 relevant lines) and events (30 findings) were already capped.
      `investigation.truncation` records `{ shown, total }` per cut list. 3 unit tests with a fake client
- [x] Tell the LLM explicitly what was truncated: the prompt gains a NOTE line ("unhealthy pods:
      showing 20 of 137 ...") only when something was cut
- [ ] Namespace-scoped install (collector needs per-namespace listing first)
- [x] Token rotation: `POST /clusters/:id/rotate-token` (owner-only, agent clusters only) mints a new
      token, stores only its hash, sets status `pending`, and closes the live socket with **4001** --
      the code every agent version (including the published 0.1.0) already treats as fatal, so the
      old agent exits instead of redialing with a dead token. UI: "Rotate" on agent cluster cards
      opens a confirm-then-install-command dialog (install panel shared with Add cluster).
      **Verified live (12/12):** agent A exits with `4001: token rotated`, cluster -> pending, old
      token -> 401, agent B with the new token connects, investigation through it works, unknown
      cluster -> 404
- [x] Agent upgrade notice: `LATEST_AGENT_VERSION` + `isAgentOutdated` in `@aika/protocol`;
      `GET /clusters` returns `update_available` for agent clusters; the hub logs a warning when an
      old agent connects; the cluster card says "Agent x.y.z is out of date · Rotate for a fresh
      install command" (the new command uses the latest image). `backend/test/versions.test.js`
      fails if agent/package.json, AGENT_VERSION, install.sh's default image and the protocol
      constant ever disagree -- the drift that shipped 0.1.0 without redaction
- [ ] Limits are per backend process (in-memory, like the agent hub) -- a second backend instance
      would need a shared store

### Phase 5 follow-up
- [x] "Other backend" card label truncated the host name -- now `On <host>` first

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
