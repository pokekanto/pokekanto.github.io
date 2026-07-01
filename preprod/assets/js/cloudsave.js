(function (window) {
  "use strict";

  // Sauvegarde cloud "eco" du .sav : compressee (gzip), envoyee seulement quand
  // elle change, 1 seul enregistrement par "code de sauvegarde". Aucun compte :
  // le code (VALD-XXXX-XXXX) sert d'identifiant, affiche et re-saisissable.

  var V = window.Valdoria || (window.Valdoria = {});
  var CLE_CODE = "valdoria.cloudCode";
  var CLE_HASH = "valdoria.cloudHash";   // hash du dernier .sav envoye (eco)
  var BASE = "monde/saves/";

  var db = null, monCode = null, timer = null, listeners = false, enSuppression = false;

  function $(id) { return document.getElementById(id); }

  function genCode() {
    var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // sans I/O/0/1/L ambigus
    function bloc(n) { var s = ""; for (var i = 0; i < n; i++) s += A.charAt(Math.floor(Math.random() * A.length)); return s; }
    return "VALD-" + bloc(4) + "-" + bloc(4);
  }
  function getCode() {
    try { monCode = window.localStorage.getItem(CLE_CODE); } catch (e) {}
    if (!monCode || !/^VALD-/.test(monCode)) {
      monCode = genCode();
      try { window.localStorage.setItem(CLE_CODE, monCode); } catch (e) {}
    }
    return monCode;
  }
  function cleFB(code) { return ("" + code).replace(/[^A-Za-z0-9]/g, "").toUpperCase(); }
  // Adopte un code comme TON code permanent (stocke en local, reutilisable partout).
  function adopte(code) {
    monCode = ("" + code).trim().toUpperCase();
    try { window.localStorage.setItem(CLE_CODE, monCode); } catch (e) {}
    try { window.localStorage.removeItem(CLE_HASH); } catch (e) {}   // re-enverra la save sous ce code
    majUI();
  }
  function hash(s) { var h = 5381, i = s.length; while (i) h = (h * 33) ^ s.charCodeAt(--i); return (h >>> 0).toString(36); }

  // --- compression gzip (built-in, pas de dependance) ---
  async function gzip(b64) {
    try {
      if (typeof CompressionStream === "undefined") return "RAW:" + b64;
      var bin = atob(b64), u8 = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var ab = await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
      var o = new Uint8Array(ab), s = "";
      for (i = 0; i < o.length; i++) s += String.fromCharCode(o[i]);
      return "GZ:" + btoa(s);
    } catch (e) { return "RAW:" + b64; }
  }
  async function gunzip(stored) {
    if (stored.indexOf("RAW:") === 0) return stored.slice(4);
    if (stored.indexOf("GZ:") === 0) {
      var bin = atob(stored.slice(3)), u8 = new Uint8Array(bin.length), i;
      for (i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var ab = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
      var o = new Uint8Array(ab), s = "";
      for (i = 0; i < o.length; i++) s += String.fromCharCode(o[i]);
      return btoa(s);
    }
    return stored;   // ancien format brut
  }

  // --- envoi (eco : seulement si la sauvegarde a change) ---
  async function envoie() {
    if (enSuppression) return "supprime";
    if (!db) return "pasdb";
    var emu = V.emulator; if (!emu || !emu.getSaveBase64) return "pasemu";
    var b64 = emu.getSaveBase64(); if (!b64) return "vide";              // pas de save / vide
    var suff = ""; try { suff = window.localStorage.getItem("valdoria.tagSuffixe") || ""; } catch (e) {}
    var amisStr = "[]"; try { amisStr = window.localStorage.getItem("valdoria.tagsAmis") || "[]"; } catch (e) {}
    var h = hash(b64 + "|" + suff + "|" + amisStr), dernier = null;
    try { dernier = window.localStorage.getItem(CLE_HASH); } catch (e) {}
    if (h === dernier) return "inchange";                               // deja a jour -> eco
    var paquet = await gzip(b64);
    var st = V.state, cart = (st && st.gba && st.gba.mmu && st.gba.mmu.cart.code) || "";
    var amisArr = []; try { amisArr = JSON.parse(amisStr) || []; } catch (e) {}
    var val = JSON.stringify({ cart: cart, suffix: suff, amis: amisArr, save: paquet });
    if (val.length > 390000) return "tropgros";
    try { await db.ref(BASE + cleFB(monCode)).set(val); window.localStorage.setItem(CLE_HASH, h); return "ok"; }
    catch (e) { return "erreur"; }
  }

  // Envoi manuel (bouton) : immediat + retour clair a l'utilisateur.
  async function envoieManuel() {
    if (!db) { window.alert("Connexion en ligne pas encore prete - attends quelques secondes apres le lancement, puis reessaie."); return; }
    var r = await envoie();
    var m = {
      ok: "\u2705 Sauvegarde envoyee en ligne ! Note bien ton code : " + getCode(),
      inchange: "\u2705 Deja a jour en ligne (code : " + getCode() + ").",
      vide: "Sauvegarde d'abord DANS le jeu (menu START > Sauvegarder), puis reclique ici.",
      tropgros: "Sauvegarde trop volumineuse pour l'envoi.",
      erreur: "Echec de l'envoi, reessaie dans un instant.",
      pasemu: "Lance d'abord le jeu."
    };
    window.alert(m[r] || ("Etat : " + r));
  }

  async function litCloud(code) {
    if (!db) return null;
    try {
      var snap = await db.ref(BASE + cleFB(code)).once("value");
      var val = snap.val(); if (!val || typeof val !== "string") return null;
      var suffix = "", amis = null, packet = "";
      if (val.charAt(0) === "{") {
        var o = JSON.parse(val);
        suffix = o.suffix || ""; amis = o.amis || null; packet = o.save || "";
      } else {
        var parts = val.split("|");
        if (parts.length >= 3) { suffix = parts[1]; packet = parts.slice(2).join("|"); }
        else if (parts.length === 2) { packet = parts[1]; }
        else packet = val;
      }
      if (!packet) return null;
      return { b64: await gunzip(packet), suffix: suffix, amis: amis };
    } catch (e) { return null; }
  }
  async function restaurer(code) {
    var data = await litCloud(code || monCode);
    if (!data || !data.b64) return false;
    // restaure aussi le suffixe du tag (sinon le #1234 change apres un vidage de donnees)
    if (data.suffix && /^\d{4}$/.test(data.suffix)) {
      try { window.localStorage.setItem("valdoria.tagSuffixe", data.suffix); } catch (e) {}
    }
    if (data.amis && Array.isArray(data.amis)) {
      try { window.localStorage.setItem("valdoria.tagsAmis", JSON.stringify(data.amis)); } catch (e) {}
    }
    if (V.tchat) {
      if (V.tchat.rafraichitTag) V.tchat.rafraichitTag();
      if (V.tchat.rechargeAmis) V.tchat.rechargeAmis();
    }
    var emu = V.emulator;
    return (emu && emu.restoreSaveBase64) ? emu.restoreSaveBase64(data.b64) : false;
  }

  function majUI() {
    var code = getCode();
    var ids = ["cloudCode", "drawerCloudCode"];
    for (var i = 0; i < ids.length; i++) { var c = $(ids[i]); if (c) c.textContent = code; }
    var secs = ["cloudSaveSection", "drawerCloudSaveSection"];
    for (var j = 0; j < secs.length; j++) { var r = $(secs[j]); if (r) r.removeAttribute("hidden"); }
  }

  // appele par network.js quand Firebase est connecte
  function connectDb(database) {
    db = database;
    getCode();
    majUI();
    if (timer) clearInterval(timer);
    timer = setInterval(envoie, 15000);                    // upload periodique (eco: si change)
    if (!listeners) {
      listeners = true;
      window.addEventListener("pagehide", envoie);
      document.addEventListener("visibilitychange", function () { if (document.hidden) envoie(); });
    }
    // auto-restauration : pas de save locale MAIS une save cloud existe pour MON code
    setTimeout(async function () {
      try {
        var emu = V.emulator;
        if (emu && emu.getSaveBase64 && !emu.getSaveBase64()) {
          var dispo = await litCloud(monCode);
          if (dispo && window.confirm("Une sauvegarde en ligne a ete trouvee pour ton code. La restaurer ?")) {
            await restaurer(monCode);
          }
        }
      } catch (e) {}
    }, 4000);
  }

  async function faireRestaure(inputId) {
    var champ = $(inputId);
    var code = (champ && champ.value ? champ.value : "").trim();
    if (!code) { window.alert("Entre ton code (ex. VALD-XXXX-XXXX)."); if (champ) champ.focus(); return; }
    adopte(code);
    if (!db) { window.alert("Code adopte : " + monCode + ".\nLance le jeu, puis reclique pour restaurer ta sauvegarde."); return; }
    var ok = await restaurer(monCode);
    window.alert(ok
      ? ("Sauvegarde restauree ! Ton code (a garder) : " + monCode)
      : ("Code adopte : " + monCode + ".\nPas encore de sauvegarde en ligne pour ce code ; tes prochaines sauvegardes iront dessus."));
  }

  // Supprime DEFINITIVEMENT la partie : enregistrement cloud + sauvegarde locale.
  async function supprimerPartie() {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer définitivement votre partie ?\n\nCette action est IRRÉVERSIBLE : ta sauvegarde sera effacée en local ET en ligne (cloud).")) return;
    enSuppression = true;
    if (timer) { clearInterval(timer); timer = null; }
    var code = getCode();
    if (db) {
      try { await db.ref(BASE + cleFB(code)).set(""); } catch (e) {}
      try { await db.ref(BASE + cleFB(code)).remove(); } catch (e) {}
    }
    try { if (V.emulator && V.emulator.deleteSave) V.emulator.deleteSave(); } catch (e) {}
    try { window.localStorage.removeItem(CLE_HASH); } catch (e) {}
    try { window.localStorage.removeItem(CLE_CODE); } catch (e) {}
    monCode = null;
    window.alert("Partie supprimée (local + en ligne). La page va se recharger pour repartir à zéro.");
    try { window.location.reload(); } catch (e) {}
  }

  // Suppression pour bannissement : efface cloud + local, SANS confirmation ni reload.
  async function supprimePourBan() {
    enSuppression = true;
    if (timer) { clearInterval(timer); timer = null; }
    var code = getCode();
    if (db) {
      try { await db.ref(BASE + cleFB(code)).set(""); } catch (e) {}
      try { await db.ref(BASE + cleFB(code)).remove(); } catch (e) {}
    }
    try { if (V.emulator && V.emulator.deleteSave) V.emulator.deleteSave(); } catch (e) {}
    try { window.localStorage.removeItem(CLE_HASH); } catch (e) {}
    try { window.localStorage.removeItem(CLE_CODE); } catch (e) {}
    monCode = null;
  }

  document.addEventListener("DOMContentLoaded", function () {
    majUI();
    var up1 = $("cloudSaveBtn"); if (up1) up1.addEventListener("click", envoieManuel);
    var up2 = $("drawerCloudSaveBtn"); if (up2) up2.addEventListener("click", envoieManuel);
    var r1 = $("cloudRestoreBtn"); if (r1) r1.addEventListener("click", function () { faireRestaure("cloudCodeInput"); });
    var r2 = $("drawerCloudRestoreBtn"); if (r2) r2.addEventListener("click", function () { faireRestaure("drawerCloudCodeInput"); });
    var del1 = $("cloudDeleteBtn"); if (del1) del1.addEventListener("click", supprimerPartie);
    var del2 = $("drawerCloudDeleteBtn"); if (del2) del2.addEventListener("click", supprimerPartie);
  });

  V.cloudsave = { connectDb: connectDb, getCode: getCode, restaurer: restaurer, envoie: envoie, envoieManuel: envoieManuel, supprimerPartie: supprimerPartie, supprimePourBan: supprimePourBan };
})(window);
