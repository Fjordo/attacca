# Invito all'installazione della PWA — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** far sì che l'app proponga da sé l'installazione, su Android come su iPhone, invece di aspettare un prompt del browser che su Edge non arriva mai e su iOS non esiste.

**Architecture:** un modulo nuovo `public/js/install.js` con un compito solo: possedere l'invito. Non conosce né il player né l'admin, parla solo col DOM tramite id noti e con `localStorage`. Gli inviti stanno **dentro** le due viste (`#home` e `#player`), mai nella topbar che è condivisa: così a mostrarne uno solo per volta pensa il `hidden` che `player.js` già gestisce, senza accoppiamento fra i due moduli.

**Tech Stack:** JavaScript vanilla senza framework (moduli ES), Vitest + jsdom per i test, Express per servire gli statici.

**Spec di riferimento:** [docs/superpowers/specs/2026-07-30-pwa-install-design.md](../specs/2026-07-30-pwa-install-design.md)

**Branch:** `feat/pwa-install` (già creato, contiene il commit dello spec)

## Global Constraints

- **Niente JavaScript inline.** La CSP del server dichiara `script-src 'self' https://www.youtube.com https://s.ytimg.com` senza `'unsafe-inline'`: ogni script sta in un file sotto `public/js/`. È il motivo per cui esiste già `sw-register.js`.
- **Niente dipendenze nuove.** `package.json` ha una sola dipendenza di runtime (`express`). Vanilla JS, così una persona della band può leggere il codice.
- **Commenti e testi in italiano**, come tutto il resto del repository. I commenti spiegano *perché*, non *cosa*.
- **Bersagli da 44px.** `--tap: 44px` è il minimo per ogni cosa toccabile. `styles.css` lo dichiara come regola: *"«small» rimpicciolisce il testo, non il bersaglio"*. Non ridurre `.iconbtn` sotto `--tap`.
- **Mobile first nel CSS.** Le regole base descrivono il telefono; gli schermi grandi arrivano solo tramite `@media (min-width: …)` in fondo al file. Non aggiungere regole desktop nella parte alta.
- **Chiave di `localStorage`:** esattamente `attacca:install-dismissed`.
- **Id degli elementi**, esattamente questi: `installBanner`, `btnInstallBanner`, `btnInstallDismiss`, `installFoot`, `btnInstallHome`, `btnInstallPlayer`, `installDialog`, `btnInstallClose`.
- **Test:** `npm test` esegue tutta la suite. Deve restare verde a ogni commit.

---

### Task 1: Igiene PWA — manifest, meta iOS, admin.html

Tre difetti che non richiedono JavaScript. Il manifest blocca in verticale l'app installata, annullando il layout landscape del player; `/admin` non registra il service worker anche se `sw.js` mette già `/admin` nella shell; manca il meta per iOS sotto 16.4.

**Files:**

- Create: `test/pwa.test.js`
- Modify: `public/manifest.webmanifest`
- Modify: `public/index.html` (blocco `<head>`)
- Modify: `public/admin.html` (blocco `<head>`, e uno `<script>` in fondo al `<body>`)

**Interfaces:**

- Consumes: niente
- Produces: `public/manifest.webmanifest` senza `orientation` e con `id: "/"`, `lang: "it"`, `dir: "ltr"`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `test/pwa.test.js`:

```js
// Igiene PWA: quello che rende l'app installabile sta nei file statici, non nel
// JavaScript. Qui si controlla quello — e si evita che una modifica distratta
// rimetta il blocco dell'orientamento o stacchi il manifest da una pagina.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (nome) => fs.readFileSync(path.join(root, "public", nome), "utf8");
const manifest = () => JSON.parse(leggi("manifest.webmanifest"));

describe("manifest", () => {
  it("non blocca l'orientamento: il player ha un layout apposta per il telefono coricato", () => {
    expect(manifest().orientation).toBeUndefined();
  });

  it("dichiara un id stabile, così l'identità non dipende da start_url", () => {
    expect(manifest().id).toBe("/");
  });

  it("dichiara lingua e direzione", () => {
    expect(manifest()).toMatchObject({ lang: "it", dir: "ltr" });
  });

  it("tiene le icone che aveva, maskable compresa", () => {
    const purposes = manifest().icons.map((i) => i.purpose);
    expect(purposes).toContain("maskable");
  });
});

describe("admin.html", () => {
  it("collega il manifest, come la home", () => {
    expect(leggi("admin.html")).toContain('rel="manifest"');
  });

  it("registra il service worker: sw.js mette /admin nella shell, ma nessuno lo installava", () => {
    expect(leggi("admin.html")).toContain("/js/sw-register.js");
  });
});

describe("meta per iOS", () => {
  for (const file of ["index.html", "admin.html"]) {
    it(`${file} dichiara mobile-web-app-capable`, () => {
      expect(leggi(file)).toContain('name="mobile-web-app-capable"');
    });

    it(`${file} tiene anche la variante apple-, che serve a iOS sotto 16.4`, () => {
      expect(leggi(file)).toContain('name="apple-mobile-web-app-capable"');
    });
  }
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- test/pwa.test.js`

