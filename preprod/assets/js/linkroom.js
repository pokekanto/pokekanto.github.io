(function (window) {
  "use strict";

  // Cable Club — lobby de matchmaking multijoueur.
  // Phase 1 : détection de map, présence Firebase, envoi/réception de défis.
  // Phase 2 (à venir) : émulation câble link SIO via WebRTC pour vrais combats.

  const state    = window.Valdoria.state;
  const CLE_MAP  = "valdoria.linkroom.map";   // "g,m" stocké en localStorage
  const CLE_AMIS = "valdoria.tagsAmis";        // partagée avec tchat.js
  const DUREE_PRESENCE_MS = 120000;            // 2 min sans mise à jour = parti
  const DUREE_DEFI_MS     = 30000;             // un défi expire après 30 s
  const CLE_ATTENTE = "valdoria.attenteMoy";   // moyenne du temps d'attente (localStorage)
  const ATTENTE_DEFAUT_MS = 30000;             // estimation par défaut sans historique

  let db       = null;
  let monId    = null;
  let monTag   = null;
  let monRef   = null;    // monde/linkroom/<monId>
  let defiRef  = null;    // monde/defis/<monId>  (défis reçus)
  let defiRecu = null;    // données du défi en attente
  let decalageServeur = 0; // serverTimeOffset Firebase (corrige le decalage horloge client/serveur)
  let dansLinkRoom = false;
  let modeDefi = "combat";   // "combat" ou "echange" selon le bouton cliqué
  let fileRef      = null;   // écoute de monde/linkroom (file d'attente)
  let enFile       = false;  // suis-je dans la file aléatoire ?
  let typeFile     = "combat";
  let tsEntreeFile = 0;      // heure serveur estimée d'entrée en file
  let estimationMs = 30000;
  let compteFin    = 0;      // horodatage de fin du décompte estimé
  let compteTimer  = null;
  let apparieTimer = null;
  let cableTimer   = null;   // rafraichit le compteur d'echanges cable

  /* ---- Map Cable Club ------------------------------------------ */
  function chargeMap() {
    try {
      const v = window.localStorage.getItem(CLE_MAP);
      if (v) {
        const parts = v.split(",").map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]))
          return { g: parts[0], m: parts[1] };
      }
    } catch (e) {}
    return null;
  }

  let mapLinkRoom = chargeMap();

  function sauveMap(g, m) {
    try { window.localStorage.setItem(CLE_MAP, g + "," + m); } catch (e) {}
    mapLinkRoom = { g, m };
  }

  function estSurMap(pos) {
    return !!(mapLinkRoom && pos &&
      pos.g === mapLinkRoom.g && pos.m === mapLinkRoom.m);
  }

  /* ---- Amis en ligne ------------------------------------------ */
  function chargeAmis() {
    try { return JSON.parse(window.localStorage.getItem(CLE_AMIS) || "[]"); }
    catch (e) { return []; }
  }

  function amisEnLigne() {
    const amis = chargeAmis();
    return Object.entries(state.joueurs || {})
      .filter(([, j]) => j.tag && amis.includes(j.tag))
      .map(([id, j]) => ({ id, pseudo: j.nom, tag: j.tag }));
  }

  /* ---- Présence Firebase -------------------------------------- */
  function rejoindre() {
    if (!db || !monId) return;
    monRef = db.ref("monde/linkroom/" + monId);
    monRef.onDisconnect().remove();
    monRef.set({
      pseudo: (state.myPos && state.myPos.nom) || "Dresseur",
      tag: monTag || "",
      ts: firebase.database.ServerValue.TIMESTAMP
    });
  }

  // Ecoute des defis entrants : active des la CONNEXION (meme si le lobby est
  // ferme) -> on recoit un defi d'ami a tout moment qu'on est en ligne.
  function ecouteDefis() {
    if (!db || !monId || defiRef) return;
    defiRef = db.ref("monde/defis/" + monId);
    defiRef.on("value", s => {
      const d = s.val();
      if (!d) { defiRecu = null; cacherDefi(); return; }
      if ((Date.now() + decalageServeur) - (d.ts || 0) > DUREE_DEFI_MS) { defiRef.remove(); return; }
      if (d.accepte) { afficherAccepte(d); return; }
      defiRecu = d;
      if (d.aleatoire && enFile) { quitterFile(false); accepterDefi(); return; }
      afficherDefi(d);
    });
  }

  function partir() {
    quitterFile(false);
    if (monRef) { monRef.remove(); monRef = null; }
    // defiRef reste actif (ecoute permanente des defis) -> reception meme lobby ferme
    cacherAttente();
  }

  /* ---- Matchmaking -------------------------------------------- */
  // File d'attente FIFO : le 1er inscrit est apparié en premier dès qu'un 2e arrive.
  function rejoindreFile(type) {
    if (!db || !monId) return;
    if (!monRef) rejoindre();              // s'assure d'être présent dans la salle
    typeFile = type || "combat";
    enFile = true;
    tsEntreeFile = Date.now() + decalageServeur;
    // On marque la recherche DANS la présence (monde/linkroom est déjà autorisé) :
    if (monRef) monRef.update({ recherche: typeFile, rechercheTs: firebase.database.ServerValue.TIMESTAMP });
    afficherRecherche(typeFile);
    estimerAttente();
    ecouterFile();
  }

  function ecouterFile() {
    if (fileRef) fileRef.off();
    fileRef = db.ref("monde/linkroom");
    fileRef.on("value", s => {
      if (!enFile) return;
      const tous = s.val() || {};
      const liste = Object.entries(tous)
        .filter(([, d]) => d && d.recherche === typeFile && d.rechercheTs)
        .filter(([, d]) => (Date.now() + decalageServeur) - (d.rechercheTs || 0) < DUREE_PRESENCE_MS)
        .sort((a, b) => (a[1].rechercheTs || 0) - (b[1].rechercheTs || 0));
      majEstimationFile(liste);
      if (liste.length < 2) return;
      // Seuls les deux plus anciens se matchent ; le 1er inscrit (liste[0]) initie.
      if (liste[0][0] === monId) apparier(liste[1][0], liste[1][1]);
    });
  }

  function apparier(cibleId, cibleD) {
    enFile = false;
    if (fileRef) { fileRef.off(); fileRef = null; }
    arreterDecompte();
    enregistrerAttente((Date.now() + decalageServeur) - tsEntreeFile);
    if (monRef) monRef.update({ recherche: null, rechercheTs: null });
    envoyerDefi(cibleId, (cibleD && cibleD.pseudo) || "Adversaire", typeFile, true);
    // Si le partenaire n'accepte pas à temps (onglet fermé...), on se remet en file.
    if (apparieTimer) clearTimeout(apparieTimer);
    apparieTimer = setTimeout(() => {
      const r = db.ref("monde/defis/" + cibleId);
      r.once("value", snap => { if (snap.val() && !snap.val().accepte) r.remove(); });
      rejoindreFile(typeFile);
    }, 15000);
  }

  function quitterFile(retourLobby) {
    enFile = false;
    if (fileRef) { fileRef.off(); fileRef = null; }
    if (apparieTimer) { clearTimeout(apparieTimer); apparieTimer = null; }
    arreterDecompte();
    if (monRef) monRef.update({ recherche: null, rechercheTs: null });
    if (retourLobby) cacherAttente();
  }

  /* Estimation du temps d'attente : moyenne historique + état de la file. */
  function estimerAttente() {
    let moy = ATTENTE_DEFAUT_MS;
    try { const v = parseInt(window.localStorage.getItem(CLE_ATTENTE), 10); if (v > 0) moy = v; } catch (e) {}
    estimationMs = moy;
    demarrerDecompte();
  }

  function majEstimationFile(liste) {
    const autres = liste.filter(([id]) => id !== monId).length;
    if (autres >= 1) {
      const cible = Date.now() + 5000;   // quelqu'un attend déjà -> match imminent
      if (compteFin === 0 || cible < compteFin) { compteFin = cible; rafraichirDecompte(); }
    }
  }

  function enregistrerAttente(ms) {
    if (ms < 0 || ms > 600000) return;
    try {
      const prev = parseInt(window.localStorage.getItem(CLE_ATTENTE), 10) || ms;
      const moy = Math.round(prev * 0.7 + ms * 0.3);   // moyenne glissante
      window.localStorage.setItem(CLE_ATTENTE, String(moy));
    } catch (e) {}
  }

  function demarrerDecompte() {
    compteFin = Date.now() + estimationMs;
    rafraichirDecompte();
    if (compteTimer) clearInterval(compteTimer);
    compteTimer = setInterval(rafraichirDecompte, 1000);
  }

  function rafraichirDecompte() {
    const c = el("linkroomAttenteCompte");
    if (!c) return;
    const reste = Math.max(0, Math.round((compteFin - Date.now()) / 1000));
    c.innerHTML = (reste > 0)
      ? "Temps d'attente estimé : <span>~" + reste + " s</span>"
      : "Toujours en recherche… <span>ça arrive</span>";
  }

  function arreterDecompte() {
    if (compteTimer) { clearInterval(compteTimer); compteTimer = null; }
  }

  function genSessionId() {
    return monId + "-" + Math.random().toString(36).slice(2, 8);
  }

  function envoyerDefi(cibleId, ciblePseudo, type, aleatoire) {
    if (!db || !monId) return;
    const sid = genSessionId();
    db.ref("monde/defis/" + cibleId).set({
      de: monId,
      pseudo: (state.myPos && state.myPos.nom) || "Dresseur",
      tag: monTag || "",
      type: type || "combat",
      sid,                      // session WebRTC partagée
      aleatoire: !!aleatoire,   // match de la file -> auto-accept côté receveur
      ts: firebase.database.ServerValue.TIMESTAMP
    });
    afficherAttente(ciblePseudo, type || "combat");

    // Écouter l'acceptation pour lancer la session SIO en tant que maître
    const monDefiRef = db.ref("monde/defis/" + monId);
    monDefiRef.on("value", snap => {
      const d = snap.val();
      if (!d || !d.accepte) return;
      monDefiRef.off();
      monDefiRef.remove();
      lancerSioLink(sid, true, type || "combat");
    });
  }

  function accepterDefi() {
    if (!defiRecu || !db) return;
    const type = defiRecu.type || "combat";
    const sid  = defiRecu.sid  || ("fallback-" + Date.now());
    // Notifie l'adversaire (maître) que c'est accepté
    db.ref("monde/defis/" + defiRecu.de).set({
      accepte: true,
      type,
      sid,
      de: monId,
      pseudo: (state.myPos && state.myPos.nom) || "Dresseur",
      tag: monTag || "",
      ts: firebase.database.ServerValue.TIMESTAMP
    });
    if (defiRef) defiRef.remove();
    defiRecu = null;
    cacherDefi();
    // Lancer la session SIO en tant qu'esclave
    lancerSioLink(sid, false, type);
  }

  function lancerSioLink(sid, master, type) {
    const siolink = window.Valdoria.siolink;
    if (!siolink || !db) { afficherPhase2(type); return; }

    afficherConnexion(type);

    siolink.connect(
      db,
      sid,
      master,
      () => {
        // Canal WebRTC ouvert — câble link établi
        afficherCableOuvert(type);
      },
      err => {
        afficherErreurSio(err);
      }
    );
  }

  function refuserDefi() {
    if (defiRef) defiRef.remove();
    defiRecu = null;
    cacherDefi();
  }

  /* ---- UI ----------------------------------------------------- */
  function el(id) { return document.getElementById(id); }

  function rafraichirAmis() {
    const listeEl = el("linkroomAmisListe");
    if (!listeEl) return;
    const amis = amisEnLigne();
    listeEl.innerHTML = "";
    if (!amis.length) {
      const vide = document.createElement("em");
      vide.textContent = "Aucun ami en ligne dans la salle";
      listeEl.appendChild(vide);
    } else {
      amis.forEach(a => {
        const btn = document.createElement("button");
        btn.className = "linkroom-ami-btn";
        const nom = document.createElement("span");
        nom.textContent = "⚔️ " + a.pseudo;
        const tag = document.createElement("span");
        tag.className = "linkroom-tag-label";
        tag.textContent = a.tag;
        btn.appendChild(nom);
        btn.appendChild(tag);
        btn.addEventListener("click", () => envoyerDefi(a.id, a.pseudo, modeDefi));
        listeEl.appendChild(btn);
      });
    }
  }

  function afficherLobby() {
    rafraichirAmis();
    const panel = el("linkroomPanel");
    if (panel) panel.removeAttribute("hidden");
    const lobby = el("linkroomLobby");
    if (lobby) lobby.removeAttribute("hidden");
    cacherAttente();
  }

  function cacherLobby() {
    if (cableTimer) { clearInterval(cableTimer); cableTimer = null; }
    const panel = el("linkroomPanel");
    if (panel) panel.setAttribute("hidden", "");
    cacherAttente();
    cacherDefi();
  }

  function afficherDefi(d) {
    const nom = el("linkroomDefiNom");
    if (nom) nom.textContent = d.pseudo || "Dresseur";
    const texte = el("linkroomDefiTexte");
    if (texte) texte.textContent = d.type === "echange"
      ? "veut échanger des Pokémon avec toi !"
      : "te défie en combat !";
    const panel = el("linkroomDefiPanel");
    if (panel) panel.removeAttribute("hidden");
  }

  function cacherDefi() {
    const panel = el("linkroomDefiPanel");
    if (panel) panel.setAttribute("hidden", "");
  }

  function resetAttenteElems() {
    ["linkroomAttenteTitre", "linkroomAttenteCompte", "linkroomBtnAnnulerFile"].forEach(function (id) {
      const e = el(id); if (e) e.setAttribute("hidden", "");
    });
  }

  function afficherRecherche(type) {
    const lobby = el("linkroomLobby");
    if (lobby) lobby.setAttribute("hidden", "");
    const titre = el("linkroomAttenteTitre");
    if (titre) {
      titre.textContent = (type === "echange") ? "Recherche d'un partenaire d'échange" : "Recherche d'un adversaire";
      titre.removeAttribute("hidden");
    }
    const msg = el("linkroomAttenteMsg");
    if (msg) msg.textContent = "🔍 Mise en relation…";
    const compte = el("linkroomAttenteCompte");
    if (compte) compte.removeAttribute("hidden");
    const annuler = el("linkroomBtnAnnulerFile");
    if (annuler) annuler.removeAttribute("hidden");
    const att = el("linkroomAttente");
    if (att) att.removeAttribute("hidden");
  }

  function afficherAttente(pseudo, type) {
    resetAttenteElems();
    const lobby = el("linkroomLobby");
    if (lobby) lobby.setAttribute("hidden", "");
    const msg = el("linkroomAttenteMsg");
    if (msg) {
      if (pseudo && type === "echange") msg.textContent = "Demande d'échange envoyée à " + pseudo + "…";
      else if (pseudo) msg.textContent = "Défi envoyé à " + pseudo + "…";
      else msg.textContent = "En attente d'un adversaire…";
    }
    const att = el("linkroomAttente");
    if (att) att.removeAttribute("hidden");
  }

  function cacherAttente() {
    resetAttenteElems();
    arreterDecompte();
    const att = el("linkroomAttente");
    if (att) att.setAttribute("hidden", "");
    const lobby = el("linkroomLobby");
    if (lobby) lobby.removeAttribute("hidden");
  }

  function afficherAccepte(d) {
    resetAttenteElems();
    const lobby = el("linkroomLobby");
    if (lobby) lobby.setAttribute("hidden", "");
    const msg = el("linkroomAttenteMsg");
    const action = d.type === "echange" ? "l'échange" : "le combat";
    if (msg) msg.textContent = "✅ " + (d.pseudo || "Adversaire") + " a accepté " + action + " ! (câble link en développement…)";
    const att = el("linkroomAttente");
    if (att) att.removeAttribute("hidden");
  }

  function afficherPhase2(type) {
    resetAttenteElems();
    cacherDefi();
    const lobby = el("linkroomLobby");
    if (lobby) lobby.setAttribute("hidden", "");
    const msg = el("linkroomAttenteMsg");
    const action = type === "echange" ? "l'échange" : "le combat";
    if (msg) msg.textContent = "🔗 Connexion pour " + action + " établie !";
    const att = el("linkroomAttente");
    if (att) att.removeAttribute("hidden");
  }

  function afficherConnexion(type) {
    resetAttenteElems();
    const lobby = el("linkroomLobby");
    if (lobby) lobby.setAttribute("hidden", "");
    const msg = el("linkroomAttenteMsg");
    const action = type === "echange" ? "l'échange" : "le combat";
    if (msg) msg.textContent = "⏳ Établissement du câble link pour " + action + "…";
    const att = el("linkroomAttente");
    if (att) att.removeAttribute("hidden");
  }

  function afficherCableOuvert(type) {
    const msg = el("linkroomAttenteMsg");
    const action = (type === "echange") ? "l'échange" : "le combat";
    function maj() {
      const n = (window.ValdoriaLink && window.ValdoriaLink.nb) || 0;
      if (msg) msg.textContent = "🔗 Câble branché ! Parle au PNJ pour " + action + ". (échanges câble : " + n + ")";
    }
    maj();
    if (cableTimer) clearInterval(cableTimer);
    cableTimer = setInterval(maj, 1000);
  }

  function afficherErreurSio(err) {
    const msg = el("linkroomAttenteMsg");
    if (msg) msg.textContent = "❌ Connexion échouée : " + (err || "erreur inconnue");
  }

  /* ---- Détection de map --------------------------------------- */
  // Le Cable Club s'ouvre desormais via un BOUTON (ouvrir), accessible de PARTOUT
  // dans le jeu : plus de map a enregistrer, plus de modal qui s'impose tout seul.
  // check() reste appelee par app.js mais ne fait plus rien.
  function check(pos) {}

  function ouvrir() {
    afficherLobby();
    if (db && monId && !dansLinkRoom) { dansLinkRoom = true; rejoindre(); }
  }

  /* ---- Init publique ----------------------------------------- */
  function connectDb(database, id) {
    db = database;
    db.ref(".info/serverTimeOffset").on("value", function (s) { decalageServeur = s.val() || 0; });
    monId = id;
    ecouteDefis();   // ecoute les defis entrants des maintenant (meme lobby ferme)
  }

  function definitTag(tag) {
    monTag = tag;
    // Met à jour la présence si déjà dans la salle
    if (monRef && tag) monRef.update({ tag });
  }

  /* ---- Salon privé (liaison directe par code) ---------------- */
  function genCodeSalon() {
    var c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "";
    for (var i = 0; i < 4; i++) s += c.charAt(Math.floor(Math.random() * c.length));
    return s;
  }
  function creerSalonPrive() {
    var code = genCodeSalon();
    lancerSioLink("priv-" + code, true, modeDefi);
    // afficherConnexion (dans lancerSioLink) masque le lobby -> on remet le code
    // dans l'ecran d'attente, qui reste visible jusqu'a la connexion.
    var msg = el("linkroomAttenteMsg");
    if (msg) msg.textContent = "Salon créé — Code : " + code + " (donne-le à l'autre joueur, puis attendez la connexion…)";
  }
  function rejoindreSalonPrive() {
    var inp = el("linkroomCodeInput");
    var code = ((inp && inp.value) || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { if (inp) { inp.value = ""; inp.placeholder = "Code à 4 caractères"; } return; }
    lancerSioLink("priv-" + code, false, modeDefi);
  }

  /* ---- Bindings UI ------------------------------------------- */
  function initUI() {
    const btnAlea     = el("linkroomBtnAlea");
    const btnAmi      = el("linkroomBtnAmi");
    const secAmis     = el("linkroomSectionAmis");
    const btnAnnuler  = el("linkroomBtnAnnuler");
    const btnAccepter = el("linkroomBtnAccepter");
    const btnRefuser  = el("linkroomBtnRefuser");
    const btnSaveMap  = el("linkroomBtnSaveMap");
    const btnSaveMap2 = el("linkroomBtnSaveMap2");

    if (btnAlea) btnAlea.addEventListener("click", function () { rejoindreFile("combat"); });

    const btnEchange = el("linkroomBtnEchange");

    if (btnAmi && secAmis) btnAmi.addEventListener("click", () => {
      const dejaCombat = !secAmis.hasAttribute("hidden") && modeDefi === "combat";
      modeDefi = "combat";
      if (dejaCombat) { secAmis.setAttribute("hidden", ""); return; }
      rafraichirAmis();
      secAmis.removeAttribute("hidden");
    });

    if (btnEchange && secAmis) btnEchange.addEventListener("click", () => {
      const dejaEchange = !secAmis.hasAttribute("hidden") && modeDefi === "echange";
      modeDefi = "echange";
      if (dejaEchange) { secAmis.setAttribute("hidden", ""); return; }
      rafraichirAmis();
      secAmis.removeAttribute("hidden");
    });

    const btnPrive = el("linkroomBtnPrive");
    const secPrive = el("linkroomSectionPrive");
    if (btnPrive && secPrive) btnPrive.addEventListener("click", () => {
      if (secPrive.hasAttribute("hidden")) secPrive.removeAttribute("hidden");
      else secPrive.setAttribute("hidden", "");
    });
    const btnCreer = el("linkroomBtnCreer");
    if (btnCreer) btnCreer.addEventListener("click", creerSalonPrive);
    const btnRejoindre = el("linkroomBtnRejoindre");
    if (btnRejoindre) btnRejoindre.addEventListener("click", rejoindreSalonPrive);

    if (btnAnnuler) btnAnnuler.addEventListener("click", () => {
      partir();
      cacherLobby();
      dansLinkRoom = false;
    });

    const btnAnnulerFile = el("linkroomBtnAnnulerFile");
    if (btnAnnulerFile) btnAnnulerFile.addEventListener("click", () => quitterFile(true));

    if (btnAccepter) btnAccepter.addEventListener("click", accepterDefi);
    if (btnRefuser)  btnRefuser.addEventListener("click", refuserDefi);

    if (btnSaveMap) btnSaveMap.addEventListener("click", () => {
      const pos = state.myPos;
      if (!pos) {
        btnSaveMap.textContent = "⚠️ Lance d’abord le jeu !";
        setTimeout(() => { btnSaveMap.textContent = "📍 Enregistrer cette map"; }, 2000);
        return;
      }
      sauveMap(pos.g, pos.m);
      btnSaveMap.textContent = "✅ Map " + pos.g + "." + pos.m + " enregistrée";
      // Map enregistrée : plus besoin du panneau config
      const cfg = el("linkroomConfigPanel");
      if (cfg) cfg.setAttribute("hidden", "");
      setTimeout(() => { btnSaveMap.textContent = "📍 Enregistrer cette map"; }, 3000);
    });

    // Boutons "Cable Club" (action bar PC + drawer mobile) -> ouvrent le lobby,
    // accessible de PARTOUT dans le jeu.
    if (btnSaveMap2) btnSaveMap2.addEventListener("click", ouvrir);
    const drawerCC = el("drawerLinkroomBtn2");
    if (drawerCC) drawerCC.addEventListener("click", ouvrir);
  }

  document.addEventListener("DOMContentLoaded", initUI);

  window.Valdoria.linkroom = { connectDb, check, definitTag, sauveMap, ouvrir };
})(window);
