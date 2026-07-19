# Interview Prep — AI Kubernetes Troubleshooting Agent

How to present this project in SDE and DevOps interviews: the pitch, the
walkthrough, and the questions you will actually get — with the answers this
codebase backs up.

> Studying the system itself (diagrams, layer-by-layer deep dives, the
> production/CI-CD story, all war stories, and a 7-session prep plan)?
> Start with [project-mastery.md](project-mastery.md) — this doc is the
> Q&A drill companion to it.

## The 30-second pitch

> "I built an AI agent that troubleshoots Kubernetes clusters on demand. You
> sign in, pick a cluster from your kubeconfig, and click Investigate. The
> backend gathers structured evidence with kubectl — pods, logs, events,
> deployments, networking — and an LLM reasons over it like a senior SRE,
> returning a root cause, a plain-language explanation, and the exact
> kubectl commands to fix it. I verified it against five intentionally
> broken scenarios and it diagnosed all of them at 95–98% confidence in
> about 40 seconds each. The interesting engineering is in the reliability:
> injection-safe kubectl execution, graceful degradation at every layer,
> and a deterministic fallback when the cluster or the LLM is unavailable."

## The 2-minute architecture walkthrough

Frontend (React/TS/Tailwind, React Query) → Express API (bearer-token auth
verified server-side against InsForge) → investigation service runs five
inspectors through a kubectl executor (`execFile`, argument arrays) →
evidence payload → prompt builder → OpenRouter LLM (temperature 0, retries,
timeout) → diagnosis JSON → persisted to Postgres (RLS) → **live progress
reaches the browser via a database trigger publishing to a realtime
channel** — the backend only updates a row; the DB does the pushing.

Know this flow cold. Every question below hangs off it.

---

## SDE questions

**Why Express and plain JS on the backend, TypeScript on the frontend?**
The backend is a thin orchestrator — its complexity is in process handling
and error paths, not type-heavy domain logic. The frontend has real data
shapes crossing a network boundary (diagnosis, evidence, history), which is
exactly where TypeScript pays. Being able to justify *where* types earn
their cost is a better answer than "always TypeScript."

**How do you run kubectl safely from a web service?** `execFile` with an
argument array — there is no shell, so user input can never be interpreted
as a command. On top of that, the only user-controlled value that reaches
kubectl (`context`) is validated against the kubeconfig's actual context
list first; unknown values are rejected with a 400 before any process runs.

**How does auth work?** InsForge email+OTP issues a token; the frontend
sends it as a Bearer header; the backend verifies **every request**
server-side against the auth provider — it never trusts the client. History
reads go directly from the browser to the database, protected by row-level
security (users can only read their own rows). Writes come only from the
backend using an admin key that never ships to the browser.

**How does live progress work, and why that design?** A Postgres trigger on
the investigations table publishes each insert/update to a per-user realtime
channel. The backend stays stateless — no websocket bookkeeping, no lost
updates if the backend restarts mid-investigation; the row is the single
source of truth and the DB pushes changes.

**What happens when things fail?** Three independent layers, each degrades
on its own: (1) cluster unreachable → every inspector returns an `error`
field, and a deterministic rule-based diagnosis is returned with **no LLM
call**; (2) LLM fails after retries → evidence still returned with a
readable `ai_error`; (3) frontend maps failures (timeout, backend down,
expired session) to plain-language messages — no stack traces reach users.

**Why temperature 0?** Diagnosis should be reproducible: same evidence, same
conclusion. Creativity is a liability when the output includes commands a
human will run.

**What if the LLM hallucinates a fix?** Three mitigations: the prompt forces
it to cite evidence and report confidence with reasoning; the agent is
read-only, so a human reviews and applies every fix; and the raw evidence is
returned alongside the diagnosis so the claim can be checked. The honest
answer includes the limit: it can still be confidently wrong, which is why
auto-apply is future scope gated behind human approval.

---

## DevOps questions

Be ready to explain each failure class end-to-end — symptom, evidence,
diagnosis, fix — because you have literally built and broken all five:

