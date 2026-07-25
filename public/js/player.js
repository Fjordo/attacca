// Player e home. Gestisce anche il routing lato client (/ e /e/:id).
import {
  apiListEvents, apiGetEvent, apiFetchTitle,
  cacheEvent, getCachedEvent, cacheList, getCachedList,
  readSetlistFile, fmtTime, fmtWhen, pad2, escapeHtml, whatsappUrl, toast,
} from "/js/common.js";

const $ = (id) => document.getElementById(id);
const homeEl = $("home");
const playerEl = $("player");

const lessMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const state = {
  event: null,
  local: false,      // true se la lista è stata importata da file (non sul server)
  index: 0,
  player: null,      // istanza YT.Player
  apiReady: false,
  apiPromise: null,  // caricamento della IFrame API in corso
  creating: null,    // creazione del player in corso: evita due istanze sullo stesso nodo
  gen: 0,            // generazione del player: invalida le callback dei player distrutti
  loadToken: 0,      // caricamento corrente: invalida i salti brano in sospeso
  started: false,    // l'utente ha premuto Avvia almeno una volta
  playing: false,
  intendPlaying: false, // vogliamo che stia suonando: base del rilevatore di stallo
  lastTime: -1,
  lastAdvance: 0,
  skipTimer: null,
  scrubbing: false,    // il dito è sulla barra: comanda l'utente, non il ticker
  seekTarget: null,    // posizione richiesta, mostrata finché il player non ci arriva
  seekHoldUntil: 0,
  autoplay: true,
  ticker: null,
};

// ---- Routing -------------------------------------------------------------
function route() {
  const m = location.pathname.match(/^\/e\/([\w-]+)\/?$/);
  if (m) return openEventById(m[1]);
  return showHome();
}
window.addEventListener("popstate", route);

// ---- HOME ----------------------------------------------------------------
async function showHome() {
  destroyPlayer();
  playerEl.hidden = true;
  homeEl.hidden = false;
  document.title = "Attacca";

  const listEl = $("eventList");
  let list = getCachedList();
  if (list) renderEventList(list);
  else listEl.innerHTML = `<div class="empty">Carico gli eventi…</div>`;

  try {
    list = await apiListEvents();
    cacheList(list);
    renderEventList(list);
  } catch {
    if (!list) listEl.innerHTML = `<div class="empty">Nessuna connessione e nessun evento salvato.</div>`;
  }
}

function renderEventList(list) {
  const listEl = $("eventList");
  if (!list || !list.length) {
    listEl.innerHTML = `<div class="empty">Ancora nessun evento. Creane uno dall'<a href="/admin">area Admin</a>.</div>`;
    return;
  }
  listEl.innerHTML = list
    .map((e) => {
      const quando = fmtWhen(e.date, e.place);
      return `
      <a class="event-card" href="/e/${e.id}" data-id="${e.id}">
        <div class="big">${pad2(e.count || 0)}</div>
        <div class="meta">
          <div class="name">${escapeHtml(e.name)}</div>
          <div class="info">${quando ? escapeHtml(quando) + " · " : ""}${e.count || 0} brani</div>
        </div>
      </a>`;
    })
    .join("");
  // Navigazione client per non ricaricare la pagina.
  listEl.querySelectorAll(".event-card").forEach((a) => {
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const id = a.getAttribute("data-id");
      history.pushState({}, "", `/e/${id}`);
      openEventById(id);
    });
  });
}

// Import da file JSON — scorciatoia non pubblicizzata: trascina un .json sulla
// home e la scaletta parte in locale, senza toccare il server (comodo offline).
// L'import "ufficiale", quello che crea davvero un evento, sta nell'area Admin.
let dragDepth = 0;
const homeVisible = () => !homeEl.hidden;
const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
const setDropHint = (on) => document.body.classList.toggle("dropping", on);

