(function (window) {
  "use strict";

  // Monde partagé : tous les visiteurs du site se retrouvent dans le même
  // monde via Firebase Realtime Database (gratuit, clés publiques par
  // conception). Chaque joueur écrit sa position dans monde/joueurs/<id>
  // et écoute celles des autres. onDisconnect() retire automatiquement un
  // joueur qui ferme l'onglet ; on ignore aussi les entrées trop vieilles
  // au cas où ce nettoyage n'aurait pas pu s'exécuter.

  const { $, setStatus } = window.Valdoria.dom;
  const state = window.Valdoria.state;

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDwiuOe8Rzf0ByZzvGRUbh4UFrSZOqS1z8",
    authDomain: "pokekanto.firebaseapp.com",
    databaseURL: "https://pokekanto-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "pokekanto"
  };
  const VIEUX_MS = 70000;     // au-delà : joueur considéré déconnecté
  const ENVOI_MIN_MS = 150;   // pas plus d'une écriture toutes les 150 ms

  let monRef = null;
  let monId = null;
  let dernierEnvoi = 0;
  let dernierePos = null;

  // Le nom lu dans la partie fait foi ; le champ libre ne sert que tant
  // que la partie n'a pas encore livré son nom (menu titre, intro).
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
    champ.title = "Nom de ta partie — non modifiable";
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
      ? "🌍 Connecté au monde — tu es seul pour l'instant."
      : "🌍 Connecté au monde — " + (n + 1) + " joueurs en ligne.");
  }

  function connectWorld() {
    if (state.monde) return;
    if (typeof firebase === "undefined") {
      setStatus("Service de jeu en ligne indisponible (Firebase non chargé).");
      return;
    }

    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.database();
    state.monde = db;
    monId = "j" + Math.random().toString(36).slice(2, 10);
    monRef = db.ref("monde/joueurs/" + monId);
    monRef.onDisconnect().remove();

    const joueursRef = db.ref("monde/joueurs");
    joueursRef.on("child_added", s => { if (s.key !== monId) { majJoueur(s.key, s.val()); majStatut(); } });
    joueursRef.on("child_changed", s => { if (s.key !== monId) majJoueur(s.key, s.val()); });
    joueursRef.on("child_removed", s => { delete state.joueurs[s.key]; majStatut(); });

    if (window.Valdoria.tchat) window.Valdoria.tchat.connect(db, pseudo);
    if (window.Valdoria.linkroom) window.Valdoria.linkroom.connectDb(db, monId);
  if (window.Valdoria.cloudsave) window.Valdoria.cloudsave.connectDb(db);

    db.ref(".info/connected").on("value", s => {
      if (s.val()) majStatut();
      else setStatus("Connexion au monde perdue, reconnexion…");
    });

    // purge des joueurs fantômes (onglet tué sans onDisconnect)
    setInterval(() => {
      const limite = Date.now() - VIEUX_MS;
      for (const id of Object.keys(state.joueurs))
        if (state.joueurs[id].t < limite) { delete state.joueurs[id]; majStatut(); }
    }, 10000);

    $("playerName").addEventListener("change", () => {
      try { window.localStorage.setItem("valdoria.pseudo", $("playerName").value.trim()); } catch (e) {}
      if (dernierePos) { dernierePos = null; sendPos(state.myPos); }
    });
  }

  // Appelé en continu par app.js : n'écrit que si quelque chose a changé,
  // plus un battement de cœur périodique pour rester "frais".
  function sendPos(pos) {
    if (!monRef || !pos) return;
    const now = Date.now();
    if (pos.nom) verrouillePseudo(pos.nom);
    const meme = dernierePos &&
      dernierePos.x === pos.x && dernierePos.y === pos.y &&
      dernierePos.g === pos.g && dernierePos.m === pos.m &&
      dernierePos.nom === (pos.nom || null);
    if (meme && now - dernierEnvoi < 30000) return;
    if (now - dernierEnvoi < ENVOI_MIN_MS) return;
    dernierEnvoi = now;
    dernierePos = { x: pos.x, y: pos.y, g: pos.g, m: pos.m, nom: pos.nom || null };
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
