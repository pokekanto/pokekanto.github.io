(function (window) {
  "use strict";

  const { $ } = window.Valdoria.dom;
  const state = window.Valdoria.state;
  const emulator = window.Valdoria.emulator;
  const network = window.Valdoria.network;
  const position = window.Valdoria.position;
  const overlay = window.Valdoria.overlay;
  const debug = window.Valdoria.debug;

  function startGameLoop() {
    network.connectWorld();
    setInterval(() => {
      state.myPos = position.readMyPos();
      state.surCarte = position.estSurCarte();
      if (state.myPos) {
        network.sendPos(state.myPos);
        if (window.Valdoria.linkroom) window.Valdoria.linkroom.check(state.myPos);
      }
      debug.updateDebug();
    }, 125);
    requestAnimationFrame(overlay.drawOverlay);
  }

  // pseudo retenu d'une visite à l'autre
  try {
    const pseudo = window.localStorage.getItem("valdoria.pseudo");
    if (pseudo) $("playerName").value = pseudo;
  } catch (e) { /* stockage indisponible */ }

  $("playSavInput").addEventListener("change", e => {
    emulator.loadSaveFile(e.target.files[0] || null, { restart: true });
  });

  var roms = window.Valdoria.roms;
  var romDrop = $("romDrop");
  var romStatus = $("romStatus");
  var launchBtn = $("launchBtn");

  function lancePartie(buffer) {
    $("setup").style.display = "none";
    $("play").style.display = "block";
    document.body.classList.add("is-playing");
    emulator.bootEmulator(buffer, startGameLoop);
  }

  function utiliseFichier(f) {
    if (!f) return;
    f.arrayBuffer().then(function (buf) {
      if (roms) roms.put(buf).catch(function () {});
      lancePartie(buf);
    });
  }

  if (roms && romStatus) {
    roms.has().then(function (ok) {
      if (ok) {
        if (launchBtn) launchBtn.hidden = false;
        romStatus.textContent = "ROM enregistrée — prête à jouer.";
        romStatus.classList.add("ok");
        if (romDrop) {
          var t = romDrop.querySelector(".rom-drop-titre");
          if (t) t.textContent = "Changer de ROM";
          romDrop.classList.add("compact");
        }
      } else {
        romStatus.textContent = "Dépose ta ROM Rouge Feu pour commencer.";
      }
    });
  }

  if (launchBtn) {
    launchBtn.addEventListener("click", function () {
      roms.get().then(function (buf) { if (buf) lancePartie(buf); else $("romInput").click(); });
    });
  }

  if (romDrop) {
    romDrop.addEventListener("click", function () { $("romInput").click(); });
    romDrop.addEventListener("dragover", function (e) { e.preventDefault(); romDrop.classList.add("survol"); });
    romDrop.addEventListener("dragleave", function () { romDrop.classList.remove("survol"); });
    romDrop.addEventListener("drop", function (e) {
      e.preventDefault();
      romDrop.classList.remove("survol");
      utiliseFichier(e.dataTransfer && e.dataTransfer.files ? e.dataTransfer.files[0] : null);
    });
  }

  $("romInput").addEventListener("change", function (e) {
    utiliseFichier(e.target.files[0]);
    e.target.value = "";
  });

  $("soundBtn").addEventListener("click", emulator.toggleSound);
  const volSlider = $("volSlider");
  if (volSlider) {
    try { if (emulator.getVolume) volSlider.value = Math.round(emulator.getVolume() * 100); } catch (e) {}
    volSlider.addEventListener("input", () => emulator.setVolume(volSlider.value / 100));
  }
  $("saveBtn").addEventListener("click", emulator.downloadSave);
  const debugToggle = $("debugToggle");
  if (debugToggle) debugToggle.addEventListener("click", debug.toggleDebugPanel);

  // Drawer mobile — délégation vers les mêmes handlers
  const drawerSoundBtn = $("drawerSoundBtn");
  if (drawerSoundBtn) drawerSoundBtn.addEventListener("click", emulator.toggleSound);

  const hudSoundBtn = $("hudSoundBtn");
  if (hudSoundBtn) hudSoundBtn.addEventListener("click", emulator.toggleSound);

  const drawerImportBtn = $("drawerImportBtn");
  if (drawerImportBtn) drawerImportBtn.addEventListener("click", () => $("playSavInput").click());

  const drawerSaveBtn = $("drawerSaveBtn");
  if (drawerSaveBtn) {
    drawerSaveBtn.addEventListener("click", emulator.downloadSave);
    // Sync état disabled depuis #saveBtn
    const origSave = $("saveBtn");
    if (origSave) new MutationObserver(() => {
      drawerSaveBtn.disabled = origSave.disabled;
    }).observe(origSave, { attributes: true, attributeFilter: ["disabled"] });
  }

  // Boutons Cable Club (action bar + drawer) : ouverture du lobby geree dans linkroom.js

  // Bouton Reglages (PC) : ouvre/ferme la sidebar en modale
  (function () {
    const sBtn = $("settingsBtn"), sPanel = $("screenSidebar"), sBack = $("settingsBackdrop"), sClose = $("settingsClose");
    if (!sBtn || !sPanel) return;
    const ouvre = () => { sPanel.classList.add("open"); if (sBack) sBack.classList.add("open"); };
    const ferme = () => { sPanel.classList.remove("open"); if (sBack) sBack.classList.remove("open"); };
    sBtn.addEventListener("click", ouvre);
    if (sClose) sClose.addEventListener("click", ferme);
    if (sBack) sBack.addEventListener("click", ferme);
  })();

  // Fond video de l'accueil : force la lecture (muet) si l'autoplay ne se declenche pas tout seul
  (function () {
    const bg = $("bgVideo");
    if (bg) { try { bg.muted = true; const p = bg.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  })();

  // légende des boutons (bas droite)
  $("legendeToggle").addEventListener("click", e => {
    e.stopPropagation();
    const p = $("legendePanel");
    p.hidden ? p.removeAttribute("hidden") : p.setAttribute("hidden", "");
  });
  document.addEventListener("click", () => $("legendePanel").setAttribute("hidden", ""));
})(window);
