// Helper condivisi tra player e admin.
// Nessun framework: vanilla JS così una persona della band può leggerlo e modificarlo.

export const VIDEO_ID = /^[\w-]{11}$/;

// --- Parsing di un link YouTube in qualsiasi forma comune -----------------
// Ritorna { videoId, start } oppure null se non riconosciuto.
export function parseYouTube(input) {
  if (!input) return null;
  const raw = String(input).trim();

  // Caso: hanno incollato direttamente l'ID a 11 caratteri.
  if (VIDEO_ID.test(raw)) return { videoId: raw, start: 0 };

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  let videoId = null;

  if (host === "youtu.be") {
    videoId = url.pathname.slice(1).split("/")[0];
  } else if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    const p = url.pathname;
    if (p === "/watch") videoId = url.searchParams.get("v");
    else if (p.startsWith("/embed/")) videoId = p.split("/")[2];
    else if (p.startsWith("/shorts/")) videoId = p.split("/")[2];
    else if (p.startsWith("/live/")) videoId = p.split("/")[2];
    else videoId = url.searchParams.get("v");
  }

  if (!videoId || !VIDEO_ID.test(videoId)) return null;

  let start = 0;
  const t = url.searchParams.get("t") || url.searchParams.get("start");
  if (t) start = parseTimeToSeconds(t);
  return { videoId, start };
}

// "90", "1:30", "1m30s" -> secondi
export function parseTimeToSeconds(t) {
  const s = String(t).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^\d+:\d{1,2}$/.test(s)) {
    const [m, sec] = s.split(":").map(Number);
    return m * 60 + sec;
  }
  const m = s.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (m) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return 0;
}

// --- Data e luogo ---------------------------------------------------------
// La data viaggia sempre in ISO "AAAA-MM-GG": è il formato di <input type="date">
// e l'unico che si ordina e si confronta senza ambiguità. Il luogo è testo libero.
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

// Vera solo se la data esiste davvero sul calendario: "2026-02-31" non passa.
export function isIsoDate(s) {
  if (!ISO_DATE.test(String(s ?? ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// "2026-08-03" -> "3 ago 2026". Mesi da lista fissa invece di toLocaleDateString:
// il risultato non dipende dalla lingua del dispositivo. Quello che non è una data
// ISO diventa stringa vuota, così i vecchi campi liberi spariscono da soli.
export function fmtDate(iso) {
  if (!isIsoDate(iso)) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d} ${MESI[m - 1]} ${y}`;
}

// La riga "quando e dove" mostrata in home, elenco admin e player.
export function fmtWhen(date, place) {
  return [fmtDate(date), String(place ?? "").trim()].filter(Boolean).join(" · ");
}

// --- Import di una scaletta da file JSON ----------------------------------
// Accetta sia il formato completo {name, date, place, note, songs:[...]} sia una
// semplice lista di URL. Scarta le righe senza un video YouTube valido.
export function normalizeImported(data) {
  let name = "Scaletta importata";
  let date = "";
  let place = "";
  let note = "";
  let rawSongs = [];
  if (Array.isArray(data)) {
    rawSongs = data;
  } else if (data && typeof data === "object") {
    name = data.name || name;
    date = isIsoDate(data.date) ? data.date : "";
    place = typeof data.place === "string" ? data.place.trim() : "";
    note = data.note || "";
    rawSongs = data.songs || data.list || [];
  }
  const songs = [];
  rawSongs.forEach((item, i) => {
    const url = typeof item === "string" ? item : (item && item.url) || "";
    const p =
      parseYouTube(url) ||
      (item && VIDEO_ID.test(item.videoId) ? { videoId: item.videoId, start: +item.start || 0 } : null);
    if (!p) return;
    songs.push({
      id: "i" + i,
      title: (item && item.title) || "",
      url: url || `https://youtu.be/${p.videoId}`,
      videoId: p.videoId,
      start: p.start || 0,
    });
  });
  return { name, date, place, note, songs };
}

// Legge un file scelto dall'utente e ne ricava una scaletta utilizzabile.
export async function readSetlistFile(file) {
  const ev = normalizeImported(JSON.parse(await file.text()));
  if (!ev.songs.length) throw new Error("Nessun brano valido");
  return ev;
}

export function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function thumbUrl(videoId) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// --- API ------------------------------------------------------------------
export async function apiListEvents() {
  const r = await fetch("/api/events");
  if (!r.ok) throw new Error("Elenco non disponibile");
  return r.json();
}
export async function apiGetEvent(id) {
  const r = await fetch(`/api/events/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(r.status === 404 ? "Evento non trovato" : "Errore di rete");
  return r.json();
}
export async function apiFetchTitle(videoId) {
  try {
    const r = await fetch(`/api/oembed?videoId=${encodeURIComponent(videoId)}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.title || null;
  } catch {
    return null;
  }
}

// Chiamate admin: la password viaggia in un header.
export function adminHeaders(password) {
  return { "Content-Type": "application/json", "x-admin-password": password };
}
export async function apiLogin(password) {
  const r = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return r.ok;
}
export async function apiCreateEvent(ev, password) {
  const r = await fetch("/api/events", { method: "POST", headers: adminHeaders(password), body: JSON.stringify(ev) });
  if (r.status === 401) throw new Error("Password non valida");
  if (!r.ok) throw new Error("Salvataggio non riuscito");
  return r.json();
}
export async function apiUpdateEvent(id, ev, password) {
  const r = await fetch(`/api/events/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: adminHeaders(password),
    body: JSON.stringify(ev),
  });
  if (r.status === 401) throw new Error("Password non valida");
  if (!r.ok) throw new Error("Salvataggio non riuscito");
  return r.json();
}
export async function apiDeleteEvent(id, password) {
  const r = await fetch(`/api/events/${encodeURIComponent(id)}`, { method: "DELETE", headers: adminHeaders(password) });
  if (r.status === 401) throw new Error("Password non valida");
  if (!r.ok) throw new Error("Eliminazione non riuscita");
  return r.json();
}

// --- Cache locale (per funzionare offline dopo la prima apertura) ---------
const K_EVENT = (id) => `attacca:event:${id}`;
const K_LIST = "attacca:list";

export function cacheEvent(ev) {
  try { localStorage.setItem(K_EVENT(ev.id), JSON.stringify(ev)); } catch {}
}
export function getCachedEvent(id) {
  try {
    const s = localStorage.getItem(K_EVENT(id));
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
export function cacheList(list) {
  try { localStorage.setItem(K_LIST, JSON.stringify(list)); } catch {}
}
export function getCachedList() {
  try {
    const s = localStorage.getItem(K_LIST);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

// --- Toast ----------------------------------------------------------------
let toastEl = null;
let toastTimer = null;
export function toast(msg, isError = false) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = "toast show" + (isError ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.className = "toast"), 2600);
}

export function shareUrl(id) {
  return `${location.origin}/e/${id}`;
}
export function whatsappUrl(ev) {
  const link = shareUrl(ev.id);
  const parts = [`🎸 ${ev.name}`];
  const quando = fmtDate(ev.date);
  const dove = String(ev.place ?? "").trim();
  if (quando) parts.push(`📅 ${quando}`);
  if (dove) parts.push(`📍 ${dove}`);
  parts.push(`▶️ Setlist da studiare su Attacca:`, link);
  return `https://wa.me/?text=${encodeURIComponent(parts.join("\n"))}`;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