window.addEventListener("dragenter", (e) => {
  if (!homeVisible() || !hasFiles(e)) return;
  dragDepth++;
  setDropHint(true);
});
window.addEventListener("dragleave", () => {
  if (dragDepth && --dragDepth === 0) setDropHint(false);
});
window.addEventListener("dragover", (e) => {
  if (!homeVisible() || !hasFiles(e)) return;
  e.preventDefault(); // senza questo il browser apre il file al posto nostro
  e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("drop", async (e) => {
  if (!homeVisible() || !hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  setDropHint(false);
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const ev = await readSetlistFile(file);
    openEvent({ ...ev, id: "local", local: true });
    history.pushState({}, "", "/");
  } catch (err) {
    toast("File non valido: " + err.message, true);
  }
});

// ---- Caricamento evento --------------------------------------------------
async function openEventById(id) {
  showPlayerShell();
  let ev = getCachedEvent(id);
  if (ev) openEvent(ev, { keepShell: true });
  try {
    ev = await apiGetEvent(id);
    cacheEvent(ev);
    // Se stai già suonando questo evento, non reinizializzo il player.
    if (!(state.started && state.event && state.event.id === id)) {
      openEvent(ev, { keepShell: true });
    }
  } catch (err) {
    if (!getCachedEvent(id)) {
      $("evName").textContent = "Evento non trovato";
      $("setlist").innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }
}

function showPlayerShell() {
  homeEl.hidden = true;
  playerEl.hidden = false;
}

function openEvent(ev, opts = {}) {
  destroyPlayer();
  state.event = ev;
  state.local = !!ev.local;
  state.index = 0;
  state.started = false;
  state.playing = false;

  if (!opts.keepShell) showPlayerShell();
  document.title = ev.name + " · Attacca";

  $("evName").textContent = ev.name || "Scaletta";
  $("evDate").textContent = fmtWhen(ev.date, ev.place);
  $("evCount").textContent = `${ev.songs.length} brani`;

  // Condivisione: solo per eventi salvati sul server.
  const share = $("btnShare");
  if (state.local) {
    share.style.display = "none";
  } else {
    share.style.display = "";
    share.href = whatsappUrl(ev);
  }

  renderSetlist();
  updateNowPlaying();
  fillMissingTitles();
  updateNetState();
}

function renderSetlist() {
  const ol = $("setlist");
  ol.innerHTML = state.event.songs
    .map(
      (s, i) => `
      <li class="song" data-i="${i}">
        <span class="num">${pad2(i + 1)}</span>
        <div class="body">
          <div class="t">${escapeHtml(s.title || "Video " + s.videoId)}</div>
          <div class="s">youtube · ${escapeHtml(s.videoId)}${s.start ? " · da " + fmtTime(s.start) : ""}</div>
        </div>
        <span class="dur" data-dur="${i}"></span>
      </li>`
    )
    .join("");
  ol.querySelectorAll(".song").forEach((li) => {
    li.addEventListener("click", () => {
      const i = +li.getAttribute("data-i");
      goTo(i, { autoplay: true });
    });
  });
  highlightActive();
}

function highlightActive() {
  const rows = $("setlist").querySelectorAll(".song");
  rows.forEach((li, i) => {
    li.classList.toggle("active", i === state.index);
    li.classList.toggle("played", i < state.index);
    const dot = li.querySelector(".livedot");
    if (i === state.index && state.playing) {
      if (!dot) {
        const d = document.createElement("span");
        d.className = "livedot";
        li.appendChild(d);
      }
    } else if (dot) dot.remove();
  });
  // La lista segue il brano in corso. Chi ha chiesto meno animazioni ci arriva
  // di colpo: lo scorrimento morbido è un'animazione anche se lo chiede il JS,
  // e il @media del CSS non ferma questa chiamata.
  const active = $("setlist").querySelector(".song.active");
  if (active && state.started) {
    active.scrollIntoView({ block: "nearest", behavior: lessMotion() ? "auto" : "smooth" });
  }
}

function currentSong() {
  return state.event.songs[state.index];
}
function updateNowPlaying() {
  const s = currentSong();
  $("nowTitle").textContent = s ? s.title || "Video " + s.videoId : "—";
  $("nowSub").textContent = s ? `Brano ${state.index + 1} di ${state.event.songs.length}` : "";
}

// Riempi i titoli mancanti (liste importate a mano) se siamo online.
async function fillMissingTitles() {
  if (!navigator.onLine) return;
  const songs = state.event.songs;
  for (let i = 0; i < songs.length; i++) {
    if (songs[i].title) continue;
    const t = await apiFetchTitle(songs[i].videoId);
    if (t) {
      songs[i].title = t;
      const row = $("setlist").querySelector(`.song[data-i="${i}"] .t`);
      if (row) row.textContent = t;
      if (i === state.index) updateNowPlaying();
    }
  }
}

// ---- YouTube IFrame API --------------------------------------------------
// Quanto aspettiamo prima di considerare un brano "piantato" e passare oltre.
const STALL_MS = 15000;
const API_TIMEOUT_MS = 12000;
// Quanto teniamo ferma la barra sul punto scelto in attesa che YouTube ci arrivi,
// e quanto vicino deve essere per considerare il salto concluso.
const SEEK_HOLD_MS = 2000;
const SEEK_SNAP_S = 1.5;

function loadYouTubeAPI() {
  if (window.YT && window.YT.Player) return Promise.resolve(true);
  if (state.apiPromise) return state.apiPromise;

  state.apiPromise = new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      state.apiReady = ok;
      if (!ok) state.apiPromise = null; // così un nuovo tentativo può ripartire
      resolve(ok);
    };

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      finish(true);
    };

    if (!document.getElementById("yt-api")) {
      const tag = document.createElement("script");
      tag.id = "yt-api";
      tag.src = "https://www.youtube.com/iframe_api";
      tag.onerror = () => finish(false);
      document.head.appendChild(tag);
    }
    // Se la API non risponde (rete lenta, blocco) non restiamo appesi per sempre.
    setTimeout(() => finish(!!(window.YT && window.YT.Player)), API_TIMEOUT_MS);
  });
  return state.apiPromise;
}