Expected: FAIL. `orientation` è `"portrait"` invece di `undefined`, `id`/`lang`/`dir` sono `undefined`, `admin.html` non contiene né `rel="manifest"` né `sw-register.js`, e nessuno dei due file contiene i meta.

- [ ] **Step 3: Sistema il manifest**

Sostituisci il contenuto di `public/manifest.webmanifest`:

```json
{
  "id": "/",
  "name": "Attacca — Setlist",
  "short_name": "Attacca",
  "description": "La setlist della band: riproduci i brani YouTube in sequenza, senza interruzioni.",
  "lang": "it",
  "dir": "ltr",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#161311",
  "theme_color": "#161311",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`orientation` è sparito di proposito: bloccava in verticale l'app installata, e `styles.css:747` ha una media query costruita apposta per il telefono coricato nel player.

- [ ] **Step 4: Aggiungi i meta iOS a `public/index.html`**

In `public/index.html`, subito dopo la riga `<meta name="theme-color" content="#161311" />`:

```html
  <!-- iOS 16.4+ legge display dal manifest; sotto, l'unico segnale è il meta
       apple-. Il nome senza prefisso è quello standard di oggi: teniamo
       entrambi finché in giro ci sono iPhone vecchi. -->
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <!-- Coerente con viewport-fit=cover e le safe-area già gestite nel CSS. -->
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- [ ] **Step 5: Sistema `public/admin.html`**

In `public/admin.html`, subito dopo `<meta name="theme-color" content="#161311" />`, aggiungi lo stesso blocco di meta del passo precedente **più** il collegamento al manifest:

```html
  <link rel="manifest" href="/manifest.webmanifest" />
  <!-- iOS 16.4+ legge display dal manifest; sotto, l'unico segnale è il meta
       apple-. Il nome senza prefisso è quello standard di oggi: teniamo
       entrambi finché in giro ci sono iPhone vecchi. -->
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

E in fondo al `<body>`, subito dopo `<script src="/js/admin.js" type="module"></script>`:

```html
  <script src="/js/sw-register.js"></script>
```

Nessun invito all'installazione su questa pagina: l'app si installa dalla home o dal player.

- [ ] **Step 6: Esegui i test e verifica che passino**

Run: `npm test`

Expected: PASS, suite intera compresa. `test/admin.test.js` legge il markup vero di `admin.html` e ne strappa gli `<script>`: aggiungerne uno non lo disturba.

- [ ] **Step 7: Commit**

```bash
git add test/pwa.test.js public/manifest.webmanifest public/index.html public/admin.html
git commit -m "fix(pwa): sblocca la rotazione, collega manifest e worker a /admin

Il manifest dichiarava orientation: portrait, che bloccava in verticale
l'app installata e rendeva irraggiungibile il layout del player col
telefono coricato — quello che styles.css:747 costruisce apposta.

/admin non collegava il manifest e non registrava il service worker,
benché sw.js mettesse già /admin nella shell da cacheare.

Aggiunge id, lang e dir al manifest e i meta iOS a entrambe le pagine."
```

---

### Task 2: Il markup e il vestito dell'invito

Gli elementi, tutti spenti. Nessun comportamento: quello arriva dal Task 3. Separarli permette di rivedere la forma dell'invito senza leggere la logica.

**Files:**

- Modify: `public/index.html` (dentro `#home`, dentro `.player-foot`, e in fondo al `<body>`)
- Modify: `public/css/styles.css` (nuova sezione prima di `/* ---- Segnali ---- */`)
- Modify: `test/pwa.test.js`

**Interfaces:**

- Consumes: niente
- Produces: gli id `installBanner`, `btnInstallBanner`, `btnInstallDismiss`, `installFoot`, `btnInstallHome`, `btnInstallPlayer`, `installDialog`, `btnInstallClose`, tutti presenti in `index.html` e tutti `hidden` all'origine

- [ ] **Step 1: Scrivi il test che fallisce**

Aggiungi in fondo a `test/pwa.test.js`:

