// @vitest-environment node
//
// Test delle rotte del server. Girano con NODE_ENV=production perché è la
// configurazione che va davvero in rete: cookie Secure, HSTS, e il freno ai
// tentativi di login che distingue i client.
//
// Ogni blocco usa un Fly-Client-IP suo: il contatore dei login falliti vive in
// memoria ed è condiviso, quindi senza IP distinti un test di forza bruta
// bloccherebbe tutti quelli dopo.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PWD = "password-di-prova";
let base;      // http://127.0.0.1:<porta>
let server;
let dataDir;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "attacca-test-"));
  process.env.NODE_ENV = "production";
  process.env.ADMIN_PASSWORD = PWD;
  process.env.DATA_DIR = dataDir;

  const { app } = await import("../server.js");
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Chiamata all'API. `ip` sceglie il secchiello del freno anti-forza-bruta. */
function call(percorso, { metodo = "GET", corpo, cookie, origin, ip = "10.0.0.1" } = {}) {
  const headers = { "fly-client-ip": ip };
  if (corpo !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return fetch(base + percorso, {
    method: metodo,
    headers,
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    redirect: "manual",
  });
}

/** Fa il login e restituisce il cookie di sessione pronto da rispedire. */
async function login(ip = "10.0.0.1") {
  const r = await call("/api/login", { metodo: "POST", corpo: { password: PWD }, ip });
  expect(r.status).toBe(200);
  return r.headers.getSetCookie()[0].split(";")[0];
}

const evento = () => ({
  name: "Sagra",
  date: "2026-08-03",
  place: "Bettona",
  songs: [{ title: "Uno", videoId: "Z2MeQJCGjLo", start: 5 }],
});

describe("accesso pubblico", () => {
  it("serve l'elenco degli eventi senza autenticazione", async () => {
    const r = await call("/api/events");
    expect(r.status).toBe(200);
    expect(Array.isArray(await r.json())).toBe(true);
  });

  it("risponde 404 per un evento che non esiste", async () => {
    expect((await call("/api/events/nonesiste")).status).toBe(404);
  });

  it("rifiuta un videoId non valido su oembed senza chiamare YouTube", async () => {
    expect((await call("/api/oembed?videoId=../../etc/passwd")).status).toBe(400);
  });

  it("manda le intestazioni di sicurezza", async () => {
    const h = (await call("/")).headers;
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(h.get("content-security-policy")).not.toContain("unsafe-inline");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("strict-transport-security")).toBeTruthy();
    expect(h.get("x-powered-by")).toBeNull();
  });
});

describe("rotte admin senza sessione", () => {
  it("rifiuta creazione, modifica ed eliminazione", async () => {
    expect((await call("/api/events", { metodo: "POST", corpo: evento() })).status).toBe(401);
    expect((await call("/api/events/x", { metodo: "PUT", corpo: evento() })).status).toBe(401);
    expect((await call("/api/events/x", { metodo: "DELETE" })).status).toBe(401);
  });

  it("dice che non c'è sessione", async () => {
    expect((await call("/api/session")).status).toBe(401);
  });
});