// Segna l'inizio di un nuovo caricamento: azzera il rilevatore di stallo
// e invalida gli eventuali salti brano ancora in coda.
function markLoad() {
  state.loadToken++;
  clearSkip();
  state.lastTime = -1;
  state.lastAdvance = Date.now();
  resetProgress(); // nuovo brano: barra a zero e disattivata finché non sappiamo la durata
}

async function startPlayback() {
  if (!currentSong()) return;
  $("screenPlaceholder").style.display = "none";
  state.started = true;
  state.intendPlaying = true;

  // Un solo player alla volta: senza questo lock un secondo tocco durante
  // l'attesa della API (Avvia + brano della scaletta) creava una seconda
  // istanza sullo stesso nodo e il lettore restava bloccato.
  if (state.creating) return state.creating;
  if (state.player) return playSong(currentSong());

  const gen = state.gen;
  state.creating = (async () => {
    const ok = await loadYouTubeAPI();
    if (gen !== state.gen) return;   // evento cambiato / player distrutto nel frattempo
    if (state.player) return;        // creato da un'altra chiamata
    if (!ok) {
      state.started = false;
      state.intendPlaying = false;
      $("screenPlaceholder").style.display = "";
      toast("Non riesco a caricare il player di YouTube. Controlla la rete.", true);
      return;
    }
    const s = currentSong();         // l'indice può essere cambiato durante l'attesa
    if (!s) return;
    markLoad();
    state.player = createPlayer(s);
    startTicker();                   // attivo subito: se onReady non arriva, lo stallo lo rileva
  })();

  try {
    await state.creating;
  } finally {
    state.creating = null;
  }
}

