// Attacca — server minimale (app "setlist" della band).
// Serve l'app statica e una piccola API per gli "eventi" (le scalette).
// Persistenza: un singolo file JSON su disco (nessun database da gestire).
// Su Fly.io monta un volume e imposta DATA_DIR=/data per non perdere i dati.

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "events.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "cambiami";

if (!process.env.ADMIN_PASSWORD) {
  console.warn(
    "\n⚠  ADMIN_PASSWORD non impostata: uso 'cambiami'. Impostala prima di andare in produzione.\n"
  );
}

// ---- Storage su file (semplice, atomico) ---------------------------------
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]");

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) || [];
  } catch {
    return [];
  }
}
function writeAll(list) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DATA_FILE); // scrittura atomica
}

// ---- Utilità -------------------------------------------------------------
function newId(n = 8) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // niente caratteri ambigui
  const bytes = crypto.randomBytes(n);
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const VIDEO_ID = /^[\w-]{11}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// La data è sempre ISO "AAAA-MM-GG" e deve esistere sul calendario:
// stessa regola di isIsoDate in public/js/common.js.
function isIsoDate(s) {
  if (!ISO_DATE.test(String(s ?? ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Ripulisce un evento in arrivo dal client, tenendo solo campi validi.
function sanitizeEvent(input, existing = null) {
  const out = existing ? { ...existing } : {};
  if (typeof input.name === "string") out.name = input.name.trim().slice(0, 200);
  // Una data non ISO (o il vecchio campo libero "03/08/26 - Bettona") viene scartata.
  if (typeof input.date === "string") out.date = isIsoDate(input.date.trim()) ? input.date.trim() : "";
  if (typeof input.place === "string") out.place = input.place.trim().slice(0, 120);
  if (typeof input.note === "string") out.note = input.note.trim().slice(0, 2000);
  if (Array.isArray(input.songs)) {
    out.songs = input.songs
      .map((s) => ({
        id: typeof s.id === "string" && s.id ? s.id.slice(0, 20) : newId(6),
        title: (typeof s.title === "string" ? s.title : "").trim().slice(0, 300),
        url: (typeof s.url === "string" ? s.url : "").trim().slice(0, 500),
        videoId: VIDEO_ID.test(s.videoId) ? s.videoId : "",
        start: Number.isFinite(+s.start) && +s.start >= 0 ? Math.floor(+s.start) : 0,
      }))
      .filter((s) => s.videoId); // scarto righe senza video valido
  }
  out.name = out.name || "Scaletta senza nome";
  out.songs = out.songs || [];
  return out;
}

// ---- App -----------------------------------------------------------------
const app = express();
app.use(express.json({ limit: "1mb" }));

// Middleware admin: richiede l'header con la password.
function requireAdmin(req, res, next) {
  const given = req.get("x-admin-password") || "";
  if (!safeEqual(given, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "Password non valida" });
  }
  next();
}

// Verifica password (usata dalla pagina admin per lo sblocco).
app.post("/api/login", (req, res) => {
  const given = (req.body && req.body.password) || "";
  if (safeEqual(given, ADMIN_PASSWORD)) return res.json({ ok: true });
  res.status(401).json({ ok: false });
});

// Elenco eventi (pubblico, solo dati essenziali per la home).
app.get("/api/events", (_req, res) => {
  const list = readAll()
    .map((e) => ({
      id: e.id,
      name: e.name,
      date: isIsoDate(e.date) ? e.date : "", // gli eventi salvati col vecchio campo libero restano senza data
      place: e.place || "",
      count: (e.songs || []).length,
      updatedAt: e.updatedAt,
    }))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  res.json(list);
});

// Singolo evento completo (pubblico: serve ai link condivisi).
app.get("/api/events/:id", (req, res) => {
  const ev = readAll().find((e) => e.id === req.params.id);
  if (!ev) return res.status(404).json({ error: "Evento non trovato" });
  res.json(ev);
});

// Crea evento (admin).
app.post("/api/events", requireAdmin, (req, res) => {
  const list = readAll();
  const now = new Date().toISOString();
  const ev = { id: newId(), ...sanitizeEvent(req.body || {}), createdAt: now, updatedAt: now };
  list.push(ev);
  writeAll(list);
  res.status(201).json(ev);
});

// Aggiorna evento — riordino, modifica brani, ecc. (admin).
app.put("/api/events/:id", requireAdmin, (req, res) => {
  const list = readAll();
  const i = list.findIndex((e) => e.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Evento non trovato" });
  list[i] = { ...sanitizeEvent(req.body || {}, list[i]), id: list[i].id, updatedAt: new Date().toISOString() };
  writeAll(list);
  res.json(list[i]);
});

// Elimina evento (admin).
app.delete("/api/events/:id", requireAdmin, (req, res) => {
  const list = readAll();
  const next = list.filter((e) => e.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: "Evento non trovato" });
  writeAll(next);
  res.json({ ok: true });
});

// Proxy oEmbed: recupera il titolo di un video YouTube senza chiave API
// ed evitando problemi di CORS lato browser.
app.get("/api/oembed", async (req, res) => {
  const videoId = String(req.query.videoId || "");
  if (!VIDEO_ID.test(videoId)) return res.status(400).json({ error: "videoId non valido" });
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!r.ok) return res.status(502).json({ error: "oEmbed non disponibile" });
    const d = await r.json();
    res.json({ title: d.title || "", author: d.author_name || "" });
  } catch {
    res.status(502).json({ error: "oEmbed non raggiungibile" });
  }
});

// File statici.
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// Rotte lato client servite dalla stessa index.html (routing nel browser).
app.get(["/", "/e/:id"], (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.listen(PORT, () => console.log(`Attacca in ascolto su http://localhost:${PORT}`));
