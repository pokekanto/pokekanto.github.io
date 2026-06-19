(function (window) {
  "use strict";

  const { $ } = window.Valdoria.dom;
  const state = window.Valdoria.state;

  function toggleDebugPanel() {
    const p = $("debugPanel");
    p.style.display = p.style.display === "block" ? "none" : "block";
  }

  function updateDebug() {
    const p = $("debugPanel");
    if (!p) return;                 // panneau absent : rien a faire (evite un flot d'erreurs)
    const myPos = state.myPos;

    if (p.style.display !== "block") return;
    const hex = n => "0x" + (n >>> 0).toString(16).toUpperCase();
    const vitesse = state.ips ? `vitesse : ${state.ips} i/s (GBA réel = 59,7)\n` : "";
    const ids = Object.keys(state.joueurs);
    const autres = ids.length
      ? ids.map(id => {
          const j = state.joueurs[id];
          return `joueur ${j.nom} : map ${j.g}.${j.m}  x=${j.tx} y=${j.ty}`;
        }).join("\n")
      : "aucun autre joueur en ligne";
    p.textContent = vitesse + (myPos
      ? `moi  : map ${myPos.g}.${myPos.m}  x=${myPos.x} y=${myPos.y}  (sb1 ${hex(myPos.addr)} → ${hex(myPos.ptr)})\n` + autres
      : "position illisible — la ROM utilise peut-être d'autres adresses (essaie ?sb1=0x... dans l'URL)");
    p.style.whiteSpace = "pre";
  }

  // Vitesse d'emulation (ips) affichee dans le tiroir PokeKanto, via
  // l'element #ipsValue d'index.html. MAJ reguliere ; ne fait rien si
  // l'element n'est pas present.
  function majIps() {
    const el = $("ipsValue");
    if (el) el.textContent = state.ips ? String(state.ips).replace(".", ",") : "...";
  }
  setInterval(majIps, 1000);
  majIps();

  window.Valdoria.debug = { toggleDebugPanel, updateDebug };
})(window);