function createPlayer(song) {
  return new YT.Player("yt", {
    videoId: song.videoId,
    playerVars: {
      autoplay: 1,
      start: song.start || 0,
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
      enablejsapi: 1,
      origin: location.origin,
    },
    events: {
      onReady: () => {
        try { state.player && state.player.playVideo(); } catch {}
        startTicker();
      },
      onStateChange: onPlayerState,
      onError: onPlayerError,
    },
  });
}

// Carica un brano nel player già esistente.
function playSong(s) {
  if (!s || !state.player) return;
  markLoad();
  state.intendPlaying = true;
  try {
    state.player.loadVideoById({ videoId: s.videoId, startSeconds: s.start || 0 });
  } catch {
    // Player in uno stato inutilizzabile: lo ricostruiamo da zero.
    rebuildPlayer();
  }
}

// Ultima risorsa: butta via il player e ricrealo sul brano corrente
// (destroyPlayer non tocca state.index).
function rebuildPlayer() {
  destroyPlayer();
  startPlayback();
}

function onPlayerState(e) {
  const YTS = window.YT.PlayerState;
  if (e.data === YTS.PLAYING) {
    state.playing = true;
    state.intendPlaying = true;
    clearSkip();
    state.lastAdvance = Date.now();
    setPlayGlyph(true);
  } else if (e.data === YTS.PAUSED) {
    state.playing = false;
    state.intendPlaying = false;
    setPlayGlyph(false);
  } else if (e.data === YTS.ENDED) {
    state.playing = false;
    if (state.autoplay) {
      // Fuori dalla callback: chiamare loadVideoById qui dentro, durante il
      // dispatch della API, lascia il player in uno stato incoerente.
      setTimeout(advanceOrStop, 0);
    } else {
      state.intendPlaying = false;
      setPlayGlyph(false);
    }
  }
  highlightActive();
}

function onPlayerError() {
  // Video non disponibile / bloccato: salto al successivo.
  toast("Brano non disponibile, salto al prossimo", true);
  scheduleSkip();
}

// Il salto è legato al caricamento che l'ha richiesto: se l'utente cambia
// brano nel frattempo, il timer scade a vuoto invece di far avanzare due volte.
function scheduleSkip() {
  clearSkip();
  const token = state.loadToken;
  state.skipTimer = setTimeout(() => {
    state.skipTimer = null;
    if (token !== state.loadToken) return;
    advanceOrStop();
  }, 1200);
}

function clearSkip() {
  if (state.skipTimer) clearTimeout(state.skipTimer);
  state.skipTimer = null;
}

function advanceOrStop() {
  if (!state.event) return;
  if (state.index < state.event.songs.length - 1) {
    goTo(state.index + 1, { autoplay: true });
  } else {
    state.intendPlaying = false;
    setPlayGlyph(false);
    toast("Fine della scaletta");
  }
}

// Il player è fermo pur dovendo suonare: è il caso dell'errore generico di
// YouTube ("An error occurred"), che non emette l'evento onError, e del
// buffering infinito. Senza questo controllo la scaletta si piantava qui.
function onStuck() {
  if (!state.autoplay || !state.event || state.index >= state.event.songs.length - 1) {
    state.intendPlaying = false;
    setPlayGlyph(false);
    toast("Il video non parte. Tocca ▶ per riprovare.", true);
    return;
  }
  toast("Video bloccato, passo al prossimo", true);
  // Ricostruiamo il player invece di caricare e basta: l'overlay di errore
  // di YouTube resta nello stesso iframe e un loadVideoById non lo sblocca.
  state.index++;
  updateNowPlaying();
  highlightActive();
  rebuildPlayer();
}

// ---- Comandi -------------------------------------------------------------
function goTo(i, { autoplay = false } = {}) {
  if (!state.event || i < 0 || i >= state.event.songs.length) return;
  clearSkip();
  state.index = i;
  updateNowPlaying();
  highlightActive();
  if (!state.started || !state.player) {
    if (autoplay) startPlayback();
    return;
  }
  playSong(currentSong());
}

