(function (window) {
  "use strict";

  const state = window.Valdoria.state;
  const params = new URLSearchParams(window.location.search);
  const urlSb1 = params.get("sb1");

  // Détection "sur la carte" : gMain.callback2 (IWRAM, gMain+4 sur Rouge
  // Feu) pointe vers la boucle de l'overworld quand on est sur la carte,
  // et vers autre chose en combat/cinématique/menu titre. On ne connaît
  // pas sa valeur à l'avance (elle dépend de la ROM) : on l'apprend en
  // l'échantillonnant pendant que le joueur MARCHE (la position change),
  // puis on la retient (localStorage par ROM). Tant qu'elle n'est pas
  // apprise, on affiche tout comme avant — jamais pire que l'existant.
  const forceCb2 = params.get("cb2");
  let cb2Addr = forceCb2 ? (parseInt(forceCb2, 16) >>> 0) : 0x03005058;
  let cb2Connu = null;
  let cb2Charge = false;
  let cbCandidat = 0;
  let cbSerie = 0;
  let derniereXY = null;
  let dernierScan = 0;

  function estPtrRom(v) { return v >= 0x08000000 && v < 0x09000000; }
  function lire32(a) { try { return state.gba.mmu.load32(a) >>> 0; } catch (e) { return 0; } }

  // Localise gMain : callback1 + callback2 = pointeurs ROM, au moins 2 autres
  // handlers ROM dans la foulee, et intrCheck (gMain+0x1C) qui n'est PAS un
  // pointeur ROM. callback2 = gMain+4.
  function trouveCb2Addr() {
    for (let a = 0x03002000; a < 0x03004F00; a += 4) {
      if (!estPtrRom(lire32(a)) || !estPtrRom(lire32(a + 4))) continue;
      let autres = 0;
      for (let k = 2; k <= 6; k++) if (estPtrRom(lire32(a + k * 4))) autres++;
      if (autres >= 2 && !estPtrRom(lire32(a + 0x1C))) return a + 4;
    }
    return null;
  }

  function cleCb2() {
    const cart = state.gba && state.gba.mmu ? state.gba.mmu.cart : null;
    return cart && cart.code ? "valdoria.cb3." + cart.code : null;
  }

  function lireCb2() { return cb2Addr !== null ? lire32(cb2Addr) : 0; }

  function apprendCb2(pos) {
    if (!cb2Charge) {
      cb2Charge = true;
      try {
        const k = cleCb2();
        const v = k ? window.localStorage.getItem(k) : null;
        if (v) { const o = JSON.parse(v); if (o && (o.a >>> 0) === cb2Addr && o.c) { cb2Connu = o.c >>> 0; } }
      } catch (e) { /* stockage indisponible */ }
    }
    if (cb2Addr === null) {
      const now = Date.now();
      if (now - dernierScan > 2000) { dernierScan = now; cb2Addr = trouveCb2Addr(); }
      if (cb2Addr === null) return;
    }
    if (cb2Connu !== null) return;
    if (!derniereXY || (pos.x === derniereXY.x && pos.y === derniereXY.y)) {
      derniereXY = { x: pos.x, y: pos.y };
      return;
    }
    derniereXY = { x: pos.x, y: pos.y };
    const cb = lireCb2();
    if (!estPtrRom(cb)) return;
    if (cb === cbCandidat) {
      if (++cbSerie >= 3) {
        cb2Connu = cb;
        try { const k = cleCb2(); if (k) window.localStorage.setItem(k, JSON.stringify({ a: cb2Addr, c: cb2Connu })); } catch (e) {}
      }
    } else {
      cbCandidat = cb;
      cbSerie = 1;
    }
  }

  // true = overworld (ou détection pas encore apprise), false = combat,
  // cinématique, menu titre… : l'overlay ne doit rien dessiner.
  function estSurCarte() {
    if (!state.gba || !state.gba.rom || cb2Connu === null) return true;
    return lireCb2() === cb2Connu;
  }
  const sb1Candidates = urlSb1 ? [parseInt(urlSb1, 16)] : [0x03005008, 0x0300500C, 0x03005010];
  let sb1Found = null;
  let lastScan = 0;

  function lirePosA(addr) {
    const gba = state.gba;
    const ptr = gba.mmu.load32(addr) >>> 0;
    if (ptr < 0x02000000 || ptr >= 0x02040000) return null;
    const x = gba.mmu.loadU16(ptr);
    const y = gba.mmu.loadU16(ptr + 2);
    const g = gba.mmu.loadU8(ptr + 4);
    const m = gba.mmu.loadU8(ptr + 5);
    if (x < 1 || x > 1500 || y < 1 || y > 1500 || g > 60 || m > 90) return null;
    return { addr, ptr, x, y, g, m, sexe: lireSexe(addr), nom: lireNom(addr) };
  }

  // Nom du héros : les 8 premiers octets de SaveBlock2 (7 caractères
  // + terminateur 0xFF), encodage propriétaire Gen III, table occidentale.
  // On ne décode que l'utile : chiffres, lettres, accents français.
  const GEN3 = (function () {
    const t = { 0x00: " ", 0xAB: "!", 0xAC: "?", 0xAD: ".", 0xAE: "-" };
    "0123456789".split("").forEach((c, i) => { t[0xA1 + i] = c; });
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((c, i) => { t[0xBB + i] = c; });
    "abcdefghijklmnopqrstuvwxyz".split("").forEach((c, i) => { t[0xD5 + i] = c; });
    t[0x06] = "É"; t[0x16] = "à"; t[0x19] = "ç"; t[0x1A] = "è"; t[0x1B] = "é";
    t[0x1C] = "ê"; t[0x20] = "î"; t[0x24] = "ô"; t[0x26] = "ù"; t[0x28] = "û";
    return t;
  })();

  function lireNom(sb1Addr) {
    try {
      const ptr2 = state.gba.mmu.load32(sb1Addr + 4) >>> 0;
      if (ptr2 < 0x02000000 || ptr2 >= 0x02040000) return null;
      let nom = "";
      for (let i = 0; i < 7; i++) {
        const c = state.gba.mmu.loadU8(ptr2 + i);
        if (c === 0xFF) break;
        nom += GEN3[c] || "?";
      }
      nom = nom.trim();
      // un nom illisible (que des '?') = encodage inattendu : on ignore
      return nom && nom.replace(/\?/g, "").length ? nom : null;
    } catch (e) {
      return null;
    }
  }

  // Genre du héros : le pointeur SaveBlock2 suit SaveBlock1 en IWRAM,
  // et playerGender est à l'offset 0x8 (après le nom sur 8 octets).
  // 0 = garçon, 1 = fille, null = illisible.
  function lireSexe(sb1Addr) {
    try {
      const ptr2 = state.gba.mmu.load32(sb1Addr + 4) >>> 0;
      if (ptr2 < 0x02000000 || ptr2 >= 0x02040000) return null;
      const sexe = state.gba.mmu.loadU8(ptr2 + 8);
      return sexe === 0 || sexe === 1 ? sexe : null;
    } catch (e) {
      return null;
    }
  }

  function scanSaveBlock() {
    const gba = state.gba;
    for (let a = 0x03000000; a < 0x03007FF8; a += 4) {
      try {
        const p2 = gba.mmu.load32(a + 4) >>> 0;
        if (p2 < 0x02000000 || p2 >= 0x02040000) continue;
        const pos = lirePosA(a);
        if (pos) return a;
      } catch (e) { /* zone non mappée */ }
    }
    return null;
  }

  function readMyPos() {
    const gba = state.gba;
    if (!gba || !gba.rom) return null;
    try {
      if (sb1Found) {
        const pos = lirePosA(sb1Found);
        if (pos) { apprendCb2(pos); return pos; }
        sb1Found = null;
      }
      for (const addr of sb1Candidates) {
        const pos = lirePosA(addr);
        if (pos) { sb1Found = addr; apprendCb2(pos); return pos; }
      }
      const now = Date.now();
      if (now - lastScan > 3000) {
        lastScan = now;
        const a = scanSaveBlock();
        if (a) { sb1Found = a; return lirePosA(a); }
      }
    } catch (err) { /* lecture impossible pour l'instant */ }
    return null;
  }

  window.Valdoria.position = { readMyPos, estSurCarte, _diag: function () { return { addr: cb2Addr, connu: cb2Connu, cur: lireCb2(), trouve: trouveCb2Addr() }; } };
})(window);
