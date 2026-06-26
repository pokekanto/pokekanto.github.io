(function (window) {
  "use strict";

  // Moteur IodineGBA : PAR DEFAUT. gbajs2 seulement via ?core=gbajs2 (secours).
  // Charge le coeur a la demande, rend dans #screen, meme interface que
  // emulator.js -> aucun changement visuel.
  if (new URLSearchParams(location.search).get("core") === "gbajs2") return;

  var V = window.Valdoria;
  var dom = V.dom, state = V.state;
  var $ = dom.$, setStatus = dom.setStatus;

  var BASE = "iodine/";
  var CORE_VER = "20260618e";   // cache-buster des scripts du coeur (Serial.js patche)
  var SCRIPTS = [
    "IodineGBA/includes/TypedArrayShim.js",
    "IodineGBA/core/Cartridge.js","IodineGBA/core/DMA.js","IodineGBA/core/Emulator.js",
    "IodineGBA/core/Graphics.js","IodineGBA/core/RunLoop.js","IodineGBA/core/Memory.js",
    "IodineGBA/core/IRQ.js","IodineGBA/core/JoyPad.js","IodineGBA/core/Serial.js",
    "IodineGBA/core/Sound.js","IodineGBA/core/Timer.js","IodineGBA/core/Wait.js",
    "IodineGBA/core/CPU.js","IodineGBA/core/Saves.js",
    "IodineGBA/core/sound/FIFO.js","IodineGBA/core/sound/Channel1.js","IodineGBA/core/sound/Channel2.js",
    "IodineGBA/core/sound/Channel3.js","IodineGBA/core/sound/Channel4.js",
    "IodineGBA/core/CPU/ARM.js","IodineGBA/core/CPU/THUMB.js","IodineGBA/core/CPU/CPSR.js",
    "IodineGBA/core/graphics/Renderer.js","IodineGBA/core/graphics/RendererShim.js",
    "IodineGBA/core/graphics/RendererProxy.js","IodineGBA/core/graphics/BGTEXT.js",
    "IodineGBA/core/graphics/BG2FrameBuffer.js","IodineGBA/core/graphics/BGMatrix.js",
    "IodineGBA/core/graphics/AffineBG.js","IodineGBA/core/graphics/ColorEffects.js",
    "IodineGBA/core/graphics/Mosaic.js","IodineGBA/core/graphics/OBJ.js",
    "IodineGBA/core/graphics/OBJWindow.js","IodineGBA/core/graphics/Window.js",
    "IodineGBA/core/graphics/Compositor.js",
    "IodineGBA/core/memory/DMA0.js","IodineGBA/core/memory/DMA1.js",
    "IodineGBA/core/memory/DMA2.js","IodineGBA/core/memory/DMA3.js",
    "IodineGBA/core/cartridge/SaveDeterminer.js","IodineGBA/core/cartridge/SRAM.js",
    "IodineGBA/core/cartridge/FLASH.js","IodineGBA/core/cartridge/EEPROM.js",
    "IodineGBA/core/cartridge/GPIO.js",
    "user_scripts/AudioGlueCode.js","user_scripts/base64.js","user_scripts/CoreGlueCode.js",
    "user_scripts/GfxGlueCode.js","user_scripts/ROMLoadGlueCode.js","user_scripts/SavesGlueCode.js",
    "user_scripts/XAudioJS/swfobject.js","user_scripts/XAudioJS/resampler.js",
    "user_scripts/XAudioJS/XAudioServer.js"
  ];

  var DEBUG = new URLSearchParams(location.search).has("debug");
  var dbg = null;
  function log(t) {
    if (!DEBUG) return;
    try {
      if (!dbg) {
        dbg = document.createElement("div");
        dbg.style.cssText = "position:fixed;left:0;bottom:0;z-index:99999;max-width:100%;background:rgba(0,0,0,.82);color:#5f5;font:11px/1.4 monospace;padding:4px;white-space:pre-wrap";
        (document.body || document.documentElement).appendChild(dbg);
      }
      dbg.textContent = "[iodine] " + t;
    } catch (e) {}
  }

  var coreLoading = null;
  function loadCore() {
    if (coreLoading) return coreLoading;
    log("chargement du coeur IodineGBA...");
    coreLoading = new Promise(function (resolve, reject) {
      var done = 0, total = SCRIPTS.length, failed = false;
      SCRIPTS.forEach(function (src) {
        var s = document.createElement("script");
        s.src = BASE + src + "?v=" + CORE_VER; s.async = false;   // parallele au telechargement, ordonne a l'execution
        s.onload = function () { if ((++done) === total && !failed) resolve(); };
        s.onerror = function () { if (!failed) { failed = true; reject(new Error("chargement " + src)); } };
        document.head.appendChild(s);
      });
    });
    return coreLoading;
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function (e) { res(e.target.result); };
      r.onerror = function () { rej(r.error || new Error("Lecture impossible.")); };
      r.readAsArrayBuffer(file);
    });
  }

  // --- adaptateur memoire : RAM IodineGBA vue comme le mmu de gbajs2 ---
  function mem() {
    try {
      var i = window.IodineGUI.Iodine;
      return (i && i.IOCore && i.IOCore.memory && i.IOCore.memory.internalRAM) ? i.IOCore.memory : null;
    } catch (e) { return null; }
  }
  function r8(a) {
    var m = mem(); a >>>= 0; if (!m) return 0;
    if (a >= 0x03000000 && a < 0x03008000) return m.internalRAM[a & 0x7FFF] || 0;
    if (a >= 0x02000000 && a < 0x02040000) return m.externalRAM[a & 0x3FFFF] || 0;
    return 0;
  }

  // --- faux keypad : tactile + clavier -> Iodine.keyDown/keyUp ---
  function makeKeypad() {
    var pad = { A:0,B:1,SELECT:2,START:3,RIGHT:4,LEFT:5,UP:6,DOWN:7,R:8,L:9, _d:0x3FF };
    Object.defineProperty(pad, "currentDown", {
      get: function () { return pad._d; },
      set: function (v) {
        v = v >>> 0; var ch = pad._d ^ v, i;
        for (i = 0; i < 10; i++) {
          if (ch & (1 << i)) {
            try { if (v & (1 << i)) window.IodineGUI.Iodine.keyUp(i); else window.IodineGUI.Iodine.keyDown(i); } catch (e) {}
          }
        }
        pad._d = v;
      }
    });
    return pad;
  }
  function installKeyboard(pad) {
    var ids = ["A","B","SELECT","START","RIGHT","LEFT","UP","DOWN","R","L"];
    function inField() { var a = document.activeElement; return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA"); }
    function h(e, down) {
      if (inField()) return;
      for (var k = 0; k < ids.length; k++) {
        var id = ids[k];
        if (pad["KEYCODE_" + id] === e.keyCode) {
          e.preventDefault();
          var b = 1 << pad[id];
          if (down) pad.currentDown &= ~b; else pad.currentDown |= b;
          return;
        }
      }
    }
    window.addEventListener("keydown", function (e) { h(e, true); });
    window.addEventListener("keyup", function (e) { h(e, false); });
  }

  var IG, inited = false, lastSave = null, audioOn = false, paused = false, partieSupprimee = false;
  var volumeVoulu = 0.2; try { var _v0 = parseFloat(window.localStorage.getItem("valdoria.volume")); if (_v0 >= 0 && _v0 <= 1) volumeVoulu = _v0; } catch (e) {}
  var ipsFrames = 0, ipsAt = 0, biosBuf = null;

  function setSoundBtn() {
    var b = $("soundBtn"); if (b) b.textContent = audioOn ? "🔇 Couper le son" : "🔊 Activer le son";
  }

  // Active l'audio en REVEILLANT d'abord le contexte (sinon buffer en overrun
  // -> le moteur bride le CPU -> le jeu se fige).
  function startAudio() {
    if (audioOn || !IG || !IG.Iodine) return;
    try {
      // Creer le mixer ICI (dans le geste) et SANS userEventLatch : XAudioJS cree
      // alors l'AudioContext immediatement, pendant l'action utilisateur -> il
      // demarre actif et produit du son. (Avec un latch = #screen, XAudioJS
      // attendait un appui sur #screen, jamais fait sur mobile -> muet. C'ETAIT LE BUG.)
      if (!IG.mixerInput) {
        var Mixer = new GlueCodeMixer();
        IG.mixerInput = new GlueCodeMixerInput(Mixer);
        IG.Iodine.attachAudioHandler(IG.mixerInput);
      }
      IG.Iodine.enableAudio();
      audioOn = true; setSoundBtn();
      try { if (IG.mixerInput) IG.mixerInput.setVolume(volumeVoulu); } catch (e0) {}
      var c = window.XAudioJSWebAudioContextHandle;
      if (c && c.state === "suspended" && c.resume) c.resume();
    } catch (e) {}
  }

  function initCore() {
    if (inited) return; inited = true;
    IG = window.IodineGUI;                       // defini par CoreGlueCode.js
    var Iodine = new GameBoyAdvanceEmulator();
    IG.Iodine = Iodine;

    // Handlers requis par play()/pause() (sinon playStatusCallback is not a function)
    Iodine.attachPlayStatusHandler(function (status) { paused = (status === 0); });
    Iodine.attachSpeedHandler(function () {});
    // Rendu ON-THREAD (sans worker, le mode offthread enverrait les frames dans le vide)
    if (Iodine.toggleOffthreadGraphics) Iodine.toggleOffthreadGraphics(false);

    // Graphismes -> canvas #screen existant, rendu net (pixelise) comme gbajs2
    var screen = $("screen");
    var Blitter = new GfxGlueCode(240, 160);
    Blitter.attachCanvas(screen);
    try { Blitter.setSmoothScaling(false); } catch (e) {}
    // QUALITE D'IMAGE (surtout mobile haute densite) : garder le canvas en
    // resolution NATIVE 240x160 (comme gbajs2). Le CSS image-rendering:pixelated
    // fait alors UN seul agrandissement net jusqu'a la resolution physique de
    // l'ecran. Par defaut GfxGlueCode met le canvas a la taille CSS -> sous-
    // resolution sur mobile -> image floue.
    try {
      Blitter.recomputeDimension = function () {
        this.canvasLastWidth = this.canvas.clientWidth;
        this.canvasLastHeight = this.canvas.clientHeight;
        this.onscreenWidth = this.canvas.width = this.offscreenWidth;
        this.onscreenHeight = this.canvas.height = this.offscreenHeight;
      };
      Blitter.recomputeDimension();
    } catch (e) {}
    Iodine.attachGraphicsFrameHandler(Blitter);
    IG.Blitter = Blitter;
    Blitter.attachGfxPostCallback(function () {
      ipsFrames++;
      var t = (window.performance ? performance.now() : Date.now());
      if (t - ipsAt >= 1000) { state.ips = Math.round(ipsFrames * 1000 / (t - ipsAt) * 10) / 10; ipsFrames = 0; ipsAt = t; }
    });

    // Audio : on NE cree PAS le mixer ici. XAudioJS, si on lui donne un
    // "userEventLatch", attend un appui SUR cet element pour creer le contexte.
    // On le cree donc plus tard, dans startAudio (1er geste), SANS latch -> le
    // contexte est cree immediatement, pendant le geste -> son (mobile inclus).

    // Sauvegarde : systeme natif IodineGBA (localStorage base64, par jeu).
    window.writeRedTemporaryText = window.writeRedTemporaryText || function () {};
    try {
      Iodine.attachSaveExportHandler(function (name, save) {
        if (partieSupprimee) return;
        try { ExportSaveCallback(name, save); } catch (e) {}
        if (name && ("" + name).indexOf("TYPE_") !== 0) { lastSave = save; updateSaveBtn(); }
      });
      Iodine.attachSaveImportHandler(ImportSaveCallback);
    } catch (e) { log("save indispo: " + e); }

    if (Iodine.toggleSkipBootROM) Iodine.toggleSkipBootROM(true);
    Iodine.setIntervalRate(8);

    // Audio active au PREMIER geste (clavier/pad/boutons). Le bouton son est
    // gere par toggleSound (on ne le double pas ici).
    // POLITIQUE NAVIGATEUR : le son ne peut demarrer qu'a une action utilisateur.
    // On l'active donc au TOUT PREMIER appui (commande clavier/tactile), une seule
    // fois (startAudio = resume puis enable). Grace a l'anti-gel ca ne met jamais
    // en pause ; et comme on n'active qu'une fois, aucune commande ne "coupe" le
    // son ensuite. Le bouton son gere le mute/unmute.
    function unlockAudio(ev) {
      if (audioOn) return;
      if (ev && ev.target && ev.target.closest && ev.target.closest("#soundBtn, #drawerSoundBtn")) return;
      startAudio();
    }
    window.addEventListener("pointerdown", unlockAudio, true);
    window.addEventListener("touchstart", unlockAudio, true);
    window.addEventListener("keydown", unlockAudio, true);
  }

  function ensureBios() {
    if (biosBuf) return Promise.resolve(biosBuf);
    return fetch(BASE + "gba_bios.bin").then(function (r) { return r.arrayBuffer(); }).then(function (b) { biosBuf = b; return b; });
  }
  function updateSaveBtn() { var b = $("saveBtn"); if (b) b.disabled = !lastSave; }

  function bootEmulator(romFile, onReady) {
    log("demarrage...");
    var romP = (romFile instanceof ArrayBuffer) ? Promise.resolve(romFile) : readFileAsArrayBuffer(romFile);
    loadCore().then(function () {
      log("coeur charge, initialisation...");
      initCore();
      return Promise.all([romP, ensureBios()]);
    }).then(function (arr) {
      var rom = arr[0], bios = arr[1];
      attachBIOS(bios);
      state.romBuffer = rom;
      attachROM(rom);

      var pad = makeKeypad();
      if (V.raccourcis) { try { V.raccourcis.applique({ keypad: pad }); } catch (e) {} }
      installKeyboard(pad);
      state.gba = {
        rom: true,
        keypad: pad,
        mmu: {
          cart: { code: "", title: "valdoria" },
          load32: function (a) { return (r8(a) | (r8(a + 1) << 8) | (r8(a + 2) << 16) | (r8(a + 3) << 24)) >>> 0; },
          loadU16: function (a) { return r8(a) | (r8(a + 1) << 8); },
          loadU8: function (a) { return r8(a); }
        },
        getSerial: function () {
          return (IG.Iodine && IG.Iodine.IOCore) ? IG.Iodine.IOCore.serial : null;
        }
      };

      // Audio PAS active ici (contexte suspendu au boot = gel). Active au 1er geste.
      IG.Iodine.play();
      // ANTI-GEL : l'audio peut faire deborder son buffer (contexte suspendu) et
      // l'emulateur bride alors le CPU a 0 -> le jeu se fige. Ce callback, lance a
      // CHAQUE iteration, garantit un budget CPU non nul -> le jeu ne se fige
      // JAMAIS (donc activer le son ne met plus en pause).
      try {
        IG.Iodine.coreExposed.appendStartIterationSync(function () {
          var J = IG.Iodine;
          if (J && (J.CPUCyclesTotal | 0) <= 0) J.CPUCyclesTotal = J.CPUCyclesPerIteration | 0;
        });
      } catch (e) {}
      // Le son s'active au tout premier appui de l'utilisateur (cf unlockAudio) :
      // c'est la seule facon autorisee par les navigateurs (pas de son sans geste).
      IG.startTime = Date.now();
      IG.coreTimerID = setInterval(function () {
        try { IG.Iodine.timerCallback((Date.now() - IG.startTime) >>> 0); } catch (e) {}
      }, 8);
      // Filet (ex: apres un restart qui efface le callback ci-dessus) : debloque le
      // CPU si l'audio l'etouffe. Ne coupe PAS le son.
      setInterval(function () {
        try {
          var J = IG.Iodine;
          if (J && (J.emulatorStatus | 0) === 5 && (J.CPUCyclesTotal | 0) <= 0) J.CPUCyclesTotal = J.CPUCyclesPerIteration | 0;
        } catch (e) {}
      }, 1000);

      var tries = 0, ci = setInterval(function () {
        try { var c = IG.Iodine.IOCore.cartridge; if (c && c.name) { state.gba.mmu.cart.code = c.name; clearInterval(ci); } } catch (e) {}
        if (++tries > 60) clearInterval(ci);
      }, 250);

      setStatus("Pret ! Connexion au monde...");
      try { sessionStorage.removeItem("valdoria.iodineFail"); } catch (e0) {}
      var _sb = $("saveBtn"); if (_sb) _sb.disabled = false;   // export possible des que le jeu tourne
      log("jeu lance (IodineGBA). Multijoueur dans 6s.");
      setTimeout(function () {
        if (dbg) dbg.style.display = "none";
        if (typeof onReady === "function") onReady();
      }, 6000);
    }).catch(function (err) {
      log("ERREUR: " + (err && err.message || err));
      // Filet de securite : si le moteur rapide echoue, repli auto sur gbajs2 (1 essai).
      try {
        if (!sessionStorage.getItem("valdoria.iodineFail")) {
          sessionStorage.setItem("valdoria.iodineFail", "1");
          location.replace(location.pathname + "?core=gbajs2");
          return;
        }
      } catch (e2) {}
      setStatus("Echec du moteur rapide. Recharge la page.");
    });
  }

  function loadSaveFile(file, options) {
    options = options || {};
    if (!file) return;
    if (!/\.sav$/i.test(file.name)) { setStatus("Choisis un fichier de sauvegarde .sav."); return; }
    return readFileAsArrayBuffer(file).then(function (buf) {
      var name = (state.gba && state.gba.mmu && state.gba.mmu.cart.code) || "";
      if (!name) { setStatus("Lance d'abord la ROM, puis importe la sauvegarde."); return; }
      try { setValue("SAVE_" + name, arrayToBase64(new Uint8Array(buf))); } catch (e) {}
      if (options.restart && state.romBuffer) { try { attachROM(state.romBuffer); IG.Iodine.play(); } catch (e) {} }
      var p = $("saveStatus"); if (p) p.textContent = "Sauvegarde .sav importee pour cette ROM.";
      setStatus("Sauvegarde .sav chargee.");
    });
  }

  function isBlankSave(u8) {
    var z = true, f = true;
    for (var i = 0; i < u8.length; i++) { if (u8[i] !== 0) z = false; if (u8[i] !== 0xFF) f = false; if (!z && !f) return false; }
    return true;
  }
  function downloadSave() {
    // exportSave() est SYNCHRONE -> lastSave est dispo juste apres ; on telecharge
    // dans le meme geste (un setTimeout casserait l'activation -> download bloque).
    try { if (IG && IG.Iodine) IG.Iodine.exportSave(); } catch (e) {}
    var p = $("saveStatus");
    if (!lastSave) { if (p) p.textContent = "Aucune sauvegarde a exporter (sauvegarde d'abord dans le jeu)."; return; }
    var u8 = (lastSave instanceof Uint8Array) ? lastSave : new Uint8Array(lastSave);
    if (isBlankSave(u8)) { if (p) p.textContent = "Sauvegarde vide : sauvegarde d'abord dans le jeu (menu)."; return; }
    var url = window.URL.createObjectURL(new Blob([u8], { type: "application/octet-stream" }));
    var a = document.createElement("a");
    a.href = url; a.download = "pokekanto.sav";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { try { window.URL.revokeObjectURL(url); } catch (e) {} }, 2000);
    if (p) p.textContent = "Export .sav genere (" + Math.round(u8.length / 1024) + " Ko) - regarde tes Telechargements.";
  }

  function toggleSound() {
    try {
      if (audioOn) { IG.Iodine.disableAudio(); audioOn = false; setSoundBtn(); }
      else { startAudio(); }
    } catch (e) {}
  }

  function togglePause() {
    try {
      if (paused) { IG.Iodine.play(); paused = false; var b = $("pauseBtn"); if (b) b.textContent = "Pause"; }
      else { IG.Iodine.pause(); paused = true; var b2 = $("pauseBtn"); if (b2) b2.textContent = "Reprendre"; }
    } catch (e) {}
  }

  function persistCurrentSave() { try { if (IG && IG.Iodine) IG.Iodine.exportSave(); } catch (e) {} return true; }

  // --- Sauvegarde cloud : recuperer / restaurer les octets du .sav (base64) ---
  function getSaveBase64() {
    try { if (IG && IG.Iodine) IG.Iodine.exportSave(); } catch (e) {}
    if (!lastSave) return null;
    var u8 = (lastSave instanceof Uint8Array) ? lastSave : new Uint8Array(lastSave);
    if (isBlankSave(u8)) return null;
    try { return arrayToBase64(u8); } catch (e) { return null; }
  }
  function restoreSaveBase64(b64) {
    var name = (state.gba && state.gba.mmu && state.gba.mmu.cart.code) || "";
    if (!name || !b64) return false;
    try { setValue("SAVE_" + name, b64); } catch (e) { return false; }
    if (state.romBuffer) { try { attachROM(state.romBuffer); IG.Iodine.play(); } catch (e) {} }
    return true;
  }

  // Supprime la sauvegarde LOCALE du jeu (toutes les cles localStorage du .sav).
  function deleteSave() {
    partieSupprimee = true;
    var name = (state.gba && state.gba.mmu && state.gba.mmu.cart.code) || "";
    try {
      if (name) { try { window.localStorage.removeItem("SAVE_" + name); } catch (e) {} }
      var aSupp = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (k && (k.indexOf("SAVE_") === 0 || k.indexOf("SAVE_") > 0 || /IodineGBA/i.test(k))) aSupp.push(k);
      }
      aSupp.forEach(function (k) { try { window.localStorage.removeItem(k); } catch (e) {} });
      lastSave = null;
    } catch (e) {}
    return true;
  }

  // Volume (0..1) : agit sur le mixer audio + persiste ; active le son si on monte.
  function setVolume(v) {
    v = Math.min(Math.max(v, 0), 1);
    volumeVoulu = v;
    try { window.localStorage.setItem("valdoria.volume", String(v)); } catch (e) {}
    try { if (IG && IG.mixerInput) IG.mixerInput.setVolume(v); } catch (e) {}
    if (v > 0 && !audioOn) { try { startAudio(); } catch (e) {} }
  }
  function getVolume() { return volumeVoulu; }

  window.Valdoria.emulator = {
    bootEmulator: bootEmulator,
    loadSaveFile: loadSaveFile,
    persistCurrentSave: persistCurrentSave,
    toggleSound: toggleSound,
    togglePause: togglePause,
    downloadSave: downloadSave,
    getSaveBase64: getSaveBase64,
    restoreSaveBase64: restoreSaveBase64,
    deleteSave: deleteSave,
    setVolume: setVolume,
    getVolume: getVolume
  };
  window.addEventListener("pagehide", persistCurrentSave);
})(window);
