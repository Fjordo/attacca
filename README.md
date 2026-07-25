# Attacca

**Setlist della band.** App web per far studiare la scaletta di un concerto. Carica una lista di brani (link YouTube) in un ordine preciso e li riproduce **in sequenza, senza dover toccare nulla tra un pezzo e l'altro**.
Un amministratore ordina i brani e condivide la scaletta con un link (via WhatsApp) che apre direttamente quell'evento.

## Cosa fa

- **Riproduzione continua**: apri un evento, premi *Avvia* una volta, e i brani partono uno dopo l'altro nell'ordine impostato. Avanzamento automatico, con pulsanti precedente / play-pausa / successivo e tocco su un brano per saltarci.
- **Gira lato client**: una volta caricata la lista, la logica di riproduzione è tutta nel browser. L'app è una PWA installabile e apribile offline.
- **Admin**: crea eventi, aggiungi brani incollando i link YouTube (il titolo viene recuperato in automatico), riordina con trascinamento o frecce, salva.
- **Condivisione**: pulsante *Condividi su WhatsApp*; il link porta a `/e/<id>`, cioè a quell'evento pronto da riprodurre.
- **Import/Export JSON**: la scaletta è un semplice JSON. Da Admin, *Esporta JSON* la scarica e *Carica lista da file* la rimette nell'editor come bozza: niente viene scritto sul server finché non premi *Salva*, che crea sempre un evento **nuovo** senza toccare quelli esistenti.
- **Prova al volo (senza server)**: trascinando un file `.json` sulla home, la scaletta viene riprodotta solo lì, in locale, senza essere salvata da nessuna parte. Scorciatoia non pubblicizzata nell'interfaccia.

## Struttura

```text
server.js          API eventi (JSON su file) + serve la SPA + proxy oEmbed
public/
  index.html       home + player
  admin.html       area amministratore
  js/common.js     parsing YouTube, API, cache offline
  js/player.js     player con avanzamento automatico
  js/admin.js      editor e riordino
  css/styles.css   tema "palco/tungsten"
  sw.js            service worker (offline)
test/              test automatici (Vitest + jsdom)
Dockerfile, fly.toml
```

## Formato della scaletta (JSON)

```json
{
  "name": "Live @ Circolo",
  "date": "2026-07-25",
  "place": "Circolo Arci, Perugia",
  "songs": [
    { "title": "Pezzo 1", "url": "https://youtu.be/xxxxxxxxxxx", "start": 0 }
  ]
}
```

`date` e `place` sono campi separati. La data è sempre in ISO `AAAA-MM-GG` — il
formato di `<input type="date">` — e viene mostrata all'utente come `25 lug 2026`;
un valore in altro formato viene scartato in import e al salvataggio. `place` è
testo libero.

`start` (secondi) è opzionale e fa partire il brano da un punto preciso. In import va bene anche un semplice array di URL: `["https://youtu.be/...", "..."]`.

## Avvio in locale

```bash
npm install
ADMIN_PASSWORD="la-tua-password" npm start
# apri http://localhost:8080  (admin: http://localhost:8080/admin)
```

Se lanci senza `ADMIN_PASSWORD`, in sviluppo il server ne genera una a caso e la
stampa all'avvio. In produzione (`NODE_ENV=production`, come nel Dockerfile) la
variabile è obbligatoria: senza, il server si rifiuta di partire.

## Test

```bash
npm test          # una passata
npm run test:watch
```

Girano con **Vitest**. I test dell'interfaccia stanno su **jsdom**: caricano il
vero `index.html` e i veri moduli di `public/js/`, e fingono solo la IFrame API di
YouTube (che non è riproducibile fuori dal browser). La parte più importante è
`test/player.test.js`: copre i modi in cui il lettore si bloccava a metà scaletta —
player che non emette `onError`, fine brano, salti annullati, pausa dell'utente.

`test/server.test.js` gira invece in ambiente node: apre il server vero su una
porta a caso e lo interroga via HTTP, con `NODE_ENV=production` perché è la
configurazione che va in rete. Copre login, integrità e scadenza del token di
sessione, difesa CSRF, freno ai tentativi e il giro completo di un evento.

## Deploy su Fly.io

1. Installa e accedi:

   ```bash
   # https://fly.io/docs/hands-on/install-flyctl/
   fly auth login
   ```

2. Dalla cartella del progetto:

   ```bash
   fly launch --no-deploy      # conferma/adatta il nome app in fly.toml
   fly volumes create attacca_data --size 1 --region cdg   # 1 GB, stessa region
   fly secrets set ADMIN_PASSWORD="scegli-una-password-robusta"
   fly deploy
   ```

3. Apri l'app:

   ```bash
   fly open
   ```

Il volume montato su `/data` conserva `events.json` tra un deploy e l'altro.
La password admin è un *secret*, non finisce nel codice.

Il server gira come utente `node`, non come root: `docker-entrypoint.sh` parte da
root solo per dare al volume appena montato il proprietario giusto, poi scende di
privilegi ed esegue il `CMD`.

## Come funziona l'accesso admin

La password si inserisce una volta sola, su `/admin`. In cambio il server manda un
cookie di sessione `HttpOnly` che dura 12 ore: il JavaScript della pagina non può
leggerlo e la password non viene conservata dal browser. *Esci* chiude la sessione
subito; cambiare `ADMIN_PASSWORD` invalida da sé tutte quelle ancora aperte.

## Punto 3 del brief — ordine suggerito da un modello (per il futuro)

Per ora l'ordine lo decide l'admin. Il codice è già predisposto: la scaletta è una
lista ordinata di brani, quindi in seguito basterà aggiungere in `admin.js` un
pulsante "Suggerisci ordine" che invia i titoli a un endpoint (`/api/suggest-order`)
il quale interroga un modello e restituisce il nuovo ordine, che l'admin può accettare
o modificare. Nessuna modifica strutturale necessaria.
