// Regressioni della riproduzione automatica.
// Ogni test nasce da un modo concreto in cui il lettore YouTube si bloccava.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mountApp, fakeYouTube, loadPlayer, flush, PlayerState, $ } from "./helpers/app.js";

const { PLAYING, PAUSED, ENDED } = PlayerState;

let yt;

beforeEach(async () => {
  history.replaceState({}, "", "/e/test");
  mountApp();
  yt = fakeYouTube();
  await loadPlayer();
  vi.useFakeTimers(); // lo stallo dura 15s: non stiamo qui ad aspettarli
});

afterEach(() => {
  vi.useRealTimers();
});

/** Porta il player fino a "sta suonando" e lo restituisce. */
async function start() {
  $("btnStart").click();
  await flush();
  yt.arrive();
  await flush();
  const p = yt.last();
  p.ready();
  p.emit(PLAYING);
  return p;
}

/** Avanza il tempo finto lasciando girare anche le microtask. */
const tick = (ms) => vi.advanceTimersByTimeAsync(ms);

describe("avvio", () => {
  it("apre l'evento indicato dalla rotta /e/:id", () => {
    expect($("evName").textContent).toBe("Prova");
    expect($("evCount").textContent).toBe("3 brani");
    expect($("setlist").querySelectorAll(".song")).toHaveLength(3);
  });

  it("mostra data e luogo in testata", () => {
    expect($("evDate").textContent).toBe("3 ago 2026 · Bettona");
  });

  it("crea una sola istanza YT.Player anche con più tocchi durante l'attesa della API", async () => {
    $("btnStart").click(); // startPlayback resta in attesa dello script YouTube
    await flush();
    $("btnNext").click();  // in questo istante state.player è ancora null
    $("btnStart").click();
    await flush();
    yt.arrive();
    await flush();

    expect(yt.players).toHaveLength(1);
  });

  it("parte dal brano scelto mentre la API stava ancora caricando", async () => {
    $("btnStart").click();
    await flush();
    $("btnNext").click();
    await flush();
    yt.arrive();
    await flush();

    expect(yt.last().cfg.videoId).toBe("BBBBBBBBBBB");
    expect(yt.last().cfg.playerVars.start).toBe(7);
  });

  it("dichiara origin alla IFrame API", async () => {
    await start();
    expect(yt.last().cfg.playerVars.origin).toBe("http://localhost:8080");
  });

  it("se lo script di YouTube non risponde, rimette il pulsante Avvia", async () => {
    $("btnStart").click();
    await flush();
    expect($("screenPlaceholder").style.display).toBe("none");

    await tick(13000); // oltre il timeout di caricamento della API

    expect(yt.players).toHaveLength(0);
    expect($("screenPlaceholder").style.display).toBe(""); // l'utente può riprovare
  });
});

describe("riproduzione continua", () => {
  it("a fine brano carica il successivo, ma fuori dalla callback della API", async () => {
    const p = await start();

    p.emit(ENDED);
    expect(p.loads).toHaveLength(0); // loadVideoById dentro onStateChange incastra il player

    await tick(1);
    expect(p.loads).toHaveLength(1);
    expect(p.loads[0]).toMatchObject({ videoId: "BBBBBBBBBBB", startSeconds: 7 });
  });

  it("percorre la scaletta fino in fondo", async () => {
    const p = await start();

    p.emit(ENDED);
    await tick(1);
    p.emit(PLAYING);
    p.emit(ENDED);
    await tick(1);

    expect(p.loads.map((l) => l.videoId)).toEqual(["BBBBBBBBBBB", "CCCCCCCCCCC"]);
    expect($("nowSub").textContent).toBe("Brano 3 di 3");
  });

  it("sull'ultimo brano si ferma senza riavvolgere", async () => {
    const p = await start();
    $("btnNext").click();
    $("btnNext").click();

    p.emit(ENDED);
    await tick(10);

    expect($("playGlyph").textContent).toBe("▶");
    expect(p.loads.at(-1).videoId).toBe("CCCCCCCCCCC"); // resta sull'ultimo
  });

  it("con la riproduzione continua spenta non passa al brano dopo", async () => {
    const p = await start();
    const toggle = $("autoplayToggle");
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change"));

    p.emit(ENDED);
    await tick(10);

    expect(p.loads).toHaveLength(0);
    expect($("playGlyph").textContent).toBe("▶");
  });
});