```js
describe("markup dell'invito all'installazione", () => {
  it("ha tutti gli elementi dell'invito", () => {
    const html = leggi("index.html");
    for (const id of [
      "installBanner", "btnInstallBanner", "btnInstallDismiss",
      "installFoot", "btnInstallHome", "btnInstallPlayer",
      "installDialog", "btnInstallClose",
    ]) {
      expect(html, `manca #${id}`).toContain(`id="${id}"`);
    }
  });

  it("parte tutto spento: a scoprirlo è install.js, solo dove si può installare", () => {
    const html = leggi("index.html");
    for (const id of ["installBanner", "installFoot", "btnInstallPlayer"]) {
      expect(html, `#${id} deve nascere hidden`).toMatch(
        new RegExp(`id="${id}"[^>]*\\shidden`)
      );
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `npm test -- test/pwa.test.js`

Expected: FAIL con `manca #installBanner`.

- [ ] **Step 3: Aggiungi il markup a `public/index.html`**

Dentro `<main id="home" class="wrap" hidden>`, **prima** di `<section class="hero">`:

```html
    <!-- Nessun browser propone l'installazione in modo affidabile, quindi la
         proponiamo noi. Lo scopre js/install.js, e solo se si può davvero
         installare. Scartato, il banner si ritira in #installFoot qui sotto. -->
    <div class="install-banner" id="installBanner" hidden>
      <span class="ib-text">Installa Attacca: si apre come un'app, anche senza rete.</span>
      <button type="button" class="btn primary small" id="btnInstallBanner">Installa</button>
      <button type="button" class="iconbtn ib-close" id="btnInstallDismiss" aria-label="Non ora">×</button>
    </div>
```

Sempre dentro `#home`, **dopo** `<div id="eventList" class="events"></div>`:

```html
    <!-- Dove si ritira il banner una volta scartato: l'app resta installabile
         con un tocco, solo più in piccolo e più in basso. -->
    <div class="install-foot" id="installFoot" hidden>
      <button type="button" class="btn ghost small" id="btnInstallHome">Installa l'app</button>
    </div>
```

Dentro `<div class="player-foot">`, **come ultimo elemento**, dopo il collegamento "← Tutti gli eventi":

```html
          <button type="button" class="btn ghost" id="btnInstallPlayer" hidden>Installa l'app</button>
```

> **Scostamento voluto dallo spec.** Lo spec diceva "come primo elemento". Va in coda perché `.player-foot .btn { flex: 1 1 auto }` dispone i bottoni in ordine di lettura, e in quella schermata l'azione principale è *Condividi su WhatsApp*: mettergli davanti l'invito la declasserebbe. Serve comunque nel player perché chi riceve un link WhatsApp atterra su `/e/<id>` e la home potrebbe non vederla mai.

In fondo al `<body>`, dopo `<p class="foot">…</p>` e **prima** degli `<script>` (il pannello è condiviso fra le due viste, quindi sta fuori da entrambe):

```html
  <!-- Su iOS il prompt di installazione non esiste e non esisterà: l'unica
       strada è il gesto, e se non glielo spieghiamo noi non lo scopre nessuno. -->
  <dialog class="ios-sheet" id="installDialog">
    <h2>Aggiungi Attacca alla Home</h2>
    <ol>
      <li>Tocca <b>Condividi</b> nella barra di Safari.</li>
      <li>Scorri e scegli <b>Aggiungi alla schermata Home</b>.</li>
      <li>Conferma con <b>Aggiungi</b>.</li>
    </ol>
    <button type="button" class="btn primary" id="btnInstallClose">Ho capito</button>
  </dialog>
```

Il tag `<script>` che carica `install.js` **non** va aggiunto qui: il file non esiste ancora e la pagina risponderebbe 404 su quello script. Lo aggiunge il Task 3, insieme al modulo.

- [ ] **Step 4: Aggiungi il CSS**

In `public/css/styles.css`, **prima** della sezione `/* ---- Segnali ---- */`:

```css
/* ---- Invito all'installazione -------------------------------------------- */
/* Il banner apre la home; una volta scartato non sparisce, si ritira nel
   pulsantino in fondo. L'app resta installabile con un tocco, solo più in
   piccolo: "smetti di gridare", non "mai più". */
.install-banner {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 14px 0 0; padding: 10px 12px;
  border: 1px solid rgba(255, 176, 32, .35); border-radius: var(--radius);
  background: var(--tungsten-soft);
}
/* Va a capo prima dei bottoni invece di strizzarli sotto il bersaglio minimo. */
.install-banner .ib-text { flex: 1 1 16ch; font-size: 14px; line-height: 1.35; }
/* Resta un .iconbtn a grandezza piena: qui il bersaglio non si rimpicciolisce,
   è la stessa regola di .btn.small poco sopra. */
.install-banner .ib-close {
  flex: none; border-color: transparent; background: transparent;
  color: var(--muted); font-size: 20px;
}

.install-foot { display: flex; justify-content: center; padding-bottom: 40px; }

/* Il pannello col gesto iOS. <dialog> nativo: focus trap ed Esc senza
   scrivere accessibilità a mano. */
.ios-sheet {
  border: 1px solid var(--line); border-radius: var(--radius);
  background: var(--riser); color: var(--ink);
  padding: 20px; max-width: 34ch; width: calc(100vw - 32px);
}
.ios-sheet::backdrop { background: rgba(0, 0, 0, .6); }
.ios-sheet h2 { font-size: 26px; margin-bottom: 12px; }
.ios-sheet ol { margin: 0 0 18px; padding-left: 1.2em; color: var(--muted); font-size: 15px; }
.ios-sheet li + li { margin-top: 8px; }
.ios-sheet b { color: var(--ink); font-weight: 600; }
.ios-sheet .btn { width: 100%; }
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `npm test`

Expected: PASS. Il markup nuovo dentro `#home` non tocca gli id che `player.js` cerca, quindi `test/player.test.js` resta verde.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/css/styles.css test/pwa.test.js
git commit -m "feat(pwa): markup e vestito dell'invito all'installazione

Banner in cima alla home, pulsantino in fondo dove si ritira una volta
scartato, pulsante nel player per chi arriva da un link WhatsApp e la
home non la vede mai, e un <dialog> col gesto per iOS.

Tutto hidden: ad accenderlo sarà install.js, e solo dove il browser sa
davvero installare."
```

---

### Task 3: `install.js` — rilevamento e percorso Chromium

Il cuore. Il banner appare solo quando Chromium ha davvero offerto l'installazione, e il tocco apre il prompt vero del sistema.

**Files:**

- Create: `public/js/install.js`
- Create: `test/install.test.js`
- Modify: `test/helpers/app.js` (nuovo export `mountInstall`)
- Modify: `public/index.html` (il tag `<script>`, rinviato dal Task 2)
- Modify: `test/pwa.test.js`

**Interfaces:**

- Consumes: gli id definiti nel Task 2
- Produces:
  - `public/js/install.js`, modulo ES senza export: agisce all'import, come `sw-register.js`
  - `mountInstall(opts)` da `test/helpers/app.js`, con `opts = { vista, standalone, ios, scartato }` e ritorno `{ flush, offri(outcome), installazioneAvvenuta() }`

- [ ] **Step 1: Scrivi l'helper di test**

Aggiungi in fondo a `test/helpers/app.js`:

```js
/**
 * Monta il markup reale di index.html e carica /js/install.js.
 *
 * `vista` sceglie quale schermata è accesa: index.html le tiene entrambe hidden
 * e a scoprirle è player.js, che qui non gira.
 *
 * L'url di jsdom è fissato a /e/test in vitest.config.js — cioè il player — ma
 * install.js non legge il percorso: guarda solo il `hidden` dei due <main>, che
 * qui impostiamo a mano.
 */
export async function mountInstall({
  vista = "home",
  standalone = false,
  ios = false,
  scartato = false,
} = {}) {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]
    .replace(/<script[\s\S]*?<\/script>/gi, ""); // i moduli li importiamo noi

  localStorage.clear();
  if (scartato) localStorage.setItem("attacca:install-dismissed", "1");

  document.getElementById("home").hidden = vista !== "home";
  document.getElementById("player").hidden = vista !== "player";

  // jsdom ha matchMedia ma non valuta le query: risponde sempre matches:false,
  // che è già lo stato "non installata". Per il caso opposto va sostituito.
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: standalone })));

  // Sostituiamo navigator intero invece di scrivere sulle sue proprietà, che
  // sono getter di sola lettura: unstubGlobals in vitest.config.js lo rimette
  // a posto da sé dopo ogni test.
  vi.stubGlobal("navigator", {
    userAgent: ios
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
      : "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    platform: ios ? "iPhone" : "Linux armv8l",
    maxTouchPoints: 5,
    standalone: false,
  });

  // jsdom implementa <dialog> ma non ha un vero strato modale: bastano due spie
  // che segnino l'apertura, ed è lo stesso trucco usato per il clic di export.
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () {
    this.open = false;
  });

  vi.resetModules();
  await import("/js/install.js");
  await flush();

  return {
    flush,
    /** Simula Chromium che offre l'installazione. Ritorna l'evento. */
    offri(outcome = "accepted") {
      const e = new Event("beforeinstallprompt");
      e.prompt = vi.fn();
      e.userChoice = Promise.resolve({ outcome });
      window.dispatchEvent(e);
      return e;
    },
    /** Simula il sistema che segnala l'installazione avvenuta. */
    installazioneAvvenuta() {
      window.dispatchEvent(new Event("appinstalled"));
    },
  };
}
```

- [ ] **Step 2: Scrivi i test che falliscono**

Crea `test/install.test.js`:

```js
// L'invito all'installazione. Il caso che conta di più è l'ultimo di ogni
// gruppo: dove il browser NON sa installare, non deve comparire niente. Un
// pulsante che promette un'installazione impossibile è peggio del silenzio.
import { describe, it, expect } from "vitest";
import { mountInstall, $ } from "./helpers/app.js";

