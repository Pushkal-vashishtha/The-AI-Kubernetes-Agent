# Build context is the REPO ROOT, not backend/ -- the backend depends on the
# @aika/collector and @aika/protocol workspaces, which live outside it.
#   docker build -f backend/Dockerfile .
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# kubectl is used by the local-cluster collection path.
ARG KUBECTL_VERSION=v1.33.1
RUN wget -qO /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && chmod +x /usr/local/bin/kubectl

# Manifests first so the install layer caches independently of source edits.
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY packages/collector/package.json ./packages/collector/
COPY packages/protocol/package.json ./packages/protocol/
# Install only the backend's workspace tree -- the root lockfile also lists
# the agent, which this image neither contains nor needs.
RUN npm ci --omit=dev --workspace ai-kubernetes-agent-backend --include-workspace-root=false

COPY packages/collector/src ./packages/collector/src
COPY packages/protocol/src ./packages/protocol/src
COPY backend/src ./backend/src
# Served at /install.sh.
COPY install ./install

EXPOSE 8000

CMD ["node", "backend/src/server.js"]
