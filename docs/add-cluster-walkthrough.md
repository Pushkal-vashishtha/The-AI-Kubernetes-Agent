# Add Cluster — End-to-End Walkthrough Checklist

Manual test of the Phase 5 "Add cluster" flow against **production**
(https://ai-k8s-agent.duckdns.org), using the local kind cluster as the target.

Run terminal steps in **Git Bash** (the install command is `curl … | bash`).
Do this from a network that does **not** block `*.duckdns.org`.

Legend: `[ ]` todo · `[x]` done · `[!]` failed (note what you saw)

---

## 1. Prepare the kind cluster

- [ ] Start the kind node: `docker start kubernetes-one-control-plane`
- [ ] Point kubectl at it: `kubectl config use-context kind-kubernetes-one`
- [ ] `kubectl get nodes` shows **Ready**
- [ ] Demo workload exists: `kubectl -n failure-lab get pods` shows `web-frontend` in `ImagePullBackOff`
      (if missing: `kubectl create ns failure-lab` then `kubectl apply -f test-scenarios/02-imagepullbackoff.yaml`)

## 2. Create the cluster in the dashboard

- [ ] Open https://ai-k8s-agent.duckdns.org and sign in
- [ ] Click **+ Add cluster**
- [ ] **Create cluster** is disabled while the name is empty
- [ ] Enter `walkthrough-test`, click **Create cluster**
- [ ] Install command is shown with a yellow **"won't be shown again"** warning
- [ ] Click **Copy** — button changes to **Copied**
- [ ] Dialog shows **"Waiting for the agent to connect…"** (leave it open)

## 3. Install the agent

- [ ] Paste the copied command in Git Bash:
      `curl -sSL https://ai-k8s-agent.duckdns.org/install.sh | bash -s -- --token aika_...`
- [ ] Output ends with, in ~20–30s:
  - [ ] `✓ Cluster reachable: context kind-kubernetes-one`
  - [ ] `✓ Applied manifest (namespace aika-system)`
  - [ ] `✓ Agent pod running`
  - [ ] `✓ Cluster registered`
- [ ] **Dialog flips to "Connected — kind" on its own** (no page refresh)

## 4. Investigate through the agent

- [ ] Click **Done**
- [ ] `walkthrough-test` card shows **Connected** and an **AGENT** badge
- [ ] Click the card — progress steps animate
- [ ] Diagnosis names the **web-frontend ImagePullBackOff** (bad image tag)
- [ ] New row appears in **Recent investigations** with cluster `walkthrough-test`

## 5. Remove the cluster

- [ ] (Optional) open the site in a second tab to watch it update live
- [ ] Hover the `walkthrough-test` card, click the **×** in its corner
- [ ] Inline confirmation appears (not a browser popup) — click **Remove**
- [ ] Card disappears
- [ ] Card also disappears in the second tab, without refresh
- [ ] Investigation history row is still there

## 6. Clean up kind

Removing the cluster disconnects the agent, but its pod stays and keeps restarting.

- [ ] `curl -sSL https://ai-k8s-agent.duckdns.org/install.sh | bash -s -- --uninstall`
- [ ] Output: `✓ Agent removed`
- [ ] `kubectl get ns aika-system` returns **NotFound**

---

## Troubleshooting

| Symptom | Check |
|---|---|
| Installer stuck at "Waiting for the agent to register" | `kubectl -n aika-system logs deploy/aika-agent` |
| Pod stuck in `ImagePullBackOff` | kind can't reach ghcr.io — check the laptop's internet access |
| "The backend rejected this agent" | Token copied partially — remove the cluster and add it again |
| Installer succeeded but dialog never says "Connected" | Refresh; if the card now shows Connected, the live update failed — report it |
| Card shows "Offline" right after install | `kubectl -n aika-system get pods` — pod may still be starting |

## Results

- Tested by: ______  Date: ______
- Anything that did not match: 
