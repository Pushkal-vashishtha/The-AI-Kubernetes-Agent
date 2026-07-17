# Live Demo Runbook — "Break Kubernetes, let the AI fix it"

A repeatable script for demoing the agent: intentionally break a cluster with
real-world failures, then let the AI investigate, explain the root cause, and
suggest the fix.

## The story you are telling

```text
1. BREAK    kubectl apply a failure manifest   (audience sees a broken app)
2. CLICK    "Investigate" in the dashboard     (one button, no kubectl skills needed)
3. WATCH    live progress: pods → logs → events → deployments → network → AI
4. READ     root cause card: what broke, why, the exact fix, kubectl commands
5. FIX      run the suggested fix, re-investigate → green "healthy" banner
```

The agent works like a two-person SRE team: the backend gathers evidence with
kubectl (junior engineer collecting facts), the LLM correlates it all into a
root cause (senior engineer reasoning). Nothing is hardcoded per scenario —
the same investigation runs every time; only the evidence changes.

## Prerequisites (do this 15+ minutes before the demo)

1. **Start Docker Desktop and wait ~15 minutes.** This matters: right after
   boot, every kube-system pod carries a fresh "crashed during shutdown"
   record, and the agent will (correctly!) diagnose a node-reboot cascade
   instead of your seeded failure. The boot residue ages out of the
   crash-loop detector after 10 minutes.
2. Verify the cluster: `kubectl get nodes` → `Ready`.
3. Start the app (local dev — the containerized backend cannot reach kind):

   ```bash
   cd backend  && npm run dev     # http://localhost:8000
   cd frontend && npm run dev     # http://localhost:3000
   ```

4. Open http://localhost:3000, sign in, confirm the cluster picker shows
   your kubeconfig contexts.
5. Optional dry run: click **Investigate** on a clean cluster → green
   "cluster healthy" banner. This is also a good *opening* for the demo
   ("here's a healthy cluster — now let's break it").

## The five failure scenarios

All manifests live in `test-scenarios/` and deploy into the `failure-lab`
namespace. Each is verified to produce the expected diagnosis.

| # | Manifest                    | What you broke              | What the AI finds                          | Wait before investigating |
|---|-----------------------------|-----------------------------|--------------------------------------------|---------------------------|
| 1 | `01-crashloopbackoff.yaml`  | Missing env variable        | `DATABASE_URL` missing (reads it from logs)| ~1 min (needs a restart or two) |
| 2 | `02-imagepullbackoff.yaml`  | Non-existent image tag      | Bad image `nginx:1.99-does-not-exist`      | ~30 s |
| 3 | `03-oomkilled.yaml`         | 16Mi memory limit           | Container exceeds memory limit             | ~30 s |
| 4 | `04-selector-mismatch.yaml` | Service selector typo       | Service matches zero pods (pods are healthy!) | ~30 s |
| 5 | `05-deployment-failure.yaml`| Readiness probe wrong port  | Rollout stuck, probe hits 8080, app is on 80 | ~90 s (progress deadline) |

Narration tips per scenario:

- **#1 CrashLoopBackOff** — show `kubectl get pods -n failure-lab` first
  (`CrashLoopBackOff`, restarts climbing). Point out the AI quotes the actual
  fatal log line and suggests `kubectl set env ...` with the right variable.
- **#4 Selector mismatch** — the audience-favorite: every pod is green, yet
  the service is dead. Ask "kubectl get pods says everything is fine — now
  what?" before clicking Investigate. The agent finds it via the network
  inspector (service has no matching pods).
- **#5 Readiness probe** — pods show `Running` but `0/1 Ready`. Same trick:
  pod-level checks look fine; the evidence is in deployment conditions
  (`ProgressDeadlineExceeded`) and probe-failure events.

## Demo flow (per scenario)

Run scenarios **one at a time** — one clear root cause per investigation
makes a much better demo than a pile of overlapping failures.

```bash
# once at the start
kubectl create namespace failure-lab

# per scenario
kubectl apply -f test-scenarios/01-crashloopbackoff.yaml
kubectl get pods -n failure-lab          # show the audience the symptom
# ...wait per the table above...
# click "Investigate" in the dashboard, read the diagnosis card aloud

# apply the AI's suggested fix (or just show it), then clean up:
kubectl delete -f test-scenarios/01-crashloopbackoff.yaml
```

Optional "full circle" ending: after fixing (or deleting) the failure,
investigate again → the healthy banner proves the loop closes.

```bash
# once at the end
kubectl delete namespace failure-lab
```

## Bonus beats

- **Multi-cluster picker** — click a different kubeconfig context card and
  investigate it; history rows record which cluster each run targeted.
- **Cluster unreachable** — stop the cluster (or pick the stopped `minikube`
  context) and investigate: the agent returns a deterministic rule-based
  checklist without calling the LLM. Good for the "graceful degradation"
  slide.
- **History table** — every investigation persists (InsForge + RLS); reopen
  the dashboard and the past diagnoses are still there.

## Troubleshooting the demo itself

| Symptom | Cause / fix |
|---|---|
| Diagnosis blames kube-system / node reboot | Cluster booted <10 min ago — wait for boot residue to age out (see Prerequisites) |
| "Cluster unreachable" banner on kind | Backend running in Docker — run it locally with `npm run dev` |
| Scenario pod never fails | You edited the manifest command via CLI args — always `kubectl apply` the YAML (PowerShell mangles `sh -c` args) |
| Diagnosis mixes two problems | Two scenarios applied at once — delete one, re-investigate |
| Healthy cluster still shows issues > 0 | Recent warning events linger ~1 h; the diagnosis card will still say "No active issues detected" |
