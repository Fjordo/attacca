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
// Niente password di ripiego: una costante scritta qui sarebbe pubblica quanto
// il repository, e un avviso a console in produzione non lo legge nessuno.
// In produzione si esce; in sviluppo se ne genera una a caso e la si stampa.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || devPassword();

function devPassword() {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "\n✖  ADMIN_PASSWORD non impostata. In produzione è obbligatoria:\n" +
        "   fly secrets set ADMIN_PASSWORD=\"...\"\n"
    );
    process.exit(1);
  }
  const pwd = crypto.randomBytes(9).toString("base64url");
  console.warn(`\n⚠  ADMIN_PASSWORD non impostata. Password di questa sessione: ${pwd}\n`);
  return pwd;
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

// Confronto a tempo costante. Si confrontano i digest e non le stringhe: sono
// sempre lunghi 32 byte, quindi il ritorno anticipato su lunghezze diverse —
// che rivelava quanto è lunga la password — non serve più.
function safeEqual(a, b) {
  const digest = (v) => crypto.createHash("sha256").update(String(v)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

// ---- Sessione admin ------------------------------------------------------
// Il browser non conserva più la password: dopo il login tiene un token firmato
// in un cookie HttpOnly, quindi fuori dalla portata del JavaScript di pagina.
// Il token scade da solo e la firma è derivata dalla password: così sopravvive
// ai riavvii (su Fly la macchina si ferma quando nessuno la usa) e cambiare
// password invalida da sola tutte le sessioni aperte.
const IS_PROD = process.env.NODE_ENV === "production";
const SESSION_COOKIE = "attacca_session";
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 ore
const SESSION_KEY = crypto.createHash("sha256").update(`attacca:session:v1:${ADMIN_PASSWORD}`).digest();

const sign = (payload) => crypto.createHmac("sha256", SESSION_KEY).update(payload).digest("base64url");

function newSession() {
  const payload = `${Date.now() + SESSION_MS}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

function validSession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  return safeEqual(parts[2], sign(payload)) && Number(parts[0]) > Date.now();
}

function readCookie(req, name) {
  for (const p of String(req.headers.cookie || "").split(";")) {
    const i = p.indexOf("=");
    if (i > 0 && p.slice(0, i).trim() === name) return p.slice(i + 1).trim();
  }
  return "";
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const bits = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`];
  if (IS_PROD) bits.push("Secure"); // in locale l'app gira in http e Secure la bloccherebbe
  res.setHeader("Set-Cookie", bits.join("; "));
}

// ---- Freno ai tentativi di login -----------------------------------------
// L'accesso è un unico segreto scelto a mano: senza un freno una wordlist lo
// trova in poche ore, e non se ne accorge nessuno perché i tentativi falliti
// non lasciano traccia. Contatore in memoria per IP: basta, perché la macchina
// è una sola e perdere i conteggi a ogni riavvio non è un problema.
const LOGIN_MAX = 10;                        // fallimenti tollerati nella finestra
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_WAIT_MS = 60 * 60 * 1000;
const tentativi = new Map();                 // ip -> { n, until }

// Dietro il proxy di Fly l'indirizzo del socket è sempre quello del proxy:
// senza questo tutti finirebbero nello stesso secchiello e basterebbe un
// estraneo a bloccare la band. Fly-Client-IP lo scrive il proxy, sovrascrivendo
// quello che manda il client.
const clientIp = (req) => req.get("fly-client-ip") || req.ip || "sconosciuto";

// Secondi di attesa rimasti, 0 se può provare.
function loginBloccato(ip) {
  const t = tentativi.get(ip);
  if (!t) return 0;
  if (Date.now() > t.until) {
    tentativi.delete(ip);
    return 0;
  }
  return t.n >= LOGIN_MAX ? Math.ceil((t.until - Date.now()) / 1000) : 0;
}

function loginFallito(ip) {
  if (tentativi.size > 500) {
    for (const [k, v] of tentativi) if (Date.now() > v.until) tentativi.delete(k);
  }
  const t = tentativi.get(ip);
  const n = (t && Date.now() <= t.until ? t.n : 0) + 1;
  // Superata la soglia l'attesa raddoppia a ogni tentativo, fino a un'ora.
  const attesa =
    n < LOGIN_MAX
      ? LOGIN_WINDOW_MS
      : Math.min(LOGIN_WINDOW_MS * 2 ** (n - LOGIN_MAX), LOGIN_MAX_WAIT_MS);
  tentativi.set(ip, { n, until: Date.now() + attesa });
  if (n === LOGIN_MAX) console.warn(`⚠  ${LOGIN_MAX} login falliti da ${ip}: bloccato.`);
}

// SameSite=Strict basta a impedire che un sito terzo si porti dietro il cookie;
// questa è la seconda cintura. Le richieste senza Origin (navigazioni dirette,
// curl) non sono cross-site e passano.
function sameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
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
app.disable("x-powered-by"); // niente "Express" in ogni risposta

// ---- Intestazioni di sicurezza -------------------------------------------
// Poche righe invece di helmet: qui le dipendenze si contano sulle dita.
// La CSP elenca esattamente i host di YouTube che servono al player (l'API
// iframe tira giù il resto da s.ytimg.com); tutto il resto vive sul proprio
// dominio. È anche il paracadute se un domani entra una injection in innerHTML:
// senza connect-src verso l'esterno, non c'è dove portare la refurtiva.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
  "img-src 'self' https://i.ytimg.com data:",
  "style-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY"); // per i browser che ignorano frame-ancestors
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (IS_PROD) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  next();
});

app.use(express.json({ limit: "1mb" }));

// Middleware admin: richiede una sessione valida, non più la password in chiaro
// a ogni richiesta.
function requireAdmin(req, res, next) {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Origine non consentita" });
  if (!validSession(readCookie(req, SESSION_COOKIE))) {
    return res.status(401).json({ error: "Sessione non valida" });
  }
  next();
}

// Login: l'unico punto in cui la password passa dal client. In cambio si riceve
// il cookie di sessione, che il JS di pagina non può leggere.
app.post("/api/login", (req, res) => {
  if (!sameOrigin(req)) return res.status(403).json({ error: "Origine non consentita" });

  const ip = clientIp(req);
  if (loginBloccato(ip)) {
    loginFallito(ip); // insistere allunga l'attesa invece di lasciarla scorrere
    const attesa = loginBloccato(ip);
    res.setHeader("Retry-After", String(attesa));
    return res.status(429).json({ ok: false, retryAfter: attesa });
  }

  const given = (req.body && req.body.password) || "";
  if (!safeEqual(given, ADMIN_PASSWORD)) {
    loginFallito(ip);
    return res.status(401).json({ ok: false });
  }

  tentativi.delete(ip); // rientrato: il conto riparte da zero
  setSessionCookie(res, newSession(), SESSION_MS / 1000);
  res.json({ ok: true });
});

// Dice alla pagina admin se la sessione già aperta vale ancora.
app.get("/api/session", (req, res) => {
  if (!validSession(readCookie(req, SESSION_COOKIE))) return res.status(401).json({ ok: false });
  res.json({ ok: true });
});

// Esci: butta via il cookie. Serve sul telefono passato di mano.
app.post("/api/logout", (_req, res) => {
  setSessionCookie(res, "", 0);
  res.json({ ok: true });
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