describe("recupero dai blocchi", () => {
  // Il caso dello screenshot: YouTube mostra "An error occurred..." ma NON emette
  // onError, quindi senza rilevatore di stallo la scaletta si pianta lì.
  it("supera un player bloccato che non emette onError", async () => {
    const bloccato = await start();
    bloccato.time = 3;
    await tick(600); // un avanzamento normale, poi il tempo si congela

    await tick(14000);
    expect(yt.players).toHaveLength(1); // prima dei 15s nessun falso allarme

    await tick(2000);

    expect(yt.players).toHaveLength(2);
    expect(yt.last().cfg.videoId).toBe("BBBBBBBBBBB");
    expect(bloccato.destroyed).toBe(true);
  });

  it("non interviene se è l'utente ad aver messo in pausa", async () => {
    const p = await start();
    p.time = 12;
    await tick(600);
    p.emit(PAUSED);

    await tick(60000);

    expect(yt.players).toHaveLength(1);
    expect(p.loads).toHaveLength(0);
    expect($("playGlyph").textContent).toBe("▶");
  });

  it("continua a suonare finché il tempo avanza", async () => {
    const p = await start();
    for (let i = 1; i <= 60; i++) {
      p.time = i;
      await tick(1000);
    }
    expect(yt.players).toHaveLength(1);
    expect(p.loads).toHaveLength(0);
  });

  it("su video non disponibile salta al successivo", async () => {
    const p = await start();

    p.emitError(150);
    await tick(1500);

    expect(p.loads.at(-1).videoId).toBe("BBBBBBBBBBB");
  });

  it("annulla il salto in sospeso se l'utente cambia brano da solo", async () => {
    const p = await start();

    p.emitError(150);   // salto programmato tra 1,2s
    $("btnNext").click(); // ma l'utente decide prima
    await tick(3000);

    expect(p.loads).toHaveLength(1); // niente doppio avanzamento
    expect(p.loads[0].videoId).toBe("BBBBBBBBBBB");
  });

  it("rimette un nodo #yt pulito anche se destroy() fallisce", async () => {
    const p = await start();
    p.destroy = () => { throw new Error("iframe non raggiungibile"); };

    history.pushState({}, "", "/"); // torna alla home: distrugge il player
    window.dispatchEvent(new PopStateEvent("popstate"));
    await flush();

    const node = $("yt");
    expect(node).toBeTruthy();
    expect(node.tagName).toBe("DIV"); // non l'iframe morto rimasto lì
  });
});

