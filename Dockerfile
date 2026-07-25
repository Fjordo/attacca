FROM node:20-slim

WORKDIR /app

# Installa solo le dipendenze di produzione (sfrutta la cache dei layer).
# npm ci rispetta il lockfile: build riproducibili.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copia il resto dell'app.
COPY . .

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

EXPOSE 8080
CMD ["node", "server.js"]
