// Editor admin: il giro completo di data e luogo, dal form al payload salvato.
import { describe, it, expect } from "vitest";
import { mountAdmin, $ } from "./helpers/app.js";

const ID = "Z2MeQJCGjLo";
const evento = (extra) => ({
  id: "e1",
  name: "Sagra",
  songs: [{ id: "a", title: "Uno", url: `https://youtu.be/${ID}`, videoId: ID, start: 0 }],
  ...extra,
});

/** Scrive in un campo come farebbe una persona. */
function type(id, value) {
  $(id).value = value;
  $(id).dispatchEvent(new Event("input", { bubbles: true }));
}

describe("data e luogo nell'editor", () => {
  it("usa un vero campo data, non testo libero", async () => {
    await mountAdmin();
    expect($("fDate").type).toBe("date");
    expect($("fPlace").type).toBe("text");
  });

  it("manda al server data ISO e luogo come campi separati", async () => {
    const admin = await mountAdmin();
    $("btnNew").click();
    type("fName", "Sagra Bettona");
    type("fDate", "2026-08-03");
    type("fPlace", "Bettona");
    await admin.addSong(`https://youtu.be/${ID}`);

    $("btnSave").click();
    await admin.flush();

    expect(admin.lastSaved()).toMatchObject({
      name: "Sagra Bettona",
      date: "2026-08-03",
      place: "Bettona",
    });
  });

  it("riempie il form con i valori dell'evento aperto", async () => {
    const admin = await mountAdmin({ events: [evento({ date: "2026-08-03", place: "Bettona" })] });
    await admin.open("e1");
    expect($("fDate").value).toBe("2026-08-03");
    expect($("fPlace").value).toBe("Bettona");
  });

  it("apre senza data un evento nel vecchio formato libero", async () => {
    const admin = await mountAdmin({ events: [evento({ date: "03/08/26 - Bettona" })] });
    await admin.open("e1");
    expect($("fDate").value).toBe("");
    expect($("fPlace").value).toBe("");
  });

  it("mostra data e luogo formattati nell'elenco", async () => {
    await mountAdmin({ events: [evento({ date: "2026-08-03", place: "Bettona" })] });
    expect($("evList").textContent).toContain("3 ago 2026 · Bettona");
  });

  it("esporta il JSON con data e luogo separati", async () => {
    const admin = await mountAdmin({ events: [evento({ date: "2026-08-03", place: "Bettona" })] });
    await admin.open("e1");
    $("btnExport").click();
    expect(await admin.lastExport()).toMatchObject({ date: "2026-08-03", place: "Bettona" });
  });
});
