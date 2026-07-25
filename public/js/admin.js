// Area Admin: crea, ordina, salva e condividi le scalette.
import {
  apiLogin, apiSession, apiLogout, apiListEvents, apiGetEvent, apiCreateEvent, apiUpdateEvent, apiDeleteEvent,
  apiFetchTitle, parseYouTube, readSetlistFile, pad2, escapeHtml, whatsappUrl, shareUrl, toast,
  fmtWhen, isIsoDate,
} from "/js/common.js";

const $ = (id) => document.getElementById(id);

let events = [];         // elenco (leggero) degli eventi
let current = null;      // evento in modifica {id?, name, date, place, note, songs[]}
let dirty = false;

// ---- Login ---------------------------------------------------------------
// La password non resta da questa parte: al login il server manda un cookie di
// sessione HttpOnly, che questo codice non può nemmeno leggere. Qui chiediamo
// solo se quella sessione vale ancora.
async function boot() {
  if (await apiSession()) return unlock();
  $("lock").hidden = false;
}
$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (await apiLogin($("pwd").value)) {
    $("pwd").value = "";
    unlock();
  } else {
    toast("Password non valida", true);
  }
});

async function unlock() {
  $("lock").hidden = true;
  $("admin").hidden = false;
  $("btnLogout").hidden = false;
  await refreshList();
}

// Sessione scaduta (o revocata cambiando password): si torna al lucchetto senza
// perdere quello che c'è nell'editor.
function relock(messaggio) {
  $("admin").hidden = true;
  $("btnLogout").hidden = true;
  $("lock").hidden = false;
  $("pwd").focus();
  if (messaggio) toast(messaggio, true);
}

// Ogni chiamata admin passa di qui: un 401 riporta al login invece di finire
// in un toast generico.
async function guard(azione) {
  try {
    return await azione();
  } catch (err) {
    if (err.status === 401) relock(err.message);
    else toast(err.message, true);
    return undefined;
  }
}

$("btnLogout").addEventListener("click", async () => {
  if (dirty && !confirm("Ci sono modifiche non salvate. Uscire comunque?")) return;
  await apiLogout();
  current = null;
  dirty = false;
  $("editor").hidden = true;
  $("editorEmpty").hidden = false;
  relock();
});

// ---- Elenco eventi -------------------------------------------------------
async function refreshList() {
  try {
    events = await apiListEvents();
  } catch {
    toast("Impossibile caricare gli eventi", true);
    events = [];
  }
  renderList();
}

// Sul telefono l'elenco e l'editor sono due schermate: qui si decide quale.
// Da 900px in su ci pensa il CSS e questo attributo non ha effetto.
function showPane(quale) {
  $("adminGrid").dataset.pane = quale;
}
$("btnBack").addEventListener("click", () => showPane("list"));

function renderList() {
  const ul = $("evList");
  if (!events.length) {
    ul.innerHTML = `<li class="none">Nessun evento.</li>`;
    return;
  }
  ul.innerHTML = events
    .map((e) => {
      const quando = fmtWhen(e.date, e.place);
      return `<li><button data-id="${e.id}" class="${current && current.id === e.id ? "sel" : ""}">
        <div class="en">${escapeHtml(e.name)}</div>
        <div class="ei">${quando ? escapeHtml(quando) + " · " : ""}${e.count || 0} brani</div>
      </button></li>`;
    })
    .join("");
  ul.querySelectorAll("button[data-id]").forEach((b) =>
    b.addEventListener("click", () => selectEvent(b.getAttribute("data-id")))
  );
}

// ---- Selezione / nuovo ---------------------------------------------------
// Allinea l'evento appena caricato a ciò che il form sa gestire: una data nel
// vecchio formato libero cade qui, non a metà salvataggio.
function normalizeCurrent(ev) {
  ev.songs = ev.songs || [];
  ev.date = isIsoDate(ev.date) ? ev.date : "";
  ev.place = ev.place || "";
  ev.note = ev.note || "";
  return ev;
}

async function selectEvent(id) {
  if (dirty && !confirm("Ci sono modifiche non salvate. Continuare?")) return;
  try {
    current = normalizeCurrent(await apiGetEvent(id));
    dirty = false;
    showEditor();
  } catch {
    toast("Evento non trovato", true);
  }
}

$("btnNew").addEventListener("click", () => {
  if (dirty && !confirm("Ci sono modifiche non salvate. Continuare?")) return;
  current = { name: "", date: "", place: "", note: "", songs: [] };
  dirty = false;
  showEditor();
});

