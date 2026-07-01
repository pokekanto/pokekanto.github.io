(function (window) {
  "use strict";

  // Monde partage via Firebase Realtime Database.
  // ECO (2026) : la presence est DECOUPEE PAR CARTE ("sharding"). Les regles
  // Firebase imposent une structure PLATE sous monde/joueurs, donc on encode la
  // carte dans la CLE : monde/joueurs/"<g_m>|<id>". Chacun ne s'abonne qu'aux
  // cles de SA carte via une requete de plage
  // orderByKey().startAt("<g_m>|").endAt("<g_m>|"). Resultat : on ne
  // telecharge QUE les joueurs de sa carte (ceux qu'on affiche vraiment), au
  // lieu du monde entier -> economie d'environ 100x en bande passante. Le
  // payload reste identique (les regles valident nom/x/y/g/m/sexe/t).
  // onDisconnect() retire le joueur qui ferme l'onglet ; on ignore aussi les
  // entrees trop vieilles au cas ou ce nettoyage n'aurait pas pu tourner.

  const { $, setStatus } = window.Valdoria.dom;
  const state = window.Valdoria.state;

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDwiuOe8Rzf0ByZzvGRUbh4UFrSZOqS1z8",
    authDomain: "pokekanto.firebaseapp.com",
    databaseURL: "https://pokekanto-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "pokekanto"
  };
  const VIEUX_MS = 70000;     // au-dela : joueur considere deconnecte
  const ENVOI_MIN_MS = 250;   // eco : au plus une ecriture toutes les 250 ms (etait 150)
  const FIN = "";       // sentinelle de fin de prefixe (requete de plage)

  let db = null;
  let monId = null;
  let zoneActuelle = null;    // "<g_m>" de la carte courante
  let monKey = null;          // "<zone>|<id>"
  let monRef = null;          // ref d'ecriture (cle composite)
  let zoneQuery = null;       // requete d'abonnement (plage de la zone)
  let dernierEnvoi = 0;
  let dernierePos = null;

  // Le nom lu dans la partie fait foi ; le champ libre ne sert que tant que la
  // partie n'a pas encore livre son nom (menu titre, intro).
  function pseudo() {
    if (state.myPos && state.myPos.nom) return state.myPos.nom;
    const saisi = $("playerName").value.trim().slice(0, 16);
    return saisi || "Dresseur-" + monId.slice(-4).toUpperCase();
  }

  function verrouillePseudo(nom) {
    if (window.Valdoria.tchat) window.Valdoria.tchat.definitNom(nom);
    const champ = $("playerName");
    if (champ.disabled && champ.value === nom) return;
    champ.value = nom;
    champ.disabled = true;
    champ.title = "Nom de ta partie - non modifiable";
  }

  function majJoueur(id, d) {
    if (!d || typeof d.x !== "number" || typeof d.y !== "number") return;
    let j = state.joueurs[id];
    if (!j) {
      j = state.joueurs[id] = {
        nom: "", g: -1, m: -1, tx: 0, ty: 0, lastTx: null, lastTy: null,
        dx: 0, dy: 0, visible: false, direction: "down", movingUntil: 0,
        sexe: null, t: 0
      };
    }
    const prevX = j.lastTx === null ? d.x : j.tx;
    const prevY = j.lastTy === null ? d.y : j.ty;
    j.nom = d.nom || "Dresseur";
    j.lastTx = j.tx; j.lastTy = j.ty;
    j.g = d.g; j.m = d.m; j.tx = d.x; j.ty = d.y;
    j.sexe = d.sexe === 0 || d.sexe === 1 ? d.sexe : null;
    j.tag = d.tag || null;
    j.t = d.t || Date.now();
    if (d.x !== prevX || d.y !== prevY) {
      if (Math.abs(d.x - prevX) >= Math.abs(d.y - prevY))
        j.direction = d.x > prevX ? "right" : "left";
      else
        j.direction = d.y > prevY ? "down" : "up";
      j.movingUntil = Date.now() + 500;
    }
  }

  function majStatut() {
    const n = Object.keys(state.joueurs).length;
    setStatus(n === 0
      ? "🌍 Connecte au monde - personne d'autre sur ta carte."
      : "🌍 Connecte au monde - " + n + " autre" + (n > 1 ? "s" : "") + " sur ta carte.");
  }

  // Quitter la zone courante : retrait immediat + desabonnement + oubli des voisins.
  function quitteZone() {
    if (monRef) {
      try { monRef.onDisconnect().cancel(); } catch (e) {}
      try { monRef.remove(); } catch (e) {}
      monRef = null;
    }
    if (zoneQuery) { try { zoneQuery.off(); } catch (e) {} zoneQuery = null; }
    for (const k of Object.keys(state.joueurs)) delete state.joueurs[k];
  }

  // Rejoindre une zone (carte) : abonnement aux SEULS joueurs de cette carte.
  function entreZone(zk) {
    zoneActuelle = zk;
    monKey = zk + "|" + monId;
    monRef = db.ref("monde/joueurs/" + monKey);
    monRef.onDisconnect().remove();
    zoneQuery = db.ref("monde/joueurs").orderByKey().startAt(zk + "|").endAt(zk + "|" + FIN);
    zoneQuery.on("child_added", s => { if (s.key !== monKey) { majJoueur(s.key, s.val()); majStatut(); } });
    zoneQuery.on("child_changed", s => { if (s.key !== monKey) majJoueur(s.key, s.val()); });
    zoneQuery.on("child_removed", s => { delete state.joueurs[s.key]; majStatut(); });
    dernierEnvoi = 0; dernierePos = null;   // forcer une 1re ecriture dans la nouvelle zone
    majStatut();
  }

  function connectWorld() {
    if (state.monde) return;
    if (typeof firebase === "undefined") {
      setStatus("Service de jeu en ligne indisponible (Firebase non charge).");
      return;
    }

    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    state.monde = db;
    monId = "j" + Math.random().toString(36).slice(2, 10);

    if (window.Valdoria.tchat) window.Valdoria.tchat.connect(db, pseudo);
    if (window.Valdoria.linkroom) window.Valdoria.linkroom.connectDb(db, monId);
    if (window.Valdoria.cloudsave) window.Valdoria.cloudsave.connectDb(db);
    if (window.Valdoria.echange) window.Valdoria.echange.connectDb(db);

    db.ref(".info/connected").on("value", s => {
      if (s.val()) majStatut();
      else setStatus("Connexion au monde perdue, reconnexion...");
    });

    // purge des voisins fantomes (onglet tue sans onDisconnect) sur la zone courante
    setInterval(() => {
      const limite = Date.now() - VIEUX_MS;
      for (const k of Object.keys(state.joueurs))
        if (state.joueurs[k].t < limite) { delete state.joueurs[k]; majStatut(); }
    }, 10000);

    $("playerName").addEventListener("change", () => {
      try { window.localStorage.setItem("valdoria.pseudo", $("playerName").value.trim()); } catch (e) {}
      if (state.myPos) { dernierePos = null; sendPos(state.myPos); }
    });
  }

  // Appele en continu par app.js : bascule de zone si on a change de carte, puis
  // n'ecrit que si quelque chose a change (+ un battement toutes les 30 s).
  function sendPos(pos) {
    if (!db || !monId || !pos) return;
    if (typeof pos.g !== "number" || typeof pos.m !== "number") return;
    const zk = pos.g + "_" + pos.m;
    if (zk !== zoneActuelle) { quitteZone(); entreZone(zk); }
    if (!monRef) return;
    const now = Date.now();
    if (pos.nom) verrouillePseudo(pos.nom);
    const meme = dernierePos &&
      dernierePos.x === pos.x && dernierePos.y === pos.y &&
      dernierePos.nom === (pos.nom || null);
    if (meme && now - dernierEnvoi < 30000) return;
    if (now - dernierEnvoi < ENVOI_MIN_MS) return;
    dernierEnvoi = now;
    dernierePos = { x: pos.x, y: pos.y, nom: pos.nom || null };
    monRef.set({
      nom: pseudo(),
      tag: window.Valdoria.tchat ? window.Valdoria.tchat.getTag() : null,
      x: pos.x, y: pos.y, g: pos.g, m: pos.m,
      sexe: pos.sexe === 0 || pos.sexe === 1 ? pos.sexe : null,
      t: firebase.database.ServerValue.TIMESTAMP
    });
  }

  window.Valdoria.network = { connectWorld, sendPos };
})(window);
