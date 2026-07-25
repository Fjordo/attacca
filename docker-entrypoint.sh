#!/bin/sh
# Il volume di Fly viene montato su /data di proprietà di root: se il container
# partisse direttamente come utente "node", il server non riuscirebbe a scrivere
# events.json. Quindi si parte da root il tempo di sistemare i permessi della
# sola cartella dati, e si lasciano subito i privilegi: il processo vero gira
# come "node".
set -e

DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DIR"
  chown -R node:node "$DIR"
  # exec in entrambi i rami: il server resta PID 1 e continua a ricevere il
  # SIGTERM con cui Fly ferma la macchina.
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  exec su node -s /bin/sh -c 'exec "$0" "$@"' -- "$@"
fi

exec "$@"
