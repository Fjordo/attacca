// Monta l'app dentro jsdom e finge la IFrame API di YouTube.
// Il DOM è quello vero di public/index.html: se cambia un id, i test se ne accorgono.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

export function sampleEvent() {
  return {
    id: "test",
    name: "Prova",
    date: "2026-08-03",
    place: "Bettona",
    songs: [
      { id: "a", title: "Uno", url: "", videoId: "AAAAAAAAAAA", start: 0 },
      { id: "b", title: "Due", url: "", videoId: "BBBBBBBBBBB", start: 7 },
      { id: "c", title: "Tre", url: "", videoId: "CCCCCCCCCCC", start: 0 },
    ],
  };
}

/** Carica il markup reale della pagina e finge le chiamate al server. */
export function mountApp({ event = sampleEvent(), list = [] } = {}) {
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const body = html
    .match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]
    .replace(/<script[\s\S]*?<\/script>/gi, ""); // i moduli li importiamo noi
  document.body.innerHTML = body;

  // Residui del test precedente: l'aggancio della API sta su window.
  delete window.onYouTubeIframeAPIReady;
  delete window.YT;
  localStorage.clear();

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes("/api/events/") ? event : list),
    }))
  );

  return { event };
}

/** Finta IFrame API: registra i player creati e ne pilota gli eventi. */
export function fakeYouTube() {
  const players = [];

  class FakePlayer {
    constructor(nodeId, cfg) {
      this.cfg = cfg;
      this.loads = [];
      this.seeks = [];
      this.time = 0;
      this.duration = 120;
      this.destroyed = false;
      this.playCalls = 0;
      this.state = PlayerState.UNSTARTED;
      // Come la vera API: il div viene sostituito da un iframe con lo stesso id.
      this.node = document.createElement("iframe");
      this.node.id = nodeId;
      document.getElementById(nodeId).replaceWith(this.node);
      players.push(this);
    }
    /** La vera API chiama onReady quando vuole lei: qui decidiamo noi. */
    ready() { this.cfg.events.onReady?.({ target: this }); }
    emit(state) {
      this.state = state;
      this.cfg.events.onStateChange?.({ data: state, target: this });
    }
    emitError(code = 150) { this.cfg.events.onError?.({ data: code, target: this }); }
    playVideo() { this.playCalls++; }
    pauseVideo() {}
    loadVideoById(opts) { this.loads.push(opts); this.time = 0; }
    // Di proposito NON aggiorna this.time: il player vero continua a riportare
    // la posizione vecchia per qualche decimo dopo un salto, ed è quel ritardo
    // che faceva tornare indietro la barra.
    seekTo(seconds, allowSeekAhead) { this.seeks.push({ seconds, allowSeekAhead }); }
    getDuration() { this.#alive(); return this.duration; }
    getCurrentTime() { this.#alive(); return this.time; }
    getPlayerState() { this.#alive(); return this.state; }
    destroy() { this.destroyed = true; this.node.remove(); }
    #alive() { if (this.destroyed) throw new Error("player distrutto"); }
  }

  return {
    players,
    last: () => players.at(-1),
    /** Simula l'arrivo dello script iframe_api di YouTube. */
    arrive() {
      vi.stubGlobal("YT", { Player: FakePlayer, PlayerState });
      window.onYouTubeIframeAPIReady?.();
    },
  };
}

/**
 * Monta l'area admin con il markup reale di public/admin.html e un server finto.
 * `events` sono eventi completi: da lì ricaviamo sia l'elenco leggero sia le
 * risposte per singolo id, come fa il server vero.
 */
export async function mountAdmin({ events = [] } = {}) {
  const html = fs.readFileSync(path.join(root, "public", "admin.html"), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]
    .replace(/<script[\s\S]*?<\/script>/gi, "");

  localStorage.clear();
  sessionStorage.clear();

  const store = events.map((e) => ({ ...e, songs: e.songs || [] }));
  const salvati = [];   // payload arrivati al server finto
  const esportati = []; // blob passati a URL.createObjectURL

  const res = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

  vi.stubGlobal("confirm", vi.fn(() => true));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, opts = {}) => {
      const u = String(url);
      const metodo = (opts.method || "GET").toUpperCase();
      const body = opts.body ? JSON.parse(opts.body) : null;

      // Sessione già aperta: boot() sblocca senza passare dal form, come quando
      // il browser ha ancora il cookie del login precedente.
      if (u.includes("/api/session")) return res({ ok: true });
      if (u.includes("/api/login") || u.includes("/api/logout")) return res({ ok: true });
      if (u.includes("/api/oembed")) return res({ title: "" });

      const m = u.match(/\/api\/events\/([^/?]+)/);
      if (m) {
        const ev = store.find((e) => e.id === m[1]);
        if (metodo === "PUT") {
          salvati.push(body);
          return res({ ...ev, ...body, id: m[1] });
        }
        return ev ? res(ev) : res({ error: "Evento non trovato" }, 404);
      }
      if (u.includes("/api/events")) {
        if (metodo === "POST") {
          salvati.push(body);
          return res({ ...body, id: "nuovo" }, 201);
        }
        return res(
          store.map((e) => ({ id: e.id, name: e.name, date: e.date || "", place: e.place || "", count: e.songs.length }))
        );
      }
      return res({}, 404);
    })
  );

  // jsdom non ha createObjectURL: qui serve solo a intercettare l'export.
  URL.createObjectURL = (blob) => { esportati.push(blob); return "blob:test"; };
  URL.revokeObjectURL = () => {};
  // L'export scarica il file con un clic su <a>: in jsdom sarebbe una navigazione
  // non implementata, e il blob l'abbiamo già intercettato qui sopra.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  vi.resetModules();
  await import("/js/admin.js");
  await flush();

  return {
    flush,
    /** Apre un evento dell'elenco come farebbe un clic. */
    async open(id) {
      document.querySelector(`#evList button[data-id="${id}"]`).click();
      await flush();
    },
    /** Aggiunge un brano incollando il link, come nell'uso reale. */
    async addSong(url) {
      $("fUrl").value = url;
      $("btnAdd").click();
      await flush();
    },
    lastSaved: () => salvati.at(-1),
    lastExport: async () => JSON.parse(await esportati.at(-1).text()),
  };
}

/** Fa girare le microtask in sospeso (fetch finte, await interni). */
export async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Ricarica player.js da zero: lo stato vive in variabili di modulo. */
export async function loadPlayer() {
  vi.resetModules();
  await import("/js/player.js");
  await flush();
}

export const $ = (id) => document.getElementById(id);

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

  // jsdom non definisce affatto showModal/close su HTMLDialogElement (non è
  // che li implementi a vuoto: proprio non ci sono, vi.spyOn su un metodo
  // assente lancia) — li aggiungiamo noi prima di spiarli, così restano due
  // spie che segnino l'apertura, lo stesso trucco usato per il clic di export.
  if (!HTMLDialogElement.prototype.showModal) HTMLDialogElement.prototype.showModal = function () {};
  if (!HTMLDialogElement.prototype.close) HTMLDialogElement.prototype.close = function () {};
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
      // cancelable:true perché il vero BeforeInstallPromptEvent lo è: senza,
      // il preventDefault() di install.js non lascerebbe traccia da verificare.
      const e = new Event("beforeinstallprompt", { cancelable: true });
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
