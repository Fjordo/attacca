// Funzioni pure condivise tra player e admin: parsing dei link e import scalette.
import { describe, it, expect } from "vitest";
import {
  parseYouTube, parseTimeToSeconds, fmtTime, pad2,
  normalizeImported, readSetlistFile, whatsappUrl, escapeHtml,
  isIsoDate, fmtDate, fmtWhen,
} from "/js/common.js";

const ID = "Z2MeQJCGjLo";

describe("parseYouTube", () => {
  it("riconosce le forme comuni di link", () => {
    const forme = [
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/watch?v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      ID, // l'id incollato da solo
    ];
    for (const f of forme) {
      expect(parseYouTube(f), f).toMatchObject({ videoId: ID });
    }
  });

  it("tiene i parametri di tracciamento fuori dall'id", () => {
    // È esattamente la forma che YouTube copia dal telefono.
    expect(parseYouTube(`https://youtu.be/${ID}?si=8X5qBC9bvPh30xlN`)).toMatchObject({
      videoId: ID,
      start: 0,
    });
  });

  it("legge il secondo di partenza", () => {
    expect(parseYouTube(`https://youtu.be/${ID}?t=90`).start).toBe(90);
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}&t=1m30s`).start).toBe(90);
    expect(parseYouTube(`https://www.youtube.com/watch?v=${ID}&start=45`).start).toBe(45);
  });

  it("rifiuta ciò che non è un video", () => {
    // Attenzione: un id valido è esattamente 11 caratteri [\w-], quindi come
    // controesempi servono stringhe di lunghezza diversa.
    for (const brutto of ["", null, undefined, "ciao", "https://vimeo.com/12345",
                          "https://www.youtube.com/watch?v=corto",
                          `https://youtu.be/${"x".repeat(12)}`]) {
      expect(parseYouTube(brutto), String(brutto)).toBeNull();
    }
  });
});

describe("parseTimeToSeconds", () => {
  it("accetta secondi, mm:ss e la forma 1h2m3s", () => {
    expect(parseTimeToSeconds("90")).toBe(90);
    expect(parseTimeToSeconds("1:30")).toBe(90);
    expect(parseTimeToSeconds("2m")).toBe(120);
    expect(parseTimeToSeconds("1h2m3s")).toBe(3723);
  });
});

describe("fmtTime e pad2", () => {
  it("formatta la durata", () => {
    expect(fmtTime(0)).toBe("0:00");
    expect(fmtTime(65)).toBe("1:05");
    expect(fmtTime(600)).toBe("10:00");
  });
  it("regge valori assurdi senza rompersi", () => {
    expect(fmtTime(-5)).toBe("0:00");
    expect(fmtTime(NaN)).toBe("0:00");
  });
  it("mette lo zero davanti ai numeri di una cifra", () => {
    expect(pad2(3)).toBe("03");
    expect(pad2(12)).toBe("12");
  });
});

describe("data e luogo", () => {
  it("riconosce solo le date ISO che esistono davvero", () => {
    expect(isIsoDate("2026-08-03")).toBe(true);
    for (const brutta of ["", null, undefined, "03/08/26", "2026-8-3", "2026-13-01",
                          "2026-02-31", "03/08/26 - Bettona"]) {
      expect(isIsoDate(brutta), String(brutta)).toBe(false);
    }
  });

  it("formatta la data in italiano", () => {
    expect(fmtDate("2026-08-03")).toBe("3 ago 2026");
    expect(fmtDate("2026-01-25")).toBe("25 gen 2026");
    expect(fmtDate("2026-12-31")).toBe("31 dic 2026");
  });

  it("lascia vuoto ciò che non è una data ISO", () => {
    // Il vecchio campo libero sparisce invece di finire a schermo.
    expect(fmtDate("03/08/26 - Bettona")).toBe("");
    expect(fmtDate("")).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });

  it("unisce data e luogo, saltando quello che manca", () => {
    expect(fmtWhen("2026-08-03", "Bettona")).toBe("3 ago 2026 · Bettona");
    expect(fmtWhen("2026-08-03", "")).toBe("3 ago 2026");
    expect(fmtWhen("", "Bettona")).toBe("Bettona");
    expect(fmtWhen("", "")).toBe("");
    expect(fmtWhen("03/08/26 - Bettona", "")).toBe("");
  });
});