const visibile = (id) => !$(id).hidden;

describe("quando non c'è niente da proporre", () => {
  it("tace se il browser non offre l'installazione", async () => {
    await mountInstall();
    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });

  it("tace se l'app è già installata, anche se il browser insiste", async () => {
    const app = await mountInstall({ standalone: true });
    app.offri();
    await app.flush();
    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });
});

describe("percorso Chromium", () => {
  it("mostra il banner quando l'installazione è davvero possibile", async () => {
    const app = await mountInstall();
    app.offri();
    await app.flush();
    expect(visibile("installBanner")).toBe(true);
  });

  it("trattiene l'evento: senza, su Chrome uscirebbe anche l'infobar sua", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();
    expect(e.defaultPrevented).toBe(true);
  });

  it("al tocco apre il prompt vero del sistema", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();

    $("btnInstallBanner").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("l'evento è monouso: speso quello, l'invito si ritira", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();

    $("btnInstallBanner").click();
    await app.flush();
    // Un secondo tocco non deve riusare un evento già consumato: riusarlo lancia.
    $("btnInstallBanner").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(visibile("installBanner")).toBe(false);
  });

  it("a installazione avvenuta sparisce tutto, senza aspettare un ricaricamento", async () => {
    const app = await mountInstall();
    app.offri();
    await app.flush();

    app.installazioneAvvenuta();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });
});
```

Aggiungi anche, dentro il `describe("markup dell'invito all'installazione")` di `test/pwa.test.js`:

```js
  it("carica il modulo dell'invito", () => {
    expect(leggi("index.html")).toContain("/js/install.js");
  });
