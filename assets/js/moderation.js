(function (window) {
  "use strict";
  // Moderation stricte (best-effort, pas de serveur/comptes) : compteur de fautes
  // (insultes + spam) persistant. 1re = avertissement, 2e = dernier avertissement,
  // 3e = ban a vie + suppression totale de la sauvegarde. Le comptage tient dans
  // localStorage (rapide) + Firebase monde/moderation/<tag> (persistance, best-effort).
  var V = window.Valdoria || (window.Valdoria = {});
  var CLE = "valdoria.moderation";
  var dernierStrike = 0;
  function DB() { return (V.state && V.state.monde) || null; }
  function tag() { return (V.tchat && V.tchat.getTag && V.tchat.getTag()) || null; }
  function cleTag(t) { return ("" + t).replace(/[.#$\[\]\/]/g, "-"); }
  function lire() { try { return JSON.parse(window.localStorage.getItem(CLE) || "{}") || {}; } catch (e) { return {}; } }
  function ecrire(o) { try { window.localStorage.setItem(CLE, JSON.stringify(o)); } catch (e) {} }
  function estBanni() { return !!lire().banned; }
  function pousseFirebase(patch) {
    var t = tag(), db = DB(); if (!t || !db) return;
    try { db.ref("monde/moderation/" + cleTag(t)).update(patch); } catch (e) {}
  }

  // Appele par tchat.js a chaque faute (type: "insulte" | "spam").
  function signale(type) {
    if (estBanni()) return;
    var now = Date.now();
    if (now - dernierStrike < 5000) return;   // une rafale = 1 faute (pas de sur-comptage)
    dernierStrike = now;
    var o = lire(); var s = (o.strikes || 0) + 1; o.strikes = s; ecrire(o);
    pousseFirebase({ strikes: s, t: firebase.database.ServerValue.TIMESTAMP });
    if (s === 1) notif("Avertissement (1/3)\nLes insultes et le spam sont interdits sur PokeKanto. A la prochaine faute, ce sera ton DERNIER avertissement.", true);
    else if (s === 2) notif("DERNIER AVERTISSEMENT (2/3)\nEncore une seule faute et ton compte sera BANNI a vie et ta sauvegarde SUPPRIMEE definitivement. Aucune exception.", true);
    else bannit();
  }

  function bannit() {
    var o = lire(); o.banned = true; o.strikes = 3; ecrire(o);
    pousseFirebase({ banned: true, strikes: 3, t: firebase.database.ServerValue.TIMESTAMP });
    try { if (V.cloudsave && V.cloudsave.supprimePourBan) V.cloudsave.supprimePourBan(); } catch (e) {}
    overlayBan();
  }

  function verifieAuLancement() {
    if (estBanni()) { try { if (V.cloudsave && V.cloudsave.supprimePourBan) V.cloudsave.supprimePourBan(); } catch (e) {} overlayBan(); return; }
    var essais = 0;
    var iv = setInterval(function () {
      essais++;
      var t = tag(), db = DB();
      if (t && db) {
        clearInterval(iv);
        db.ref("monde/moderation/" + cleTag(t)).once("value").then(function (snap) {
          var v = snap.val();
          if (v && v.banned) { var o = lire(); o.banned = true; ecrire(o); try { V.cloudsave.supprimePourBan(); } catch (e) {} overlayBan(); }
          else if (v && v.strikes) { var o2 = lire(); if ((o2.strikes || 0) < v.strikes) { o2.strikes = v.strikes; ecrire(o2); } }
        }).catch(function () {});
      } else if (essais > 40) clearInterval(iv);
    }, 1500);
  }

  function notif(msg, warn) {
    var d = document.getElementById("modNotif");
    if (!d) { d = document.createElement("div"); d.id = "modNotif"; d.addEventListener("click", function () { d.hidden = true; }); document.body.appendChild(d); }
    d.className = "mod-notif" + (warn ? " mod-warn" : "");
    d.textContent = msg;
    d.hidden = false;
    clearTimeout(d._t);
    d._t = setTimeout(function () { d.hidden = true; }, 11000);
  }

  function overlayBan() {
    if (document.getElementById("modBanOverlay")) return;
    var o = document.createElement("div"); o.id = "modBanOverlay"; o.className = "mod-ban-overlay";
    o.innerHTML = '<div class="mod-ban-box"><h2>Banni definitivement</h2>' +
      '<p>Tu as ete banni de PokeKanto pour insultes ou spam repetes (3/3).</p>' +
      '<p>Ton compte et ta sauvegarde ont ete supprimes definitivement. Cette decision est irreversible.</p></div>';
    document.body.appendChild(o);
    try { var inp = document.getElementById("tchatInput"); if (inp) { inp.disabled = true; inp.placeholder = "Banni."; } } catch (e) {}
  }

  V.moderation = { signale: signale, estBanni: estBanni, verifieAuLancement: verifieAuLancement };
  document.addEventListener("DOMContentLoaded", verifieAuLancement);
})(window);
