FROM node:24-bookworm-slim AS build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
COPY third-party-licenses/ /app/third-party-licenses/
COPY web/ ./
RUN npm run build:pwa
FROM node:24-bookworm-slim
WORKDIR /app/api
COPY api/package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /app
COPY api/ api/
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY third-party-licenses/ third-party-licenses/
COPY --from=build /app/web/dist/pwa web/dist/pwa
USER node
EXPOSE 3001
CMD ["node", "api/src/server.ts"]