```

- [ ] **Step 3: Esegui i test e verifica che falliscano**

Run: `npm test -- test/install.test.js test/pwa.test.js`

Expected: FAIL. `install.test.js` non risolve il modulo — `public/js/install.js` non esiste ancora — e `pwa.test.js` non trova il tag `<script>`.

- [ ] **Step 4: Scrivi `public/js/install.js`**

```js
// Invito all'installazione della PWA.
//
// L'app è già installabile — manifest, icone, service worker e HTTPS sono a
// posto — ma nessun browser lo dice in modo affidabile: Edge su Android non
// mostra alcuna infobar e nasconde l'installazione nel menu ⋮, Chrome la
// propone una volta sola e poi tace per mesi, Safari su iOS non emette proprio
// `beforeinstallprompt` e non mostrerà mai nulla. Quindi l'invito è nostro.
//
// Sta in un file suo e non inline nella pagina: la CSP non ammette
// script-src 'unsafe-inline', ed è quel divieto a rendere la policy una difesa
// vera. Stessa ragione per cui esiste sw-register.js.
//
// Gli inviti stanno DENTRO le due viste (#home e #player), non nella topbar che
// è condivisa: così a mostrarne uno solo per volta pensa il `hidden` che
// player.js già gestisce, e questo modulo non ha bisogno di sapere niente di
// quello.

const $ = (id) => document.getElementById(id);

const banner = $("installBanner");

// L'evento messo da parte da Chromium. È monouso: dopo prompt() non vale più.
let differito = null;

// Già installata: gira nella sua finestra, non c'è niente da proporre.
const installata = () =>
  window.matchMedia?.("(display-mode: standalone)").matches === true ||
  navigator.standalone === true;

/** Accende gli inviti o li spegne tutti. */
function mostra(attivo) {
  if (banner) banner.hidden = !attivo;
}

async function chiedi() {
  if (!differito) return;
  const evento = differito;
  differito = null; // monouso: riusarlo lancia
  evento.prompt();
  await evento.userChoice;
  // L'evento è speso: meglio nessun invito che uno che non fa più niente.
  mostra(false);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  differito = e;
  if (!installata()) mostra(true);
});

window.addEventListener("appinstalled", () => {
  differito = null;
  mostra(false);
});

$("btnInstallBanner")?.addEventListener("click", chiedi);
```

Ora che il file esiste, collegalo in `public/index.html` fra gli altri `<script>`, dopo `player.js`:

```html
  <script src="/js/install.js" type="module"></script>
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Run: `npm test -- test/install.test.js test/pwa.test.js`

Expected: PASS.

- [ ] **Step 6: Esegui la suite intera**

Run: `npm test`

Expected: PASS. `mountInstall` sostituisce `navigator` e `matchMedia` con `vi.stubGlobal`, e `unstubGlobals: true` in `vitest.config.js` li rimette a posto: gli altri file di test non se ne accorgono.

- [ ] **Step 7: Commit**

```bash
git add public/js/install.js public/index.html test/install.test.js test/pwa.test.js test/helpers/app.js
git commit -m "feat(pwa): il banner di installazione, percorso Chromium

Intercetta beforeinstallprompt e lo mette da parte invece di lasciarlo
cadere: il preventDefault serve o su Chrome uscirebbe anche l'infobar
del browser sopra la nostra.

L'evento è monouso — dopo prompt() non vale più — quindi finito il giro
l'invito si ritira: meglio niente che un pulsante che non fa nulla.

Dove il browser non sa installare non compare niente."
```

