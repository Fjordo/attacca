// Area Admin: crea, ordina, salva e condividi le scalette.
import {
  apiLogin, apiListEvents, apiGetEvent, apiCreateEvent, apiUpdateEvent, apiDeleteEvent,
  apiFetchTitle, parseYouTube, readSetlistFile, pad2, escapeHtml, whatsappUrl, shareUrl, toast,
  fmtWhen, isIsoDate,
} from "/js/common.js";

const $ = (id) => document.getElementById(id);
const PWD_KEY = "attacca:pwd";

let password = sessionStorage.getItem(PWD_KEY) || "";
let events = [];         // elenco (leggero) degli eventi
let current = null;      // evento in modifica {id?, name, date, place, note, songs[]}
let dirty = false;

// ---- Login ---------------------------------------------------------------
async function boot() {
  if (password && (await apiLogin(password))) return unlock();
  $("lock").hidden = false;
}
$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pwd = $("pwd").value;
  if (await apiLogin(pwd)) {
    password = pwd;
    sessionStorage.setItem(PWD_KEY, pwd);
    unlock();
  } else {
    toast("Password non valida", true);
  }
});

async function unlock() {
  $("lock").hidden = true;
  $("admin").hidden = false;
  await refreshList();
}

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

function renderList() {
  const ul = $("evList");
  if (!events.length) {
    ul.innerHTML = `<li style="color:var(--muted);font-size:14px;padding:6px">Nessun evento.</li>`;
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
    ul.innerHTML = `<li style="color:var(--muted);font-size:14px;padding:6px 2px">Incolla un link YouTube qui sopra per aggiungere il primo brano.</li>`;
    return;
  }
  ul.innerHTML = current.songs
    .map(
      (s, i) => `
      <li class="srow" draggable="true" data-i="${i}">
        <span class="handle" title="Trascina">⠿</span>
        <span class="idx">${pad2(i + 1)}</span>
        <div class="grow">
          <input class="st-inp" data-i="${i}" value="${escapeHtml(s.title || "")}" placeholder="Titolo del brano" />
          <div class="su">${escapeHtml(s.videoId)}${s.start ? " · da " + s.start + "s" : ""}</div>
        </div>
        <div class="ord">
          <button class="btn small" data-up="${i}" title="Su">▲</button>
          <button class="btn small" data-down="${i}" title="Giù">▼</button>
        </div>
        <button class="btn small danger" data-del="${i}" title="Rimuovi">✕</button>
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

// Drag & drop (desktop). Su mobile restano le frecce ▲▼.
function enableDrag(ul) {
  let from = null;
  ul.querySelectorAll(".srow").forEach((row) => {
    row.addEventListener("dragstart", () => {
      from = +row.getAttribute("data-i");
      row.classList.add("dragging");
    });
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("dragover"); });
    row.addEventListener("dragleave", () => row.classList.remove("dragover"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("dragover");
      const to = +row.getAttribute("data-i");
      if (from === null || from === to) return;
      const [moved] = current.songs.splice(from, 1);
      current.songs.splice(to, 0, moved);
      dirty = true;
      renderSongs();
    });
  });
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
  try {
    const saved = current.id
      ? await apiUpdateEvent(current.id, payload, password)
      : await apiCreateEvent(payload, password);
    current = normalizeCurrent(saved);
    dirty = false;
    await refreshList();
    showEditor();
    toast("Scaletta salvata");
  } catch (err) {
    toast(err.message, true);
  }
});

function updateActionLinks() {
  const hasId = !!current.id;
  $("btnPreview").style.display = hasId ? "" : "none";
  $("btnWa").style.display = hasId ? "" : "none";
  $("btnDelete").style.display = hasId ? "" : "none";
  if (hasId) {
    $("btnPreview").href = `/e/${current.id}`;
    $("savedHint").innerHTML = `Link da condividere: <a href="${shareUrl(current.id)}" style="color:var(--tungsten)">${shareUrl(current.id)}</a>`;
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
  try {
    await apiDeleteEvent(current.id, password);
    current = null;
    $("editor").hidden = true;
    $("editorEmpty").hidden = false;
    await refreshList();
    toast("Evento eliminato");
  } catch (err) {
    toast(err.message, true);
  }
});

window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

boot();
