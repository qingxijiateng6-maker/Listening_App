FROM node:20-bookworm-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
COPY tsconfig.json ./
COPY vitest.config.ts ./

RUN npm ci

COPY src ./src

RUN npm run build \
  && npm prune --omit=dev

FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
  && pip3 install --no-cache-dir yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