---

### Task 4: Lo scarto — il banner si ritira nel pulsantino in fondo

Chiudere il banner non lo fa sparire: lo rimpicciolisce e lo sposta in fondo alla home, per sempre. "Smetti di gridare", non "mai più".

**Files:**

- Modify: `public/js/install.js`
- Modify: `test/install.test.js`

**Interfaces:**

- Consumes: `mostra(attivo)` e `chiedi()` dal Task 3
- Produces: la chiave `attacca:install-dismissed` in `localStorage`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi a `test/install.test.js`:

```js
describe("lo scarto del banner", () => {
  it("non fa sparire l'invito: lo ritira nel pulsantino in fondo", async () => {
    const app = await mountInstall();
    app.offri();
    await app.flush();

    $("btnInstallDismiss").click();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(true);
  });

  it("sopravvive a un ricaricamento: si riparte dal pulsantino, non dal banner", async () => {
    const app = await mountInstall({ scartato: true });
    app.offri();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(true);
  });

  it("dal pulsantino in fondo si installa comunque", async () => {
    const app = await mountInstall({ scartato: true });
    const e = app.offri();
    await app.flush();

    $("btnInstallHome").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("dire no al dialogo vero conta più che chiudere il banner: la volta dopo parte in piccolo", async () => {
    const app = await mountInstall();
    app.offri("dismissed");
    await app.flush();

    $("btnInstallBanner").click();
    await app.flush();

    expect(localStorage.getItem("attacca:install-dismissed")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test -- test/install.test.js`

Expected: FAIL. `installFoot` resta nascosto e la chiave non viene scritta.

- [ ] **Step 3: Aggiungi la memoria dello scarto a `public/js/install.js`**

Sotto `const banner = $("installBanner");` aggiungi:

```js
const inFondo = $("installFoot");

const SCARTO = "attacca:install-dismissed";

// localStorage può lanciare (Safari in navigazione privata, quota piena):
// senza memoria l'invito resta quello di partenza e non si rompe niente.
const scartato = () => {
  try { return localStorage.getItem(SCARTO) !== null; } catch { return false; }
};
const scarta = () => {
  try { localStorage.setItem(SCARTO, "1"); } catch { /* pazienza */ }
};
```

Sostituisci `mostra` con:

```js
/**
 * Accende gli inviti o li spegne tutti.
 * In home banner e pulsantino si escludono: il primo finché non lo scarti, il
 * secondo da lì in poi.
 */
function mostra(attivo) {
  if (banner) banner.hidden = !(attivo && !scartato());
  if (inFondo) inFondo.hidden = !(attivo && scartato());
}
```

In `chiedi()`, sostituisci `await evento.userChoice;` con:

```js
  const { outcome } = await evento.userChoice;
  // Ha detto no al dialogo vero del sistema: segnale più forte del chiudere il
  // banner, quindi alla visita dopo si parte già dal pulsantino in fondo.
  if (outcome === "dismissed") scarta();
```

In fondo al file, dopo il listener di `btnInstallBanner`, aggiungi:

```js
$("btnInstallHome")?.addEventListener("click", chiedi);

$("btnInstallDismiss")?.addEventListener("click", () => {
  scarta();
  mostra(true); // non sparisce: si ritira nel pulsantino in fondo
});
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test -- test/install.test.js`

Expected: PASS, tutti e undici.

- [ ] **Step 5: Commit**

```bash
git add public/js/install.js test/install.test.js
git commit -m "feat(pwa): scartare il banner lo ritira, non lo cancella

Chiuderlo lo sostituisce con un pulsantino in fondo alla home: l'app
resta installabile con un tocco, solo più in piccolo. Lo scarto vive in
localStorage e sopravvive al ricaricamento.

Dire no al prompt vero del sistema scrive lo stesso flag: è un segnale
più forte del chiudere un banner."
```

---

### Task 5: L'invito nel player

Chi riceve un link WhatsApp atterra su `/e/<id>` e la home potrebbe non vederla mai. Il suo invito è indipendente dallo scarto del banner, che riguarda solo la home.

**Files:**

- Modify: `public/js/install.js`
- Modify: `test/install.test.js`

**Interfaces:**

- Consumes: `mostra(attivo)` e `chiedi()` dai Task 3-4
- Produces: niente di nuovo

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi a `test/install.test.js`:

