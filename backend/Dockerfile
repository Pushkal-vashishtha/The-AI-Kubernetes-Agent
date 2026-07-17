FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# kubectl is used by the Kubernetes investigation layer.
ARG KUBECTL_VERSION=v1.33.1
RUN wget -qO /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && chmod +x /usr/local/bin/kubectl

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 8000

CMD ["node", "src/server.js"]
