# Invito all'installazione della PWA

**Data:** 2026-07-30
**Stato:** approvato, da implementare

## Il problema

Aprendo l'app da Edge su Android non compare nessuna proposta di installazione.

## Diagnosi

L'app **è** già una PWA valida. Verificato sull'istanza in rete:

```text
index:    200  text/html
manifest: 200  application/manifest+json
sw:       200  text/javascript
icon512:  200  image/png
```

Manifest completo, icone 192/512 più maskable, service worker con gestore `fetch`,
HTTPS, CSP che non blocca né il manifest né il worker. Niente è rotto.

Manca il fatto che **nessun browser lo dice all'utente in modo affidabile**:

- **Edge su Android** emette `beforeinstallprompt` ma non mostra alcuna infobar
  propria: l'installazione sta nel menu ⋮, dove non la cerca nessuno. È il caso
  da cui nasce questa segnalazione.
- **Chrome su Android** mostra una mini-infobar una sola volta, dopo un'euristica
  di ingaggio; se la scarti non torna per circa tre mesi.
- **Safari su iOS** non emette `beforeinstallprompt` e non mostrerà mai nulla:
  l'unica strada è Condividi → *Aggiungi alla schermata Home*, a mano.

Conclusione: l'invito deve essere dell'app, non del browser.

Il mobile-first invece non è in discussione — `public/css/styles.css` parte dal
telefono e aggiunge solo `@media (min-width:)`, con tap target da 44px,
safe-area insets, input a 16px contro lo zoom di Safari e guardie
`@media (hover: hover)`. Verificato anche su telefono: si vede bene.

## Difetti secondari trovati

1. `manifest.webmanifest` dichiara `"orientation": "portrait"`, che **blocca in
   verticale l'app installata**. Ma `styles.css:747` ha una media query costruita
   apposta per il telefono coricato nel player (video a sinistra, scaletta a
   destra): installando l'app quel layout diventa irraggiungibile.
2. `admin.html` non ha `<link rel="manifest">` né carica `sw-register.js`: chi
   atterra su `/admin` non registra il service worker, benché `sw.js` metta già
   `/admin` nella shell da cacheare.
3. Manca il meta `mobile-web-app-capable` (rete di sicurezza per iOS < 16.4).

Rientrano tutti in questo intervento.

## Decisioni

| Decisione | Scelta | Perché |
| --- | --- | --- |
| Chi invita | L'app, non il browser | È l'unica cosa che funziona su Edge Android e su iOS |
| Forma dell'invito | Banner in home + pulsanti | Un pulsante solo è discreto quanto l'infobar che nessuno ha visto |
| Dopo lo scarto | Si ritira in un pulsantino, non sparisce | "Smetti di gridare", non "mai più" |
| Nel player | Sì, in `.player-foot` | Chi arriva da un link WhatsApp atterra su `/e/<id>` e la home potrebbe non vederla mai |
| iPhone | Coperto, con pannello di istruzioni | La band ha anche iPhone e lì il prompt non esisterà mai |
| Blocco verticale | Rimosso dal manifest | Restituisce il layout landscape del player |
| `screenshots` nel manifest | No | Servono PNG veri da catturare e migliorano solo il dialog nativo di Chrome, che qui stiamo scavalcando |

## Architettura

Un modulo nuovo, `public/js/install.js`, con un compito solo: **possedere
l'invito all'installazione**. Non sa nulla del player né dell'admin; parla solo
col DOM tramite id noti e con `localStorage`.

Sta in un file suo e non inline nella pagina per la stessa ragione per cui
esiste `sw-register.js`: la CSP vieta `script-src 'unsafe-inline'`, ed è quel
divieto a rendere la policy una difesa vera.

### I quattro stati

| Situazione | Come la riconosce | Cosa fa |
| --- | --- | --- |
| App già installata | `matchMedia("(display-mode: standalone)").matches` oppure `navigator.standalone` | Niente, in nessun posto, mai |
| Chromium installabile | è arrivato `beforeinstallprompt` | Scopre l'invito; al tocco chiama `prompt()` |
| iOS | UA iPhone/iPad, incluso iPadOS che si spaccia per Mac | Scopre l'invito subito, senza attendere eventi; al tocco apre il `<dialog>` col gesto |
| Tutto il resto | nessun evento e non è iOS | L'invito non appare **mai** |

L'ultima riga è un requisito, non un ripiego: niente pulsante che prometta
un'installazione che il browser non sa fare. Su Firefox desktop o Safari macOS
non compare nulla.

### Dove si vede l'invito

| Dove sei | Cosa vedi |
| --- | --- |
| Home, banner non scartato | Banner in cima, sopra l'hero |
| Home, banner scartato | Pulsantino in fondo alla home, dopo la lista eventi. Permanente, non si scarta più |
| Player | Pulsante in `.player-foot`, accanto a "Condividi su WhatsApp" |

Mai due inviti insieme. Home e player sono lo stesso documento con due `<main>`
che si accendono a vicenda con `hidden`: mettendo gli inviti *dentro* le
rispettive viste, è quel meccanismo già esistente a garantirlo. Nessun aggancio
di `install.js` allo stato di vista di `player.js`.

Per la stessa ragione l'invito **non** sta nella topbar: la topbar è condivisa
fra le due viste e distinguerle richiederebbe quell'accoppiamento.

### Regole del percorso Chromium

- `preventDefault()` sull'evento e lo si mette da parte. Senza, su Chrome
  comparirebbero sia il nostro invito sia l'infobar del browser.
- L'evento è **monouso**: dopo `prompt()` va scartato, non riciclato. Finito il
  giro, gli inviti si nascondono per il resto del caricamento; al prossimo
  Chromium potrà riemettere l'evento.