```js
describe("l'invito nel player", () => {
  it("c'è, perché chi arriva da un link WhatsApp la home non la vede mai", async () => {
    const app = await mountInstall({ vista: "player" });
    app.offri();
    await app.flush();

    expect(visibile("btnInstallPlayer")).toBe(true);
  });

  it("non risente dello scarto del banner: quello riguarda solo la home", async () => {
    const app = await mountInstall({ vista: "player", scartato: true });
    app.offri();
    await app.flush();

    expect(visibile("btnInstallPlayer")).toBe(true);
  });

  it("al tocco apre il prompt vero", async () => {
    const app = await mountInstall({ vista: "player" });
    const e = app.offri();
    await app.flush();

    $("btnInstallPlayer").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("resta spento se il browser non offre l'installazione", async () => {
    await mountInstall({ vista: "player" });
    expect(visibile("btnInstallPlayer")).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test -- test/install.test.js`

Expected: FAIL — `btnInstallPlayer` resta nascosto: nessuno lo tocca.

- [ ] **Step 3: Collega il pulsante del player**

In `public/js/install.js`, sotto `const inFondo = $("installFoot");`:

```js
const nelPlayer = $("btnInstallPlayer");
```

In `mostra`, aggiungi la terza riga e allarga il commento:

```js
/**
 * Accende gli inviti o li spegne tutti.
 * In home banner e pulsantino si escludono: il primo finché non lo scarti, il
 * secondo da lì in poi. Nel player c'è sempre il suo, perché chi arriva da un
 * link WhatsApp la home potrebbe non vederla mai.
 */
function mostra(attivo) {
  if (banner) banner.hidden = !(attivo && !scartato());
  if (inFondo) inFondo.hidden = !(attivo && scartato());
  if (nelPlayer) nelPlayer.hidden = !attivo;
}
```

E sostituisci i due `addEventListener` separati dei pulsanti "installa" con un giro solo:

```js
for (const b of [$("btnInstallBanner"), $("btnInstallHome"), nelPlayer]) {
  b?.addEventListener("click", chiedi);
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test -- test/install.test.js`

Expected: PASS, tutti e quindici.

- [ ] **Step 5: Commit**

```bash
git add public/js/install.js test/install.test.js
git commit -m "feat(pwa): invito all'installazione anche nel player

Chi riceve la scaletta su WhatsApp atterra su /e/<id> e la home
potrebbe non aprirla mai: se l'invito vivesse solo lì, per metà della
band non esisterebbe.

Indipendente dallo scarto del banner, che riguarda solo la home."
```

---

### Task 6: Il percorso iOS

Su iPhone `beforeinstallprompt` non esiste e non esisterà: l'unica strada è il gesto, spiegato da noi.

**Files:**

- Modify: `public/js/install.js`
- Modify: `test/install.test.js`

**Interfaces:**

- Consumes: `mostra(attivo)`, `chiedi()`, `installata()` dai Task 3-5
- Produces: niente di nuovo

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi a `test/install.test.js`:

```js
describe("percorso iOS", () => {
  it("invita subito, senza aspettare un evento che non arriverà mai", async () => {
    await mountInstall({ ios: true });
    expect(visibile("installBanner")).toBe(true);
  });

  it("al tocco spiega il gesto invece di aprire un prompt che non esiste", async () => {
    const app = await mountInstall({ ios: true });

    $("btnInstallBanner").click();
    await app.flush();

    expect($("installDialog").open).toBe(true);
  });

  it("il pannello si chiude", async () => {
    const app = await mountInstall({ ios: true });
    $("btnInstallBanner").click();
    await app.flush();

    $("btnInstallClose").click();
    await app.flush();

    expect($("installDialog").open).toBe(false);
  });

  it("tace se l'app è già sulla schermata Home", async () => {
    await mountInstall({ ios: true, standalone: true });
    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });

  it("anche su iOS lo scarto ritira il banner nel pulsantino in fondo", async () => {
    const app = await mountInstall({ ios: true });

    $("btnInstallDismiss").click();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test -- test/install.test.js`

Expected: FAIL — su iOS non arriva nessun evento e oggi il modulo non mostra niente.

- [ ] **Step 3: Aggiungi il percorso iOS a `public/js/install.js`**

Sotto `const nelPlayer = $("btnInstallPlayer");`:

```js
const pannello = $("installDialog");

// iPadOS si spaccia per Mac: l'unico indizio che lo tradisce è il touch su una
// piattaforma che da scrivania non ne ha.
const isIOS =
  /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
```

In `chiedi()`, sostituisci `if (!differito) return;` con:

```js
  // Su iOS non arriverà mai un evento: si può solo spiegare il gesto.
  if (!differito) {
    if (isIOS) pannello?.showModal();
    return;
  }
```

In fondo al file:

```js
$("btnInstallClose")?.addEventListener("click", () => pannello?.close());

// iOS non emetterà mai beforeinstallprompt: se siamo lì, l'invito parte subito.
if (isIOS && !installata()) mostra(true);
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test -- test/install.test.js`

Expected: PASS, tutti e venti.

- [ ] **Step 5: Commit**

