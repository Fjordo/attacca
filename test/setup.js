import { vi } from "vitest";

// jsdom non implementa lo scorrimento: la scaletta lo usa per seguire il brano.
// Il setup gira anche per i test del server, che stanno in ambiente node: lì il
// DOM non esiste e non c'è niente da correggere.
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = vi.fn();
}