- Se `userChoice.outcome === "dismissed"` si imposta anche il flag di scarto:
  aver detto no al dialogo vero è un segnale più forte del chiudere il banner.
  Alla visita dopo resta il pulsantino in fondo.
- `appinstalled` nasconde tutto senza attendere un ricaricamento.

### Memoria dello scarto

Una chiave in `localStorage`: `attacca:install-dismissed`. Presente = il banner
non si mostra più su quel telefono; al suo posto il pulsantino in fondo.

### Il pannello iOS

`<dialog>` nativo. Dà focus trap ed Esc senza scrivere accessibilità a mano, e
jsdom 29 lo implementa davvero, quindi resta testabile.

Contenuto: il gesto in tre passi — tocca Condividi, scorri fino a *Aggiungi alla
schermata Home*, conferma.

## Modifiche file per file

### `public/js/install.js` — nuovo

Modulo ES (`type="module"`). Nessun export: agisce e basta, come `sw-register.js`.

Rilevamento iOS, iPadOS incluso:

```js
const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
```

*Nota sul momento di aggancio:* uno script `type="module"` è differito, quindi
il listener di `beforeinstallprompt` si registra dopo il parsing del documento.
Il rischio di perdere l'evento è trascurabile perché l'euristica di ingaggio di
Chromium richiede secondi di interazione, molti ordini di grandezza più del
parsing.

### `public/index.html`

Meta per iOS nell'`<head>`:

```html
<meta name="mobile-web-app-capable" content="yes" />
<!-- La variante apple- serve a iOS < 16.4, che non legge display dal manifest. -->
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

`black-translucent` è coerente con il `viewport-fit=cover` già dichiarato e con
le safe-area già gestite nel CSS.

In `#home`, prima di `<section class="hero">`:

```html
<div class="install-banner" id="installBanner" hidden>
  <span class="ib-text">Installa Attacca: si apre come un'app, anche senza rete.</span>
  <button type="button" class="btn primary small" id="btnInstallBanner">Installa</button>
  <button type="button" class="iconbtn ib-close" id="btnInstallDismiss" aria-label="Non ora">×</button>
</div>
```

In `#home`, dopo `#eventList`:

```html
<div class="install-foot" id="installFoot" hidden>
  <button type="button" class="btn ghost small" id="btnInstallHome">Installa l'app</button>
</div>
```

In `.player-foot`, come primo elemento:

```html
<button type="button" class="btn ghost" id="btnInstallPlayer" hidden>Installa l'app</button>
```

Il `<dialog id="installDialog">` col gesto iOS prima degli script, e
`<script src="/js/install.js" type="module"></script>` insieme agli altri.

### `public/admin.html`

Aggiungere `<link rel="manifest" href="/manifest.webmanifest" />`, i tre meta per
iOS, e `<script src="/js/sw-register.js"></script>`. **Nessun invito
all'installazione qui:** l'app si installa dalla home o dal player.

### `public/manifest.webmanifest`

- rimuovere `"orientation": "portrait"`
- aggiungere `"id": "/"` — identità stabile se un domani `start_url` cambia
- aggiungere `"lang": "it"` e `"dir": "ltr"`

### `public/sw.js`

- `/js/install.js` dentro `SHELL`
- `VERSION` da `attacca-v8` a `attacca-v9`, con la nota del cambiamento

Senza il bump la shell vecchia resta in cache e il file nuovo non arriva mai.

### `public/css/styles.css`

Vestito di `.install-banner`, `.install-foot` e `.ios-sheet`, riusando
`--riser`, `--line`, `--radius`, `--tungsten` e `--tap`. Il banner segue le
regole già in casa: altezza minima `--tap` per i bersagli, e su schermo largo
non ha bisogno di nulla di suo. **Nessuna modifica al layout esistente.**

## Test

`test/install.test.js`, ambiente jsdom, markup reale di `index.html` caricato
come fanno già gli altri test tramite `test/helpers/app.js`.

Serve un helper nuovo in `test/helpers/app.js`, esportato come `mountInstall()`:
monta il markup reale, carica `/js/install.js` con `vi.resetModules()` e
restituisce i comandi per simulare `beforeinstallprompt`, la UA iOS e
`display-mode: standalone`. In jsdom `matchMedia` esiste ma non valuta le query
e risponde sempre `matches: false`: è lo stato "non installata", e va sostituito
con uno stub per il caso opposto.

Attenzione alla vista di partenza: `vitest.config.js` fissa l'url di jsdom a
`http://localhost:8080/e/test`, che è il **player**. I casi sulla home vanno
montati riscrivendo l'url su `/`, altrimenti il banner non c'è perché `#home`
resta `hidden`.

Casi:

1. App in `standalone` → nessun invito, in nessun posto
2. Browser senza evento e non iOS → nessun invito, in nessun posto
3. `beforeinstallprompt` → il banner appare in cima **ed è stato `preventDefault`**
4. Tocco su "Installa" → `prompt()` chiamato una volta sola; l'evento non è riciclabile
5. `userChoice: "dismissed"` → il flag di scarto viene scritto
6. `appinstalled` → tutti gli inviti spariscono
7. Tocco su "Non ora" → il banner sparisce e compare il pulsantino in fondo
8. Scarto già in `localStorage` al caricamento → si parte dal pulsantino in fondo, il banner non appare
9. Nel player l'invito sta in `.player-foot` e **non** risente dello scarto del banner
10. UA iOS → invito senza alcun evento; il tocco apre il `<dialog>` e **non** chiama `prompt()`

## Fuori scope

- `screenshots` nel manifest
- Invito all'installazione su `/admin`
- Qualsiasi forma di insistenza oltre al banner scartabile una volta
- Notifiche push, scorciatoie del manifest, share target