describe("normalizeImported", () => {
  it("accetta una semplice lista di URL", () => {
    const ev = normalizeImported([`https://youtu.be/${ID}`, `https://youtu.be/${ID}?t=30`]);
    expect(ev.songs).toHaveLength(2);
    expect(ev.songs[1].start).toBe(30);
    expect(ev.name).toBe("Scaletta importata");
  });

  it("accetta il formato completo con nome, data e luogo", () => {
    const ev = normalizeImported({
      name: "Sagra Bettona",
      date: "2026-08-03",
      place: "Bettona",
      songs: [{ title: "I Figli di Lir", url: `https://youtu.be/${ID}` }],
    });
    expect(ev.name).toBe("Sagra Bettona");
    expect(ev.date).toBe("2026-08-03");
    expect(ev.place).toBe("Bettona");
    expect(ev.songs[0]).toMatchObject({ title: "I Figli di Lir", videoId: ID });
  });

  it("scarta le date non ISO invece di importarle", () => {
    const ev = normalizeImported({ date: "03/08/26 - Bettona", songs: [`https://youtu.be/${ID}`] });
    expect(ev.date).toBe("");
    expect(ev.place).toBe("");
  });

  it("scarta le righe senza un video valido", () => {
    const ev = normalizeImported(["corto", "", `https://youtu.be/${ID}`, { url: "https://vimeo.com/1" }]);
    expect(ev.songs).toHaveLength(1);
    expect(ev.songs[0].videoId).toBe(ID);
  });

  it("accetta un videoId già pronto senza url", () => {
    const ev = normalizeImported({ songs: [{ videoId: ID, start: 12 }] });
    expect(ev.songs[0]).toMatchObject({ videoId: ID, start: 12, url: `https://youtu.be/${ID}` });
  });

  it("non si rompe con dati spazzatura", () => {
    expect(normalizeImported(null).songs).toEqual([]);
    expect(normalizeImported({}).songs).toEqual([]);
    expect(normalizeImported("boh").songs).toEqual([]);
  });

  // Un file con i campi del tipo sbagliato arrivava intatto fino all'editor, e
  // lì il primo .trim() su quello che credeva una stringa spegneva il salvataggio.
  it("restituisce sempre stringhe, qualunque cosa ci sia nel file", () => {
    const ev = normalizeImported({
      name: { non: "una stringa" },
      note: [1, 2],
      place: 42,
      songs: [`https://youtu.be/${ID}`],
    });
    expect(typeof ev.name).toBe("string");
    expect(typeof ev.note).toBe("string");
    expect(typeof ev.place).toBe("string");
    expect(() => ev.name.trim()).not.toThrow(); // è ciò che fa btnSave
  });

  it("tiene il titolo del brano solo se è una stringa", () => {
    const ev = normalizeImported({ songs: [{ videoId: ID, title: { oggetto: true } }] });
    expect(ev.songs[0].title).toBe("");
  });
});

describe("readSetlistFile", () => {
  const file = (contenuto) => ({ text: async () => contenuto });

  it("legge una scaletta da file JSON", async () => {
    const ev = await readSetlistFile(file(JSON.stringify({ name: "Prova", songs: [`https://youtu.be/${ID}`] })));
    expect(ev.name).toBe("Prova");
    expect(ev.songs).toHaveLength(1);
  });

  it("avvisa se non c'è nemmeno un brano valido", async () => {
    await expect(readSetlistFile(file('["ciao"]'))).rejects.toThrow("Nessun brano valido");
  });

  it("avvisa se il file non è JSON", async () => {
    await expect(readSetlistFile(file("non sono json"))).rejects.toThrow();
  });
});

describe("condivisione", () => {
  it("compone il messaggio WhatsApp con il link all'evento", () => {
    const url = whatsappUrl({ id: "87tmqk4z", name: "Sagra Bettona", date: "2026-08-03", place: "Bettona" });
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const testo = decodeURIComponent(url.split("text=")[1]);
    expect(testo).toContain("Sagra Bettona");
    expect(testo).toContain("3 ago 2026");
    expect(testo).toContain("Bettona");
    expect(testo).toContain("/e/87tmqk4z");
  });

  it("non lascia righe vuote quando data o luogo mancano", () => {
    const testo = decodeURIComponent(whatsappUrl({ id: "x", name: "Prova" }).split("text=")[1]);
    expect(testo).not.toContain("📅");
    expect(testo).not.toContain("📍");
    expect(testo.split("\n").every((r) => r.trim())).toBe(true);
  });

  it("neutralizza l'HTML nei titoli", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).not.toContain("<");
    expect(escapeHtml("Rock & Roll")).toBe("Rock &amp; Roll");
  });
});
