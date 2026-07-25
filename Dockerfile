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

# Niente root: l'immagine node porta già l'utente "node". Se un domani salta
# fuori una RCE in una dipendenza, non parte con i privilegi massimi del
# container. Il codice dell'app non deve essere scrivibile dal processo che lo
# esegue, quindi /app resta di root: al server basta leggerlo.
RUN chmod +x docker-entrypoint.sh

# Il container parte da root solo per sistemare i permessi del volume montato,
# poi l'entrypoint scende a "node" prima di eseguire il CMD.
EXPOSE 8080

# Usa la fetch di Node: nell'immagine slim non c'è curl e non vale la pena
# installarlo per una riga.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/events').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
