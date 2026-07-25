// Registra il service worker per l'uso offline (app shell + font + icone).
// Sta in un file suo e non inline nella pagina: la CSP non ammette script-src
// 'unsafe-inline', ed è quel divieto a rendere la policy una difesa vera.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