```bash
git add public/js/install.js test/install.test.js
git commit -m "feat(pwa): il gesto di installazione su iOS

Safari non emette beforeinstallprompt e non lo emetterà: l'unica strada
è Condividi -> Aggiungi alla schermata Home, e senza qualcuno che lo
dica non lo scopre nessuno.

L'invito parte subito invece di attendere un evento che non arriverà, e
il tocco apre un <dialog> col gesto in tre passi. iPadOS si spaccia per
Mac: lo si riconosce dal touch."
```

---

### Task 7: Service worker, README e verifica finale

Il file nuovo va nella shell offline, e senza bump di versione la cache vecchia non lo prende mai.

**Files:**

- Modify: `public/sw.js`
- Modify: `README.md`
- Modify: `test/pwa.test.js`

**Interfaces:**

- Consumes: `public/js/install.js` dal Task 3
- Produces: `VERSION = "attacca-v9"` in `public/sw.js`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi a `test/pwa.test.js`:

```js
describe("service worker", () => {
  it("mette il modulo dell'invito nella shell offline", () => {
    expect(leggi("sw.js")).toContain('"/js/install.js"');
  });

  it("ha cambiato versione: senza il bump la cache vecchia non prende il file nuovo", () => {
    expect(leggi("sw.js")).toContain('attacca-v9');
  });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test -- test/pwa.test.js`

Expected: FAIL — la shell non contiene `install.js` e la versione è ancora `attacca-v8`.

- [ ] **Step 3: Aggiorna `public/sw.js`**

Cambia la riga della versione:

```js
const VERSION = "attacca-v9"; // v9: invito all'installazione (js/install.js)
```

E aggiungi il file alla shell, dopo `"/js/admin.js"`:

```js
  "/js/install.js",
```

- [ ] **Step 4: Aggiorna il README**

In `README.md`, nella sezione *Cosa fa*, sostituisci il punto "Gira lato client" con:

```markdown
- **Gira lato client**: una volta caricata la lista, la logica di riproduzione è tutta nel browser. L'app è una PWA installabile e apribile offline: un banner in home la propone, e su iPhone — dove il prompt di installazione non esiste — spiega il gesto da fare a mano.
```

E nella sezione *Struttura*, dopo la riga di `js/admin.js`:

```text
  js/install.js    invito all'installazione (banner, iOS, prompt Chromium)
```

- [ ] **Step 5: Esegui la suite intera**

Run: `npm test`

Expected: PASS, tutti i file.

- [ ] **Step 6: Verifica a mano nel browser**

I test in jsdom non vedono il layout: questa parte va guardata con gli occhi.

```bash
ADMIN_PASSWORD="prova" npm start
```

Con `http://localhost:8080` aperto in Chrome (localhost è contesto sicuro, quindi il service worker si registra):

1. DevTools → *Application* → *Manifest*: nessun avviso, `orientation` assente, `id` presente.
2. DevTools → *Application* → *Service Workers*: attivo su `attacca-v9`.
3. DevTools → *Application* → *Manifest* → pulsante **Install**: verifica che l'app si installi.
4. Modalità telefono (Ctrl+Shift+M, iPhone 12 Pro): il banner sta in cima alla home, il testo va a capo prima di strizzare i bottoni, la × è un bersaglio pieno.
5. Chiudi il banner: compare il pulsantino in fondo, sotto la lista eventi.
6. Ricarica: il banner non torna, il pulsantino sì.
7. Apri un evento: l'invito è in fondo, dopo *Tutti gli eventi*, e non copre il deck.
8. Ruota in orizzontale nel player: il layout a due colonne di `styles.css:747` funziona.

- [ ] **Step 7: Commit**

```bash
git add public/sw.js README.md test/pwa.test.js
git commit -m "feat(pwa): il modulo dell'invito nella shell offline

VERSION a attacca-v9: senza il bump la cache vecchia resta buona e il
file nuovo non arriva mai ai telefoni che hanno già aperto l'app."
```

---

## Nota per chi implementa

**Se un test fallisce, non aggirarlo.** Il modo più facile di far passare i test di questo piano è indebolirli — mostrare l'invito sempre invece che solo quando si può installare. Sarebbe esattamente il difetto che il piano vuole evitare: un pulsante che promette un'installazione impossibile è peggio del silenzio di oggi.

**Il caso più delicato** è l'evento monouso. `BeforeInstallPromptEvent.prompt()` si può chiamare **una volta sola**: alla seconda il browser lancia. Per questo `differito` viene azzerato *prima* di `prompt()`, non dopo.

## Fuori scope

Confermato dallo spec, da non aggiungere strada facendo:

- `screenshots` nel manifest
- Invito all'installazione su `/admin`
- Qualsiasi insistenza oltre al banner scartabile una volta
- Notifiche push, `shortcuts`, share target
