(function (window) {
  "use strict";

  // Échange PokéKanto (sans câble). Deux modes :
  //  1) Boîte aux lettres (async) : j'envoie un Pokémon dans la boîte d'un tag,
  //     il le reçoit quand il veut. Sert aux cadeaux + transfert entre appareils.
  //  2) Échange en direct (atomique) : les deux joueurs en ligne déposent leur
  //     Pokémon dans un salon (monde/sessions/troc_<code>), voient l'offre de
  //     l'autre, valident tous les deux -> échange simultané. Dépôt = séquestre :
  //     si annulation/déconnexion, le Pokémon revient (rien perdu). Pas de synchro
  //     temps réel -> pas le mur du câble.
  //  Lecture/écriture directe dans gPlayerParty (RAM IodineGBA). Persistance via
  //  sauvegarde EN JEU (Start > Sauvegarder).

  var V = window.Valdoria || (window.Valdoria = {});

  var PARTY = 0x24284;   // gPlayerParty - 0x2000000
  var COUNT = 0x24029;   // gPlayerPartyCount - 0x2000000
  var TAILLE = 100;

  var ORD = ["GAEM","GAME","GEAM","GEMA","GMAE","GMEA","AGEM","AGME","AEGM","AEMG","AMGE","AMEG",
             "EGAM","EGMA","EAGM","EAMG","EMGA","EMAG","MGAE","MGEA","MAGE","MAEG","MEGA","MEAG"];

  var db = null;
  var tagAbonne = null;
  var recus = [];
  var invites = [];
  var onglet = "envoyer";
  var choisi = -1;          // sélection onglet Envoyer
  var choisiDirect = -1;    // sélection onglet En direct
  var salon = null;         // salon d'échange en cours

  function $(id) { return document.getElementById(id); }
  function monTag() { return (V.tchat && V.tchat.getTag && V.tchat.getTag()) || ""; }
  function cle(tag) { return ("" + tag).replace("#", "-"); }
  function estOuvert() { var p = $("echangePanel"); return p && !p.hasAttribute("hidden"); }
  function TS() { return firebase.database.ServerValue.TIMESTAMP; }

  function ewram() {
    try {
      var i = window.IodineGUI && window.IodineGUI.Iodine;
      var m = i && i.IOCore && i.IOCore.memory;
      return (m && m.externalRAM) ? m.externalRAM : null;
    } catch (e) { return null; }
  }

  // --- lecture / décodage Gen 3 ---
  function r16(ew, o) { return ew[o] | (ew[o + 1] << 8); }
  function r32(ew, o) { return (ew[o] | (ew[o + 1] << 8) | (ew[o + 2] << 16) | (ew[o + 3] << 24)) >>> 0; }

  function surnom(ew, off) {
    var s = "";
    for (var i = 0; i < 10; i++) {
      var b = ew[off + 8 + i];
      if (b === 0xFF) break;
      if (b >= 0xBB && b <= 0xD4) s += String.fromCharCode(65 + (b - 0xBB));
      else if (b >= 0xD5 && b <= 0xEE) s += String.fromCharCode(97 + (b - 0xD5));
      else if (b >= 0xA1 && b <= 0xAA) s += String.fromCharCode(48 + (b - 0xA1));
    }
    return s;
  }

  function decode(ew, off) {
    var p = r32(ew, off), otid = r32(ew, off + 4);
    if (p === 0) return null;
    var key = (p ^ otid) >>> 0, chk = r16(ew, off + 0x1C), sum = 0, i, w;
    for (i = 0; i < 12; i++) { w = (r32(ew, off + 0x20 + i * 4) ^ key) >>> 0; sum = (sum + (w & 0xFFFF) + ((w >>> 16) & 0xFFFF)) & 0xFFFF; }
    var g = ORD[p % 24].indexOf("G");
    var sp = (r32(ew, off + 0x20 + g * 12) ^ key) & 0xFFFF;
    var nom = surnom(ew, off);
    return { off: off, sp: sp, niveau: ew[off + 0x54], nom: nom || ("Pokemon #" + sp), valide: (sum === chk && sp >= 1 && sp <= 411) };
  }

  function compte() { var ew = ewram(); return ew ? ew[COUNT] : 0; }

  function lireEquipe() {
    var ew = ewram(); if (!ew) return null;
    var c = ew[COUNT]; if (c < 0 || c > 6) return [];
    var l = [];
    for (var i = 0; i < c; i++) {
      var m = decode(ew, PARTY + i * TAILLE);
      l.push(m || { off: PARTY + i * TAILLE, sp: 0, niveau: 0, nom: "???", valide: false });
    }
    return l;
  }

  function lireBrut(off) { var ew = ewram(), u = new Uint8Array(TAILLE), i; for (i = 0; i < TAILLE; i++) u[i] = ew[off + i]; return u; }
  function ecritBrut(off, u) { var ew = ewram(), i; for (i = 0; i < TAILLE; i++) ew[off + i] = u[i]; }

  function retire(idx) {
    var ew = ewram(), c = ew[COUNT], s, b;
    for (s = idx; s < c - 1; s++) for (b = 0; b < TAILLE; b++) ew[PARTY + s * TAILLE + b] = ew[PARTY + (s + 1) * TAILLE + b];
    for (b = 0; b < TAILLE; b++) ew[PARTY + (c - 1) * TAILLE + b] = 0;
    ew[COUNT] = c - 1;
  }

  function ajoute(u) {
    var ew = ewram(), c = ew[COUNT];
    if (c >= 6) return false;
    ecritBrut(PARTY + c * TAILLE, u);
    ew[COUNT] = c + 1;
    return true;
  }

  function b64enc(u) { var s = "", i; for (i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function b64dec(b) { var bin = atob(b), u = new Uint8Array(bin.length), i; for (i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  function surCarte() { try { return !(V.position && V.position.estSurCarte) || V.position.estSurCarte(); } catch (e) { return true; } }
  function lesAmis() { try { var a = JSON.parse(window.localStorage.getItem("valdoria.tagsAmis") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

  // ===================== BOÎTE AUX LETTRES =====================
  function assureAbonnement() {
    if (!db) return;
    var tag = monTag();
    if (!tag || tagAbonne === tag) return;
    if (tagAbonne) { try { db.ref("monde/echanges/" + cle(tagAbonne)).off(); } catch (e) {} }
    recus = []; invites = [];
    tagAbonne = tag;
    var ref = db.ref("monde/echanges/" + cle(tag));
    ref.on("child_added", function (s) {
      var d = s.val(); if (!d) return;
      d._key = s.key; d._ref = s.ref;
      if (d.troc) { if (!invites.some(function (x) { return x.troc === d.troc; })) invites.push(d); majBadge(); if (estOuvert() && onglet === "direct") rendInvites(); return; }
      if (!d.data) return;
      recus.push(d); majBadge(); if (estOuvert() && onglet === "recus") rendRecus();
    });
    ref.on("child_removed", function (s) {
      recus = recus.filter(function (g) { return g._key !== s.key; });
      invites = invites.filter(function (g) { return g._key !== s.key; });
      majBadge(); if (estOuvert()) { if (onglet === "recus") rendRecus(); if (onglet === "direct") rendInvites(); }
    });
  }

  function destinataire() {
    var inp = $("echangeTagInput"), sel = $("echangeAmiSelect");
    var v = (inp && inp.value.trim()) || "";
    if (/^.{1,12}#\d{4}$/.test(v)) return v;
    if (sel && sel.value) return sel.value;
    return null;
  }

  function envoyer() {
    var st = $("echangeStatut");
    if (!ewram()) { st.textContent = "Lance d'abord le jeu."; return; }
    if (!surCarte()) { st.textContent = "Reviens sur la carte (pas en combat ni dans un menu) pour échanger."; return; }
    var equipe = lireEquipe() || [];
    if (choisi < 0 || choisi >= equipe.length) { st.textContent = "Choisis un Pokémon à envoyer."; return; }
    if (compte() <= 1) { st.textContent = "Tu dois garder au moins 1 Pokémon dans ton équipe."; return; }
    var mon = equipe[choisi];
    if (!mon.valide) { st.textContent = "Ce Pokémon est illisible, réessaie."; return; }
    var dest = destinataire();
    if (!dest) { st.textContent = "Choisis un ami ou entre un tag (Nom#1234)."; return; }
    var brut = b64enc(lireBrut(mon.off));
    var btn = $("echangeBtnEnvoyer"); btn.disabled = true; st.textContent = "Envoi en cours...";
    db.ref("monde/echanges/" + cle(dest)).push({ de: monTag() || "?", nom: mon.nom, espece: mon.sp, niveau: mon.niveau, data: brut, t: TS() })
      .then(function () {
        retire(choisi); choisi = -1;
        st.innerHTML = "✅ <strong>" + mon.nom + "</strong> envoyé à " + dest + " !<br>⚠️ Sauvegarde EN JEU (Start → Sauvegarder) pour valider.";
        rendEquipe();
      })
      .catch(function () { st.textContent = "Échec de l'envoi, réessaie dans un instant."; btn.disabled = false; });
  }

  function recevoir(g) {
    var st = $("echangeStatut2");
    if (!ewram()) { if (st) st.textContent = "Lance d'abord le jeu."; return; }
    if (!surCarte()) { if (st) st.textContent = "Reviens sur la carte pour recevoir."; return; }
    if (compte() >= 6) { if (st) st.textContent = "Équipe pleine (6). Libère une place d'abord."; return; }
    var u; try { u = b64dec(g.data); } catch (e) { u = null; }
    if (!u || u.length !== TAILLE) { if (st) st.textContent = "Données invalides."; return; }
    ajoute(u);
    if (g._ref) g._ref.remove().catch(function () {});
    if (st) st.innerHTML = "✅ <strong>" + g.nom + "</strong> reçu dans ton équipe !<br>⚠️ Sauvegarde EN JEU (Start → Sauvegarder) pour le garder.";
  }

  // ===================== ÉCHANGE EN DIRECT =====================
  function genCode() { var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = "", i; for (i = 0; i < 5; i++) s += A.charAt(Math.floor(Math.random() * A.length)); return s; }
  function chemin(code) { return "monde/sessions/troc_" + code; }
  function champMy() { return salon.role === "hote" ? "offreHote" : "offreInvite"; }
  function champSon() { return salon.role === "hote" ? "offreInvite" : "offreHote"; }
  function champMyFin() { return salon.role === "hote" ? "finHote" : "finInvite"; }
  function champSonFin() { return salon.role === "hote" ? "finInvite" : "finHote"; }

  function inviter() {
    var st = $("echangeRoomStatut") || $("echangeStatut");
    if (!ewram()) { dirStatut("Lance d'abord le jeu."); return; }
    if (!monTag()) { dirStatut("Ton tag n'est pas prêt (avance un peu en jeu)."); return; }
    var sel = $("echangeDirectAmi"), inp = $("echangeDirectTag");
    var dest = (inp && /^.{1,12}#\d{4}$/.test(inp.value.trim())) ? inp.value.trim() : (sel && sel.value) || null;
    if (!dest) { dirStatut("Choisis un ami ou entre son tag (Nom#1234)."); return; }
    var code = genCode();
    var ref = db.ref(chemin(code));
    ref.set({ hote: monTag(), invite: dest, etat: "ouvert", t: TS() })
      .then(function () {
        db.ref("monde/echanges/" + cle(dest)).push({ de: monTag(), troc: code, t: TS() });
        entrerSalon(code, "hote", dest);
      })
      .catch(function () { dirStatut("Impossible de créer le salon, réessaie."); });
  }

  function rejoindreCode(code, hoteTag) {
    code = ("" + code).trim().toUpperCase();
    if (!code) { dirStatut("Entre un code de salon."); return; }
    var ref = db.ref(chemin(code));
    ref.once("value").then(function (s) {
      var r = s.val();
      if (!r) { dirStatut("Salon introuvable (code expiré ?)."); return; }
      entrerSalon(code, "invite", hoteTag || r.hote || "?");
    });
  }

  function entrerSalon(code, role, partenaire) {
    salon = { code: code, role: role, partenaire: partenaire, ref: db.ref(chemin(code)),
              depot: null, retourKey: null, recu: false, fini: false, timer: null };
    choisiDirect = -1;
    if (role === "hote") { try { salon.ref.onDisconnect().remove(); } catch (e) {} }
    salon.ref.on("value", function (s) { surMajSalon(s.val()); });
    salon.timer = setInterval(verifieSalon, 1300);
    $("echangeDirectIdle").setAttribute("hidden", "");
    $("echangeDirectRoom").removeAttribute("hidden");
    $("echangeRoomTitre").textContent = "Salon " + code + " — avec " + partenaire;
    dirStatut(role === "hote" ? "En attente que " + partenaire + " rejoigne…" : "Tu as rejoint le salon de " + partenaire + ".");
    rendSalon(null);
  }

  function deposer() {
    if (!salon || salon.fini) return;
    if (!surCarte()) { dirStatut("Reviens sur la carte pour déposer."); return; }
    if (salon.depot) { dirStatut("Tu as déjà déposé un Pokémon."); return; }
    var eq = lireEquipe() || [];
    if (choisiDirect < 0 || choisiDirect >= eq.length) { dirStatut("Choisis un Pokémon à déposer."); return; }
    if (compte() <= 1) { dirStatut("Tu dois garder au moins 1 Pokémon."); return; }
    var mon = eq[choisiDirect];
    if (!mon.valide) { dirStatut("Ce Pokémon est illisible."); return; }
    var brut = b64enc(lireBrut(mon.off));
    salon.depot = { nom: mon.nom, espece: mon.sp, niveau: mon.niveau, brut: brut };
    // séquestre : retire de la RAM + filet de sécurité (retour en boîte si déconnexion)
    retire(choisiDirect); choisiDirect = -1;
    var rk = db.ref("monde/echanges/" + cle(monTag())).push();
    salon.retourKey = rk;
    try { rk.onDisconnect().set({ de: "Retour échange", nom: mon.nom, espece: mon.sp, niveau: mon.niveau, data: brut, t: TS() }); } catch (e) {}
    salon.ref.child(champMy()).set({ tag: monTag(), nom: mon.nom, espece: mon.sp, niveau: mon.niveau, data: brut, pret: false });
    dirStatut("Pokémon déposé. En attente de l'autre joueur…");
  }

  function valider() {
    if (!salon || salon.fini || !salon.depot) return;
    salon.ref.child(champMy()).child("pret").set(true);
    dirStatut("Validé ✅ — en attente de la validation de l'autre…");
  }

  function faireSwap(sonOffre) {
    if (!salon || salon.recu || salon.fini) return;
    try {
      if (!ewram()) { dirStatut("Reviens dans le jeu (sur la carte) pour finaliser l'échange…"); return; }
      if (compte() >= 6) { dirStatut("Équipe pleine (6) : libère une place pour finaliser."); return; }
      var u = b64dec(sonOffre.data || "");
      if (!u || u.length !== TAILLE) { dirStatut("Données reçues invalides."); return; }
      if (!ajoute(u)) { dirStatut("Impossible d'ajouter le Pokémon (équipe pleine)."); return; }
      salon.recu = true; salon.fini = true;
      if (salon.timer) { clearInterval(salon.timer); salon.timer = null; }
      if (salon.retourKey) { try { salon.retourKey.onDisconnect().cancel(); } catch (e) {} }
      salon.ref.child(champMyFin()).set(true);
      var ch = $("echangeDirectChoix"); if (ch) ch.setAttribute("hidden", "");
      var bv = $("echangeBtnValider"); if (bv) bv.setAttribute("hidden", "");
      dirStatut("🎉 Échange réussi ! Tu as reçu <strong>" + (sonOffre.nom || "un Pokémon") + "</strong>.<br>⚠️ Sauvegarde EN JEU (Start → Sauvegarder) pour le garder.");
    } catch (e) { dirStatut("Souci pendant l'échange (" + (e && e.message ? e.message : e) + "). Réessaie."); }
  }

  function abandon(msg) {
    if (!salon || salon.fini) return;
    salon.fini = true;
    if (salon.timer) { clearInterval(salon.timer); salon.timer = null; }
    if (salon.depot && !salon.recu) { ajoute(b64dec(salon.depot.brut)); }   // rends le Pokémon déposé
    if (salon.retourKey) { try { salon.retourKey.onDisconnect().cancel(); } catch (e) {} }
    try { salon.ref.off(); } catch (e) {}
    dirStatut(msg || "Échange annulé. Ton Pokémon t'a été rendu.");
    var bv = $("echangeBtnValider"); if (bv) bv.setAttribute("hidden", "");
  }

  function quitterSalon() {
    if (salon && !salon.fini) {
      var ref = salon.ref, role = salon.role;
      try { ref.child("etat").set("annule"); } catch (e) {}
      abandon("Échange annulé. Ton Pokémon t'a été rendu.");
      if (role === "hote") setTimeout(function () { try { ref.remove(); } catch (e) {} }, 1500);
    }
    if (salon && salon.timer) { clearInterval(salon.timer); salon.timer = null; }
    if (salon && salon.ref) { try { salon.ref.off(); } catch (e) {} }
    salon = null;
    $("echangeDirectRoom").setAttribute("hidden", "");
    $("echangeDirectChoix").removeAttribute("hidden");
    $("echangeDirectIdle").removeAttribute("hidden");
    rendInvites();
  }

  function checkComplete(room) {
    if (!salon || salon.fini || !room) return;
    var mienne = room[champMy()], sienne = room[champSon()];
    var both = !!(mienne && mienne.pret && sienne && sienne.pret);
    var sonFin = !!room[champSonFin()];
    try { console.log("[ech] check", { role: salon.role, maPret: !!(mienne && mienne.pret), saPret: !!(sienne && sienne.pret), sonFin: sonFin, recu: salon.recu }); } catch (e) {}
    if ((both || sonFin) && !salon.recu && sienne && sienne.data) faireSwap(sienne);
  }
  function menageHote(room) {
    if (salon && salon.role === "hote" && room && room.finHote && room.finInvite) { try { salon.ref.remove(); } catch (e) {} }
  }
  function verifieSalon() {
    if (!salon || !salon.ref) return;
    salon.ref.once("value").then(function (s) {
      if (!salon) return;
      var r = s.val();
      if (r === null) { if (!salon.fini) abandon("L'autre joueur a quitté. Ton Pokémon t'a été rendu."); return; }
      if (r.etat === "annule") { if (!salon.fini) abandon("L'autre joueur a annulé. Ton Pokémon t'a été rendu."); return; }
      if (!salon.fini) { rendSalon(r); checkComplete(r); }
      menageHote(r);
    }).catch(function () {});
  }
  function surMajSalon(room) {
    if (!salon) return;
    if (room === null) { if (!salon.fini) abandon("L'autre joueur a quitté. Ton Pokémon t'a été rendu."); return; }
    if (room.etat === "annule") { if (!salon.fini) abandon("L'autre joueur a annulé. Ton Pokémon t'a été rendu."); return; }
    if (!salon.fini) { rendSalon(room); checkComplete(room); }
    menageHote(room);
  }

  // ===================== RENDU UI =====================
  function renderEquipeDans(containerId, selIdx, onPick) {
    var boite = $(containerId); if (!boite) return;
    boite.textContent = "";
    var eq = lireEquipe();
    if (eq === null) { boite.innerHTML = '<p class="echange-vide">Lance le jeu pour voir ton équipe.</p>'; return; }
    if (eq.length === 0) { boite.innerHTML = '<p class="echange-vide">Aucun Pokémon dans ton équipe.</p>'; return; }
    for (var i = 0; i < eq.length; i++) {
      (function (i, m) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "echange-mon" + (i === selIdx ? " choisi" : "");
        b.innerHTML = '<span class="echange-mon-pt"></span><span class="echange-mon-nom">' + m.nom + '</span><span class="echange-mon-niv">Niv. ' + m.niveau + '</span>';
        if (!m.valide) b.disabled = true;
        b.addEventListener("click", function () { onPick(i); });
        boite.appendChild(b);
      })(i, eq[i]);
    }
  }

  function rendEquipe() { renderEquipeDans("echangeEquipe", choisi, function (i) { choisi = i; rendEquipe(); var b = $("echangeBtnEnvoyer"); if (b) b.disabled = (choisi < 0); }); var b = $("echangeBtnEnvoyer"); if (b) b.disabled = (choisi < 0); }
  function rendEquipeDirect() { renderEquipeDans("echangeDirectEquipe", choisiDirect, function (i) { choisiDirect = i; rendEquipeDirect(); var b = $("echangeBtnDeposer"); if (b) b.disabled = (choisiDirect < 0); }); var b = $("echangeBtnDeposer"); if (b) b.disabled = (choisiDirect < 0); }

  function rendAmis(selId) {
    var sel = $(selId); if (!sel) return;
    var amis = lesAmis(), cur = sel.value;
    sel.textContent = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = amis.length ? "-- choisir un ami --" : "(aucun ami ajouté)"; sel.appendChild(o0);
    for (var i = 0; i < amis.length; i++) { var o = document.createElement("option"); o.value = amis[i]; o.textContent = amis[i]; sel.appendChild(o); }
    if (cur) sel.value = cur;
  }

  function rendRecus() {
    var boite = $("echangeRecusListe"); if (!boite) return;
    boite.textContent = "";
    if (!recus.length) { boite.innerHTML = '<p class="echange-vide">Aucun Pokémon reçu pour l\'instant.<br>Donne ton tag à un ami pour qu\'il t\'en envoie.</p>'; return; }
    for (var i = 0; i < recus.length; i++) {
      (function (g) {
        var ligne = document.createElement("div");
        ligne.className = "echange-recu";
        ligne.innerHTML = '<span class="echange-mon-pt"></span><span class="echange-recu-info"><strong>' + (g.nom || "Pokémon") + '</strong> Niv. ' + (g.niveau || "?") + '<br><span class="echange-recu-de">de ' + (g.de || "?") + '</span></span>';
        var b = document.createElement("button");
        b.type = "button"; b.className = "echange-recevoir"; b.textContent = "Recevoir";
        b.addEventListener("click", function () { recevoir(g); });
        ligne.appendChild(b);
        boite.appendChild(ligne);
      })(recus[i]);
    }
  }

  function rendInvites() {
    var wrap = $("echangeInvitesWrap"), boite = $("echangeInvitesListe");
    if (!boite || !wrap) return;
    boite.textContent = "";
    var vis = invites.filter(function (g) { return !(salon && !salon.fini && salon.code === g.troc); });
    if (!vis.length) { wrap.setAttribute("hidden", ""); return; }
    wrap.removeAttribute("hidden");
    for (var i = 0; i < vis.length; i++) {
      (function (g) {
        var ligne = document.createElement("div");
        ligne.className = "echange-recu";
        ligne.innerHTML = '<span class="echange-recu-info"><strong>' + (g.de || "?") + '</strong><br><span class="echange-recu-de">veut échanger en direct</span></span>';
        var b = document.createElement("button");
        b.type = "button"; b.className = "echange-recevoir"; b.textContent = "Rejoindre";
        b.addEventListener("click", function () { if (g._ref) g._ref.remove().catch(function () {}); rejoindreCode(g.troc, g.de); });
        ligne.appendChild(b);
        boite.appendChild(ligne);
      })(vis[i]);
    }
  }

  function rendSalon(room) {
    var moi = $("echangeSlotMoi"), son = $("echangeSlotSon"), sonTete = $("echangeSlotSonTete");
    if (sonTete && salon) sonTete.textContent = salon.partenaire || "Lui";
    var mienne = room ? room[champMy()] : (salon && salon.depot ? { nom: salon.depot.nom, niveau: salon.depot.niveau, pret: false } : null);
    var sienne = room ? room[champSon()] : null;
    if (moi) moi.innerHTML = mienne ? ('<strong>' + (mienne.nom || "?") + '</strong><br>Niv. ' + (mienne.niveau || "?") + (mienne.pret ? '<br><span class="echange-pret">✅ validé</span>' : '')) : '<span class="echange-attente">à déposer…</span>';
    if (son) son.innerHTML = sienne ? ('<strong>' + (sienne.nom || "?") + '</strong><br>Niv. ' + (sienne.niveau || "?") + (sienne.pret ? '<br><span class="echange-pret">✅ validé</span>' : '')) : '<span class="echange-attente">en attente…</span>';
    // boutons
    var choix = $("echangeDirectChoix"), bDep = $("echangeBtnDeposer"), bVal = $("echangeBtnValider");
    var jaiDepose = !!(salon && salon.depot);
    if (choix) choix.toggleAttribute("hidden", jaiDepose);
    if (!jaiDepose) rendEquipeDirect();
    if (bVal) {
      var lesDeux = mienne && sienne;
      var dejaPret = mienne && mienne.pret;
      bVal.toggleAttribute("hidden", !(jaiDepose && lesDeux && !dejaPret));
    }
  }

  function dirStatut(msg) { var s = $("echangeRoomStatut"); if (s) s.innerHTML = msg; }

  function majBadge() {
    var n = recus.length + invites.length;
    [].forEach.call(document.querySelectorAll(".js-ech-badge"), function (b) {
      if (n > 0) { b.textContent = n; b.removeAttribute("hidden"); } else b.setAttribute("hidden", "");
    });
    var tr = $("echangeBadgeOnglet"); if (tr) { if (recus.length > 0) { tr.textContent = recus.length; tr.removeAttribute("hidden"); } else tr.setAttribute("hidden", ""); }
    var td = $("echangeBadgeOngletDirect"); if (td) { if (invites.length > 0) { td.textContent = invites.length; td.removeAttribute("hidden"); } else td.setAttribute("hidden", ""); }
  }

  function montreOnglet(o) {
    onglet = o;
    [["echangeTabEnvoyer", "envoyer"], ["echangeTabRecus", "recus"], ["echangeTabDirect", "direct"]].forEach(function (p) {
      var el = $(p[0]); if (el) el.classList.toggle("actif", o === p[1]);
    });
    [["echangeSectionEnvoyer", "envoyer"], ["echangeSectionRecus", "recus"], ["echangeSectionDirect", "direct"]].forEach(function (p) {
      var el = $(p[0]); if (el) el.toggleAttribute("hidden", o !== p[1]);
    });
    if (o === "envoyer") { rendEquipe(); rendAmis("echangeAmiSelect"); }
    else if (o === "recus") rendRecus();
    else { rendAmis("echangeDirectAmi"); rendInvites(); if (salon && !salon.fini) { $("echangeDirectIdle").setAttribute("hidden", ""); $("echangeDirectRoom").removeAttribute("hidden"); } else { $("echangeDirectIdle").removeAttribute("hidden"); $("echangeDirectRoom").setAttribute("hidden", ""); } }
  }

  function ouvre() {
    assureAbonnement();
    var p = $("echangePanel"); if (!p) return;
    p.removeAttribute("hidden");
    var st = $("echangeStatut"); if (st) st.textContent = "";
    var st2 = $("echangeStatut2"); if (st2) st2.textContent = "";
    montreOnglet(salon && !salon.fini ? "direct" : "envoyer");
  }
  function ferme() { var p = $("echangePanel"); if (p) p.setAttribute("hidden", ""); }

  function connectDb(database) {
    db = database;
    assureAbonnement();
    setInterval(assureAbonnement, 3000);
  }

  document.addEventListener("DOMContentLoaded", function () {
    [].forEach.call(document.querySelectorAll(".js-ech-open"), function (b) { b.addEventListener("click", ouvre); });
    [].forEach.call(document.querySelectorAll(".js-combat"), function (b) { b.addEventListener("click", function () { window.alert("Système de combat en construction…"); }); });
    var bf = $("echangeBtnFermer"); if (bf) bf.addEventListener("click", ferme);
    var te = $("echangeTabEnvoyer"); if (te) te.addEventListener("click", function () { montreOnglet("envoyer"); });
    var tr = $("echangeTabRecus"); if (tr) tr.addEventListener("click", function () { montreOnglet("recus"); });
    var td = $("echangeTabDirect"); if (td) td.addEventListener("click", function () { montreOnglet("direct"); });
    var be = $("echangeBtnEnvoyer"); if (be) be.addEventListener("click", envoyer);
    var bi = $("echangeDirectInviter"); if (bi) bi.addEventListener("click", inviter);
    var bj = $("echangeDirectRejoindre"); if (bj) bj.addEventListener("click", function () { rejoindreCode(($("echangeDirectCode") || {}).value || "", null); });
    var bdep = $("echangeBtnDeposer"); if (bdep) bdep.addEventListener("click", deposer);
    var bval = $("echangeBtnValider"); if (bval) bval.addEventListener("click", valider);
    var bq = $("echangeBtnQuitterSalon"); if (bq) bq.addEventListener("click", quitterSalon);
    var p = $("echangePanel"); if (p) p.addEventListener("click", function (e) { if (e.target === p) ferme(); });
    ["echangeTagInput", "echangeDirectTag", "echangeDirectCode"].forEach(function (id) {
      var el = $(id); if (el) ["keydown", "keyup", "keypress"].forEach(function (t) { el.addEventListener(t, function (e) { e.stopPropagation(); }); });
    });
  });

  V.echange = { connectDb: connectDb, ouvre: ouvre, lireEquipe: lireEquipe };
})(window);