function togglePlay() {
  if (!state.started || !state.player) return startPlayback();
  let st;
  try {
    st = state.player.getPlayerState();
  } catch {
    return rebuildPlayer();
  }
  if (st === window.YT.PlayerState.PLAYING) {
    state.intendPlaying = false;
    state.player.pauseVideo();
  } else {
    state.intendPlaying = true;
    state.lastAdvance = Date.now();
    state.player.playVideo();
  }
}

function setPlayGlyph(playing) {
  $("playGlyph").textContent = playing ? "⏸" : "▶";
}

function startTicker() {
  stopTicker();
  state.ticker = setInterval(tick, 500);
}

function tick() {
  const p = state.player;
  if (!p) return;

  let dur = 0;
  let cur = 0;
  try {
    dur = (p.getDuration && p.getDuration()) || 0;
    cur = (p.getCurrentTime && p.getCurrentTime()) || 0;
  } catch {
    // Player non ancora pronto: conta come "nessun avanzamento".
  }

  updateDuration(dur);
  if (dur) {
    const el = $("setlist").querySelector(`[data-dur="${state.index}"]`);
    if (el && !el.textContent) el.textContent = fmtTime(dur);
  }

  // Mentre trascini comandi tu: il ticker non deve contrastare il dito.
  if (state.scrubbing) {
    state.lastAdvance = Date.now();
    return;
  }

  // Dopo un salto YouTube riporta ancora la posizione vecchia per qualche
  // decimo: mostriamo la destinazione finché non ci arriva davvero, altrimenti
  // la barra torna visibilmente indietro.
  if (state.seekTarget !== null) {
    const arrivato = Math.abs(cur - state.seekTarget) < SEEK_SNAP_S;
    if (arrivato || Date.now() > state.seekHoldUntil) {
      state.seekTarget = null;
    } else {
      renderPosition(state.seekTarget, dur);
      state.lastAdvance = Date.now(); // il buffering del salto non è un blocco
      return;
    }
  }

  renderPosition(cur, dur);

  // Rilevatore di stallo: solo quando ci aspettiamo che stia suonando,
  // così una pausa volontaria non fa saltare il brano.
  if (!state.intendPlaying) {
    state.lastAdvance = Date.now();
    return;
  }
  if (cur !== state.lastTime) {
    state.lastTime = cur;
    state.lastAdvance = Date.now();
    return;
  }
  if (Date.now() - state.lastAdvance > STALL_MS) {
    state.lastAdvance = Date.now(); // evita di rilanciare a raffica
    onStuck();
  }
}
function stopTicker() {
  if (state.ticker) clearInterval(state.ticker);
  state.ticker = null;
}

// ---- Barra di avanzamento ------------------------------------------------
const seekEl = $("seek");

// La barra ha senso solo quando sappiamo quanto dura il brano.
function updateDuration(dur) {
  const nota = dur > 0;
  seekEl.disabled = !nota;
  if (!nota) {
    seekEl.max = 0;
    $("timeDur").textContent = "0:00";
    return;
  }
  if (Number(seekEl.max) !== dur) {
    seekEl.max = dur;
    $("timeDur").textContent = fmtTime(dur);
  }
}

function renderPosition(cur, dur) {
  const pos = Math.max(0, Math.min(cur, dur || cur));
  if (!state.scrubbing) seekEl.value = String(pos);
  seekEl.style.setProperty("--pct", (dur ? Math.min(100, (pos / dur) * 100) : 0) + "%");
  $("timeCur").textContent = fmtTime(pos);
  seekEl.setAttribute("aria-valuetext", `${fmtTime(pos)} di ${fmtTime(dur)}`);
}

