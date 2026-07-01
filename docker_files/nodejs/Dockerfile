# === STAGE 1: Build & Prune ===
FROM node:20-alpine AS builder

WORKDIR /app

# Zuerst NUR die package.json kopieren.
# Dadurch wird "npm ci" NUR neu ausgeführt, wenn du neue Pakete installierst!
COPY ./docker_files/nodejs/package*.json ./
RUN npm ci

# Unnötige Dev-Abhängigkeiten entfernen
RUN npm prune --production && npm cache clean --force


# === STAGE 2: Finale schlanke Produktions-Umgebung ===
FROM node:20-alpine

# WICHTIG: Die System-Pakete direkt als ALLERERSTES installieren!
# Da sich diese Liste nie ändert, cached Docker diesen Schritt für immer.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Die vorbereiteten node_modules kopieren (kommt auch meistens aus dem Cache)
COPY --from=builder /app/node_modules ./node_modules
COPY ./docker_files/nodejs/package.json ./

# Als ALLERLETZTES die app.js kopieren.
# Da sich dein Code am häufigsten ändert, steht er ganz unten, damit er keinen Cache davor zerstört.
COPY ./docker_files/nodejs/app.js .

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

CMD ["node", "app.js"]