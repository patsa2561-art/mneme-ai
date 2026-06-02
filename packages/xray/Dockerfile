# Mneme X-Ray server — production image.
# Build context MUST be the monorepo root:  docker build -f packages/xray/Dockerfile -t mneme-xray .
FROM node:22-bookworm-slim AS build
WORKDIR /app
# git is required at RUNTIME (shallow-clone + analyse public repos) and build time
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/xray/package.json packages/xray/
RUN npm ci --ignore-scripts --workspace @mneme-ai/core --workspace @mneme-ai/xray --include-workspace-root || npm install --ignore-scripts
COPY packages/core packages/core
COPY packages/xray packages/xray
RUN npx tsc -b packages/xray

FROM node:22-bookworm-slim AS run
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 XRAY_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/xray/dist ./packages/xray/dist
COPY --from=build /app/packages/xray/public ./packages/xray/public
COPY --from=build /app/packages/xray/package.json ./packages/xray/package.json
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8787) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/xray/dist/server.js"]
