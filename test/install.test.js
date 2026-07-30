// L'invito all'installazione. Il caso che conta di più è l'ultimo di ogni
// gruppo: dove il browser NON sa installare, non deve comparire niente. Un
// pulsante che promette un'installazione impossibile è peggio del silenzio.
import { describe, it, expect } from "vitest";
import { mountInstall, $ } from "./helpers/app.js";

const visibile = (id) => !$(id).hidden;

describe("quando non c'è niente da proporre", () => {
  it("tace se il browser non offre l'installazione", async () => {
    await mountInstall();
    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });

  it("tace se l'app è già installata, anche se il browser insiste", async () => {
    const app = await mountInstall({ standalone: true });
    app.offri();
    await app.flush();
    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });
});

describe("percorso Chromium", () => {
  it("mostra il banner quando l'installazione è davvero possibile", async () => {
    const app = await mountInstall();
    app.offri();
    await app.flush();
    expect(visibile("installBanner")).toBe(true);
  });

  it("trattiene l'evento: senza, su Chrome uscirebbe anche l'infobar sua", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();
    expect(e.defaultPrevented).toBe(true);
  });

  it("al tocco apre il prompt vero del sistema", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();

    $("btnInstallBanner").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("l'evento è monouso: speso quello, l'invito si ritira", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();

    $("btnInstallBanner").click();
    await app.flush();
    // Un secondo tocco non deve riusare un evento già consumato: riusarlo lancia.
    $("btnInstallBanner").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(visibile("installBanner")).toBe(false);
  });

  it("a installazione avvenuta sparisce tutto, senza aspettare un ricaricamento", async () => {
    const app = await mountInstall();
    app.offri();
    await app.flush();

    app.installazioneAvvenuta();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });
});

describe("lo scarto del banner", () => {
  it("non fa sparire l'invito: lo ritira nel pulsantino in fondo", async () => {
    const app = await mountInstall();
    app.offri();
    await app.flush();

    $("btnInstallDismiss").click();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(true);
  });

  it("sopravvive a un ricaricamento: si riparte dal pulsantino, non dal banner", async () => {
    const app = await mountInstall({ scartato: true });
    app.offri();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(true);
  });

  it("dal pulsantino in fondo si installa comunque", async () => {
    const app = await mountInstall({ scartato: true });
    const e = app.offri();
    await app.flush();

    $("btnInstallHome").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("scartato e poi installato dal pulsantino in fondo, nella stessa visita: l'evento non si è perso per strada", async () => {
    const app = await mountInstall();
    const e = app.offri();
    await app.flush();

    $("btnInstallDismiss").click();
    await app.flush();

    $("btnInstallHome").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("dire no al dialogo vero conta più che chiudere il banner: la volta dopo parte in piccolo", async () => {
    const app = await mountInstall();
    app.offri("dismissed");
    await app.flush();

    $("btnInstallBanner").click();
    await app.flush();

    expect(localStorage.getItem("attacca:install-dismissed")).not.toBeNull();
  });
});

describe("l'invito nel player", () => {
  it("c'è, perché chi arriva da un link WhatsApp la home non la vede mai", async () => {
    const app = await mountInstall({ vista: "player" });
    app.offri();
    await app.flush();

    expect(visibile("btnInstallPlayer")).toBe(true);
  });

  it("non risente dello scarto del banner: quello riguarda solo la home", async () => {
    const app = await mountInstall({ vista: "player", scartato: true });
    app.offri();
    await app.flush();

    expect(visibile("btnInstallPlayer")).toBe(true);
  });

  it("al tocco apre il prompt vero", async () => {
    const app = await mountInstall({ vista: "player" });
    const e = app.offri();
    await app.flush();

    $("btnInstallPlayer").click();
    await app.flush();

    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("resta spento se il browser non offre l'installazione", async () => {
    await mountInstall({ vista: "player" });
    expect(visibile("btnInstallPlayer")).toBe(false);
  });
});

describe("percorso iOS", () => {
  it("invita subito, senza aspettare un evento che non arriverà mai", async () => {
    await mountInstall({ ios: true });
    expect(visibile("installBanner")).toBe(true);
  });

  it("al tocco spiega il gesto invece di aprire un prompt che non esiste", async () => {
    const app = await mountInstall({ ios: true });

    $("btnInstallBanner").click();
    await app.flush();

    expect($("installDialog").open).toBe(true);
  });

  it("il pannello si chiude", async () => {
    const app = await mountInstall({ ios: true });
    $("btnInstallBanner").click();
    await app.flush();

    $("btnInstallClose").click();
    await app.flush();

    expect($("installDialog").open).toBe(false);
  });

  it("tace se l'app è già sulla schermata Home", async () => {
    await mountInstall({ ios: true, standalone: true });
    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(false);
  });

  it("anche su iOS lo scarto ritira il banner nel pulsantino in fondo", async () => {
    const app = await mountInstall({ ios: true });

    $("btnInstallDismiss").click();
    await app.flush();

    expect(visibile("installBanner")).toBe(false);
    expect(visibile("installFoot")).toBe(true);
  });
});
