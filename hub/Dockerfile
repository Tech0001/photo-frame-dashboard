FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY lib ./lib
COPY public ./public
ENV PORT=8099 PHOTOS_DIR=/photos DASHBOARD_DIR=/app/dashboard DATA_DIR=/app/data CACHE_DIR=/app/cache \
    HUB_CONFIG=/app/config/config.json HUB_SECRETS=/app/config/secrets.json
EXPOSE 8099
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8099/api/health || exit 1
CMD ["node", "server.js"]