describe("barra di avanzamento trascinabile", () => {
  /** Simula il trascinamento del cursore fino a `secondi` (senza rilasciare). */
  function trascina(secondi) {
    const seek = $("seek");
    seek.value = String(secondi);
    seek.dispatchEvent(new Event("input", { bubbles: true }));
  }
  /** Rilascia il dito: è qui che deve avvenire il salto vero. */
  function rilascia() {
    $("seek").dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("è un cursore, non un semplice riempimento", async () => {
    await start();
    await tick(600);

    const seek = $("seek");
    expect(seek).toBeTruthy();
    expect(seek.tagName).toBe("INPUT");
    expect(seek.type).toBe("range");
  });

  it("resta disattivata finché non si conosce la durata", async () => {
    $("btnStart").click();
    await flush();
    yt.arrive();
    await flush();
    const p = yt.last();
    p.duration = 0; // il player non sa ancora quanto dura il video
    p.ready();
    await tick(600);

    expect($("seek").disabled).toBe(true);
  });

  it("si attiva e prende la durata del brano", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    expect($("seek").disabled).toBe(false);
    expect(Number($("seek").max)).toBe(120);
    expect($("timeDur").textContent).toBe("2:00");
  });

  it("mostra la posizione corrente mentre il brano va avanti", async () => {
    const p = await start();
    p.time = 65;
    await tick(600);

    expect(Number($("seek").value)).toBeCloseTo(65, 0);
    expect($("timeCur").textContent).toBe("1:05");
  });

  it("trascinare aggiorna il tempo mostrato ma NON fa saltare il video", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);

    expect(p.seeks).toHaveLength(0); // bombardare seekTo blocca il player
    expect($("timeCur").textContent).toBe("1:52");
  });

  it("il ticker non contrasta il dito mentre trascini", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);
    p.time = 11; // il brano intanto va avanti per conto suo
    await tick(600);

    expect(Number($("seek").value)).toBe(112); // resta dove l'hai messo
    expect($("timeCur").textContent).toBe("1:52");
  });

  it("al rilascio salta una volta sola, al punto scelto", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);
    rilascia();

    expect(p.seeks).toHaveLength(1);
    expect(p.seeks[0].seconds).toBeCloseTo(112, 0);
    expect(p.seeks[0].allowSeekAhead).toBe(true);
  });

  // Il punto centrale della richiesta: niente scatto all'indietro.
  it("dopo il salto la barra non torna indietro mentre YouTube si allinea", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);
    rilascia();
    // Il player vero continua a dire "sono a 0:10" per qualche decimo.
    await tick(600);

    expect(Number($("seek").value)).toBeCloseTo(112, 0);
    expect($("timeCur").textContent).toBe("1:52");
  });

  it("riprende a seguire il player quando il salto è arrivato a destinazione", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);
    rilascia();
    p.time = 112.4; // YouTube è arrivato
    await tick(600);
    p.time = 118;
    await tick(600);

    expect(Number($("seek").value)).toBeCloseTo(118, 0);
  });

  it("non scambia il trascinamento per un blocco", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);       // dito fermo sulla barra, il tempo del player non avanza
    await tick(30000);

    expect(yt.players).toHaveLength(1); // niente salto di brano
    expect(p.loads).toHaveLength(0);
  });

  it("non scambia il buffering dopo un salto per un blocco", async () => {
    const p = await start();
    p.time = 10;
    await tick(600);

    trascina(112);
    rilascia();
    await tick(14000); // il video sta ancora caricando dal nuovo punto

    expect(yt.players).toHaveLength(1);
    expect(p.loads).toHaveLength(0);
  });

  it("riparte da zero al cambio brano", async () => {
    const p = await start();
    p.time = 90;
    await tick(600);

    $("btnNext").click();
    await flush();

    expect(Number($("seek").value)).toBe(0);
    expect($("timeCur").textContent).toBe("0:00");
    expect($("seek").disabled).toBe(true); // durata del nuovo brano non ancora nota
  });

  it("la barra spaziatrice continua a fare play/pausa col cursore a fuoco", async () => {
    const p = await start();
    await tick(600);
    $("seek").focus();

    $("seek").dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    p.emit(PAUSED);

    expect($("playGlyph").textContent).toBe("▶");
  });

  it("le frecce sul cursore non cambiano brano", async () => {
    const p = await start();
    await tick(600);
    $("seek").focus();

    $("seek").dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight", bubbles: true }));

    expect(p.loads).toHaveLength(0); // sposta la posizione, non la scaletta
  });
});

describe("comandi", () => {
  it("la barra spazio mette in pausa e riprende", async () => {
    const p = await start();
    const spazio = () => document.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));

    spazio();
    p.emit(PAUSED);
    expect($("playGlyph").textContent).toBe("▶");

    spazio();
    p.emit(PLAYING);
    expect($("playGlyph").textContent).toBe("⏸");
  });

  it("le frecce cambiano brano", async () => {
    const p = await start();
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowRight" }));
    expect(p.loads.at(-1).videoId).toBe("BBBBBBBBBBB");

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" }));
    expect(p.loads.at(-1).videoId).toBe("AAAAAAAAAAA");
  });

  it("un tocco sulla scaletta salta al brano scelto", async () => {
    const p = await start();
    $("setlist").querySelector('.song[data-i="2"]').click();

    expect(p.loads.at(-1).videoId).toBe("CCCCCCCCCCC");
    expect($("nowTitle").textContent).toBe("Tre");
  });
});