// ---- Import da file ------------------------------------------------------
// Il file riempie l'editor come bozza: sul server non viene scritto nulla
// finché non premi Salva, e il salvataggio crea sempre un evento nuovo
// (gli eventi già esistenti restano dove sono).
$("btnImport").addEventListener("click", () => $("fileInput").click());
$("fileInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // così si può ricaricare lo stesso file
  if (!file) return;
  if (dirty && !confirm("Ci sono modifiche non salvate. Continuare?")) return;
  try {
    const ev = await readSetlistFile(file);
    current = { name: ev.name, date: ev.date, place: ev.place, note: ev.note, songs: ev.songs };
    dirty = true;
    showEditor();
    toast(`${ev.songs.length} brani caricati: controlla e salva`);
    fillMissingTitles(ev.songs);
  } catch (err) {
    toast("File non valido: " + err.message, true);
  }
});

// Le liste scritte a mano spesso non hanno i titoli: li chiediamo a YouTube.
async function fillMissingTitles(songs) {
  for (const s of songs) {
    if (s.title) continue;
    const t = await apiFetchTitle(s.videoId);
    // L'utente può aver cambiato evento nel frattempo: aggiorno solo se è ancora il suo.
    if (!t || !current || !current.songs.includes(s)) continue;
    s.title = t;
    renderSongs();
  }
}

// Campo del form -> proprietà dell'evento.
const FIELDS = { fName: "name", fDate: "date", fPlace: "place", fNote: "note" };

function showEditor() {
  $("editorEmpty").hidden = true;
  $("editor").hidden = false;
  showPane("editor");
  // Un valore non ISO su <input type="date"> viene rifiutato dal browser e il
  // campo resta vuoto: è quello che vogliamo per gli eventi in vecchio formato.
  for (const [id, prop] of Object.entries(FIELDS)) $(id).value = current[prop] || "";
  renderSongs();
  renderList();
  updateActionLinks();
}

Object.entries(FIELDS).forEach(([id, prop]) =>
  $(id).addEventListener("input", () => {
    current[prop] = $(id).value;
    dirty = true;
  })
);

// ---- Brani ---------------------------------------------------------------
function renderSongs() {
  const ul = $("songList");
  if (!current.songs.length) {
    ul.innerHTML = `<li class="none">Incolla un link YouTube qui sopra per aggiungere il primo brano.</li>`;
    return;
  }
  ul.innerHTML = current.songs
    .map(
      (s, i) => `
      <li class="srow" data-i="${i}">
        <span class="handle" title="Trascina per riordinare" aria-hidden="true">⠿</span>
        <span class="idx">${pad2(i + 1)}</span>
        <div class="grow">
          <input class="st-inp" data-i="${i}" value="${escapeHtml(s.title || "")}" placeholder="Titolo del brano" />
          <div class="su">${escapeHtml(s.videoId)}${s.start ? " · da " + s.start + "s" : ""}</div>
        </div>
        <div class="acts">
          <button type="button" class="btn small" data-up="${i}" title="Sposta su" aria-label="Sposta su">▲</button>
          <button type="button" class="btn small" data-down="${i}" title="Sposta giù" aria-label="Sposta giù">▼</button>
          <button type="button" class="btn small danger" data-del="${i}" title="Rimuovi" aria-label="Rimuovi brano">✕</button>
        </div>
      </li>`
    )
    .join("");

  ul.querySelectorAll(".st-inp").forEach((inp) =>
    inp.addEventListener("input", () => {
      current.songs[+inp.getAttribute("data-i")].title = inp.value;
      dirty = true;
    })
  );
  ul.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", () => move(+b.getAttribute("data-up"), -1)));
  ul.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", () => move(+b.getAttribute("data-down"), 1)));
  ul.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      current.songs.splice(+b.getAttribute("data-del"), 1);
      dirty = true;
      renderSongs();
    })
  );
  enableDrag(ul);
}

function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= current.songs.length) return;
  [current.songs[i], current.songs[j]] = [current.songs[j], current.songs[i]];
  dirty = true;
  renderSongs();
}

// Riordino con la maniglia ⠿, dito e mouse sullo stesso percorso.
// Prima erano gli eventi drag & drop di HTML5, che sul touch non esistono: la
// maniglia si vedeva ma sul telefono non faceva nulla. Le frecce ▲▼ restano
// come strada da tastiera.
function enableDrag(ul) {
  ul.querySelectorAll(".handle").forEach((handle) =>
    handle.addEventListener("pointerdown", startDrag)
  );
}

