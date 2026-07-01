(function (window) {
  "use strict";

  // Tchat à deux canaux :
  // - "Général" : monde/tchat, visible par tous ;
  // - "Amis"    : modèle par tag unique façon Discord. Chaque joueur
  //   reçoit un tag "Nom#1234" (nom du héros de la partie + 4 chiffres
  //   tirés une seule fois, retenus par le navigateur). J'écris sous MON
  //   tag ; je lis les tags de ma liste d'amis. Échange mutuel des tags
  //   = conversation. Pas de comptes : tout vit en localStorage.

  const { $ } = window.Valdoria.dom;
  const CLE_SUFFIXE = "valdoria.tagSuffixe";    // suffixe STABLE par appareil (ne depend plus du nom/sauvegarde)
  const CLE_AMIS = "valdoria.tagsAmis";
  const FORMAT_TAG = /^.{1,12}#\d{4}$/;
  const MAX_AMIS = 10;
  const DUREE_MS = 5 * 60 * 1000;   // un message vit 5 minutes puis s'efface

  let db = null;
  let pseudoFn = null;
  let canal = "general";
  let monNom = "";
  let monTag = "";
  let amis = [];
  let refs = [];
  let dernierEnvoi = 0;
  const historiques = { general: [], amis: [] };

  try { amis = JSON.parse(window.localStorage.getItem(CLE_AMIS) || "[]"); } catch (e) { amis = []; }
  if (!Array.isArray(amis)) amis = [];

  // '#' est interdit dans un chemin Firebase
  function cle(tag) { return tag.replace("#", "-"); }

  function sauveAmis() {
    try { window.localStorage.setItem(CLE_AMIS, JSON.stringify(amis)); } catch (e) {}
  }

  // appelé par network.js dès que le nom du héros est lisible en mémoire
  function definitNom(nom) {
    if (!nom || nom === monNom) return;
    monNom = nom;
    let suffixe = null;
    try { suffixe = window.localStorage.getItem(CLE_SUFFIXE); } catch (e) {}
    if (!suffixe || !/^\d{4}$/.test(suffixe)) {
      // Migration : reutilise l'ancien suffixe par-nom s'il existe (garde tes chiffres actuels).
      let vieux = null;
      try { vieux = window.localStorage.getItem("valdoria.tagSuffixe." + nom); } catch (e) {}
      suffixe = (vieux && /^\d{4}$/.test(vieux)) ? vieux : String(1000 + Math.floor(Math.random() * 9000));
      try { window.localStorage.setItem(CLE_SUFFIXE, suffixe); } catch (e) {}
    }
    monTag = nom + "#" + suffixe;
    if (window.Valdoria.linkroom) window.Valdoria.linkroom.definitTag(monTag);
    abonneAmis();
    rend();
  }

  function isoleClavier(el) {
    if (!el) return;
    ["keydown", "keyup", "keypress"].forEach(t =>
      el.addEventListener(t, e => e.stopPropagation()));
  }

  // ---- Moderation tchat : anti-insulte (censure ***) + anti-spam (debit + doublons) ----
  var _envois = [], _dernierTexte = "";
  var _ROOTS = ["encul","connard","connass","salop","enfoir","batard","putain","tapette","pedale","gouine","tarlouze","fuck","shit","bitch","asshol","bastard","nigg","faggot","motherf","niqu","negr","bougnoul","pouffias"];
  var _EXACT = new Set(["con","cons","conne","connes","pd","pds","pede","pute","putes","tg","fdp","ntm","salaud","salauds","abruti","abrutie","debile","debiles","cretin","cretine","mongol","mongols","trisomique","fag","fags","cunt","slut","whore","youpin","bicot"]);
  function _norm(x){ return ("" + x).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function _interdit(brut){
    if (!brut) return false;
    if (_EXACT.has(brut)) return true;
    for (var i = 0; i < _ROOTS.length; i++) if (brut.indexOf(_ROOTS[i]) === 0) return true;
    return false;
  }
  function censure(texte){
    return ("" + texte).split(/(\s+)/).map(function (tok){
      if (!tok || /^\s+$/.test(tok)) return tok;
      var brut = _norm(tok).replace(/[^a-z0-9]/g, "");
      return _interdit(brut) ? "***" : tok;
    }).join("");
  }
  function _spamBloque(){
    var now = Date.now();
    _envois = _envois.filter(function (t){ return now - t < 10000; });
    if (_envois.length >= 5) return "trop";
    if (_envois.length && now - _envois[_envois.length - 1] < 1200) return "vite";
    return null;
  }
  function _avertit(msg){
    var boite = $("tchatMessages"); if (!boite) return;
    var p = ligneInfo("⚠️ " + msg);
    boite.appendChild(p); boite.scrollTop = boite.scrollHeight;
    setTimeout(function (){ try { p.remove(); } catch (e) {} }, 3000);
  }

  function ligneMessage(d) {
    const ligne = document.createElement("div");
    ligne.className = "tchat-ligne";
    const qui = document.createElement("strong");
    qui.textContent = d.nom + " : ";
    // amis (et soi-même) en rose, le reste en bleu foncé
    if (d.tag && (d.tag === monTag || amis.includes(d.tag))) qui.classList.add("ami");
    if (d.tag) qui.title = d.tag;
    ligne.appendChild(qui);
    ligne.appendChild(document.createTextNode(censure(d.texte)));
    return ligne;
  }

  function ligneInfo(texte) {
    const p = document.createElement("p");
    p.className = "tchat-info";
    p.textContent = texte;
    return p;
  }

  function rendMessages() {
    const boite = $("tchatMessages");
    boite.textContent = "";
    if (canal === "amis") {
      if (!monTag) {
        boite.appendChild(ligneInfo("Ton tag sera créé dès que ta partie sera chargée (lance le jeu et marche un peu)."));
        return;
      }
      if (amis.length === 0)
        boite.appendChild(ligneInfo("Donne ton tag " + monTag + " à tes amis et ajoute les leurs ci-dessus : l'ajout mutuel ouvre la conversation."));
      for (const d of historiques.amis) boite.appendChild(ligneMessage(d));
    } else {
      // Général : messages publics + messages amis mélangés, triés par temps
      const tous = [...historiques.general, ...historiques.amis]
        .sort((a, b) => (a.t || 0) - (b.t || 0));
      for (const d of tous) boite.appendChild(ligneMessage(d));
    }
    boite.scrollTop = boite.scrollHeight;
  }

  // Rend la liste d'amis avec LED online/offline dans un élément donné
  function rendListeAmis(listeEl, style) {
    if (!listeEl) return;
    listeEl.textContent = "";
    const joueurs = (window.Valdoria.state && window.Valdoria.state.joueurs) || {};

    if (amis.length === 0) {
      const vide = document.createElement("p");
      vide.className = "ami-vide";
      vide.textContent = "Aucun ami ajouté pour l'instant.";
      listeEl.appendChild(vide);
      return;
    }

    for (const tag of amis) {
      const enLigne = Object.values(joueurs).some(j => j.tag === tag);

      if (style === "chips") {
        // Version compacte pour la sidebar desktop
        const puce = document.createElement("span");
        puce.className = "tag-puce";
        const led = document.createElement("span");
        led.className = "ami-led " + (enLigne ? "online" : "offline");
        puce.appendChild(led);
        puce.appendChild(document.createTextNode(" " + tag + " "));
        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "✕";
        x.title = "Retirer";
        x.addEventListener("click", () => {
          amis = amis.filter(t => t !== tag);
          sauveAmis(); abonneAmis(); rend();
        });
        puce.appendChild(x);
        listeEl.appendChild(puce);
      } else {
        // Version liste pour le drawer mobile
        const ligne = document.createElement("div");
        ligne.className = "ami-ligne";
        const led = document.createElement("span");
        led.className = "ami-led " + (enLigne ? "online" : "offline");
        const nomEl = document.createElement("span");
        nomEl.className = "ami-tag-texte";
        nomEl.textContent = tag;
        const statut = document.createElement("span");
        statut.className = "ami-statut";
        statut.textContent = enLigne ? "en ligne" : "hors ligne";
        const x = document.createElement("button");
        x.type = "button";
        x.textContent = "✕";
        x.title = "Retirer";
        x.addEventListener("click", () => {
          amis = amis.filter(t => t !== tag);
          sauveAmis(); abonneAmis(); rend();
        });
        ligne.appendChild(led);
        ligne.appendChild(nomEl);
        ligne.appendChild(statut);
        ligne.appendChild(x);
        listeEl.appendChild(ligne);
      }
    }
  }

  function rend() {
    $("tchatOngletGeneral").classList.toggle("actif", canal === "general");
    $("tchatOngletAmis").classList.toggle("actif", canal === "amis");

    // Sidebar desktop : mon tag + bouton copier
    const info = $("tchatCodeInfo");
    info.textContent = "";
    if (!monTag) info.textContent = "Ton tag ami apparaîtra quand ta partie sera chargée.";
    if (monTag) {
      info.appendChild(document.createTextNode("Mon tag : " + monTag + " "));
      const copier = document.createElement("button");
      copier.type = "button";
      copier.className = "tchat-changer";
      copier.textContent = "copier";
      copier.addEventListener("click", () => {
        try { navigator.clipboard.writeText(monTag); copier.textContent = "copié !"; } catch (e) {}
        setTimeout(() => { copier.textContent = "copier"; }, 1500);
      });
      info.appendChild(copier);
    }

    // Drawer mobile : mon tag
    const drawerInfo = $("drawerTagInfo");
    if (drawerInfo) {
      drawerInfo.textContent = "";
      if (!monTag) {
        drawerInfo.textContent = "Lance le jeu pour obtenir ton tag.";
      } else {
        drawerInfo.appendChild(document.createTextNode("Mon tag : " + monTag + " "));
        const copier2 = document.createElement("button");
        copier2.type = "button";
        copier2.className = "tchat-changer";
        copier2.textContent = "copier";
        copier2.addEventListener("click", () => {
          try { navigator.clipboard.writeText(monTag); copier2.textContent = "copié !"; } catch (e) {}
          setTimeout(() => { copier2.textContent = "copier"; }, 1500);
        });
        drawerInfo.appendChild(copier2);
      }
    }

    // Listes d'amis
    rendListeAmis($("tagAmiListe"), "chips");
    rendListeAmis($("drawerAmiListe"), "list");

    // parler exige une partie chargée avec un nom de héros
    const champ = $("tchatInput");
    champ.disabled = !monTag;
    champ.placeholder = !monTag
      ? "Lance ta partie pour pouvoir parler…"
      : (canal === "amis" ? "Écris à tes amis…" : "Écris au monde…");
    rendMessages();
  }

  function ajoute(quel, s) {
    const d = s.val();
    if (!d || !d.nom || !d.texte) return;
    // déjà périmé : on le retire aussi de la base
    if ((d.t || 0) < Date.now() - DUREE_MS) { s.ref.remove().catch(() => {}); return; }
    d._ref = s.ref;
    const h = historiques[quel];
    h.push(d);
    h.sort((a, b) => (a.t || 0) - (b.t || 0));
    if (h.length > 80) h.splice(0, h.length - 80);
    if (canal === quel || (quel === "amis" && canal === "general")) rendMessages();
  }

  // efface au fil de l'eau les messages de plus de 5 minutes
  function purgePerimes() {
    const limite = Date.now() - DUREE_MS;
    let change = false;
    for (const quel of ["general", "amis"]) {
      const h = historiques[quel];
      while (h.length && (h[0].t || 0) < limite) {
        const d = h.shift();
        if (d._ref) d._ref.remove().catch(() => {});
        if (canal === quel) change = true;
      }
    }
    if (change) rendMessages();
  }

  function abonneAmis() {
    refs.forEach(r => r.off());
    refs = [];
    historiques.amis = [];
    if (!db) return;
    const tags = (monTag ? [monTag] : []).concat(amis).slice(0, MAX_AMIS + 1);
    for (const tag of tags) {
      const r = db.ref("monde/tchatAmis/" + cle(tag)).limitToLast(30);
      r.on("child_added", s => ajoute("amis", s));
      refs.push(r);
    }
  }

  function ajouteAmi(champEl) {
    const champ = champEl || $("tagAmiInput");
    if (!champ) return;
    const tag = champ.value.trim();
    if (!FORMAT_TAG.test(tag)) { champ.value = ""; champ.placeholder = "Format : Nom#1234"; return; }
    if (tag === monTag || amis.includes(tag)) { champ.value = ""; return; }
    if (amis.length >= MAX_AMIS) {
      champ.value = "";
      window.alert("10 amis maximum : impossible d'ajouter plus de 10 amis dans le jeu.");
      return;
    }
    amis.push(tag);
    sauveAmis();
    abonneAmis();
    champ.value = "";
    rend();
  }

  function connect(base, pseudo) {
    db = base;
    pseudoFn = pseudo;
    db.ref("monde/tchat").limitToLast(50).on("child_added", s => ajoute("general", s));
    abonneAmis();
    setInterval(purgePerimes, 10000);

    // Refresh statut online/offline des amis toutes les 5s
    setInterval(() => {
      rendListeAmis($("tagAmiListe"), "chips");
      rendListeAmis($("drawerAmiListe"), "list");
    }, 5000);

    isoleClavier($("tchatInput"));
    isoleClavier($("tagAmiInput"));
    isoleClavier($("drawerAmiInput"));

    $("tchatOngletGeneral").addEventListener("click", () => { canal = "general"; rend(); });
    $("tchatOngletAmis").addEventListener("click", () => { canal = "amis"; rend(); });

    // Sidebar desktop
    $("tagAmiAjouter").addEventListener("click", () => ajouteAmi($("tagAmiInput")));
    $("tagAmiInput").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); ajouteAmi($("tagAmiInput")); }
    });

    // Drawer mobile
    const drawerBtn = $("drawerAmiAjouter");
    const drawerInput = $("drawerAmiInput");
    if (drawerBtn) drawerBtn.addEventListener("click", () => ajouteAmi(drawerInput));
    if (drawerInput) drawerInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); ajouteAmi(drawerInput); }
    });

    $("tchatForm").addEventListener("submit", e => {
      e.preventDefault();
      const champ = $("tchatInput");
      const texte0 = champ.value.trim().slice(0, 120);
      if (!monTag || !texte0) return;
      const bloc = _spamBloque();
      if (bloc) { _avertit(bloc === "vite" ? "Doucement, attends une seconde." : "Tu envoies trop vite, patiente un peu."); if (window.Valdoria.moderation) window.Valdoria.moderation.signale("spam"); return; }
      if (texte0 === _dernierTexte) { _avertit("Tu as deja envoye ce message."); if (window.Valdoria.moderation) window.Valdoria.moderation.signale("spam"); champ.value = ""; return; }
      const texte = censure(texte0);
      if (texte !== texte0 && window.Valdoria.moderation) window.Valdoria.moderation.signale("insulte");
      if (!texte.replace(/[*\s]/g, "")) { champ.value = ""; return; }
      _dernierTexte = texte0; _envois.push(Date.now()); dernierEnvoi = Date.now();
      const ref = canal === "general"
        ? db.ref("monde/tchat")
        : db.ref("monde/tchatAmis/" + cle(monTag));
      ref.push({
        nom: pseudoFn(), texte: texte, tag: monTag || null,
        t: firebase.database.ServerValue.TIMESTAMP
      });
      champ.value = "";
    });

    rend();
  }

  // Re-applique le suffixe (depuis localStorage) au tag courant, sans changer le nom.
  // Appele apres une restauration cloud pour que le #1234 redevienne le bon.
  function rafraichitTag() {
    if (!monNom) return;
    let suffixe = null;
    try { suffixe = window.localStorage.getItem(CLE_SUFFIXE); } catch (e) {}
    if (!suffixe || !/^\d{4}$/.test(suffixe)) return;
    monTag = monNom + "#" + suffixe;
    if (window.Valdoria.linkroom) window.Valdoria.linkroom.definitTag(monTag);
    abonneAmis();
    rend();
  }

  function rechargeAmis() {
    try { amis = JSON.parse(window.localStorage.getItem(CLE_AMIS) || "[]"); } catch (e) { amis = []; }
    if (!Array.isArray(amis)) amis = [];
    abonneAmis();
    rend();
  }

  window.Valdoria.tchat = { connect, definitNom, getTag: () => monTag, rafraichitTag, rechargeAmis };
})(window);