function resetProgress() {
  state.scrubbing = false;
  state.seekTarget = null;
  seekEl.disabled = true;
  seekEl.max = 0;
  seekEl.value = "0";
  seekEl.style.setProperty("--pct", "0%");
  $("timeCur").textContent = "0:00";
  $("timeDur").textContent = "0:00";
}

// Durante il trascinamento aggiorniamo solo ciò che si vede: un seekTo per
// ogni movimento del dito manderebbe il player negli stati bloccati.
seekEl.addEventListener("input", () => {
  if (!state.player) return;
  state.scrubbing = true;
  renderPosition(Number(seekEl.value), Number(seekEl.max));
});

// Il rilascio (o una freccia da tastiera) è l'unico momento in cui si salta.
seekEl.addEventListener("change", () => {
  state.scrubbing = false;
  if (!state.player) return;
  const destinazione = Number(seekEl.value);
  try {
    state.player.seekTo(destinazione, true);
  } catch {
    return;
  }
  state.seekTarget = destinazione;
  state.seekHoldUntil = Date.now() + SEEK_HOLD_MS;
  // Un salto riazzera il rilevatore di stallo: il caricamento che segue non
  // deve essere scambiato per un blocco e farti saltare il brano.
  state.lastTime = -1;
  state.lastAdvance = Date.now();
  renderPosition(destinazione, Number(seekEl.max));
});

function destroyPlayer() {
  stopTicker();
  clearSkip();
  state.gen++;          // invalida creazioni e callback del player uscente
  if (state.player && state.player.destroy) {
    try { state.player.destroy(); } catch {}
  }
  state.player = null;
  state.creating = null;
  state.started = false;
  state.playing = false;
  state.intendPlaying = false;
  state.lastTime = -1;
  const ph = $("screenPlaceholder");
  if (ph) ph.style.display = "";
  resetProgress();
  setPlayGlyph(false);
  // Rifà sempre il div #yt (la YT API lo sostituisce con un iframe). Va rimosso
  // anche quando destroy() fallisce: altrimenti resta l'iframe del player morto
  // e la nuova istanza ci si aggancia sopra, restando bloccata.
  const old = document.getElementById("yt");
  if (old) old.remove();
  const scr = document.querySelector(".screen");
  if (scr) {
    const d = document.createElement("div");
    d.id = "yt";
    scr.insertBefore(d, scr.firstChild);
  }
}

// ---- Stato rete ----------------------------------------------------------
function updateNetState() {
  const online = navigator.onLine;
  $("offlineBanner").classList.toggle("show", !online);
  $("netState").textContent = online ? "" : "offline";
}
window.addEventListener("online", updateNetState);
window.addEventListener("offline", updateNetState);

// ---- Wiring bottoni ------------------------------------------------------
$("btnStart").addEventListener("click", () => startPlayback());
$("btnPlay").addEventListener("click", () => togglePlay());
$("btnPrev").addEventListener("click", () => goTo(state.index - 1, { autoplay: state.started }));
$("btnNext").addEventListener("click", () => goTo(state.index + 1, { autoplay: state.started }));
$("autoplayToggle").addEventListener("change", (e) => (state.autoplay = e.target.checked));

// Tastiera: spazio play/pausa, frecce per cambiare brano.
document.addEventListener("keydown", (e) => {
  if (playerEl.hidden) return;
  // Il bersaglio non è sempre un elemento (può essere document): senza il
  // controllo opzionale l'eccezione spegneva del tutto i comandi da tastiera.
  if (e.target?.matches?.("textarea, [contenteditable], input:not([type='range'])")) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  // Sulla barra le frecce spostano la posizione (ci pensa il browser),
  // non devono anche cambiare brano.
  else if (e.target === seekEl) return;
  else if (e.code === "ArrowRight") goTo(state.index + 1, { autoplay: state.started });
  else if (e.code === "ArrowLeft") goTo(state.index - 1, { autoplay: state.started });
});

// Via!
route();
