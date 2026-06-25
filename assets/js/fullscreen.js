(function (window) {
  "use strict";

  // Bouton plein ecran (mobile). Deux niveaux, pour que le bouton fasse
  // toujours quelque chose quel que soit le navigateur :
  //  1. API plein ecran native (Chrome Android, navigateurs desktop) :
  //     vrai plein ecran, masque la barre du navigateur.
  //  2. Repli CSS "immersif" quand l'API n'existe pas (iOS / Safari) ou
  //     qu'elle est refusee : c'est le cas des navigateurs integres
  //     (webviews d'apps) qui exposent la methode mais rejettent l'appel
  //     en silence. On masque alors l'en-tete de la page et on agrandit
  //     le jeu via une classe sur <html>.

  const { $ } = window.Valdoria.dom;
  const root = document.documentElement;
  const btn = $("fullscreenBtn");
  if (!btn) { window.Valdoria.fullscreen = { toggle: function () {} }; return; }

  const request = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;

  function nativeActif() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function immersifActif() {
    return root.classList.contains("is-immersive");
  }

  function entreImmersif() { root.classList.add("is-immersive"); refresh(); }
  function sortImmersif()  { root.classList.remove("is-immersive"); refresh(); }

  function toggle() {
    // deja en plein ecran natif -> sortir
    if (nativeActif()) { try { exit.call(document); } catch (e) {} return; }
    // deja en repli immersif -> sortir
    if (immersifActif()) { sortImmersif(); return; }

    // pas d'API du tout (iOS Safari) : repli direct
    if (!request) { entreImmersif(); return; }

    // Tenter le plein ecran natif ; repli si indisponible, refuse, ou
    // "accepte" sans effet : certaines webviews (apps integrees) resolvent
    // la promesse sans jamais passer reellement en plein ecran. On verifie
    // donc l'etat reel apres coup et on bascule en immersif si rien n'a pris.
    let p;
    try { p = request.call(root); } catch (e) { entreImmersif(); return; }
    const verifieEffet = () => { if (nativeActif()) refresh(); else entreImmersif(); };
    if (p && typeof p.then === "function") {
      p.then(function () { setTimeout(verifieEffet, 400); }).catch(entreImmersif);
    } else {
      setTimeout(verifieEffet, 400);
    }
  }

  function refresh() {
    btn.textContent = (nativeActif() || immersifActif()) ? String.fromCharCode(0x2715) : String.fromCharCode(0x26F6);
  }

  var derniereBascule = 0;
  function surBoutonPleinEcran(e) {
    try { e.preventDefault(); } catch (x) {}
    var now = Date.now();
    if (now - derniereBascule < 350) return;     // anti double-declenchement
    derniereBascule = now;
    toggle();
  }
  btn.addEventListener("pointerup", surBoutonPleinEcran);
  btn.addEventListener("click", function (e) { try { e.preventDefault(); } catch (x) {} });
  document.addEventListener("fullscreenchange", refresh);
  document.addEventListener("webkitfullscreenchange", refresh);

  window.Valdoria.fullscreen = { toggle };
})(window);
