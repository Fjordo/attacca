import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));
const posix = (p) => p.split(path.sep).join("/");

export default defineConfig({
  // Qui public/ è il codice dell'app, non la cartella di asset statici di Vite:
  // senza questo Vite rifiuta di importare i moduli che stanno lì dentro.
  publicDir: false,
  resolve: {
    // In pagina i moduli si importano con path assoluti (/js/common.js).
    // Qui li facciamo puntare alla cartella public, così i test caricano
    // esattamente i file che finiscono nel browser.
    alias: [{ find: /^\/js\//, replacement: posix(path.join(root, "public", "js")) + "/" }],
  },
  test: {
    environment: "jsdom",
    // Le rotte lato client leggono location.pathname: partiamo da un evento.
    environmentOptions: { jsdom: { url: "http://localhost:8080/e/test" } },
    setupFiles: ["./test/setup.js"],
    include: ["test/**/*.test.js"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
