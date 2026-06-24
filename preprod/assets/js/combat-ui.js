(function (window) {
  "use strict";
  var V = window.Valdoria || (window.Valdoria = {});
  function $(id) { return document.getElementById(id); }
  function C() { return V.combat; }
  function esc(s) { return ("" + s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function toID(s) { return ("" + s).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  var TCOL = { Normal:"#A8A878", Fighting:"#C03028", Flying:"#A890F0", Poison:"#A040A0", Ground:"#E0C068", Rock:"#B8A038", Bug:"#A8B820", Ghost:"#705898", Steel:"#B8B8D0", Fire:"#F08030", Water:"#6890F0", Grass:"#78C850", Electric:"#F8D030", Psychic:"#F85888", Ice:"#98D8D8", Dragon:"#7038F8", Dark:"#705848" };
  var STATFR = { atk:"L'Attaque", def:"La Défense", spa:"L'Atq. Spé.", spd:"La Déf. Spé.", spe:"La Vitesse", accuracy:"La Précision", evasion:"L'Esquive" };
  var sim = null, gen3 = null, spByNum = {}, mvByNum = {}, mvFr = {}, etat = null;
  var myId = "c" + Math.random().toString(36).slice(2, 9);
  var invitsRef = null, invitsTag = null, pending = null;

  function DB() { return (V.state && V.state.monde) || null; }
  function monTag() { return (V.tchat && V.tchat.getTag && V.tchat.getTag()) || ""; }
  function lesAmis() { try { var a = JSON.parse(window.localStorage.getItem("valdoria.tagsAmis") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function genCode() { var A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = "", i; for (i = 0; i < 5; i++) s += A.charAt(Math.floor(Math.random() * A.length)); return s; }
  function cle(t) { return ("" + t).replace("#", "-"); }
  function TS() { return firebase.database.ServerValue.TIMESTAMP; }
  function sess(code) { return "monde/sessions/cbt_" + code; }
  function setStatus(t) { var s = $("cbStatus"); if (s) s.textContent = t || ""; }
  function logLigne(t) { var l = $("cbLogBox"); if (!l) return; var d = document.createElement("div"); d.textContent = t; l.appendChild(d); l.scrollTop = l.scrollHeight; }

  function buildSrcdoc(initLog) {
    var S = "scr" + "ipt";
    return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>html,body{margin:0;padding:0;background:#0e1018;overflow:hidden;}.replay-controls,.replay-controls-2,.battle-log{display:none!important;}.battle{margin:0 auto!important;}</style>' +
      '</head><body>' + '<' + S + '>document.addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.src){if(!t.__r){t.__r=1;t.src=t.src+(t.src.indexOf("?")>=0?"&":"?")+"cbr=1";}else{t.style.visibility="hidden";}}},true);</' + S + '>' + '<div id="cbSon" style="position:fixed;top:5px;right:6px;z-index:200;background:rgba(0,0,0,.6);color:#fff;font:bold 12px sans-serif;padding:4px 9px;border-radius:8px;cursor:pointer;">🔊 Activer le son</div><div class="wrapper replay-wrapper" style="margin:0 auto">' +
      '<div class="battle"></div><div class="battle-log"></div><div class="replay-controls"></div><div class="replay-controls-2"></div>' +
      '<' + S + ' type="text/plain" class="battle-log-data">' + initLog + '</' + S + '>' +
      '</div>' +
      '<' + S + ' src="https://code.jquery.com/jquery-3.7.1.min.js"></' + S + '>' +
      '<' + S + ' src="https://code.jquery.com/ui/1.13.1/jquery-ui.min.js"></' + S + '>' +
      '<' + S + '>window.Config={whitelist:[]};</' + S + '>' +
      '<' + S + ' src="https://play.pokemonshowdown.com/js/replay-embed.js?v=' + Math.floor(Date.now() / 864e5) + '"></' + S + '>' + '<' + S + '>(function(){function u(){try{if(window.BattleSound){window.BattleSound.setMute(false);var k=Object.keys(window.BattleSound.soundCache||{});if(k.length)window.BattleSound.playSound(k[0],0.5);}}catch(e){}var h=document.getElementById("cbSon");if(h)h.style.display="none";document.removeEventListener("pointerdown",u);}document.addEventListener("pointerdown",u);})();</' + S + '>' +
      '</body></html>';
  }

  async function loadSim() {
    if (sim) return;
    sim = await import("https://esm.sh/@pkmn/sim");
    gen3 = sim.Dex.forGen(3);
    gen3.species.all().forEach(function (s) { if (s.num > 0 && !spByNum[s.num]) spByNum[s.num] = s; });
    gen3.moves.all().forEach(function (m) { if (m.num > 0) { mvByNum[m.num] = m; var fr = C().moveName(m.num); if (fr) mvFr[m.name] = fr; } });
  }
  function toSet(d) {
    var sp = spByNum[C().natdex(d.species)]; if (!sp) return null;
    return { name: d.nomFr || sp.name, species: sp.name, level: d.niveau,
      moves: d.moves.map(function (id) { return mvByNum[id] ? mvByNum[id].name : null; }).filter(Boolean),
      nature: d.nature, ability: (sp.abilities && (sp.abilities[d.abilSlot] || sp.abilities[0])) || "",
      evs: { hp: d.ev[0], atk: d.ev[1], def: d.ev[2], spa: d.ev[4], spd: d.ev[5], spe: d.ev[3] },
      ivs: { hp: d.iv[0], atk: d.iv[1], def: d.iv[2], spa: d.iv[4], spd: d.iv[5], spe: d.iv[3] }, item: "" };
  }
  async function prepareMonSet() {
    if (!C().decodeBattleTeam) { window.alert("Module pas prêt, recharge la page."); return null; }
    await loadSim();
    var eq = C().decodeBattleTeam();
    if (!eq || !eq.length) { window.alert("Lance ta partie et avance un peu en jeu, puis réessaie."); return null; }
    var set = toSet(eq[0]); if (!set) { window.alert("Équipe illisible."); return null; }
    return { set: set, decoded: eq[0] };
  }
  function omniscient(lines) { var o = []; for (var i = 0; i < lines.length; i++) { if (lines[i].indexOf("|split|") === 0) { if (i + 1 < lines.length) o.push(lines[i + 1]); i += 2; continue; } o.push(lines[i]); } return o; }
  function nick(s) { return ("" + s).split(": ")[1] || s; }
  function mv(n) { return mvFr[n] || n; }
  function frMsg(line) {
    var p = line.split("|"), t = p[1];
    if (t === "move") return nick(p[2]) + " utilise " + mv(p[3]) + " !";
    if (t === "-crit") return "Coup critique !";
    if (t === "-supereffective") return "C'est super efficace !";
    if (t === "-resisted") return "Ce n'est pas très efficace…";
    if (t === "-immune") return "Ça n'affecte pas " + nick(p[2]) + "…";
    if (t === "-miss") return "Raté !";
    if (t === "faint") return nick(p[2]) + " est K.O. !";
    if (t === "-status") { var st = { brn:"est brûlé", par:"est paralysé", psn:"est empoisonné", tox:"est gravement empoisonné", slp:"s'endort", frz:"est gelé" }[p[3]] || ("subit " + p[3]); return nick(p[2]) + " " + st + " !"; }
    if (t === "-boost") return (STATFR[p[3]] || p[3]) + " de " + nick(p[2]) + " augmente !";
    if (t === "-unboost") return (STATFR[p[3]] || p[3]) + " de " + nick(p[2]) + " baisse !";
    if (t === "cant") return nick(p[2]) + " ne peut pas attaquer !";
    if (t === "-heal") return nick(p[2]) + " récupère des PV.";
    return null;
  }

  function W() { return etat && etat.ifr && etat.ifr.contentWindow; }
  function bat() { var w = W(); return (w && w.Replays && w.Replays.battle) || null; }
  function nudgeAudio() { try { var w = W(); if (w && w.BattleSound) { w.BattleSound.setMute(false); } } catch (e) {} }
  function feedTurn(lines) {
    var w = W(); var b = bat(); if (!w || !b) return;
    lines.forEach(function (l) { if (l) try { b.add(l); } catch (e) {} });
    try { b.add(""); } catch (e) {}
    try { if (b.paused) w.Replays.play(); else if (b.play) b.play(); } catch (e) {}
  }
  async function waitAnim(maxMs) {
    var b = bat(); if (!b) { await sleep(800); return; }
    var n = Math.ceil((maxMs || 9000) / 200);
    for (var i = 0; i < n; i++) { await sleep(200); try { if (bat().atQueueEnd) { await sleep(160); return; } } catch (e) { return; } }
  }
  async function waitReady() { for (var i = 0; i < 80; i++) { await sleep(250); if (bat()) return true; } return false; }
  function sizeScene() {
    try {
      var card = document.querySelector("#combatPanel .combat-card");
      var wrap = $("cbScaleWrap"); var d = etat.ifr.contentDocument; var bt = d.querySelector(".battle");
      var bw = (bt && bt.offsetWidth) || 642, bh = (bt && bt.offsetHeight) || 362;
      etat.ifr.style.width = bw + "px"; etat.ifr.style.height = bh + "px"; etat.ifr.style.transformOrigin = "top left";
      var sw = document.getElementById("screenWrap");
      if (card) {
        if (sw && window.innerWidth >= 820) { var gw = Math.round(sw.getBoundingClientRect().width); if (gw > 200) card.style.width = Math.min(gw + 40, Math.round(window.innerWidth * 0.96)) + "px"; }
        else { card.style.width = ""; }
      }
      var sc = Math.min(1.7, (wrap.clientWidth || 520) / bw);
      etat.ifr.style.transform = "scale(" + sc + ")";
      wrap.style.height = Math.ceil(bh * sc) + "px"; wrap.style.overflow = "hidden";
    } catch (e) {}
  }
  async function showArene(initLog, flip) {
    $("combatLobby").setAttribute("hidden", ""); onlineHide(); $("combatArene").removeAttribute("hidden");
    var lb = $("cbLogBox"); if (lb) lb.innerHTML = ""; setStatus("Préparation du combat… (~5 s la 1ère fois)");
    var wrap = $("cbScaleWrap"); wrap.innerHTML = ""; wrap.style.height = ""; wrap.style.background = "#0e1018";
    var ifr = document.createElement("iframe"); ifr.id = "cbIframe"; ifr.setAttribute("scrolling", "no"); ifr.setAttribute("allow", "autoplay");
    ifr.style.cssText = "width:642px;height:362px;border:0;display:block;background:#0e1018;transform-origin:top left;";
    ifr.srcdoc = buildSrcdoc(initLog); wrap.appendChild(ifr); etat.ifr = ifr;
    var ok = await waitReady(); if (!etat) return false;
    if (!ok) { setStatus("Le moteur d'affichage n'a pas répondu. Réessaie."); return false; }
    setStatus("");
    try { etat.ifr.contentWindow.BattleSound.setMute(false); } catch (e) {}
    try { etat.ifr.contentWindow.Replays.play(); } catch (e) {}
    if (flip) { try { etat.ifr.contentWindow.Replays.switchViewpoint(); } catch (e) {} }
    sizeScene(); setTimeout(sizeScene, 600); setTimeout(sizeScene, 1500);
    await waitAnim(7000);
    return true;
  }

  function aiChoice() {
    var req = etat.sim.sides[1].activeRequest;
    if (req && req.active && req.active[0] && req.active[0].moves) { var o = []; req.active[0].moves.forEach(function (m, i) { if (!m.disabled && (m.pp == null || m.pp > 0)) o.push(i + 1); }); if (o.length) return "move " + o[Math.floor(Math.random() * o.length)]; }
    return "default";
  }
  function renderMoves() {
    var box = $("cbMoves"); if (!box) return; box.textContent = "";
    var moves;
    if (etat.mode === "invite") moves = etat.reqMoves || [];
    else { var req = etat.sim && etat.sim.sides[0].activeRequest; moves = (req && req.active && req.active[0] && req.active[0].moves) || []; }
    moves.forEach(function (m, i) {
      var b = document.createElement("button"); b.type = "button"; b.className = "cb-move";
      var md = gen3.moves.get(m.id), col = (md && TCOL[md.type]) || "#888"; b.style.borderColor = col;
      var romId = etat.moiDecoded && etat.moiDecoded.moves[i];
      var nom = (romId && C().moveName(romId)) || mv(m.move || m.id);
      b.innerHTML = '<span class="n" style="color:' + col + '">' + esc(nom) + '</span><span class="i">PP ' + (m.pp != null ? m.pp : "?") + "/" + (m.maxpp != null ? m.maxpp : "?") + '</span>';
      if (m.disabled || etat.fini || etat.attente) b.disabled = true;
      b.addEventListener("click", function () { jouer(i + 1); });
      box.appendChild(b);
    });
    if (etat.attente && !etat.fini && etat.mode !== "local") { var p = document.createElement("p"); p.className = "cb-wait"; p.textContent = "⏳ En attente de l'adversaire…"; box.appendChild(p); }
  }
  async function jouer(n) {
    if (!etat || etat.fini || etat.attente) return;
    nudgeAudio();
    if (etat.mode === "invite") { etat.attente = true; renderMoves(); try { etat.ref.child("choixInvite").set("move " + n); } catch (e) {} return; }
    etat.attente = true; renderMoves();
    if (etat.mode === "local") {
      try { etat.sim.makeChoices("move " + n, aiChoice()); } catch (e) { etat.attente = false; renderMoves(); return; }
      var neuf = omniscient(etat.sim.log.slice(etat.rawIdx)); etat.rawIdx = etat.sim.log.length;
      feedTurn(neuf); neuf.forEach(function (l) { var m = frMsg(l); if (m) logLigne(m); });
      await waitAnim(); if (!etat) return;
      if (etat.sim.ended) finir(); else { etat.attente = false; renderMoves(); }
    } else if (etat.mode === "hote") { etat.monChoix = "move " + n; tryResolveHost(); }
  }
  function finir() { etat.fini = true; renderMoves(); var w = etat.sim.winner; setStatus(w === "Toi" ? "🏆 Tu remportes le combat !" : (w ? "💀 Tu as perdu le combat…" : "Combat terminé.")); }
  function finOnline(res) {
    etat.fini = true; etat.attente = true; renderMoves();
    setStatus(res === "win" ? "🏆 Victoire !" : res === "lose" ? "💀 Défaite…" : "Match nul.");
    if (etat.role === "hote" && etat.ref) setTimeout(function () { try { etat.ref.remove(); } catch (e) {} }, 2500);
  }

  // ---------- LOCAL (vs IA) ----------
  async function combatLocal() {
    try {
      if (!C().decodeBattleTeam) { window.alert("Module pas prêt, recharge la page."); return; }
      setStatus("Préparation… (~5 s la 1ère fois)"); await loadSim();
      var eq = C().decodeBattleTeam(); if (!eq || !eq.length) { window.alert("Lance ta partie et avance un peu en jeu, puis réessaie."); return; }
      var moi = toSet(eq[0]), adv = toSet(eq[1] || eq[0]); if (!moi || !adv) { window.alert("Équipe illisible."); return; }
      if (!eq[1]) adv.name = adv.name + " (clone)";
      var b = new sim.Battle({ formatid: "gen3customgame", p1: { name: "Toi", team: [moi] }, p2: { name: "Adversaire", team: [adv] } });
      etat = { mode: "local", sim: b, moiDecoded: eq[0], rawIdx: b.log.length, fini: false, attente: true };
      var ok = await showArene(omniscient(b.log).join("\n"), false);
      if (!etat || !ok) return;
      etat.attente = false; renderMoves();
    } catch (e) { setStatus("Souci : " + (e && e.message ? e.message : e)); }
  }

  // ---------- ONLINE : HÔTE ----------
  function hostRoom(code, mine) {
    var db = DB(); var ref = db.ref(sess(code));
    etat = { mode: "hote", role: "hote", ref: ref, code: code, moiDecoded: mine.decoded, mySet: mine.set, p1name: monTag() || "Toi", started: false, fini: false, attente: true, tour: 1, choixInvite: null, monChoix: null };
    ref.set({ hote: monTag() || "Toi", etat: "attente", eqHote: mine.set, t: TS() });
    try { ref.onDisconnect().remove(); } catch (e) {}
    ref.on("value", onHostRoom);
  }
  async function onHostRoom(snap) {
    if (!etat || etat.mode !== "hote") return;
    var r = snap.val();
    if (!r) { if (etat.started && !etat.fini) { setStatus("L'adversaire a quitté."); etat.fini = true; etat.attente = true; renderMoves(); } return; }
    if (!etat.started && r.eqInvite) {
      etat.started = true;
      stopAttente();
      var advSet = typeof r.eqInvite === "string" ? JSON.parse(r.eqInvite) : r.eqInvite;
      var advName = r.invite || "Adversaire";
      var b = new sim.Battle({ formatid: "gen3customgame", p1: { name: etat.p1name, team: [etat.mySet] }, p2: { name: advName, team: [advSet] } });
      etat.sim = b; etat.rawIdx = b.log.length;
      var req = b.sides[1].activeRequest, rm = (req && req.active && req.active[0] && req.active[0].moves) || null;
      try { etat.ref.update({ etat: "jeu", log: omniscient(b.log).join("\n"), reqInvite: rm, tour: 1 }); } catch (e) {}
      var ok = await showArene(omniscient(b.log).join("\n"), false);
      if (!etat || !ok) return;
      etat.attente = false; renderMoves();
      return;
    }
    if (etat.started && r.choixInvite && r.choixInvite !== etat.choixInvite) { etat.choixInvite = r.choixInvite; tryResolveHost(); }
  }
  async function tryResolveHost() {
    if (!etat || etat.mode !== "hote" || etat.fini || etat.resolving) return;
    if (!etat.monChoix || !etat.choixInvite) return;
    etat.resolving = true;
    var ch = etat.monChoix, ci = etat.choixInvite; etat.monChoix = null; etat.choixInvite = null;
    try { etat.ref.child("choixHote").remove(); etat.ref.child("choixInvite").remove(); } catch (e) {}
    try { etat.sim.makeChoices(ch, ci); } catch (e) { etat.resolving = false; etat.attente = false; renderMoves(); return; }
    var neuf = omniscient(etat.sim.log.slice(etat.rawIdx)); etat.rawIdx = etat.sim.log.length;
    var req = etat.sim.sides[1].activeRequest, rm = (req && req.active && req.active[0] && req.active[0].moves) || null;
    var upd = { log: omniscient(etat.sim.log).join("\n"), reqInvite: rm, tour: (etat.tour = (etat.tour || 1) + 1) };
    if (etat.sim.ended) upd.fin = etat.sim.winner === etat.p1name ? "hote" : (etat.sim.winner ? "invite" : "nul");
    try { etat.ref.update(upd); } catch (e) {}
    feedTurn(neuf); neuf.forEach(function (l) { var m = frMsg(l); if (m) logLigne(m); });
    await waitAnim(); if (!etat) return;
    etat.resolving = false;
    if (etat.sim.ended) finOnline(upd.fin === "hote" ? "win" : upd.fin === "invite" ? "lose" : "nul"); else { etat.attente = false; renderMoves(); }
  }

  // ---------- ONLINE : INVITÉ ----------
  async function joinGuest(code, hoteTag) {
    var db = DB(); if (!db) { window.alert("Connecte-toi au monde (lance le jeu)."); return; }
    var mine = await prepareMonSet(); if (!mine) return;
    var ref = db.ref(sess(code));
    var s = await ref.once("value"); if (!s.val()) { window.alert("Combat introuvable (expiré ?)."); onlineHide(); return; }
    etat = { mode: "invite", role: "invite", ref: ref, code: code, moiDecoded: mine.decoded, logSeen: 0, areneShown: false, fini: false, attente: true, reqMoves: null };
    try { ref.update({ invite: monTag() || "Invité", eqInvite: mine.set }); } catch (e) {}
    ref.on("value", onGuestRoom);
  }
  async function onGuestRoom(snap) {
    if (!etat || etat.mode !== "invite") return;
    var r = snap.val();
    if (!r) { if (!etat.fini) { setStatus("L'adversaire a quitté."); etat.fini = true; etat.attente = true; renderMoves(); } return; }
    if (r.etat === "jeu" && r.log && !etat.areneShown) {
      etat.areneShown = true; etat.reqMoves = r.reqInvite || [];
      var ok = await showArene(r.log, true);
      if (!etat || !ok) return;
      etat.logSeen = r.log.length;
      if (r.fin) { finOnline(r.fin === "invite" ? "win" : "lose"); return; }
      etat.attente = false; renderMoves();
      return;
    }
    if (etat.areneShown && r.log && r.log.length > etat.logSeen) {
      var portion = r.log.slice(etat.logSeen).split("\n"); etat.logSeen = r.log.length;
      etat.reqMoves = r.reqInvite || etat.reqMoves;
      etat.attente = true; renderMoves();
      feedTurn(portion); portion.forEach(function (l) { var m = frMsg(l); if (m) logLigne(m); });
      await waitAnim(); if (!etat) return;
      if (r.fin) { finOnline(r.fin === "invite" ? "win" : "lose"); return; }
      etat.attente = false; renderMoves();
    }
  }

  // ---------- MATCHMAKING ALÉATOIRE ----------
  async function estimAttente() {
    try { var s = await DB().ref("monde/sessions/cbt__stats").limitToLast(12).once("value"); var arr = []; s.forEach(function (c) { var v = c.val(); if (v && typeof v.w === "number") arr.push(v.w); }); if (arr.length) { var a = arr.reduce(function (x, y) { return x + y; }, 0) / arr.length; return Math.min(180, Math.max(5, Math.round(a))); } } catch (e) {} return 45;
  }
  function onAttenteFile(snap) {
    if (!etat || etat.started || etat.areneShown || etat.fini) return;
    var entries = []; snap.forEach(function (c) { var v = c.val(); if (v && v.code) entries.push({ id: v.id, t: v.t || 0 }); });
    entries.sort(function (a, b) { return a.t - b.t; });
    var pos = -1; for (var i = 0; i < entries.length; i++) { if (entries[i].id === myId) { pos = i; break; } }
    etat.position = pos < 0 ? 1 : pos + 1; etat.nbAttente = entries.length || 1; renderAttente();
  }
  function renderAttente() {
    var el = $("cbOnlineWaitTxt"); if (!el || !etat) return;
    var sec = Math.floor((Date.now() - (etat.attenteDepuis || Date.now())) / 1000);
    var mm = Math.floor(sec / 60), ss = sec % 60;
    var pos = etat.position || 1, nb = etat.nbAttente || 1, est = etat.estim || 45;
    el.innerHTML = "\uD83D\uDD0D <b>Recherche d'un adversaire\u2026</b><br>" +
      "\uD83C\uDF9F\uFE0F Ton ticket : <b>n\u00b0" + pos + "</b> dans la file<br>" +
      "\uD83D\uDC65 " + nb + " joueur" + (nb > 1 ? "s" : "") + " en attente<br>" +
      "\u23F1\uFE0F En attente : " + mm + ":" + (ss < 10 ? "0" : "") + ss + "<br>" +
      "\u231B Attente estim\u00e9e : ~" + est + " s";
  }
  function stopAttente() {
    if (!etat) return;
    if (etat.attenteTimer) { clearInterval(etat.attenteTimer); etat.attenteTimer = null; }
    if (etat.fileRef) { try { etat.fileRef.off("value", onAttenteFile); } catch (e) {} etat.fileRef = null; }
    if (etat.fileEntryRef) { try { etat.fileEntryRef.remove(); } catch (e) {} etat.fileEntryRef = null; }
  }
  async function aleatoire() {
    var db = DB(); if (!db) { window.alert("Connecte-toi au monde (lance le jeu)."); return; }
    var mine = await prepareMonSet(); if (!mine) return;
    onlineShow("wait", "🔍 Recherche d'un adversaire…");
    var fileRef = db.ref("monde/sessions/cbt__file");
    var snap = await fileRef.once("value");
    var entries = []; snap.forEach(function (c) { var v = c.val(); if (v && v.code) entries.push({ key: c.key, id: v.id, code: v.code, tag: v.tag, t: v.t || 0 }); });
    entries.sort(function (a, b) { return a.t - b.t; });
    var now = Date.now(), oldest = null;
    for (var i = 0; i < entries.length; i++) { if (entries[i].id !== myId && (now - entries[i].t < 600000)) { oldest = entries[i]; break; } }
    if (oldest) {
      try { await fileRef.child(oldest.key).remove(); } catch (e) {}
      try { db.ref("monde/sessions/cbt__stats").push({ w: Math.max(1, Math.round((now - oldest.t) / 1000)), t: TS() }); } catch (e) {}
      joinGuest(oldest.code, oldest.tag); return;
    }
    var code = genCode();
    hostRoom(code, mine);
    var myEntry = fileRef.push({ tag: monTag() || "Toi", id: myId, code: code, t: TS() });
    try { myEntry.onDisconnect().remove(); } catch (e) {}
    if (etat) { etat.fileEntryRef = myEntry; etat.fileRef = fileRef; etat.attenteDepuis = Date.now(); etat.position = 1; etat.nbAttente = 1; etat.estim = await estimAttente(); fileRef.on("value", onAttenteFile); etat.attenteTimer = setInterval(renderAttente, 1000); setTimeout(renderAttente, 80); }
    onlineShow("wait", "🔍 Recherche d'un adversaire…  (tu peux annuler)");
  }

  // ---------- DÉFIER UN AMI ----------
  async function defier(tag) {
    var db = DB(); if (!db) { window.alert("Connecte-toi au monde (lance le jeu)."); return; }
    if (!/^.{1,14}#\d{4}$/.test(tag)) { window.alert("Tag invalide (ex : Sacha#1234)."); return; }
    if (!monTag()) { window.alert("Ton tag n'est pas prêt (avance un peu en jeu)."); return; }
    var mine = await prepareMonSet(); if (!mine) return;
    var code = genCode();
    hostRoom(code, mine);
    try { db.ref("monde/echanges/" + cle(tag)).push({ de: monTag(), combat: code, t: TS() }); } catch (e) {}
    onlineShow("wait", "⏳ En attente que " + tag + " accepte ton défi…");
  }
  function annulerOnline() {
    if (etat && etat.ref && !etat.started && !etat.areneShown) { try { etat.ref.remove(); } catch (e) {} }
    stopAttente();
    if (etat && etat.ref) { try { etat.ref.off(); } catch (e) {} }
    etat = null; onlineHide();
  }

  // ---------- DÉFIS REÇUS ----------
  function abonneInvits() {
    var db = DB(); if (!db) return;
    var tag = monTag(); if (!tag || tag === invitsTag) return;
    if (invitsRef) { try { invitsRef.off(); } catch (e) {} }
    invitsTag = tag; invitsRef = db.ref("monde/echanges/" + cle(tag));
    invitsRef.on("child_added", function (s) {
      var d = s.val(); if (!d || !d.combat) return;
      if (d.t && Date.now() - d.t > 120000) { try { s.ref.remove(); } catch (e) {} return; }
      pending = { de: d.de || "?", code: d.combat, ref: s.ref };
      majBadge(); showToast(pending.de); if ($("combatPanel") && !$("combatPanel").hasAttribute("hidden")) showChallenge();
    });
  }
  function hideToast() { var t = $("cbToast"); if (t) t.remove(); }
  function showToast(de) {
    hideToast();
    var t = document.createElement("div"); t.id = "cbToast";
    t.style.cssText = "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;background:#2a2150;color:#fff;border:2px solid #8a7dd0;border-radius:12px;padding:11px 15px;box-shadow:0 6px 30px rgba(0,0,0,.5);font:600 15px system-ui,sans-serif;display:flex;gap:9px;align-items:center;flex-wrap:wrap;justify-content:center;max-width:92vw;";
    var msg = document.createElement("span"); msg.textContent = "\u2694\ufe0f " + de + " te d\u00e9fie en combat !"; t.appendChild(msg);
    var ok = document.createElement("button"); ok.type = "button"; ok.textContent = "\u2705 Accepter"; ok.style.cssText = "background:#46a049;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer;";
    var no = document.createElement("button"); no.type = "button"; no.textContent = "Refuser"; no.style.cssText = "background:#5a5a6a;color:#fff;border:0;border-radius:8px;padding:7px 12px;cursor:pointer;";
    ok.addEventListener("click", accepterDefi); no.addEventListener("click", refuserDefi);
    t.appendChild(ok); t.appendChild(no); document.body.appendChild(t);
  }
  function majBadge() {
    [].forEach.call(document.querySelectorAll(".js-combat-badge"), function (b) {
      if (pending) { b.textContent = "!"; b.removeAttribute("hidden"); } else b.setAttribute("hidden", "");
    });
  }
  function showChallenge() { if (!pending) return; ouvrir(); onlineShow("challenge", "⚔️ " + pending.de + " te défie en combat !"); }
  function accepterDefi() { hideToast(); if (!pending) return; var c = pending; if (c.ref) try { c.ref.remove(); } catch (e) {} pending = null; majBadge(); var p = $("combatPanel"); if (p) p.removeAttribute("hidden"); joinGuest(c.code, c.de); }
  function refuserDefi() { hideToast(); if (pending && pending.ref) try { pending.ref.remove(); } catch (e) {} pending = null; majBadge(); onlineHide(); }

  // ---------- UI lobby online (injectée) ----------
  function injecteUI() {
    var lobby = $("combatLobby"); if (!lobby || $("cbOnline")) return;
    var d = document.createElement("div"); d.id = "cbOnline"; d.setAttribute("hidden", ""); d.style.cssText = "margin-top:8px;";
    d.innerHTML =
      '<div id="cbOnlineWait" hidden><p id="cbOnlineWaitTxt" style="margin:6px 0;font-weight:600;"></p><button type="button" id="cbOnlineAnnuler" class="echange-fermer">Annuler</button></div>' +
      '<div id="cbOnlineFriends" hidden>' +
        '<p style="margin:4px 0 6px;font-weight:600;">Défier un ami</p>' +
        '<select id="cbAmiSelect" style="width:100%;padding:7px;border-radius:7px;margin-bottom:6px;"></select>' +
        '<input id="cbAmiTag" type="text" placeholder="ou tag (Sacha#1234)" autocomplete="off" style="width:100%;padding:7px;border-radius:7px;margin-bottom:6px;box-sizing:border-box;">' +
        '<button type="button" id="cbAmiDefier" class="combat-action">⚔️ Envoyer le défi</button>' +
        '<button type="button" id="cbAmiAnnuler" class="echange-fermer">Retour</button>' +
      '</div>' +
      '<div id="cbOnlineChallenge" hidden>' +
        '<p id="cbChallengeTxt" style="margin:6px 0;font-weight:600;"></p>' +
        '<button type="button" id="cbChallengeOK" class="combat-action">✅ Accepter</button>' +
        '<button type="button" id="cbChallengeNo" class="echange-fermer">Refuser</button>' +
      '</div>';
    lobby.appendChild(d);
    $("cbOnlineAnnuler").addEventListener("click", annulerOnline);
    $("cbAmiAnnuler").addEventListener("click", onlineHide);
    $("cbAmiDefier").addEventListener("click", function () { var sel = $("cbAmiSelect"), inp = $("cbAmiTag"); var tag = (inp.value.trim()) || (sel.value) || ""; if (tag) defier(tag); });
    $("cbChallengeOK").addEventListener("click", accepterDefi);
    $("cbChallengeNo").addEventListener("click", refuserDefi);
    var t = $("cbAmiTag"); if (t) ["keydown", "keyup", "keypress"].forEach(function (ev) { t.addEventListener(ev, function (e) { e.stopPropagation(); }); });
  }
  function lobbyBtns(show) { ["combatBtnEntrainement", "combatBtnAlea", "combatBtnAmi"].forEach(function (id) { var b = $(id); if (b) b.toggleAttribute("hidden", !show); }); }
  function onlineHide() { var o = $("cbOnline"); if (o) { o.setAttribute("hidden", ""); ["cbOnlineWait", "cbOnlineFriends", "cbOnlineChallenge"].forEach(function (id) { var e = $(id); if (e) e.setAttribute("hidden", ""); }); } lobbyBtns(true); }
  function onlineShow(which, txt) {
    injecteUI(); lobbyBtns(false);
    var o = $("cbOnline"); if (o) o.removeAttribute("hidden");
    ["cbOnlineWait", "cbOnlineFriends", "cbOnlineChallenge"].forEach(function (id) { var e = $(id); if (e) e.setAttribute("hidden", ""); });
    if (which === "wait") { $("cbOnlineWait").removeAttribute("hidden"); $("cbOnlineWaitTxt").textContent = txt || "…"; }
    else if (which === "friends") { $("cbOnlineFriends").removeAttribute("hidden"); rendAmis(); }
    else if (which === "challenge") { $("cbOnlineChallenge").removeAttribute("hidden"); $("cbChallengeTxt").textContent = txt || ""; }
  }
  function rendAmis() {
    var sel = $("cbAmiSelect"); if (!sel) return; var amis = lesAmis(); sel.textContent = "";
    var o0 = document.createElement("option"); o0.value = ""; o0.textContent = amis.length ? "— choisir un ami —" : "(aucun ami ajouté)"; sel.appendChild(o0);
    amis.forEach(function (a) { var o = document.createElement("option"); o.value = a; o.textContent = a; sel.appendChild(o); });
  }

  function ouvrir() { var p = $("combatPanel"); if (!p) return; injecteUI(); p.removeAttribute("hidden"); $("combatArene").setAttribute("hidden", ""); $("combatLobby").removeAttribute("hidden"); if (pending) showChallenge(); else onlineHide(); }
  function fermer() {
    if (etat && (etat.mode === "hote" || etat.mode === "invite") && !etat.fini) { try { etat.ref.remove(); } catch (e) {} }
    stopAttente();
    if (etat && etat.ref) { try { etat.ref.off(); } catch (e) {} }
    var p = $("combatPanel"); if (p) p.setAttribute("hidden", ""); var w = $("cbScaleWrap"); if (w) { w.innerHTML = ""; w.style.height = ""; } var cc = document.querySelector("#combatPanel .combat-card"); if (cc) cc.style.width = ""; etat = null; onlineHide();
  }

  document.addEventListener("DOMContentLoaded", function () {
    [].forEach.call(document.querySelectorAll(".js-combat"), function (b) { b.addEventListener("click", ouvrir); });
    var be = $("combatBtnEntrainement"); if (be) be.addEventListener("click", combatLocal);
    var bf = $("combatBtnFermer"); if (bf) bf.addEventListener("click", fermer);
    var bq = $("combatBtnQuitter"); if (bq) bq.addEventListener("click", fermer);
    var ba = $("combatBtnAlea"); if (ba) ba.addEventListener("click", aleatoire);
    var bm = $("combatBtnAmi"); if (bm) bm.addEventListener("click", function () { onlineShow("friends"); });
    var p = $("combatPanel"); if (p) p.addEventListener("click", function (e) { if (e.target === p) fermer(); });
    window.addEventListener("resize", function () { if (etat && etat.ifr) sizeScene(); });
    setInterval(abonneInvits, 3000); abonneInvits();
  });

  V.combatUI = { ouvrir: ouvrir, fermer: fermer, combatLocal: combatLocal };
})(window);
