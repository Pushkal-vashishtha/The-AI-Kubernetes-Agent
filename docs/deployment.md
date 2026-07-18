# Deployment Guide

How to take this project from "runs on my machine" to something you can link
on a resume. Three paths, in increasing order of effort and impressiveness —
do them in order; each builds on the last.

## Step 0 — Publish the repo (do this first, it costs nothing)

The project is not a git repository yet. `.gitignore` already excludes
`.env` (both backends and frontend secrets), so publishing is safe — but
verify before the first push:

```bash
cd ai-kubernetes-agent
git init -b main
git add .
git status              # confirm NO .env files are staged
git commit -m "AI Kubernetes troubleshooting agent"
gh repo create ai-kubernetes-agent --public --source . --push
```

Then make the repo tell the story in 30 seconds (recruiters give you less):

- The README already has objective, architecture, and results — keep it
  first-person and specific.
- Record a **30–60s demo GIF/video**: apply `01-crashloopbackoff.yaml`,
  click Investigate, show the diagnosis card. Embed it at the top of the
  README. This is the single highest-value deployment artifact for a resume
  — most reviewers will never run your code.
- Add topics: `kubernetes`, `ai-agent`, `llm`, `devops`, `sre`, `react`,
  `express`.

## Path A — Local/demo deployment (what exists today)

`docker compose up --build` runs both services; the backend needs a
kubeconfig it can reach (see "Cluster access" in the README). This is the
honest baseline: **"containerized, one-command bring-up"** is already a
resume line. Nothing new to build.

## Path B — Live on the internet with one VPS (~$5/month)

Best effort-to-impressiveness ratio: one small VM runs a real Kubernetes
cluster **and** the app, so your live demo investigates a real cluster.

> **Doing this on AWS EC2?** There's a full copy-paste walkthrough in
> [deployment-ec2.md](deployment-ec2.md) — instance launch, k3s, systemd,
> DuckDNS + Caddy HTTPS, seeding, costs, and teardown. The outline below is
> the provider-agnostic short version.

1. Get a small VM (EC2 t3.small / Lightsail / Hetzner CX22, Ubuntu 24.04).
2. Install **k3s** (a real, CNCF-certified lightweight Kubernetes):

   ```bash
   curl -sfL https://get.k3s.io | sh -
   ```

3. Clone the repo on the VM; point the backend at k3s:

   ```bash
   # backend/.env
   KUBECONFIG_PATH=/etc/rancher/k3s/k3s.yaml
   ```

   (k3s's kubeconfig uses `127.0.0.1:6443` — reachable because the backend
   runs on the same host; run the backend with node/pm2, not in Docker,
   or mount the kubeconfig and use `network_mode: host`.)

4. Seed a failure scenario in k3s so visitors always see a real diagnosis:

   ```bash
   kubectl create namespace failure-lab
   kubectl apply -f test-scenarios/02-imagepullbackoff.yaml
   ```

5. Put **Caddy** (or nginx) in front for HTTPS: frontend static build on
   `/`, backend proxied on `/api` (set `VITE_API_BASE_URL` accordingly at
   build time). A `$3` domain or the VM's IP both work; Caddy gives you
   automatic TLS with two lines of config.
6. InsForge (auth, history, realtime) is already cloud-hosted — nothing to
   deploy there. Add your domain to the allowed origins if CORS blocks you.

Security notes you should be able to defend in an interview:

- The demo login: create a dedicated demo user; never expose the InsForge
  **admin** key to the frontend (it lives only in `backend/.env`).
- The backend can read the whole cluster — on a shared/important cluster
  you would scope it down (see Path C's RBAC); on a throwaway demo VM the
  blast radius is the demo itself.
- Rate-limit `/investigate` (each call costs an LLM request) — one line of
  `express-rate-limit` is enough for a demo.

## Path C — Run the agent *inside* the cluster (the DevOps flex)

The strongest interview story: the agent is deployed into the very cluster
it diagnoses, using Kubernetes-native auth instead of a kubeconfig file.

What it takes (this is the "future scope" item, roughly a day of work):

1. **RBAC**: a ServiceAccount bound to a **read-only** ClusterRole (`get`,
   `list` on pods/events/deployments/services/endpoints + `pods/log`).
   kubectl inside a pod automatically uses the ServiceAccount token — the
   executor code needs no changes.
2. **Manifests/Helm**: Deployment + Service for backend and frontend, an
   Ingress in front, secrets from `kubectl create secret` (or
   External Secrets) instead of `.env` files.
3. **CI/CD**: GitHub Actions workflow — build both images, push to GHCR,
   `kubectl apply` (or `helm upgrade`) on merge to main. Add a job that
   spins up a kind cluster, applies a failure scenario, calls
   `/investigate`, and asserts on the diagnosis: that's an **automated e2e
   test of an AI agent in CI**, which very few resumes can claim.

Talking point: explain *why* in-cluster is better — no kubeconfig secret to
manage, credentials are short-lived and auto-rotated, access is scoped by
RBAC and auditable via the API server audit log.

## What to put on the resume

> Built an AI-powered Kubernetes troubleshooting agent (React/TypeScript,
> Node/Express, OpenRouter LLM) that investigates live clusters via kubectl —
> collecting pod/log/event/deployment/network evidence — and produces root
> causes with fixes at 95–98% confidence across five verified failure
> classes (CrashLoopBackOff, ImagePullBackOff, OOMKilled, service selector
> mismatch, failed rollouts); features multi-cluster support, realtime
> progress via Postgres triggers, RLS-secured history, and deterministic
> fallbacks when the cluster or LLM is unavailable.

Trim to taste — but keep the numbers (5 failure classes, 95–98%, ~40s) and
the reliability engineering (fallbacks, RLS, injection-safe kubectl), because
those are what interviewers dig into. See
[interview-prep.md](interview-prep.md) for the questions to expect.
