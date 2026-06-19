(function (window) {
  "use strict";

  window.Valdoria = window.Valdoria || {};
  window.Valdoria.state = {
    gba: null,
    romBuffer: null,
    pendingSave: null,
    pendingSaveName: "",
    pendingSaveRead: null,
    lastLocalSaveAt: null,
    myPos:  null,
    monde: null,        // connexion au monde partagé (network.js)
    // joueurs distants, indexés par identifiant de session Firebase.
    // Chaque entrée : { nom, g, m, tx, ty, lastTx, lastTy, dx, dy,
    //                   visible, direction, movingUntil, sexe, t }
    joueurs: {}
  };
})(window);
