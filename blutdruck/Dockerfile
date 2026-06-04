FROM node:22-slim

WORKDIR /app

# Abhängigkeiten zuerst (Build-Cache)
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY . .

# Datenbank + Fotos liegen hier – als Volume mounten, damit nichts verloren geht.
VOLUME ["/app/data", "/app/uploads"]

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
