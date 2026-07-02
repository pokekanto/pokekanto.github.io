(function (window) {
  "use strict";

  // Monde partage via Firebase RTDB - ECO + LAYERS (facon WoW).
  // Presence DECOUPEE PAR CARTE *et* PAR LAYER : cle plate imposee par les regles
  //   monde/joueurs/"L<layer>_<g>_<m>|<id>". Chacun ne s'abonne qu'a
  //   "L<layer>_<g>_<m>|" -> ne voit que les joueurs de SON layer ET de sa carte.
  // 3 layers, 200 max chacun ; au-dela = file d'attente (entrees "Q|<id>").
  // Comptage a la demande via requetes de plage (pas en continu -> reste eco) ;
  // on lit snap.val() + Object (le snap.forEach du SDK peut sauter des entrees).
  // Changer de layer = simple re-abonnement -> AUCUN redemarrage du jeu.

  const { $, setStatus } = window.Valdoria.dom;
  const state = window.Valdoria.state;

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDwiuOe8Rzf0ByZzvGRUbh4UFrSZOqS1z8",
    authDomain: "pokekanto.firebaseapp.com",
    databaseURL: "https://pokekanto-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "pokekanto"
  };
  const VIEUX_MS = 70000;
  const ENVOI_MIN_MS = 250;
  const FIN = String.fromCharCode(0xF8FF);   // sentinelle de fin de prefixe (requetes de plage)
  const LAYER_MAX = 200;
  const NB_LAYERS = 3;

  let db = null;
  let monId = null;
  let monLayer = null;        // 1..3, ou null (pas encore place / en file)
  let zoneActuelle = null;
  let monKey = null;
  let monRef = null;
  let zoneQuery = null;
  let dernierEnvoi = 0;
  let dernierePos = null;
  let enFile = false;
  let fileRef = null;
  let filePoll = null;

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
    if (enFile) return;
    const n = Object.keys(state.joueurs).length;
    const suf = monLayer ? " (Layer " + monLayer + ")" : "";
    setStatus(n === 0
      ? "🌍 Connecte au monde" + suf + " - personne d'autre sur ta carte."
      : "🌍 Connecte au monde" + suf + " - " + n + " autre" + (n > 1 ? "s" : "") + " sur ta carte.");
  }

  function quitteZone() {
    if (monRef) {
      try { monRef.onDisconnect().cancel(); } catch (e) {}
      try { monRef.remove(); } catch (e) {}
      monRef = null;
    }
    if (zoneQuery) { try { zoneQuery.off(); } catch (e) {} zoneQuery = null; }
    for (const k of Object.keys(state.joueurs)) delete state.joueurs[k];
  }

  function entreZone(zk) {
    zoneActuelle = zk;
    monKey = zk + "|" + monId;
    monRef = db.ref("monde/joueurs/" + monKey);
    monRef.onDisconnect().remove();
    zoneQuery = db.ref("monde/joueurs").orderByKey().startAt(zk + "|").endAt(zk + "|" + FIN);
    zoneQuery.on("child_added", function (s) { if (s.key !== monKey) { majJoueur(s.key, s.val()); majStatut(); } });
    zoneQuery.on("child_changed", function (s) { if (s.key !== monKey) majJoueur(s.key, s.val()); });
    zoneQuery.on("child_removed", function (s) { delete state.joueurs[s.key]; majStatut(); });
    dernierEnvoi = 0; dernierePos = null;
    majStatut();
  }

  // ---------- LAYERS ----------
  function prefLayer(L) { return "L" + L + "_"; }
  function compteLayer(L) {
    return db.ref("monde/joueurs").orderByKey().startAt(prefLayer(L)).endAt(prefLayer(L) + FIN).once("value").then(function (snap) {
      const val = snap.val() || {}; const limite = Date.now() - VIEUX_MS; let n = 0;
      for (const k in val) { const v = val[k]; if (v && (v.t || 0) > limite) n++; }
      return n;
    }).catch(function () { return 0; });
  }

  function placerAuto() {
    let pref = parseInt(window.localStorage.getItem("valdoria.layer"), 10);
    if (!(pref >= 1 && pref <= NB_LAYERS)) pref = 0;
    const ordre = [];
    if (pref) ordre.push(pref);
    for (let L = 1; L <= NB_LAYERS; L++) if (L !== pref) ordre.push(L);
    (function suivant(i) {
      if (i >= ordre.length) { entrerFile(); return; }
      compteLayer(ordre[i]).then(function (n) {
        if (n < LAYER_MAX) {
          monLayer = ordre[i]; enFile = false; zoneActuelle = null;
          majStatut(); majLayerUI();
          if (state.myPos) sendPos(state.myPos);
        } else suivant(i + 1);
      });
    })(0);
  }

  function changeLayer(L) {
    L = parseInt(L, 10);
    if (!(L >= 1 && L <= NB_LAYERS) || L === monLayer) return;
    compteLayer(L).then(function (n) {
      if (n >= LAYER_MAX) { majLayerUI(); return; }
      quitterFile();
      monLayer = L; enFile = false;
      try { window.localStorage.setItem("valdoria.layer", String(L)); } catch (e) {}
      quitteZone(); zoneActuelle = null;
      if (state.myPos) sendPos(state.myPos);
      majStatut(); majLayerUI();
    });
  }

  // ---------- FILE D'ATTENTE ----------
  function entrerFile() {
    enFile = true; monLayer = null;
    quitteZone();
    fileRef = db.ref("monde/joueurs/Q|" + monId);
    fileRef.set({ nom: pseudo(), tag: null, x: 0, y: 0, g: 999, m: 999, sexe: null, t: firebase.database.ServerValue.TIMESTAMP });
    try { fileRef.onDisconnect().remove(); } catch (e) {}
    setStatus("⏳ File d'attente : les 3 layers sont pleins. Tu peux jouer, tu rejoindras des qu'une place se libere.");
    majLayerUI();
    if (!filePoll) filePoll = setInterval(essayeSortirFile, 8000);
    essayeSortirFile();
  }
  function quitterFile() {
    if (!enFile && !fileRef) return;
    enFile = false;
    if (filePoll) { clearInterval(filePoll); filePoll = null; }
    if (fileRef) { try { fileRef.onDisconnect().cancel(); } catch (e) {} try { fileRef.remove(); } catch (e) {} fileRef = null; }
  }
  function essayeSortirFile() {
    if (!enFile) return;
    db.ref("monde/joueurs").orderByKey().startAt("Q|").endAt("Q|" + FIN).once("value").then(function (snap) {
      if (!enFile) return;
      const val = snap.val() || {}; const limite = Date.now() - VIEUX_MS; const maCle = "Q|" + monId;
      const maT = (val[maCle] && val[maCle].t) || Infinity;
      let minKey = null, minT = Infinity, devant = 0;
      for (const k in val) {
        const v = val[k]; if (!v) continue; const t = v.t || 0; const moi = (k === maCle);
        if (!moi && t <= limite) continue;
        if (t < minT) { minT = t; minKey = k; }
        if (!moi && t < maT) devant++;
      }
      setStatus("⏳ File d'attente : position " + (devant + 1) + " - tu peux jouer, tu rejoindras des qu'une place se libere.");
      if (minKey !== maCle) return;
      (function cherche(L) {
        if (L > NB_LAYERS) return;
        compteLayer(L).then(function (n) { if (!enFile) return; if (n < LAYER_MAX) sortirFile(L); else cherche(L + 1); });
      })(1);
    }).catch(function () {});
  }
  function sortirFile(L) {
    quitterFile();
    monLayer = L; zoneActuelle = null;
    try { window.localStorage.setItem("valdoria.layer", String(L)); } catch (e) {}
    setStatus("✅ Une place s'est liberee - tu rejoins le Layer " + L + " !");
    majLayerUI();
    if (state.myPos) sendPos(state.myPos);
  }

  // ---------- MENU DEROULANT LAYER ----------
  function majLayerUI() {
    const selects = [$("layerSelect"), $("drawerLayerSelect")].filter(Boolean);
    if (!selects.length || !db) return;
    Promise.all([compteLayer(1), compteLayer(2), compteLayer(3)]).then(function (cs) {
      const counts = { 1: cs[0], 2: cs[1], 3: cs[2] };
      selects.forEach(function (sel) {
        sel.innerHTML = "";
        for (let L = 1; L <= NB_LAYERS; L++) {
          const plein = counts[L] >= LAYER_MAX;
          const o = document.createElement("option");
          o.value = String(L);
          o.textContent = plein ? "🔴 (Layer " + L + ") complet" : "🟢 Layer " + L + " (" + counts[L] + "/" + LAYER_MAX + ")";
          o.style.color = plein ? "#c0392b" : "#1d7a3c";
          if (plein && L !== monLayer) o.disabled = true;
          if (L === monLayer) o.selected = true;
          sel.appendChild(o);
        }
        if (enFile) {
          const o = document.createElement("option");
          o.value = ""; o.textContent = "⏳ File d'attente"; o.selected = true; o.disabled = true;
          sel.appendChild(o);
        }
      });
    });
  }

  function connectWorld() {
    if (state.monde) return;
    if (typeof firebase === "undefined") {
      setStatus("Service de jeu en ligne indisponible (Firebase non charge).");
      return;
    }

    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    if (window.Valdoria.lieux) window.Valdoria.lieux.connect(db);
    state.monde = db;
    monId = "j" + Math.random().toString(36).slice(2, 10);

    if (window.Valdoria.tchat) window.Valdoria.tchat.connect(db, pseudo);
    if (window.Valdoria.linkroom) window.Valdoria.linkroom.connectDb(db, monId);
    if (window.Valdoria.cloudsave) window.Valdoria.cloudsave.connectDb(db);
    if (window.Valdoria.echange) window.Valdoria.echange.connectDb(db);

    db.ref(".info/connected").on("value", function (s) {
      if (s.val()) majStatut();
      else setStatus("Connexion au monde perdue, reconnexion...");
    });

    setInterval(function () {
      const limite = Date.now() - VIEUX_MS;
      for (const k of Object.keys(state.joueurs))
        if (state.joueurs[k].t < limite) { delete state.joueurs[k]; majStatut(); }
    }, 10000);

    [$("layerSelect"), $("drawerLayerSelect")].forEach(function (sel) {
      if (!sel) return;
      sel.addEventListener("mousedown", majLayerUI);
      sel.addEventListener("focus", majLayerUI);
      sel.addEventListener("change", function () { if (sel.value) changeLayer(sel.value); });
    });

    $("playerName").addEventListener("change", function () {
      try { window.localStorage.setItem("valdoria.pseudo", $("playerName").value.trim()); } catch (e) {}
      if (state.myPos) { dernierePos = null; sendPos(state.myPos); }
    });

    placerAuto();
  }

  function sendPos(pos) {
    if (!db || !monId || !pos) return;
    if (monLayer === null) return;
    if (typeof pos.g !== "number" || typeof pos.m !== "number") return;
    // localisation des amis : publication LOC|<tag> (throttle interne a lieux.js)
    if (window.Valdoria.lieux) window.Valdoria.lieux.publie(pos);
    const zk = "L" + monLayer + "_" + pos.g + "_" + pos.m;
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

  window.Valdoria.network = { connectWorld: connectWorld, sendPos: sendPos, changeLayer: changeLayer };
})(window);