function startDrag(e) {
  if (e.button > 0) return; // niente trascinamenti col tasto destro
  e.preventDefault();       // e niente selezione del testo mentre trascini

  const handle = e.currentTarget;
  const ul = $("songList");
  const rows = Array.from(ul.querySelectorAll(".srow"));
  const from = rows.indexOf(handle.closest(".srow"));
  if (from < 0) return;
  let to = from;

  handle.setPointerCapture(e.pointerId);
  rows[from].classList.add("dragging");

  // Durante il trascinamento la lista non si ridisegna: la destinazione la
  // ricaviamo dalla geometria e la mostriamo col bordo acceso. Lo scambio
  // vero avviene una volta sola, al rilascio.
  const onMove = (ev) => {
    let vicina = from;
    let dist = Infinity;
    rows.forEach((r, k) => {
      const b = r.getBoundingClientRect();
      const d = Math.abs(ev.clientY - (b.top + b.height / 2));
      if (d < dist) { dist = d; vicina = k; }
    });
    to = vicina;
    rows.forEach((r, k) => r.classList.toggle("dragover", k === to && to !== from));
    edgeScroll(ev.clientY);
  };

  const onEnd = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onEnd);
    handle.removeEventListener("pointercancel", onEnd);
    if (to !== from) {
      const [moved] = current.songs.splice(from, 1);
      current.songs.splice(to, 0, moved);
      dirty = true;
    }
    renderSongs(); // ridisegna comunque: ripulisce dragging/dragover
  };

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onEnd);
  handle.addEventListener("pointercancel", onEnd);
}

// Vicino al bordo la pagina scorre da sé: senza questo una lista più lunga
// dello schermo non si riordina oltre l'ultima riga visibile.
function edgeScroll(y) {
  const bordo = 72;
  if (y < bordo) window.scrollBy(0, -14);
  else if (y > window.innerHeight - bordo) window.scrollBy(0, 14);
}

// Aggiunta brano da link.
async function addSong() {
  const url = $("fUrl").value.trim();
  if (!url) return;
  const p = parseYouTube(url);
  if (!p) return toast("Link YouTube non riconosciuto", true);
  const song = { id: "s" + Date.now().toString(36), title: "", url, videoId: p.videoId, start: p.start || 0 };
  current.songs.push(song);
  dirty = true;
  $("fUrl").value = "";
  renderSongs();
  // Recupera il titolo in background.
  const t = await apiFetchTitle(p.videoId);
  if (t) {
    const idx = current.songs.indexOf(song);
    if (idx !== -1) {
      current.songs[idx].title = t;
      renderSongs();
    }
  }
}
$("btnAdd").addEventListener("click", addSong);
$("fUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addSong(); } });

// ---- Salvataggio / azioni ------------------------------------------------
$("btnSave").addEventListener("click", async () => {
  if (!current.name.trim()) return toast("Dai un nome all'evento", true);
  if (!current.songs.length) return toast("Aggiungi almeno un brano", true);
  const payload = {
    name: current.name,
    date: current.date,
    place: current.place,
    note: current.note,
    songs: current.songs,
  };
  const saved = await guard(() =>
    current.id ? apiUpdateEvent(current.id, payload) : apiCreateEvent(payload)
  );
  if (!saved) return;
  current = normalizeCurrent(saved);
  dirty = false;
  await refreshList();
  showEditor();
  toast("Scaletta salvata");
});

function updateActionLinks() {
  const hasId = !!current.id;
  $("btnPreview").style.display = hasId ? "" : "none";
  $("btnWa").style.display = hasId ? "" : "none";
  $("btnDelete").style.display = hasId ? "" : "none";
  if (hasId) {
    $("btnPreview").href = `/e/${current.id}`;
    $("savedHint").innerHTML = `Link da condividere: <a href="${shareUrl(current.id)}">${shareUrl(current.id)}</a>`;
  } else {
    $("savedHint").textContent = "Salva l'evento per ottenere il link condivisibile.";
  }
}

$("btnWa").addEventListener("click", () => {
  if (!current.id) return;
  if (dirty) toast("Ricorda di salvare le ultime modifiche");
  window.open(whatsappUrl(current), "_blank", "noopener");
});

$("btnExport").addEventListener("click", () => {
  const data = {
    name: current.name,
    date: current.date,
    place: current.place,
    note: current.note,
    songs: current.songs,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (current.name || "attacca").replace(/[^\w\-]+/g, "_").toLowerCase() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("btnDelete").addEventListener("click", async () => {
  if (!current.id) return;
  if (!confirm(`Eliminare "${current.name}"? L'operazione non è reversibile.`)) return;
  if (!(await guard(() => apiDeleteEvent(current.id)))) return;
  current = null;
  $("editor").hidden = true;
  $("editorEmpty").hidden = false;
  showPane("list");
  await refreshList();
  toast("Evento eliminato");
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

boot();
