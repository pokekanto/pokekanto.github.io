(function (window) {
  "use strict";

  // Remappage des raccourcis clavier (PC) : panneau sombre translucide
  // ouvert depuis les options. Conservé dans le navigateur (localStorage)
  // et appliqué au keypad gbajs à chaque démarrage de ROM.

  const { $ } = window.Valdoria.dom;
  const state = window.Valdoria.state;
  const CLE = "valdoria.raccourcis";

  const ACTIONS = [
    ["A", "Bouton A"], ["B", "Bouton B"],
    ["L", "Gâchette L"], ["R", "Gâchette R"],
    ["START", "Start"], ["SELECT", "Select"],
    ["UP", "Haut"], ["DOWN", "Bas"], ["LEFT", "Gauche"], ["RIGHT", "Droite"]
  ];
  // c = keyCode attendu par gbajs ; l = libellé affiché
  const DEFAUTS = {
    A: { c: 90, l: "Z" }, B: { c: 88, l: "X" },
    L: { c: 65, l: "A" }, R: { c: 83, l: "S" },
    START: { c: 13, l: "Entrée" }, SELECT: { c: 220, l: "\\" },
    UP: { c: 38, l: "↑" }, DOWN: { c: 40, l: "↓" },
    LEFT: { c: 37, l: "←" }, RIGHT: { c: 39, l: "→" }
  };

  let pending = charge();
  let enCapture = null;          // action en attente d'une touche

  function copieDefauts() {
    const d = {};
    for (const [id] of ACTIONS) d[id] = { c: DEFAUTS[id].c, l: DEFAUTS[id].l };
    return d;
  }

  function charge() {
    try {
      const brut = window.localStorage.getItem(CLE);
      if (brut) {
        const lu = JSON.parse(brut);
        const ok = {};
        for (const [id] of ACTIONS)
          ok[id] = lu[id] && typeof lu[id].c === "number" && lu[id].l
            ? { c: lu[id].c, l: String(lu[id].l) }
            : { c: DEFAUTS[id].c, l: DEFAUTS[id].l };
        return ok;
      }
    } catch (e) { /* stockage indisponible */ }
    return copieDefauts();
  }

  function applique(gba) {
    const pad = gba && gba.keypad;
    if (!pad) return;
    for (const [id] of ACTIONS) pad["KEYCODE_" + id] = pending[id].c;
    majAide();
  }

  // met à jour la ligne d'aide "Clavier : …" sous les options
  function majAide() {
    const aide = document.querySelector(".keys");
    if (!aide) return;
    const l = id => pending[id].l;
    aide.textContent = "Clavier : " + l("UP") + l("DOWN") + l("LEFT") + l("RIGHT")
      + " = croix · " + l("A") + " = A · " + l("B") + " = B · "
      + l("START") + " = Start · " + l("SELECT") + " = Select · "
      + l("L") + "/" + l("R") + " = L/R";
  }

  function libelle(e) {
    const map = {
      ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
      Enter: "Entrée", " ": "Espace", Shift: "Maj", Control: "Ctrl",
      Alt: "Alt", Backspace: "Retour", Tab: "Tab", CapsLock: "Verr. Maj"
    };
    if (map[e.key]) return map[e.key];
    return e.key.length === 1 ? e.key.toUpperCase() : e.key;
  }

  function rend() {
    const liste = $("raccourcisListe");
    liste.textContent = "";
    for (const [id, nom] of ACTIONS) {
      const ligne = document.createElement("div");
      ligne.className = "raccourci-ligne";
      const lab = document.createElement("span");
      lab.textContent = nom;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "raccourci-touche" + (enCapture === id ? " attente" : "");
      btn.textContent = enCapture === id ? "Appuie sur une touche…" : pending[id].l;
      btn.addEventListener("click", () => { enCapture = id; rend(); });
      ligne.appendChild(lab);
      ligne.appendChild(btn);
      liste.appendChild(ligne);
    }
  }

  function ouvre() { $("raccourcisPanel").hidden = false; enCapture = null; rend(); }
  function ferme() { pending = charge(); enCapture = null; $("raccourcisPanel").hidden = true; }

  // capture de touche, en phase de capture pour passer avant l'émulateur
  window.addEventListener("keydown", e => {
    if ($("raccourcisPanel").hidden) return;
    if (!enCapture) {
      if (e.key === "Escape") ferme();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") { enCapture = null; rend(); return; }
    // touche déjà utilisée ailleurs : on échange les deux affectations
    for (const [id] of ACTIONS)
      if (id !== enCapture && pending[id].c === e.keyCode)
        pending[id] = { c: pending[enCapture].c, l: pending[enCapture].l };
    pending[enCapture] = { c: e.keyCode, l: libelle(e) };
    enCapture = null;
    rend();
  }, true);

  $("raccourcisBtn").addEventListener("click", ouvre);
  $("raccourcisFermer").addEventListener("click", ferme);
  $("raccourcisDefaut").addEventListener("click", () => { pending = copieDefauts(); enCapture = null; rend(); });
  $("raccourcisSauver").addEventListener("click", () => {
    try { window.localStorage.setItem(CLE, JSON.stringify(pending)); } catch (e) {}
    applique(state.gba);
    enCapture = null;
    $("raccourcisPanel").hidden = true;
  });

  window.Valdoria.raccourcis = { applique };
})(window);
