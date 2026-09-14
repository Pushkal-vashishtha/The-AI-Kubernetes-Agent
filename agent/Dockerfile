# Build context is the REPO ROOT -- the agent depends on the @aika/collector
# and @aika/protocol workspaces, which live outside this directory.
#   docker build -f agent/Dockerfile -t aika-agent .
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Manifests first so the install layer caches independently of source edits.
# Only the agent's workspaces are installed: no Express, no InsForge SDK, no
# kubectl binary (the agent talks to the API directly).
COPY package.json package-lock.json ./
COPY agent/package.json ./agent/
COPY packages/collector/package.json ./packages/collector/
COPY packages/protocol/package.json ./packages/protocol/
RUN npm ci --omit=dev --workspace @aika/agent --include-workspace-root=false

COPY packages/collector/src ./packages/collector/src
COPY packages/protocol/src ./packages/protocol/src
COPY agent/src ./agent/src

# Unprivileged, fixed UID so a restricted PodSecurity profile can require
# runAsNonRoot without guessing.
USER 1000:1000

CMD ["node", "agent/src/index.js"]