| Failure | Symptom | The evidence that nails it |
|---|---|---|
| CrashLoopBackOff | Restarts climbing | Fatal line in logs (`DATABASE_URL` missing), non-zero exit code |
| ImagePullBackOff | Pod never starts | Event: image/tag not found |
| OOMKilled | Restarts, exit 137 | `lastState.terminated.reason: OOMKilled` vs the 16Mi limit |
| Selector mismatch | **All pods green**, service dead | Service has zero matching endpoints |
| Failed rollout | Pod `Running` but `0/1 Ready` | Readiness probe events + `ProgressDeadlineExceeded` condition |

The last two are the interview gold: they show why "kubectl get pods says
everything is fine" is not the end of debugging — the failure lives in the
*relationships* between objects, which is exactly what the agent correlates.

**Why is this not an operator/controller?** Operators watch and reconcile
continuously and need write access — a much bigger blast radius and a much
harder trust story. On-demand read-only investigation is the right scope for
a diagnostic tool: a human triggers it, it only reads, a human applies fixes.

**How would you deploy it into the cluster it monitors?** ServiceAccount +
read-only ClusterRole (`get`/`list` on the five resource types plus
`pods/log`); kubectl in a pod picks up the ServiceAccount token
automatically, so no kubeconfig secret exists at all — credentials are
short-lived, rotated, and auditable. (See docs/deployment.md, Path C.)

**Multi-cluster?** kubeconfig contexts, listed via `kubectl config view`,
with `--context` threaded through every call, validated server-side. Each
history row records which cluster it targeted.

**Docker networking gotcha you hit?** A containerized backend can't reach
kind's API server bound to `127.0.0.1` on the host — loopback inside a
container is the container. Options: run the backend on the host, use a
kubeconfig with a reachable address, or run in-cluster. Knowing *why* is a
networking-fundamentals checkmark.

---

## The bug story ("tell me about a hard bug")

Testing the CrashLoopBackOff scenario, the agent found nothing wrong —
sometimes. The pod was crash-looping, but a crash-looper is briefly
**`Running` between restarts**, and detection only read the *current*
container state. Fix: also read `lastState.terminated`. That created the
opposite bug — after a node reboot, every system pod carries an old
"crashed at shutdown" record, so the fix flagged seven healthy kube-system
pods. Final design: flag only if the last failed exit is **recent (10-minute
window)** *and* the container has restarts — an active crash-looper always
has a recent failure because backoff caps at ~5 minutes. Lessons in the
story: state machines lie between transitions; detection needs time
awareness; and the false-positive fix is as important as the false-negative
fix. Bonus ending: days later a real node reboot happened and the agent
correctly diagnosed the reboot cascade from the events timeline — the
"false positive" pattern was a true positive that time.

## Numbers to remember

- **5** verified failure classes, **0** scenario-specific code paths
- **95–98%** diagnosis confidence across scenarios
- **~40s** end-to-end: ~6s kubectl evidence gathering, ~33s LLM reasoning
- **6** investigation steps streamed live; **2** auth-protected endpoints
- **1** LLM call per investigation (and **0** when the cluster is
  unreachable — deterministic fallback)

## Curveballs

- *"How would you scale it?"* — Investigations are stateless and
  independent: horizontal backend replicas behind a load balancer work
  as-is because progress lives in the DB, not in server memory. The real
  bottleneck is LLM latency/cost → queue investigations, cache evidence
  briefly, stream partial results.
- *"Why not just feed `kubectl get all` output to the LLM?"* — Token cost,
  noise, and non-determinism. Structured inspectors pre-correlate evidence
  (this pod's logs, its deployment's conditions), which is why confidence is
  high and the prompt stays small.
- *"What's the security risk of this tool?"* — It executes a binary with
  cluster credentials on behalf of web users. Mitigations in place:
  injection-safe execution, context validation, server-side token checks,
  read-only usage, secrets never reach the client. Next step: in-cluster
  RBAC scoping.
- *"What would you build next?"* — Pick from README future scope, but lead
  with approval-gated auto-fix + the CI e2e suite (kind in GitHub Actions
  asserting on diagnoses) — both are concrete and unusual.
