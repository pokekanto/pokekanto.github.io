(function (window) {
  "use strict";
  // Classement Elo des COMBATS ALEATOIRES (ladder facon Showdown), SAISONNIER :
  // la cle inclut la saison (semestre) -> reset automatique tous les 6 mois.
  // Stocke dans monde/ladder/<saison>/<tag> (necessite la regle Firebase "ladder").
  var V = window.Valdoria || (window.Valdoria = {});
  var K = 32, ELO_DEFAUT = 1000;
  function DB() { return (V.state && V.state.monde) || null; }
  function monTag() { return (V.tchat && V.tchat.getTag && V.tchat.getTag()) || null; }
  function saison() { var d = new Date(); return d.getFullYear() + "S" + (d.getMonth() < 6 ? 1 : 2); }
  function cleTag(t) { return ("" + t).replace(/[.#$\[\]\/]/g, "-"); }
  function esc(s) { return ("" + s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function base() { return "monde/ladder/" + saison(); }

  function litEntree(tag) {
    var db = DB(); if (!db || !tag) return Promise.resolve(null);
    return db.ref(base() + "/" + cleTag(tag)).once("value").then(function (s) { return s.val(); }).catch(function () { return null; });
  }

  // Combat CLASSE (aleatoire) termine : met a jour MON Elo selon celui de l'adversaire.
  function enregistreResultat(advTag, gagne) {
    var db = DB(); var mt = monTag();
    if (!db || !mt) return;
    Promise.all([litEntree(mt), litEntree(advTag)]).then(function (r) {
      var moi = r[0] || {}; var adv = r[1] || {};
      var eloMoi = (typeof moi.elo === "number") ? moi.elo : ELO_DEFAUT;
      var eloAdv = (typeof adv.elo === "number") ? adv.elo : ELO_DEFAUT;
      var attendu = 1 / (1 + Math.pow(10, (eloAdv - eloMoi) / 400));
      var nouv = Math.round(eloMoi + K * ((gagne ? 1 : 0) - attendu));
      var nom = (V.state && V.state.myPos && V.state.myPos.nom) || moi.nom || ("" + mt).split("#")[0] || "Dresseur";
      var maj = { elo: nouv, w: (moi.w || 0) + (gagne ? 1 : 0), l: (moi.l || 0) + (gagne ? 0 : 1), nom: nom, t: firebase.database.ServerValue.TIMESTAMP };
      try { db.ref(base() + "/" + cleTag(mt)).set(maj); } catch (e) {}
      setTimeout(afficheTop, 900);
    });
  }

  function afficheTop() {
    var box = document.getElementById("ladderBox"); var db = DB();
    if (!box || !db) return;
    db.ref(base()).orderByChild("elo").limitToLast(20).once("value").then(function (snap) {
      var val = snap.val() || {}; var arr = [];
      for (var k in val) { var v = val[k]; if (v && typeof v.elo === "number") arr.push(v); }
      arr.sort(function (a, b) { return b.elo - a.elo; });
      var h = '<div class="ladder-titre">🏆 Classement — Combat aléatoire</div>' +
              '<div class="ladder-saison">Saison ' + saison() + ' · remise à zéro tous les 6 mois</div>';
      if (!arr.length) {
        h += '<div class="ladder-vide">Aucun combat classé pour l\'instant — lance un combat aléatoire pour ouvrir le classement !</div>';
      } else {
        h += '<table class="ladder-table"><thead><tr><th>#</th><th>Dresseur</th><th>Elo</th><th>V/D</th></tr></thead><tbody>';
        arr.forEach(function (v, i) {
          h += '<tr><td>' + (i + 1) + '</td><td>' + esc(v.nom || "?") + '</td><td>' + v.elo + '</td><td>' + (v.w || 0) + '/' + (v.l || 0) + '</td></tr>';
        });
        h += '</tbody></table>';
      }
      box.innerHTML = h;
    }).catch(function () {});
  }

  var refreshIv = null;
  function demarre() {
    if (refreshIv) return;
    afficheTop();
    refreshIv = setInterval(function () { if (document.body.classList.contains("is-playing")) afficheTop(); }, 60000);
  }
  document.addEventListener("DOMContentLoaded", function () {
    var chk = setInterval(function () { if (DB() && document.body.classList.contains("is-playing")) { clearInterval(chk); demarre(); } }, 3000);
  });

  V.ladder = { enregistreResultat: enregistreResultat, afficheTop: afficheTop, litEntree: litEntree, saison: saison };
})(window);
