// Igiene PWA: quello che rende l'app installabile sta nei file statici, non nel
// JavaScript. Qui si controlla quello — e si evita che una modifica distratta
// rimetta il blocco dell'orientamento o stacchi il manifest da una pagina.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const leggi = (nome) => fs.readFileSync(path.join(root, "public", nome), "utf8");
const manifest = () => JSON.parse(leggi("manifest.webmanifest"));

describe("manifest", () => {
  it("non blocca l'orientamento: il player ha un layout apposta per il telefono coricato", () => {
    expect(manifest().orientation).toBeUndefined();
  });

  it("dichiara un id stabile, così l'identità non dipende da start_url", () => {
    expect(manifest().id).toBe("/");
  });

  it("dichiara lingua e direzione", () => {
    expect(manifest()).toMatchObject({ lang: "it", dir: "ltr" });
  });

  it("tiene le icone che aveva, maskable compresa", () => {
    const purposes = manifest().icons.map((i) => i.purpose);
    expect(purposes).toContain("maskable");
  });
});

describe("admin.html", () => {
  it("collega il manifest, come la home", () => {
    expect(leggi("admin.html")).toContain('rel="manifest"');
  });

  it("registra il service worker: sw.js mette /admin nella shell, ma nessuno lo installava", () => {
    expect(leggi("admin.html")).toContain("/js/sw-register.js");
  });
});

describe("meta per iOS", () => {
  for (const file of ["index.html", "admin.html"]) {
    it(`${file} dichiara mobile-web-app-capable`, () => {
      expect(leggi(file)).toContain('name="mobile-web-app-capable"');
    });

    it(`${file} tiene anche la variante apple-, che serve a iOS sotto 16.4`, () => {
      expect(leggi(file)).toContain('name="apple-mobile-web-app-capable"');
    });
  }
});

describe("markup dell'invito all'installazione", () => {
  it("ha tutti gli elementi dell'invito", () => {
    const html = leggi("index.html");
    for (const id of [
      "installBanner", "btnInstallBanner", "btnInstallDismiss",
      "installFoot", "btnInstallHome", "btnInstallPlayer",
      "installDialog", "btnInstallClose",
    ]) {
      expect(html, `manca #${id}`).toContain(`id="${id}"`);
    }
  });

  it("parte tutto spento: a scoprirlo è install.js, solo dove si può installare", () => {
    const html = leggi("index.html");
    for (const id of ["installBanner", "installFoot", "btnInstallPlayer"]) {
      expect(html, `#${id} deve nascere hidden`).toMatch(
        new RegExp(`id="${id}"[^>]*\\shidden`)
      );
    }
  });
});
