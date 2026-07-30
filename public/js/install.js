// Invito all'installazione della PWA.
//
// L'app è già installabile — manifest, icone, service worker e HTTPS sono a
// posto — ma nessun browser lo dice in modo affidabile: Edge su Android non
// mostra alcuna infobar e nasconde l'installazione nel menu ⋮, Chrome la
// propone una volta sola e poi tace per mesi, Safari su iOS non emette proprio
// `beforeinstallprompt` e non mostrerà mai nulla. Quindi l'invito è nostro.
//
// Sta in un file suo e non inline nella pagina: la CSP non ammette
// script-src 'unsafe-inline', ed è quel divieto a rendere la policy una difesa
// vera. Stessa ragione per cui esiste sw-register.js.
//
// Gli inviti stanno DENTRO le due viste (#home e #player), non nella topbar che
// è condivisa: così a mostrarne uno solo per volta pensa il `hidden` che
// player.js già gestisce, e questo modulo non ha bisogno di sapere niente di
// quello.

const $ = (id) => document.getElementById(id);

const banner = $("installBanner");
const inFondo = $("installFoot");
const nelPlayer = $("btnInstallPlayer");

const SCARTO = "attacca:install-dismissed";

// localStorage può lanciare (Safari in navigazione privata, quota piena):
// senza memoria l'invito resta quello di partenza e non si rompe niente.
const scartato = () => {
  try { return localStorage.getItem(SCARTO) !== null; } catch { return false; }
};
const scarta = () => {
  try { localStorage.setItem(SCARTO, "1"); } catch { /* pazienza */ }
};

// L'evento messo da parte da Chromium. È monouso: dopo prompt() non vale più.
let differito = null;

// Già installata: gira nella sua finestra, non c'è niente da proporre.
const installata = () =>
  window.matchMedia?.("(display-mode: standalone)").matches === true ||
  navigator.standalone === true;

/**
 * Accende gli inviti o li spegne tutti.
 * In home banner e pulsantino si escludono: il primo finché non lo scarti, il
 * secondo da lì in poi. Nel player c'è sempre il suo, perché chi arriva da un
 * link WhatsApp la home potrebbe non vederla mai.
 */
function mostra(attivo) {
  if (banner) banner.hidden = !(attivo && !scartato());
  if (inFondo) inFondo.hidden = !(attivo && scartato());
  if (nelPlayer) nelPlayer.hidden = !attivo;
}

async function chiedi() {
  if (!differito) return;
  const evento = differito;
  differito = null; // monouso: riusarlo lancia
  evento.prompt();
  const { outcome } = await evento.userChoice;
  // Ha detto no al dialogo vero del sistema: segnale più forte del chiudere il
  // banner, quindi alla visita dopo si parte già dal pulsantino in fondo.
  if (outcome === "dismissed") scarta();
  // L'evento è speso: meglio nessun invito che uno che non fa più niente.
  mostra(false);
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  differito = e;
  if (!installata()) mostra(true);
});

window.addEventListener("appinstalled", () => {
  differito = null;
  mostra(false);
});

for (const b of [$("btnInstallBanner"), $("btnInstallHome"), nelPlayer]) {
  b?.addEventListener("click", chiedi);
}

$("btnInstallDismiss")?.addEventListener("click", () => {
  scarta();
  mostra(true); // non sparisce: si ritira nel pulsantino in fondo
});
