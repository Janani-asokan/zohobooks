# ---- build ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=10000 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright TZ=Asia/Kolkata
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
# pg_dump for the backup job and fonts with ₹ and Indian scripts. PDFs are printed by Playwright's own headless
# Chromium (always the version the library expects); Debian's Chromium stays installed as a fallback.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client chromium fonts-noto-core fonts-liberation \
 && (node node_modules/playwright-core/cli.js install --with-deps chromium-headless-shell || echo "Playwright headless shell not installed; PDFs will use Debian's Chromium") \
 && mkdir -p /ms-playwright && chmod -R a+rX /ms-playwright \
 && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/migrations ./server/migrations
USER node
EXPOSE 10000
CMD ["node", "server/dist/index.js"]
