# Self-contained build context: server.mjs already holds the app's core and data.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.mjs stops.v1.json REVISION ./
ENV NODE_ENV=production MCP_KEYS=/app/keys/keys.json
# The API keys' hashes (mcp/README.md): the one volume, writable by node.
RUN mkdir /app/keys && chown node:node /app/keys
VOLUME /app/keys
USER node
EXPOSE 8049
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||8049)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# 96 MB of heap: tested to fit 256 MB of memory with several plans at once.
CMD ["node", "--max-old-space-size=96", "server.mjs"]
