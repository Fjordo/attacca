import { vi } from "vitest";

// jsdom non implementa lo scorrimento: la scaletta lo usa per seguire il brano.
Element.prototype.scrollIntoView = vi.fn();
