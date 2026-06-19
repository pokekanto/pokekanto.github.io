(function (window) {
  "use strict";

  const { $ } = window.Valdoria.dom;
  const state = window.Valdoria.state;
  const directionKeys = ["UP", "RIGHT", "DOWN", "LEFT"];

  function keypad() {
    return state.gba && state.gba.keypad ? state.gba.keypad : null;
  }

  function setKey(key, pressed) {
    const pad = keypad();
    if (!pad || typeof pad[key] !== "number") return;

    const bit = 1 << pad[key];
    if (pressed) pad.currentDown &= ~bit;
    else pad.currentDown |= bit;
  }

  function releaseDirections() {
    directionKeys.forEach(key => setKey(key, false));
  }

  // Un appui sur la manette ne doit jamais laisser le clavier virtuel
  // ouvert : si un champ texte (tchat, pseudo) a encore le focus, on le
  // rend — preventDefault() sur pointerdown empêche le blur naturel.
  function fermeClavier() {
    const actif = document.activeElement;
    if (actif && (actif.tagName === "INPUT" || actif.tagName === "TEXTAREA")) actif.blur();
  }

  /* ----- boutons simples (A, B, L, R, Start, Select, Menu jeu) ----- */
  function bindTouchButton(button) {
    const key = button.dataset.gbaKey;
    if (!key) return;

    const press = event => {
      event.preventDefault();
      fermeClavier();
      button.setPointerCapture?.(event.pointerId);
      button.classList.add("is-active");
      setKey(key, true);
    };
    const release = event => {
      event.preventDefault();
      button.classList.remove("is-active");
      setKey(key, false);
    };

    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", () => {
      button.classList.remove("is-active");
      setKey(key, false);
    });
    button.addEventListener("contextmenu", event => event.preventDefault());
  }

  /* ----- croix directionnelle ------------------------------------
     Toute la zone est tactile : on peut maintenir une direction et
     faire glisser le pouce pour tourner sans relâcher, comme sur
     une vraie croix GBA. Petite zone morte au centre pour éviter
     les changements de direction involontaires. */
  let activeDir = null;
  let dpadPointer = null;

  function dpadButton(dir) {
    return document.querySelector('.dpad .d[data-dir="' + dir + '"]');
  }

  function applyDirection(dir) {
    if (dir === activeDir) return;
    if (activeDir) {
      setKey(activeDir, false);
      const old = dpadButton(activeDir);
      if (old) old.classList.remove("is-active");
    }
    activeDir = dir;
    if (dir) {
      setKey(dir, true);
      const el = dpadButton(dir);
      if (el) el.classList.add("is-active");
    }
  }

  function directionFromEvent(pad, event) {
    const rect = pad.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) < rect.width * 0.12) return activeDir; // zone morte : on garde la direction
    return Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "RIGHT" : "LEFT")
      : (dy > 0 ? "DOWN" : "UP");
  }

  function bindDpad() {
    const pad = $("dpadZone");
    if (!pad) return;

    pad.addEventListener("pointerdown", event => {
      event.preventDefault();
      fermeClavier();
      dpadPointer = event.pointerId;
      pad.setPointerCapture?.(event.pointerId);
      applyDirection(directionFromEvent(pad, event));
    });
    pad.addEventListener("pointermove", event => {
      if (event.pointerId !== dpadPointer) return;
      event.preventDefault();
      applyDirection(directionFromEvent(pad, event));
    });
    const end = () => { dpadPointer = null; applyDirection(null); };
    pad.addEventListener("pointerup", end);
    pad.addEventListener("pointercancel", end);
    pad.addEventListener("lostpointercapture", end);
    pad.addEventListener("contextmenu", event => event.preventDefault());
  }

  function toggleValdoriaMenu(open) {
    $("valdoriaOptions").classList.toggle("open", open);
    $("mobileBackdrop").classList.toggle("open", open);
  }

  function bindMenus() {
    $("mobileValdoriaBtn").addEventListener("click", () => toggleValdoriaMenu(true));
    $("closeValdoriaMenu").addEventListener("click", () => toggleValdoriaMenu(false));
    $("mobileBackdrop").addEventListener("click", () => toggleValdoriaMenu(false));
  }

  document.querySelectorAll("[data-gba-key]").forEach(bindTouchButton);
  bindDpad();
  bindMenus();

  // Filet global (notamment en plein écran) : tout contact en dehors d'un
  // champ texte rend le focus, en phase de capture pour passer avant les
  // preventDefault() des contrôles. Le clavier virtuel ne peut donc pas
  // rester ouvert pendant qu'on joue, quel que soit l'élément touché.
  document.addEventListener("pointerdown", event => {
    const actif = document.activeElement;
    if (!actif || (actif.tagName !== "INPUT" && actif.tagName !== "TEXTAREA")) return;
    if (event.target === actif) return;
    actif.blur();
  }, true);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      applyDirection(null);
      releaseDirections();
      ["A", "B", "L", "R", "START", "SELECT"].forEach(key => setKey(key, false));
    }
  });
})(window);
