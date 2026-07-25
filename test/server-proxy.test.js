// @vitest-environment node
//
// File a parte perché serve un server avviato SENZA TRUST_PROXY_IP: le
// variabili d'ambiente si leggono una volta sola, al caricamento del modulo, e
// vitest isola i moduli per file.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PWD = "password-di-prova";
let base;
let server;
let dataDir;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "attacca-proxy-"));
  process.env.NODE_ENV = "production";
  process.env.ADMIN_PASSWORD = PWD;
  process.env.DATA_DIR = dataDir;
  delete process.env.TRUST_PROXY_IP; // nessun proxy dichiarato davanti

  const { app } = await import("../server.js");
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const tentativo = (ipFinto, password = "sbagliata") =>
  fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "fly-client-ip": ipFinto },
    body: JSON.stringify({ password }),
  });

describe("senza un proxy dichiarato", () => {
  it("non crede a Fly-Client-IP, quindi non si evade il freno cambiandolo", async () => {
    // Dieci fallimenti fingendo un IP diverso ogni volta: se l'header contasse,
    // ognuno avrebbe il suo secchiello e non scatterebbe mai niente.
    for (let i = 0; i < 10; i++) {
      expect((await tentativo(`203.0.113.${i}`)).status).toBe(401);
    }

    // Undicesimo con un IP ancora diverso: bloccato, perché contano tutti come
    // lo stesso client — che è la verità, arrivano tutti dallo stesso socket.
    expect((await tentativo("203.0.113.200")).status).toBe(429);

    // E nemmeno indovinando la password si passa, finché dura la punizione.
    expect((await tentativo("203.0.113.201", PWD)).status).toBe(429);
  });
});
