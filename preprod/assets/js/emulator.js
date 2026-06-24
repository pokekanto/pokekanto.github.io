(function (window) {
  "use strict";

  const { $, setStatus } = window.Valdoria.dom;
  const state = window.Valdoria.state;
  const SAVE_META_PREFIX = "valdoria.saveMeta.";

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(event.target.result);
      reader.onerror = () => reject(reader.error || new Error("Lecture impossible."));
      reader.readAsArrayBuffer(file);
    });
  }

  function isSavFile(file) {
    return !!file && /\.sav$/i.test(file.name);
  }

  function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function formatSize(bytes) {
    if (!bytes) return "0 Ko";
    return Math.round(bytes / 1024) + " Ko";
  }

  function setSaveStatus(message) {
    const panel = $("saveStatus");
    if (panel) panel.textContent = message;
  }

  function getCart() {
    return state.gba && state.gba.mmu ? state.gba.mmu.cart : null;
  }

  function getCartCode() {
    const cart = getCart();
    return cart && cart.code ? cart.code : "";
  }

  function getCartTitle() {
    const cart = getCart();
    return cart && cart.title ? cart.title : "valdoria";
  }

  function getSaveStorageKey() {
    const code = getCartCode();
    if (!state.gba || !code) return "";
    return state.gba.SYS_ID + "." + code;
  }

  function getSaveMetaKey() {
    const code = getCartCode();
    return code ? SAVE_META_PREFIX + code : "";
  }

  function getSaveView() {
    const save = state.gba && state.gba.mmu ? state.gba.mmu.save : null;
    return save && save.view ? save.view : null;
  }

  function getSaveBufferCopy() {
    const view = getSaveView();
    if (!view) return null;
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }

  function isBlankSaveBuffer(buffer) {
    if (!buffer || !buffer.byteLength) return true;

    const bytes = new Uint8Array(buffer);
    let hasNonZero = false;
    let hasNonFF = false;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] !== 0) hasNonZero = true;
      if (bytes[i] !== 0xff) hasNonFF = true;
      if (hasNonZero && hasNonFF) return false;
    }
    return true;
  }

  function hasLocalSave() {
    const key = getSaveStorageKey();
    if (!key) return false;
    try {
      return !!window.localStorage.getItem(key);
    } catch (e) {
      return false;
    }
  }

  function readLocalSaveMeta() {
    const key = getSaveMetaKey();
    if (!key) return null;
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (e) {
      return null;
    }
  }

  function writeLocalSaveMeta(source) {
    const key = getSaveMetaKey();
    const view = getSaveView();
    if (!key || !view) return;
    const savedAt = Date.now();
    state.lastLocalSaveAt = savedAt;
    try {
      window.localStorage.setItem(key, JSON.stringify({
        code: getCartCode(),
        title: getCartTitle(),
        source,
        savedAt,
        size: view.byteLength
      }));
    } catch (e) {
      console.warn("[save]", e);
    }
  }

  function updateSaveControls() {
    const hasGame = !!(state.gba && state.gba.rom && getSaveView());
    $("saveBtn").disabled = !hasGame;
  }

  function updateInitialSaveStatus(imported) {
    updateSaveControls();
    if (imported) {
      setSaveStatus("Sauvegarde .sav importée. Elle remplace le slot local de cette ROM.");
      return;
    }

    if (hasLocalSave()) {
      const meta = readLocalSaveMeta();
      const suffix = meta && meta.savedAt ? " à " + formatTime(meta.savedAt) : "";
      setSaveStatus("Slot local unique chargé" + suffix + ".");
    } else {
      setSaveStatus("Aucun slot local pour cette ROM.");
    }
  }

  function setSaveData(buffer, name) {
    state.pendingSave = buffer;
    state.pendingSaveName = name || "";
  }

  function applyPendingSave() {
    if (!state.gba || !state.pendingSave) return false;
    state.gba.setSavedata(state.pendingSave);
    return true;
  }

  function persistCurrentSave(message, source = "manual") {
    const gba = state.gba;
    if (!gba || !gba.rom || !getSaveView()) {
      setSaveStatus("Aucune sauvegarde disponible pour cette ROM.");
      return false;
    }

    const buffer = getSaveBufferCopy();
    if (isBlankSaveBuffer(buffer)) {
      setSaveStatus("Sauvegarde vide : sauvegarde d'abord depuis le menu du jeu.");
      return false;
    }

    gba.storeSavedata();
    writeLocalSaveMeta(source);
    updateSaveControls();
    setSaveStatus(message || "Sauvegarde locale remplacée à " + formatTime(Date.now()) + ".");
    return true;
  }

  function resetWithCurrentSave(options = {}) {
    const gba = state.gba;
    if (!gba || !state.romBuffer || !state.pendingSave) return false;

    const soundEnabled = gba.audio.masterEnable;
    gba.pause();
    gba.setRom(state.romBuffer);
    gba.audio.masterEnable = soundEnabled;
    applyPendingSave();
    state.myPos = null;
    for (const id of Object.keys(state.joueurs)) state.joueurs[id].visible = false;
    gba.runStable();
    if (options.persist !== false)
      persistCurrentSave("Sauvegarde .sav importée. Elle remplace le slot local de cette ROM.", "import");
    updateSaveControls();
    return true;
  }

  function installSaveHooks(gba) {
    const storeSavedata = gba.storeSavedata.bind(gba);
    gba.storeSavedata = function () {
      const result = storeSavedata();
      writeLocalSaveMeta("auto");
      updateSaveControls();
      setSaveStatus("Sauvegarde locale remplacée automatiquement à " + formatTime(Date.now()) + ".");
      return result;
    };
  }

  function bootEmulator(romFile, onReady) {
    const gba = new GameBoyAdvance();
    state.gba = gba;
    installSaveHooks(gba);

    gba.keypad.eatInput = true;
    if (window.Valdoria.raccourcis) window.Valdoria.raccourcis.applique(gba);
    gba.logLevel = gba.LOG_ERROR;
    gba.setLogger((level, error) => console.error("[gba]", error));

    // gbajs est servi depuis le dépôt (js/) : son worker de rendu est
    // trouvable et le renderer par défaut dessine dans un thread dédié,
    // ce qui libère le thread principal (gros gain PC et mobile).
    // Sans Worker, gbajs retombe tout seul sur le rendu logiciel.
    const renduLogiciel = gba.video.renderPath instanceof GameBoyAdvanceSoftwareRenderer;

    // Audio : sortie via AudioWorklet (voir assets/js/audio.js pour le pourquoi).
    if (gba.audio && gba.audio.context) {
      gba.audio.masterVolume = 0.85;   // évite la saturation des musiques
      window.Valdoria.audio.setup(gba);
    }

    // Rendu direct dans un canvas 240x160 (résolution GBA native) :
    // un seul putImageData par frame, pas de canvas intermédiaire ni de
    // blit agrandi (gba.setCanvas ferait les deux). C'est le CSS
    // (image-rendering:pixelated) qui agrandit proprement à l'écran.
    // alpha:false = canvas opaque, composition moins chère sur mobile.
    const screenCanvas = $("screen");
    screenCanvas.width = 240;
    screenCanvas.height = 160;
    screenCanvas.getContext("2d", { alpha: false });
    gba.setCanvasDirect(screenCanvas);

    // Cadence : gbajs planifie chaque frame avec setTimeout(16 ms), donc
    // émulation + attente fixe → ~35-40 i/s dès que la frame coûte
    // quelques ms (mobiles), avec du jitter. On cale plutôt la boucle sur
    // le rafraîchissement de l'écran (requestAnimationFrame), avec un
    // rattrapage borné du retard pour tenir la vitesse réelle du jeu.
    const fpsCible = (function () {
      var v = parseFloat(new URLSearchParams(location.search).get("fps"));
      return (v >= 5 && v <= 120) ? v : 59.7275;   // test: ?fps=30 ralentit tout le jeu
    })();
    const FRAME_MS = 1000 / fpsCible;       // cadence cible (defaut = GBA 59,7275)
    let horloge = 0;
    let retard = 0;
    let vsyncMs = FRAME_MS;   // durée mesurée entre deux ticks d'écran
    window.queueFrame = function (f) {
      requestAnimationFrame(function (maintenant) {
        if (!horloge) horloge = maintenant - FRAME_MS;
        const delta = maintenant - horloge;
        horloge = maintenant;
        if (delta < 100) vsyncMs = vsyncMs * 0.9 + delta * 0.1;
        retard += delta;
        // onglet revenu au premier plan : on ne rattrape pas des minutes
        if (retard > 4 * FRAME_MS) retard = 4 * FRAME_MS;
        // écran 90/120 Hz : trop tôt pour une nouvelle frame
        if (retard < FRAME_MS) { window.queueFrame(f); return; }
        retard -= FRAME_MS;
        f();                               // émule une frame et replanifie
        // encore en retard et du budget avant le prochain vsync : on rattrape
        // (budget calé sur le rythme réel : écran 30 Hz en mode éco, 60, 120…)
        let rattrap = 0;
        const budget = Math.min(12, vsyncMs - 4);
        while (retard >= FRAME_MS && rattrap < 2 && performance.now() - maintenant < budget && !gba.paused) {
          retard -= FRAME_MS;
          rattrap++;
          gba.advanceFrame();
        }
      });
    };

    gba.setBios(biosBin);
    gba.audio.masterEnable = false;

    // Rouge Feu peut rester bloqué dans IntrWait si les IRQ sont masquées.
    const avance = gba.advanceFrame.bind(gba);

    // Saut de rendu adaptatif, utile seulement en rendu logiciel (le
    // renderer à worker gère son retard lui-même) : si l'appareil ne tient
    // pas 60 i/s, on ne dessine qu'1 frame sur 2 puis 1 sur 3. La logique
    // du jeu et l'audio gardent leur vitesse, seul l'affichage est allégé.
    const renderPath = gba.video.renderPath;
    const vraiScanline = renderPath.drawScanline;
    const vraiFinishDraw = renderPath.finishDraw;
    const rienScanline = function () {};
    const rienFinish = function () {
      // même sur une frame sautée, remettre à zéro les fonds affines
      // (sinon ils dérivent) ; on ne saute que l'affichage.
      this.bg[2].sx = this.bg[2].refx;
      this.bg[2].sy = this.bg[2].refy;
      this.bg[3].sx = this.bg[3].refx;
      this.bg[3].sy = this.bg[3].refy;
    };
    let frameIndex = 0;
    let coutTotal = 0, coutFrames = 0;
    let ipsDepuis = performance.now(), ipsFrames = 0;
    let niveauSaut = 0;   // 0 = tout dessiner, 1 = 1 frame sur 2, 2 = 1 sur 3

    gba.advanceFrame = function () {
      if ((gba.cpu.gprs[15] >>> 0) < 0x4000 && gba.cpu.cpsrI) {
        try {
          if (gba.mmu.loadU16(0x04000200) & gba.mmu.loadU16(0x04000202))
            gba.cpu.cpsrI = false;
        } catch (e) { /* ignore */ }
      }

      frameIndex++;
      // vitesse réelle d'émulation, lisible dans le panneau debug :
      // ~59,7 i/s = vitesse GBA exacte (la musique est alors à son vrai tempo)
      ipsFrames++;
      const ipsT = performance.now();
      if (ipsT - ipsDepuis >= 1000) {
        state.ips = Math.round(ipsFrames * 1000 / (ipsT - ipsDepuis) * 10) / 10;
        ipsFrames = 0;
        ipsDepuis = ipsT;
      }
      const sauterCelleCi = renduLogiciel && niveauSaut > 0 && frameIndex % (niveauSaut + 1) !== 0;
      if (sauterCelleCi) {
        renderPath.drawScanline = rienScanline;
        renderPath.finishDraw = rienFinish;
      }
      const t0 = performance.now();
      avance();
      const dt = performance.now() - t0;
      window.Valdoria.audio.pump(gba);
      if (sauterCelleCi) {
        renderPath.drawScanline = vraiScanline;
        renderPath.finishDraw = vraiFinishDraw;
      } else {
        // on ne mesure que les frames complètes pour jauger la puissance
        coutTotal += dt;
        coutFrames++;
        if (coutFrames >= 30) {
          const moyenne = coutTotal / coutFrames;
          // marge sous 16,7 ms : il faut aussi du temps pour le rattrapage,
          // sinon l'audio se vide et coupe (saccades sur mobile)
          niveauSaut = moyenne > 15 ? 2 : moyenne > 12 ? 1 : 0;
          coutTotal = 0; coutFrames = 0;
        }
      }
    };

    var lectureRom = (romFile instanceof ArrayBuffer) ? Promise.resolve(romFile) : readFileAsArrayBuffer(romFile);
    lectureRom.then(async romBuffer => {
      if (state.pendingSaveRead) await state.pendingSaveRead;
      state.romBuffer = romBuffer;
      const ok = gba.setRom(romBuffer);
      if (!ok) { setStatus("Impossible de lire cette ROM."); return; }
      const imported = applyPendingSave();
      if (imported)
        persistCurrentSave("Sauvegarde .sav importée. Elle remplace le slot local de cette ROM.", "import");
      gba.runStable();
      updateInitialSaveStatus(imported);
      setStatus("Prêt ! Connexion au monde…");
      if (typeof onReady === "function") onReady();
    }).catch(error => {
      console.error("[gba]", error);
      setStatus("Impossible de lire cette ROM.");
    });
  }

  function loadSaveFile(file, options = {}) {
    state.pendingSaveRead = null;
    if (!file) return;
    if (!isSavFile(file)) {
      setStatus("Choisis un fichier de sauvegarde .sav.");
      return;
    }

    const read = readFileAsArrayBuffer(file).then(buffer => {
      if (isBlankSaveBuffer(buffer)) {
        setSaveStatus("Ce fichier .sav ne contient pas de partie valide.");
        setStatus("Sauvegarde .sav vide ou non initialisée.");
        return null;
      }

      setSaveData(buffer, file.name);
      if (options.restart && state.gba && state.gba.rom) {
        const expected = getSaveView() ? getSaveView().byteLength : 0;
        resetWithCurrentSave();
        if (expected && expected !== buffer.byteLength)
          setSaveStatus("Sauvegarde importée (" + formatSize(buffer.byteLength) + "), taille attendue " + formatSize(expected) + ".");
        setStatus("Sauvegarde .sav chargée. Lance la partie depuis le menu du jeu.");
      }
      return buffer;
    }).catch(error => {
      console.error("[gba]", error);
      setStatus("Impossible de lire cette sauvegarde .sav.");
      return null;
    });
    state.pendingSaveRead = read;
    return read;
  }

  function toggleSound() {
    const gba = state.gba;
    gba.audio.masterEnable = !gba.audio.masterEnable;
    if (gba.audio.masterEnable && gba.audio.context && gba.audio.context.state !== "running")
      gba.audio.context.resume();
    $("soundBtn").textContent = gba.audio.masterEnable ? "🔇 Couper le son" : "🔊 Activer le son";
  }

  function togglePause() {
    const gba = state.gba;
    if (gba.paused) { gba.runStable(); $("pauseBtn").textContent = "Pause"; }
    else { gba.pause(); $("pauseBtn").textContent = "Reprendre"; }
  }

  function downloadSave() {
    const buffer = getSaveBufferCopy();
    if (!buffer) {
      setSaveStatus("Aucune sauvegarde à exporter.");
      return;
    }
    if (isBlankSaveBuffer(buffer)) {
      setSaveStatus("Export bloqué : sauvegarde d'abord depuis le menu du jeu.");
      return;
    }

    const name = getCartTitle().replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "valdoria";
    const url = window.URL.createObjectURL(new Blob([buffer], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name + ".sav";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setSaveStatus("Export .sav généré (" + formatSize(buffer.byteLength) + ").");
  }

  window.Valdoria.emulator = {
    bootEmulator,
    loadSaveFile,
    persistCurrentSave,
    toggleSound,
    togglePause,
    downloadSave
  };
})(window);