describe("login", () => {
  const ip = "10.0.1.1";

  it("rifiuta la password sbagliata", async () => {
    const r = await call("/api/login", { metodo: "POST", corpo: { password: "sbagliata" }, ip });
    expect(r.status).toBe(401);
    expect(r.headers.getSetCookie()).toHaveLength(0);
  });

  it("rifiuta anche una password della lunghezza giusta ma diversa", async () => {
    const uguale = "x".repeat(PWD.length);
    expect((await call("/api/login", { metodo: "POST", corpo: { password: uguale }, ip })).status).toBe(401);
  });

  it("con la password giusta consegna un cookie protetto", async () => {
    const r = await call("/api/login", { metodo: "POST", corpo: { password: PWD }, ip });
    expect(r.status).toBe(200);
    const cookie = r.headers.getSetCookie()[0];
    expect(cookie).toMatch(/^attacca_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure"); // NODE_ENV=production
  });

  it("la sessione appena aperta vale", async () => {
    const cookie = await login(ip);
    expect((await call("/api/session", { cookie, ip })).status).toBe(200);
  });

  it("il logout la chiude", async () => {
    const cookie = await login(ip);
    expect((await call("/api/logout", { metodo: "POST", cookie, ip })).status).toBe(200);
    // Il server svuota il cookie: da qui in poi il browser non manda più nulla.
    expect((await call("/api/session", { ip })).status).toBe(401);
  });
});

describe("integrità del token di sessione", () => {
  const ip = "10.0.2.1";

  // Deve restare allineata a SESSION_KEY in server.js: se la derivazione della
  // chiave cambia, questo test lo dice invece di lasciarlo scoprire in rete.
  const chiave = crypto.createHash("sha256").update(`attacca:session:v1:${PWD}`).digest();
  const firma = (payload) => crypto.createHmac("sha256", chiave).update(payload).digest("base64url");
  const token = (scadenza) => {
    const payload = `${scadenza}.${crypto.randomBytes(12).toString("base64url")}`;
    return `attacca_session=${payload}.${firma(payload)}`;
  };

  it("accetta un token firmato e non scaduto", async () => {
    const cookie = token(Date.now() + 60_000);
    expect((await call("/api/session", { cookie, ip })).status).toBe(200);
  });

  it("rifiuta un token scaduto anche se la firma è buona", async () => {
    const cookie = token(Date.now() - 1000);
    expect((await call("/api/session", { cookie, ip })).status).toBe(401);
  });

  it("rifiuta una firma manomessa", async () => {
    const buono = token(Date.now() + 60_000);
    const rotto = buono.slice(0, -4) + "AAAA";
    expect((await call("/api/session", { cookie: rotto, ip })).status).toBe(401);
  });

  it("rifiuta un token inventato di sana pianta", async () => {
    expect((await call("/api/session", { cookie: "attacca_session=1.2.3", ip })).status).toBe(401);
  });

  it("non si può allungare la scadenza riusando la firma", async () => {
    const buono = token(Date.now() + 60_000);
    const [, payloadFirma] = buono.split("=");
    const [, nonce, sig] = payloadFirma.split(".");
    const allungato = `attacca_session=${Date.now() + 999_999_999}.${nonce}.${sig}`;
    expect((await call("/api/session", { cookie: allungato, ip })).status).toBe(401);
  });
});

describe("difesa CSRF", () => {
  const ip = "10.0.3.1";

  it("rifiuta le scritture che arrivano da un altro sito", async () => {
    const cookie = await login(ip);
    const r = await call("/api/events", {
      metodo: "POST",
      corpo: evento(),
      cookie,
      origin: "https://cattivo.example",
      ip,
    });
    expect(r.status).toBe(403);
  });

  it("accetta quelle che arrivano dall'app", async () => {
    const cookie = await login(ip);
    const r = await call("/api/events", { metodo: "POST", corpo: evento(), cookie, origin: base, ip });
    expect(r.status).toBe(201);
  });
});

describe("giro completo di un evento", () => {
  const ip = "10.0.4.1";

  it("crea, legge, modifica ed elimina", async () => {
    const cookie = await login(ip);

    const creato = await (await call("/api/events", { metodo: "POST", corpo: evento(), cookie, ip })).json();
    expect(creato.id).toMatch(/^[a-z0-9]{8}$/);
    expect(creato.songs).toHaveLength(1);

    // La lettura è pubblica: è il link che si manda su WhatsApp.
    const letto = await (await call(`/api/events/${creato.id}`)).json();
    expect(letto.name).toBe("Sagra");
    expect(letto.date).toBe("2026-08-03");

    const modificato = await (
      await call(`/api/events/${creato.id}`, { metodo: "PUT", corpo: { name: "Sagra 2" }, cookie, ip })
    ).json();
    expect(modificato.name).toBe("Sagra 2");
    expect(modificato.id).toBe(creato.id);          // l'id non si sovrascrive
    expect(modificato.songs).toHaveLength(1);       // i brani non spariscono

    expect((await call(`/api/events/${creato.id}`, { metodo: "DELETE", cookie, ip })).status).toBe(200);
    expect((await call(`/api/events/${creato.id}`)).status).toBe(404);
  });

  it("non lascia al client la scelta dell'id", async () => {
    const cookie = await login(ip);
    const r = await call("/api/events", {
      metodo: "POST",
      corpo: { ...evento(), id: "scelto-da-me", createdAt: "1999-01-01" },
      cookie,
      ip,
    });
    expect((await r.json()).id).not.toBe("scelto-da-me");
  });

  it("scarta le date inventate e i brani senza video valido", async () => {
    const cookie = await login(ip);
    const r = await call("/api/events", {
      metodo: "POST",
      corpo: {
        name: "Prova",
        date: "2026-02-31",                       // non esiste sul calendario
        songs: [
          { videoId: "Z2MeQJCGjLo" },
          { videoId: "troppo-corto" },
          { title: "senza video" },
        ],
      },
      cookie,
      ip,
    });
    const ev = await r.json();
    expect(ev.date).toBe("");
    expect(ev.songs).toHaveLength(1);
  });
});

// Ultimo: lascia il proprio IP bloccato, e il blocco dura più della suite.
describe("freno ai tentativi di login", () => {
  const ip = "10.0.9.1";

  it("dopo dieci fallimenti risponde 429 e dice quanto aspettare", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await call("/api/login", { metodo: "POST", corpo: { password: "no" }, ip });
      expect(r.status).toBe(401);
    }
    const r = await call("/api/login", { metodo: "POST", corpo: { password: "no" }, ip });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("blocca anche chi indovina la password mentre è in punizione", async () => {
    const r = await call("/api/login", { metodo: "POST", corpo: { password: PWD }, ip });
    expect(r.status).toBe(429);
  });

  // IP suo: nel blocco qui sopra l'attesa è già al tetto e non potrebbe crescere.
  it("insistere allunga l'attesa, fino a un tetto di un'ora", async () => {
    const suo = "10.0.9.2";
    for (let i = 0; i < 10; i++) await call("/api/login", { metodo: "POST", corpo: { password: "no" }, ip: suo });

    const attese = [];
    for (let i = 0; i < 4; i++) {
      const r = await call("/api/login", { metodo: "POST", corpo: { password: "no" }, ip: suo });
      attese.push(Number(r.headers.get("retry-after")));
    }

    expect(attese[1]).toBeGreaterThan(attese[0]); // raddoppia
    expect(attese.at(-1)).toBeLessThanOrEqual(3600); // ma non cresce all'infinito
  });

  it("non tocca gli altri client", async () => {
    const r = await call("/api/login", { metodo: "POST", corpo: { password: PWD }, ip: "10.0.9.99" });
    expect(r.status).toBe(200);
  });
});
