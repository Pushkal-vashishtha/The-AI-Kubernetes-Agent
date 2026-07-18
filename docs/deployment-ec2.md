# Deploying to AWS EC2 — step-by-step

This guide takes the project from your laptop to a **public HTTPS URL** on a
single **free-tier** EC2 instance (`t3.micro`). The same machine runs a real
Kubernetes cluster (k3s), so your live demo investigates a real cluster — not
a mock.

**What you'll learn doing this** (all legitimate interview material):

- Provisioning EC2: AMIs, instance types, key pairs, security groups, and
  staying inside the free tier (including its billing traps)
- Running a CNCF-certified Kubernetes distribution (k3s) on a VM
- Managing a Node.js service with **systemd** (start on boot, restart on crash)
- Serving a SPA + reverse-proxying an API under one origin with **Caddy**
- Free DNS (DuckDNS) + automatic HTTPS (Let's Encrypt)
- Cloud cost hygiene (budgets, stopping instances, teardown)

## Architecture on the instance

```
                     Internet
                        │
        https://<you>.duckdns.org  (443)
                        │
                ┌───────▼────────┐
                │     Caddy      │  TLS termination, one origin
                │                │
                │  /health       │──► 127.0.0.1:8000  (backend, systemd)
                │  /clusters     │        │
                │  /investigate  │        │ kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml
                │                │        ▼
                │  everything    │   ┌─────────┐
                │  else ────────►│   │   k3s   │  real cluster + seeded failure
                │  frontend dist │   └─────────┘
                └────────────────┘
```

Key decisions (and why):

- **Backend runs on the host, not in Docker** — same lesson we learned locally:
  a containerized backend can't reach a cluster API on `127.0.0.1`. k3s listens
  on the host, so the backend runs on the host too.
- **One origin for frontend + API** — Caddy serves the built frontend and
  proxies the three API routes (`/health`, `/clusters`, `/investigate`) to
  `127.0.0.1:8000`. No CORS issues, no mixed-content issues, and port 8000 is
  never exposed to the internet.
- **HTTPS is not optional** — the copy-to-clipboard button uses
  `navigator.clipboard`, which browsers only allow in secure contexts. A plain
  `http://<ip>` deploy would silently break it (and look worse on a resume).

## Cost — this fits in the AWS free tier

This guide is tuned for the **EC2 free tier**. The classic free tier (first
12 months of an account) covers the whole setup running 24/7:

| Item | Free-tier allowance | This setup |
|---|---|---|
| EC2 `t3.micro` (2 vCPU, 1 GB) | 750 h/month | one instance 24/7 ≈ 730 h ✔ |
| EBS gp3 storage | 30 GB | 20 GB root volume ✔ |
| Public IPv4 | 750 h/month in use | free while the instance runs ✔ |
| DuckDNS, Let's Encrypt, k3s, Caddy | — | free forever ✔ |

**$0/month**, as long as you run exactly one instance and stay inside the
12-month window. (If your account is on the newer credits-based free plan —
accounts created after mid-2025 get ~$100 of credits instead of the 750-hour
tier — the same setup just draws down credits slowly.)

Things that CAN sneak onto a "free" bill — avoid all three:

- An **Elastic IP sitting idle** while the instance is stopped. We skip
  Elastic IPs entirely (Step 2) for exactly this reason.
- A **second instance** in the same month — 750 h is a monthly pool, not
  per-instance.
- Forgetting the instance running after the 12-month window ends.

Set a budget alert first: AWS Console → **Billing → Budgets → Create budget**
→ use the **Zero spend budget** template with an email alert. Do this before
launching anything; it's the seatbelt.

Making 1 GB of RAM work takes three tricks, all baked into the steps below:
2 GB of swap (Step 4), a trimmed k3s (Step 5), and building the frontend on
your laptop instead of on the server (Step 10). It's snug, but it's a demo
box, not production — and saying exactly that in an interview is a feature.

---

## Step 1 — Launch the instance

AWS Console → EC2 → **Launch instance** (pick a region near you, e.g.
`ap-south-1` Mumbai):

1. **Name**: `ai-k8s-agent`
2. **AMI**: Ubuntu Server 24.04 LTS (64-bit x86)
3. **Instance type**: `t3.micro` — it carries the **Free tier eligible**
   label in the console (in the few regions where it doesn't, `t2.micro` is
   the eligible one; either works here)
4. **Key pair**: Create new → name `ai-k8s-agent-key`, type RSA, format
   `.pem` → it downloads once, keep it safe (e.g. `D:\Devops\keys\`).
5. **Network settings → Edit** — create a security group with exactly:

   | Type | Port | Source | Why |
   |---|---|---|---|
   | SSH | 22 | **My IP** | admin access, only from you |
   | HTTP | 80 | Anywhere (0.0.0.0/0) | Let's Encrypt challenge + redirect to 443 |
   | HTTPS | 443 | Anywhere (0.0.0.0/0) | the app |

   **Do not open 8000 or 6443.** The backend and the k3s API are reachable
   only from inside the instance — that's the security posture, and it's an
   interview talking point.
6. **Storage**: 20 GiB gp3 (free tier includes 30 GiB — stay at or below).
7. Launch.

## Step 2 — Your public IP (why we skip Elastic IPs)

Once the instance is running, EC2 → Instances → select it → copy its
**Public IPv4 address**. Call it `<PUBLIC-IP>` below.

We deliberately do **not** allocate an Elastic IP: an EIP is free only while
attached to a *running* instance, and it starts billing the moment you stop
the instance to save free-tier hours — the exact trap the free tier sets.
The trade-off: **every stop/start gives you a new public IP**, so after each
start you spend 30 seconds updating DuckDNS (Step 9) with the new address.
Your domain and HTTPS certificate are unaffected — they're tied to the
hostname, not the IP.

## Step 3 — Connect from Windows

From PowerShell:

```powershell
ssh -i D:\Devops\keys\ai-k8s-agent-key.pem ubuntu@<PUBLIC-IP>
```

If ssh complains the key is too open, fix the file's ACLs:

```powershell
icacls D:\Devops\keys\ai-k8s-agent-key.pem /inheritance:r /grant:r "$env:USERNAME`:R"
```

Everything below runs **on the instance** unless marked otherwise.

## Step 4 — Base packages, Node 20, swap

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get -y install git curl

# Node 20 LTS (matches the version the project was built against)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get -y install nodejs
node -v   # v20.x
```

Add 2 GB of swap — **not optional on a 1 GB instance**; k3s plus the Node
backend won't fit in RAM alone, and without swap the kernel starts killing
processes:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## Step 5 — Install k3s (the cluster the agent will investigate)

```bash
curl -sfL https://get.k3s.io | sh -s - \
  --write-kubeconfig-mode 644 \
  --disable traefik \
  --disable metrics-server
```

Each flag matters:

- `--write-kubeconfig-mode 644` makes `/etc/rancher/k3s/k3s.yaml` readable by
  the `ubuntu` user, so the backend (which runs as `ubuntu`) can use it.
  Without it the kubeconfig is root-only and every `kubectl` call fails with
  `permission denied`.
- `--disable traefik` is **required for this architecture**, not a memory
  optimization: k3s ships the Traefik ingress controller, and its bundled
  load balancer claims host ports **80 and 443**. Left enabled, it silently
  intercepts all web traffic before Caddy ever sees it — the site serves
  Traefik 404s and certificate issuance fails. Caddy is our only web entry
  point, so Traefik has no job here.
- `--disable metrics-server` frees ~50–70 MB of RAM we need on a 1 GB box;
  the agent's inspectors don't use the metrics API.
- k3s installs a `kubectl` binary and registers itself with systemd, so the
  cluster starts on boot automatically.

Verify (give it ~30 s):

```bash
kubectl get nodes
# NAME              STATUS   ROLES                  AGE   VERSION
# ip-172-31-x-x     Ready    control-plane,master   30s   v1.3x...
```

The kubeconfig context is named `default` — that's the name that will appear
on the cluster card in the UI.

## Step 6 — Clone the repo

```bash
cd ~
git clone https://github.com/Pushkal-vashishtha/The-AI-Kubernetes-Agent.git
cd The-AI-Kubernetes-Agent
```

(If the repo is private, create a fine-grained personal access token on
GitHub with read access to this repo and clone with
`https://<token>@github.com/...`.)

## Step 7 — Backend: env + smoke test

```bash
cd ~/The-AI-Kubernetes-Agent/backend
npm install
nano .env
```

Paste, filling values from your **local** `backend/.env` (the only line that
differs from local is `KUBECONFIG_PATH`):

```ini
PORT=8000
OPENROUTER_API_KEY=<from local backend/.env>
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
KUBECONFIG_PATH=/etc/rancher/k3s/k3s.yaml
INSFORGE_URL=<from local backend/.env>
INSFORGE_API_KEY=<from local backend/.env>
```

> Getting the values there: open the local files on Windows and paste into
> `nano`, or copy them up first from PowerShell and then edit
> `KUBECONFIG_PATH`:
> `scp -i D:\Devops\keys\ai-k8s-agent-key.pem D:\Devops\ai-kubernetes-agent\backend\.env ubuntu@<PUBLIC-IP>:~/The-AI-Kubernetes-Agent/backend/.env`
> Never commit these files — the repo's `.gitignore` already blocks them.

Smoke test (the `sleep` gives the server a moment to bind the port before
curl hits it):

```bash
node src/server.js &
sleep 2
curl -s localhost:8000/health
echo
kill %1
```

Expected: the server's "listening on port 8000" log line, then
`{"status":"healthy","service":"ai-kubernetes-agent"}`. If instead node
prints a stack trace, read it — the
usual culprits are a missing `npm install` or a missing/typo'd `.env`.

## Step 8 — Backend as a systemd service

```bash
sudo nano /etc/systemd/system/aika-backend.service
```

```ini
[Unit]
Description=AI Kubernetes Agent backend
After=network-online.target k3s.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/The-AI-Kubernetes-Agent/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` matters: the backend loads `.env` relative to it.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aika-backend
systemctl status aika-backend        # active (running)
curl -s localhost:8000/health        # {"status":"healthy",...}
```

Logs whenever you need them: `journalctl -u aika-backend -f`

## Step 9 — Free domain with DuckDNS

Let's Encrypt won't issue certificates for bare IPs, so you need *a* hostname.
DuckDNS gives you one free:

1. Go to <https://www.duckdns.org>, sign in (GitHub/Google).
2. Create a subdomain, e.g. `ai-k8s-agent` → gives you
   `ai-k8s-agent.duckdns.org`. Use your own name below wherever
   `<you>.duckdns.org` appears.
3. Set its IP to your `<PUBLIC-IP>` and click **update ip**.

Remember the trade-off from Step 2: after every instance **stop/start**, come
back here and paste in the new public IP. (While the instance merely runs or
reboots, the IP doesn't change.)

Check it resolves (from anywhere): `nslookup <you>.duckdns.org` → `<PUBLIC-IP>`.

## Step 10 — Frontend: build on your laptop, ship the static files

The frontend is static files after `npm run build` — nothing about the build
has to happen on the server, and a 1 GB instance is the wrong place to run
Vite. So build on Windows and copy `dist/` up.

**On your laptop** (PowerShell), create
`D:\Devops\ai-kubernetes-agent\frontend\.env.production` with the production
values (Vite automatically prefers `.env.production` over `.env` during
`npm run build`, so your local dev `.env` stays untouched — and the
`.gitignore`'s `.env.*` rule keeps this file out of git):

```ini
VITE_API_BASE_URL=https://<you>.duckdns.org
VITE_INSFORGE_URL=<same as local frontend/.env>
VITE_INSFORGE_ANON_KEY=<same as local frontend/.env>
```

`VITE_API_BASE_URL` points at the **public HTTPS origin** — Caddy will route
the API paths to the backend, so frontend and API share one origin.

```powershell
cd D:\Devops\ai-kubernetes-agent\frontend
npm run build
scp -i D:\Devops\keys\ai-k8s-agent-key.pem -r .\dist ubuntu@<PUBLIC-IP>:~/dist
```

**On the server**, publish to a directory Caddy can read (don't serve from
`/home/ubuntu` — home directories are mode 750 on Ubuntu 24.04 and the
`caddy` user can't traverse them):

```bash
sudo mkdir -p /var/www/aika
sudo cp -r ~/dist/* /var/www/aika/
rm -rf ~/dist
```

(On a bigger instance you *could* build on the server instead; on free tier,
don't fight the RAM.)

## Step 11 — Caddy: HTTPS + reverse proxy

Install from the official repo:

```bash
sudo apt-get -y install debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get -y install caddy
```

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace the whole file with:

```
<you>.duckdns.org {
	encode gzip

	@api path /health /clusters /investigate
	handle @api {
		reverse_proxy 127.0.0.1:8000
	}

	handle {
		root * /var/www/aika
		try_files {path} /index.html
		file_server
	}
}
```

```bash
sudo systemctl reload caddy
```

That's the entire TLS story: Caddy sees a real hostname, gets a Let's Encrypt
certificate automatically, renews it forever, and redirects HTTP→HTTPS. Check
`journalctl -u caddy -f` if the certificate doesn't appear within a minute
(usually it means port 80 isn't open in the security group or DNS hasn't
propagated).

**Open `https://<you>.duckdns.org` — you should see the login page.**

## Step 12 — Seed a permanent demo failure

An agent pointed at a healthy empty cluster is a boring demo. Seed the
image-pull scenario — it's the cheapest to keep around (no CPU-burning crash
loops, no restarts, just a pod stuck in `ImagePullBackOff` forever):

```bash
cd ~/The-AI-Kubernetes-Agent
kubectl apply -f test-scenarios/02-imagepullbackoff.yaml
kubectl get pods -n failure-lab   # wait until STATUS shows ImagePullBackOff
```

Now anyone you send the link to can sign in, click the `default` cluster
card, and watch the agent produce a real root-cause diagnosis in ~40 s.

## Step 13 — End-to-end test

1. Open `https://<you>.duckdns.org` (padlock present, no warnings).
2. Sign in.
3. Click the `default` cluster card.
4. Watch the six progress steps stream live, then read the diagnosis — it
   should identify the bad image tag with high confidence.
5. Confirm the copy button works (it will, because you're on HTTPS).
6. Refresh — the investigation appears in History.

If all six pass, you're live. Put the URL in the repo's About section on
GitHub.

---

## Operating it

**Deploying an update** (after pushing changes to GitHub):

```bash
cd ~/The-AI-Kubernetes-Agent && git pull
# backend changed?
cd backend && npm install && sudo systemctl restart aika-backend
```

Frontend changed? Rebuild on your laptop and `scp` the `dist/` up again
(Step 10), then re-run the `cp` into `/var/www/aika`.

**Or skip all of that — CI/CD** (see
[.github/workflows/deploy.yml](../.github/workflows/deploy.yml)): every push
to `main` runs a build/typecheck job on GitHub's runners, and if it passes,
deploys over SSH — pulls the repo on the instance, reinstalls backend deps,
restarts `aika-backend`, health-checks it, and atomically swaps the frontend
(previous build kept at `/var/www/aika-old` for instant rollback). One-time
setup:

1. Generate a dedicated deploy key pair (do **not** reuse the AWS `.pem`):
   `ssh-keygen -t ed25519 -C github-actions-deploy -N "" -f aika-deploy-key`,
   and append `aika-deploy-key.pub` to `~/.ssh/authorized_keys` on the
   instance. (Windows gotcha: transfer the `.pub` with `scp`, not by piping
   text through PowerShell — the pipe adds `\r` line endings that make sshd
   silently reject the key.)
2. GitHub repo → **Settings → Secrets and variables → Actions**:
   - **Secret** `EC2_SSH_KEY` — full contents of the private key file.
   - **Variables** `EC2_HOST` (the DuckDNS hostname, so IP changes don't
     break CI), `VITE_API_BASE_URL`, `VITE_INSFORGE_URL`,
     `VITE_INSFORGE_ANON_KEY`.
3. **Security group**: change the SSH rule's source from "My IP" to
   `0.0.0.0/0` — GitHub-hosted runners have no fixed IP, so a My-IP rule
   blocks the deploy job at `ssh-keyscan`. This is acceptable because the
   instance is key-auth only (EC2 Ubuntu disables password login), so an
   open port 22 can be knocked on but not entered. The stricter alternatives
   — AWS SSM Session Manager instead of SSH, or a workflow step that
   temporarily allowlists the runner's IP via the AWS API — are good
   interview answers and overkill for a demo box.
4. Push to `main` and watch the **Actions** tab.

The frontend is built on GitHub's runners — never on the 1 GB instance —
and production ships the exact artifact CI verified.

**Adding more clusters to the picker**: the UI lists whatever contexts exist
in the kubeconfig at `KUBECONFIG_PATH` — there is no app-side cluster config.
Give the backend its own copy so k3s's file stays untouched:

```bash
mkdir -p ~/.kube
cp /etc/rancher/k3s/k3s.yaml ~/.kube/aika-config
chmod 600 ~/.kube/aika-config
KUBECONFIG=~/.kube/aika-config kubectl config rename-context default aws-k3s
```

Set `KUBECONFIG_PATH=/home/ubuntu/.kube/aika-config` in `backend/.env` and
`sudo systemctl restart aika-backend`. To add another cluster later, copy its
kubeconfig to the box, rename its context to something unique, merge —

```bash
KUBECONFIG=~/.kube/aika-config:/tmp/other.yaml \
  kubectl config view --flatten > ~/.kube/merged
mv ~/.kube/merged ~/.kube/aika-config && chmod 600 ~/.kube/aika-config
```

— and restart the backend. Remote-cluster gotchas: its `server:` URL must be
reachable *from this instance* (never `127.0.0.1`), and its TLS cert must
include that address (k3s: install with `--tls-san <public-ip>`). Note the
copied config embeds client certs that k3s rotates ~yearly — re-copy if auth
errors appear long after setup.

**Pausing (e.g. saving free-tier hours)**: EC2 console → Stop instance.
Everything (k3s, backend, Caddy) is systemd-enabled and comes back on Start
by itself — the only manual step is updating DuckDNS with the instance's new
public IP (Step 9).

**Watching activity**: `journalctl -u aika-backend -f` shows each request;
every investigation is also a row in the InsForge `investigations` table.

**Abuse/cost control**: `/investigate` already requires a signed-in InsForge
user, so anonymous visitors can't spend your OpenRouter credit. If you share
the URL widely, keep an eye on OpenRouter usage — each investigation is one
LLM call.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| Browser can't reach the site at all | DNS not set/propagated (`nslookup`), or 80/443 missing from the security group |
| Site was working, then unreachable after a stop/start | The public IP changed — update DuckDNS with the new one (Step 9) |
| Certificate errors / Caddy log shows ACME failures | Port 80 closed, or DuckDNS still points at an old IP |
| Site shows a bare 404 page that isn't Caddy's | k3s was installed without `--disable traefik` — Traefik is intercepting ports 80/443; reinstall k3s with the Step 5 flags (or `sudo systemctl restart caddy` after disabling Traefik) |
| Site loads but sign-in fails | Check the browser devtools Network tab — if InsForge rejects the request by origin, add `https://<you>.duckdns.org` to the project's allowed origins in the InsForge dashboard |
| Site loads, login works, but Investigate fails with a network error | Backend down — `systemctl status aika-backend`; or the `@api` block missing from the Caddyfile |
| Diagnosis says cluster unreachable | `kubectl get nodes` on the instance; check `KUBECONFIG_PATH` in `backend/.env` and that `k3s.yaml` is mode 644 |
| `kubectl` works for you but not for the service | k3s installed without `--write-kubeconfig-mode 644` — run `sudo chmod 644 /etc/rancher/k3s/k3s.yaml` |
| Instance feels sluggish / random process deaths | Memory pressure — confirm swap is active (`free -h` should show 2 GB); never run `npm run build` on the server |
| Agent diagnoses a "node reboot cascade" right after instance start | Same boot-residue window as local demos — wait ~10–15 min after starting the instance before demoing (see the demo runbook) |

## Teardown (when you're done with it)

1. `EC2 → Instances → Terminate` (deletes the root EBS volume with it).
2. If you ever allocated an Elastic IP: `Elastic IPs → Release` — a held
   unattached IP keeps billing.
3. Delete the security group and key pair if you won't reuse them.
4. Your DuckDNS subdomain just stops resolving; delete it or leave it.

## The resume line this earns you

> Deployed the agent to AWS EC2 (free tier) behind Caddy with automatic
> HTTPS: k3s cluster and Node backend managed by systemd on one t3.micro,
> SPA and API served from a single origin, API and cluster ports never
> exposed publicly; live demo investigates a permanently seeded failure at a
> public URL.

Next level after this: [deployment.md](deployment.md) Path C — move the
backend *into* the cluster with a read-only ServiceAccount, and add GitHub
Actions CI/CD.
