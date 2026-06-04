FROM node:22-slim

WORKDIR /app

# Abhängigkeiten zuerst (Build-Cache)
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY . .

# Datenbank + Fotos liegen unter DATA_DIR (=/data) – dort die persistente Platte mounten.
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
