(function (window) {
  "use strict";

  // Localisation des amis : chaque joueur publie sa carte courante sous
  // monde/joueurs/LOC|<tag> (le validate passe : nom/x/y/g/m/t presents,
  // cle libre ; onDisconnect nettoie). Les amis lisent monde/joueurs/LOC|<tagAmi>
  // et affichent le nom du lieu a cote du pseudo.
  // Table extraite de la ROM FR (BPRF) : gMapGroups a 0x0834caf8 (43 groupes),
  // MAPSEC = octet +0x14 de l en-tete de carte - 0x58, noms a ROM 0x3ea268.

  const TABLE = {"0_0":"CENT. COMMERCIAL","0_1":"CENT. COMMERCIAL","0_2":"CENT. COMMERCIAL","0_3":"CENT. COMMERCIAL","0_4":"CENT. COMMERCIAL","10_0":"CELADOPOLE","10_1":"CELADOPOLE","10_10":"CELADOPOLE","10_11":"CELADOPOLE","10_12":"CELADOPOLE","10_13":"CELADOPOLE","10_14":"CELADOPOLE","10_15":"CELADOPOLE","10_16":"CELADOPOLE","10_17":"CELADOPOLE","10_18":"CELADOPOLE","10_19":"CELADOPOLE","10_2":"CELADOPOLE","10_3":"CELADOPOLE","10_4":"CELADOPOLE","10_5":"CELADOPOLE","10_6":"CELADOPOLE","10_7":"CELADOPOLE","10_8":"CELADOPOLE","10_9":"CELADOPOLE","11_0":"PARMANIE","11_1":"PARMANIE","11_2":"PARMANIE","11_3":"PARMANIE","11_4":"PARMANIE","11_5":"PARMANIE","11_6":"PARMANIE","11_7":"PARMANIE","11_8":"PARMANIE","11_9":"PARMANIE","12_0":"CRAMOIS'ILE","12_1":"CRAMOIS'ILE","12_2":"CRAMOIS'ILE","12_3":"CRAMOIS'ILE","12_4":"CRAMOIS'ILE","12_5":"CRAMOIS'ILE","12_6":"CRAMOIS'ILE","12_7":"CRAMOIS'ILE","13_0":"PLATEAU INDIGO","13_1":"PLATEAU INDIGO","14_0":"SAFRANIA","14_1":"SAFRANIA","14_2":"SAFRANIA","14_3":"SAFRANIA","14_4":"SAFRANIA","14_5":"SAFRANIA","14_6":"SAFRANIA","14_7":"SAFRANIA","14_8":"SAFRANIA","14_9":"SAFRANIA","15_0":"ROUTE 2","15_1":"ROUTE 2","15_2":"ROUTE 2","15_3":"ROUTE 2","16_0":"ROUTE 4","16_1":"ROUTE 4","17_0":"ROUTE 5","17_1":"ROUTE 5","18_0":"ROUTE 6","18_1":"ROUTE 6","19_0":"ROUTE 7","1_0":"FORET DE JADE","1_1":"MONT SELENITE","1_10":"L'OCEANE","1_100":"MONT BRAISE","1_101":"MONT BRAISE","1_102":"MONT BRAISE","1_103":"MONT BRAISE","1_104":"MONT BRAISE","1_105":"MONT BRAISE","1_106":"MONT BRAISE","1_107":"MONT BRAISE","1_108":"MONT BRAISE","1_109":"BOIS BAIES","1_11":"L'OCEANE","1_110":"GROTTE DE GLACE","1_111":"GROTTE DE GLACE","1_112":"GROTTE DE GLACE","1_113":"GROTTE DE GLACE","1_114":"ENTREPOT","1_115":"TROU PERCE","1_116":"TROU PERCE","1_117":"TROU PERCE","1_118":"TROU PERCE","1_119":"TROU PERCE","1_12":"L'OCEANE","1_120":"TROU PERCE","1_121":"FORBUISSONS","1_122":"GROTTE METAMO","1_13":"L'OCEANE","1_14":"L'OCEANE","1_15":"L'OCEANE","1_16":"L'OCEANE","1_17":"L'OCEANE","1_18":"L'OCEANE","1_19":"L'OCEANE","1_2":"MONT SELENITE","1_20":"L'OCEANE","1_21":"L'OCEANE","1_22":"L'OCEANE","1_23":"L'OCEANE","1_24":"L'OCEANE","1_25":"L'OCEANE","1_26":"L'OCEANE","1_27":"L'OCEANE","1_28":"L'OCEANE","1_29":"L'OCEANE","1_3":"MONT SELENITE","1_30":"SOUTERRAIN","1_31":"SOUTERRAIN","1_32":"SOUTERRAIN","1_33":"SOUTERRAIN","1_34":"SOUTERRAIN","1_35":"SOUTERRAIN","1_36":"CAVE TAUPIQUEUR","1_37":"CAVE TAUPIQUEUR","1_38":"CAVE TAUPIQUEUR","1_39":"ROUTE VICTOIRE","1_4":"L'OCEANE","1_40":"ROUTE VICTOIRE","1_41":"ROUTE VICTOIRE","1_42":"REPAIRE ROCKET","1_43":"REPAIRE ROCKET","1_44":"REPAIRE ROCKET","1_45":"REPAIRE ROCKET","1_46":"REPAIRE ROCKET","1_47":"SYLPHE SARL","1_48":"SYLPHE SARL","1_49":"SYLPHE SARL","1_5":"L'OCEANE","1_50":"SYLPHE SARL","1_51":"SYLPHE SARL","1_52":"SYLPHE SARL","1_53":"SYLPHE SARL","1_54":"SYLPHE SARL","1_55":"SYLPHE SARL","1_56":"SYLPHE SARL","1_57":"SYLPHE SARL","1_58":"SYLPHE SARL","1_59":"MANOIR POKéMON","1_6":"L'OCEANE","1_60":"MANOIR POKéMON","1_61":"MANOIR POKéMON","1_62":"MANOIR POKéMON","1_63":"PARC SAFARI","1_64":"PARC SAFARI","1_65":"PARC SAFARI","1_66":"PARC SAFARI","1_67":"PARC SAFARI","1_68":"PARC SAFARI","1_69":"PARC SAFARI","1_7":"L'OCEANE","1_70":"PARC SAFARI","1_71":"PARC SAFARI","1_72":"CAVERNE AZUREE","1_73":"CAVERNE AZUREE","1_74":"CAVERNE AZUREE","1_75":"LIGUE POKéMON","1_76":"LIGUE POKéMON","1_77":"LIGUE POKéMON","1_78":"LIGUE POKéMON","1_79":"LIGUE POKéMON","1_8":"L'OCEANE","1_80":"LIGUE POKéMON","1_81":"GROTTE","1_82":"GROTTE","1_83":"ILES ECUME","1_84":"ILES ECUME","1_85":"ILES ECUME","1_86":"ILES ECUME","1_87":"ILES ECUME","1_88":"TOUR POKéMON","1_89":"TOUR POKéMON","1_9":"L'OCEANE","1_90":"TOUR POKéMON","1_91":"TOUR POKéMON","1_92":"TOUR POKéMON","1_93":"TOUR POKéMON","1_94":"TOUR POKéMON","1_95":"CENTRALE","1_96":"MONT BRAISE","1_97":"MONT BRAISE","1_98":"MONT BRAISE","1_99":"MONT BRAISE","20_0":"ROUTE 8","21_0":"ROUTE 10","21_1":"ROUTE 10","22_0":"ROUTE 11","22_1":"ROUTE 11","23_0":"ROUTE 12","23_1":"ROUTE 12","23_2":"ROUTE 12","24_0":"ROUTE 15","24_1":"ROUTE 15","25_0":"ROUTE 16","25_1":"ROUTE 16","25_2":"ROUTE 16","26_0":"ROUTE 18","26_1":"ROUTE 18","27_0":"CHENAL 19","28_0":"ROUTE 22","29_0":"ROUTE 23","2_0":"ROC NOMBRI","2_1":"TOUR DRESSEURS","2_10":"TOUR DRESSEURS","2_11":"TOUR DRESSEURS","2_12":"GROTTE PERDUE","2_13":"GROTTE PERDUE","2_14":"GROTTE PERDUE","2_15":"GROTTE PERDUE","2_16":"GROTTE PERDUE","2_17":"GROTTE PERDUE","2_18":"GROTTE PERDUE","2_19":"GROTTE PERDUE","2_2":"TOUR DRESSEURS","2_20":"GROTTE PERDUE","2_21":"GROTTE PERDUE","2_22":"GROTTE PERDUE","2_23":"GROTTE PERDUE","2_24":"GROTTE PERDUE","2_25":"GROTTE PERDUE","2_26":"GROTTE PERDUE","2_27":"CHAMBRE ANEMUNE","2_28":"CHAMBRE DEULIPE","2_29":"CHAMBRE PROIS","2_3":"TOUR DRESSEURS","2_30":"CHAMBRE JONQUATR","2_31":"CHAMBRE HIBICINQ","2_32":"CHAMBRE IRIX","2_33":"CHAMBRE POINSEPT","2_34":"CHEMIN ILE 3","2_35":"CLE TANOBY","2_36":"ROC NOMBRI","2_37":"ROC NOMBRI","2_38":"ROC NOMBRI","2_39":"ROC NOMBRI","2_4":"TOUR DRESSEURS","2_40":"ROC NOMBRI","2_41":"ROC NOMBRI","2_42":"ROC NOMBRI","2_43":"ROC NOMBRI","2_44":"ROC NOMBRI","2_45":"ROC NOMBRI","2_46":"ROC NOMBRI","2_47":"ROC NOMBRI","2_48":"ROC NOMBRI","2_49":"ROC NOMBRI","2_5":"TOUR DRESSEURS","2_50":"ROC NOMBRI","2_51":"ROC NOMBRI","2_52":"ROC NOMBRI","2_53":"ROC NOMBRI","2_54":"ROC NOMBRI","2_55":"ROC NOMBRI","2_56":"ILE AURORE","2_57":"SOURCE BRAISE","2_58":"ILE AURORE","2_59":"ROC NOMBRI","2_6":"TOUR DRESSEURS","2_7":"TOUR DRESSEURS","2_8":"TOUR DRESSEURS","2_9":"TOUR DRESSEURS","30_0":"ROUTE 25","31_0":"ILE 7","31_1":"ILE 7","31_2":"ILE 7","31_3":"ILE 7","31_4":"ILE 7","31_5":"ILE 7","31_6":"ILE 7","32_0":"ILE 1","32_1":"ILE 1","32_2":"ILE 1","32_3":"ILE 1","32_4":"ILE 1","33_0":"ILE 2","33_1":"ILE 2","33_2":"ILE 2","33_3":"ILE 2","33_4":"ILE 2","34_0":"ILE 3","34_1":"ILE 3","34_2":"ILE 3","34_3":"ILE 3","34_4":"ILE 3","34_5":"ILE 3","34_6":"ILE 3","34_7":"ILE 3","35_0":"ILE 4","35_1":"ILE 4","35_2":"ILE 4","35_3":"ILE 4","35_4":"ILE 4","35_5":"ILE 4","35_6":"ILE 4","35_7":"ILE 4","36_0":"ILE 5","36_1":"ILE 5","36_2":"ILE 5","36_3":"ILE 5","36_4":"ILE 5","37_0":"ILE 6","37_1":"ILE 6","37_2":"ILE 6","37_3":"ILE 6","37_4":"ILE 6","38_0":"PORT ILE 3","39_0":"CAMP DE VACANCES","3_0":"BOURG PALETTE","3_1":"JADIELLE","3_10":"SAFRANIA","3_11":"SAFRANIA","3_12":"ILE 1","3_13":"ILE 2","3_14":"ILE 3","3_15":"ILE 4","3_16":"ILE 5","3_17":"ILE 7","3_18":"ILE 6","3_19":"ROUTE 1","3_2":"ARGENTA","3_20":"ROUTE 2","3_21":"ROUTE 3","3_22":"ROUTE 4","3_23":"ROUTE 5","3_24":"ROUTE 6","3_25":"ROUTE 7","3_26":"ROUTE 8","3_27":"ROUTE 9","3_28":"ROUTE 10","3_29":"ROUTE 11","3_3":"AZURIA","3_30":"ROUTE 12","3_31":"ROUTE 13","3_32":"ROUTE 14","3_33":"ROUTE 15","3_34":"ROUTE 16","3_35":"ROUTE 17","3_36":"ROUTE 18","3_37":"CHENAL 19","3_38":"CHENAL 20","3_39":"CHENAL 21","3_4":"LAVANVILLE","3_40":"CHENAL 21","3_41":"ROUTE 22","3_42":"ROUTE 23","3_43":"ROUTE 24","3_44":"ROUTE 25","3_45":"ROUTE TISON","3_46":"PLAGE TRESOR","3_47":"CAP FALAISE","3_48":"PONT DU LIEN","3_49":"PORT ILE 3","3_5":"CARMIN SUR MER","3_50":"ILE SEVII 6","3_51":"ILE SEVII 7","3_52":"ILE SEVII 8","3_53":"ILE SEVII 9","3_54":"CAMP DE VACANCES","3_55":"LABYRINTHE D'O","3_56":"PRE DE L'ILE 5","3_57":"MEMORIAL","3_58":"ILE DU LOINTAIN","3_59":"CHEMIN VERT","3_6":"CELADOPOLE","3_60":"AGUALCANAL","3_61":"VALLEE RUINE","3_62":"TOUR DRESSEURS","3_63":"ENTREE CANYON","3_64":"CANYON SESOR","3_65":"RUINES TANOBY","3_7":"PARMANIE","3_8":"CRAMOIS'ILE","3_9":"PLATEAU INDIGO","40_0":"CAP FALAISE","41_0":"AGUALCANAL","41_1":"AGUALCANAL","42_0":"CANYON SESOR","4_0":"BOURG PALETTE","4_1":"BOURG PALETTE","4_2":"BOURG PALETTE","4_3":"BOURG PALETTE","5_0":"JADIELLE","5_1":"JADIELLE","5_2":"JADIELLE","5_3":"JADIELLE","5_4":"JADIELLE","5_5":"JADIELLE","6_0":"ARGENTA","6_1":"ARGENTA","6_2":"ARGENTA","6_3":"ARGENTA","6_4":"ARGENTA","6_5":"ARGENTA","6_6":"ARGENTA","6_7":"ARGENTA","7_0":"AZURIA","7_1":"AZURIA","7_2":"AZURIA","7_3":"AZURIA","7_4":"AZURIA","7_5":"AZURIA","7_6":"AZURIA","7_7":"AZURIA","7_8":"AZURIA","7_9":"AZURIA","8_0":"LAVANVILLE","8_1":"LAVANVILLE","8_2":"LAVANVILLE","8_3":"LAVANVILLE","8_4":"LAVANVILLE","8_5":"LAVANVILLE","9_0":"CARMIN SUR MER","9_1":"CARMIN SUR MER","9_2":"CARMIN SUR MER","9_3":"CARMIN SUR MER","9_4":"CARMIN SUR MER","9_5":"CARMIN SUR MER","9_6":"CARMIN SUR MER","9_7":"CARMIN SUR MER"};

  const RAFRAICHIT_MS = 60000;   // republie au plus toutes les 60 s (eco)
  const PERIME_MS = 5 * 60000;   // au-dela, entree consideree hors ligne

  let db = null;
  let monRef = null;
  let dernierEnvoi = 0;
  let derniereZone = "";
  let lieux = {};        // tag -> { g, m, t }
  let refs = [];
  let dernierTags = [];
  let cbChange = null;
  let timerRend = null;

  // '#' est interdit dans un chemin Firebase (meme convention que tchat.js)
  function cle(tag) { return tag.replace("#", "-"); }

  function nomLieu(g, m) { return TABLE[g + "_" + m] || null; }

  function connect(database) {
    db = database;
    if (dernierTags.length) suitAmis(dernierTags);
  }

  // Appele par network.js a chaque sendPos ; throttle interne :
  // n ecrit que si la carte change, ou toutes les 60 s pour rafraichir t.
  function publie(pos) {
    if (!db || !pos || typeof pos.g !== "number" || typeof pos.m !== "number") return;
    const tag = window.Valdoria.tchat ? window.Valdoria.tchat.getTag() : "";
    if (!tag) return;
    const zone = pos.g + "_" + pos.m;
    const now = Date.now();
    if (zone === derniereZone && now - dernierEnvoi < RAFRAICHIT_MS) return;
    dernierEnvoi = now;
    derniereZone = zone;
    const r = db.ref("monde/joueurs/LOC|" + cle(tag));
    if (!monRef || monRef.key !== r.key) {
      monRef = r;
      try { monRef.onDisconnect().remove(); } catch (e) {}
    }
    monRef.set({
      nom: pos.nom || "?",
      x: pos.x || 0, y: pos.y || 0, g: pos.g, m: pos.m,
      t: firebase.database.ServerValue.TIMESTAMP
    }).catch(function () {});
  }

  // Suit les entrees LOC des amis ; cb est rappele (debounce) a chaque changement.
  function suitAmis(tags, cb) {
    if (cb) cbChange = cb;
    dernierTags = tags.slice();
    refs.forEach(function (r) { r.off(); });
    refs = [];
    lieux = {};
    if (!db) return;
    tags.forEach(function (tag) {
      const r = db.ref("monde/joueurs/LOC|" + cle(tag));
      r.on("value", function (s) {
        const d = s.val();
        if (d && typeof d.g === "number" && typeof d.m === "number") lieux[tag] = d;
        else delete lieux[tag];
        if (timerRend) clearTimeout(timerRend);
        timerRend = setTimeout(function () {
          timerRend = null;
          if (cbChange) cbChange();
        }, 150);
      });
      refs.push(r);
    });
  }

  // Nom du lieu de l ami, ou null si inconnu / hors ligne / perime.
  function lieuAmi(tag) {
    const d = lieux[tag];
    if (!d) return null;
    if (typeof d.t === "number" && Date.now() - d.t > PERIME_MS) return null;
    return nomLieu(d.g, d.m);
  }

  window.Valdoria.lieux = { connect: connect, publie: publie, suitAmis: suitAmis, lieuAmi: lieuAmi, nomLieu: nomLieu };
})(window);
