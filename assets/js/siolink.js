(function (window) {
  "use strict";

  // Câble link GBA via WebRTC — Phase 2 du système de combat/échange.
  //
  // Principe :
  //   - Deux joueurs se sont mis d'accord dans le lobby (linkroom.js).
  //   - On établit une connexion WebRTC peer-to-peer avec Firebase
  //     comme serveur de signaling (pas de backend supplémentaire).
  //   - Une fois le DataChannel ouvert, on se branche comme linkLayer
  //     sur gba.sio : chaque transfert SIO32 passe par le canal.
  //
  // Protocole SIO Normal 32-bit (Pokémon Rouge Feu) :
  //   Le maître (isMaster=true) initie chaque transfert.
  //   L'esclave répond immédiatement avec ses propres données.
  //   Les deux complètent leur transfert en simultané.

  const state  = window.Valdoria.state;
  const STUN   = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  const BASE   = "monde/sessions/";
  const TIMEOUT_MS = 120000;   // 2 min : laisse le temps de coordonner 2 appareils (créer puis rejoindre)

  let db        = null;
  let dbgN      = 0;          // diag : log des premiers mots echanges
  let sessionId = null;
  let isMaster  = false;
  let pc        = null;
  let channel   = null;
  let sessionRef = null;
  let connectCb = null;   // appelé quand le canal est prêt
  let errorCb   = null;   // appelé en cas d'échec

  /* ---- Helpers ------------------------------------------------ */
  function log(msg) { console.log("[siolink]", msg); }

  function gba() { return state.gba || null; }

  // Installe le pont multijoueur 16-bit sur le coeur serie d'IodineGBA.
  function attachLinkLayer() {
    const g = gba();
    const serial = (g && g.getSerial) ? g.getSerial() : null;
    if (!serial) { log("pont: coeur serie IodineGBA introuvable"); return; }
    serial.SIOMULT_PLAYER_NUMBER = isMaster ? 0 : 1;   // role impose par WebRTC
    window.ValdoriaLink = {
      actif: true,
      serial: serial,
      isMaster: isMaster,
      envoye: false,
      nb: 0,
      // Maitre : le coeur reclame un transfert -> on envoie notre mot, on attend.
      masterTransfert: function (s) {
        if (this.envoye) return;
        this.envoye = true;
        const mot = s.SIODATA8 & 0xFFFF;
        if (dbgN < 80) { console.log("[sio] M> 0x" + mot.toString(16)); dbgN++; }
        if (channel && channel.readyState === "open") channel.send(JSON.stringify({ t: "mlt", d: mot }));
      },
      // Reception d'un mot du pair -> on complete le transfert (+ IRQ).
      onMot: function (motDistant) {
        const s = this.serial; if (!s) return;
        const motLocal = s.SIODATA8 & 0xFFFF;
        if (dbgN < 120) { console.log("[sio] " + (this.isMaster ? "M" : "S") + "< recu=0x" + (motDistant>>>0).toString(16) + " local=0x" + motLocal.toString(16) + " irq=" + (s.SIOCNT_IRQ ? 1 : 0)); dbgN++; }
        if (this.isMaster) { s.linkComplete(motLocal, motDistant); this.envoye = false; }
        else { s.linkComplete(motDistant, motLocal); if (channel && channel.readyState === "open") channel.send(JSON.stringify({ t: "mlt", d: motLocal })); }
        this.nb = (this.nb + 1) | 0;
      }
    };
    log("pont multijoueur installe (joueur " + (isMaster ? 0 : 1) + ")");
  }

  function detachLinkLayer() {
    if (window.ValdoriaLink) window.ValdoriaLink.actif = false;
  }

  /* ---- Échange câble (mode multijoueur 16-bit) --------------- */
  function onChannelMessage(evt) {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    if (msg.t === "mlt") {
      if (window.ValdoriaLink && window.ValdoriaLink.actif) window.ValdoriaLink.onMot(msg.d >>> 0);
      return;
    }
    if (msg.t === "ping") { channel.send(JSON.stringify({ t: "pong" })); }
  }

  /* ---- WebRTC ------------------------------------------------- */
  function creerPeerConnection() {
    pc = new RTCPeerConnection({ iceServers: STUN });

    pc.onicecandidate = evt => {
      if (!evt.candidate) return;
      const role = isMaster ? "master" : "slave";
      sessionRef.child("ice_" + role).push({
        candidate: evt.candidate.candidate,
        sdpMid: evt.candidate.sdpMid,
        sdpMLineIndex: evt.candidate.sdpMLineIndex
      });
    };

    pc.onconnectionstatechange = () => {
      log("connectionState: " + pc.connectionState);
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        fermer();
        if (errorCb) errorCb("Connexion perdue");
      }
    };

    return pc;
  }

  function ouvrirCanal(dc) {
    channel = dc;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      log("DataChannel ouvert");
      attachLinkLayer();
      // Ping pour vérifier la latence
      channel.send(JSON.stringify({ t: "ping" }));
      if (connectCb) connectCb();
    };

    channel.onmessage = onChannelMessage;

    channel.onclose = () => {
      log("DataChannel fermé");
      detachLinkLayer();
    };

    channel.onerror = e => {
      log("DataChannel erreur: " + e);
    };
  }

  /* ---- Signaling Firebase ------------------------------------- */
  // Structure :
  //   monde/sessions/<sessionId>/
  //     offer:       { sdp, type }
  //     answer:      { sdp, type }
  //     ice_master/  { candidate, sdpMid, sdpMLineIndex }
  //     ice_slave/   { candidate, sdpMid, sdpMLineIndex }

  async function connectMaster() {
    log("Rôle : maître (initiateur WebRTC)");
    creerPeerConnection();

    // Créer le DataChannel avant l'offre
    const dc = pc.createDataChannel("sio-link", { ordered: true });
    ouvrirCanal(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sessionRef.child("offer").set({ sdp: offer.sdp, type: offer.type });
    log("Offre envoyée");

    // Attendre la réponse de l'esclave
    sessionRef.child("answer").on("value", async snap => {
      if (!snap.val() || pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
      log("Réponse reçue");
      sessionRef.child("answer").off();
      ecouterCandidats("slave");
    });
  }

  async function connectSlave() {
    log("Rôle : esclave (répondeur WebRTC)");
    creerPeerConnection();

    // Réceptionner le DataChannel créé par le maître
    pc.ondatachannel = evt => { ouvrirCanal(evt.channel); };

    // Attendre l'offre du maître
    sessionRef.child("offer").on("value", async snap => {
      if (!snap.val() || pc.signalingState !== "stable") return;
      await pc.setRemoteDescription(new RTCSessionDescription(snap.val()));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sessionRef.child("answer").set({ sdp: answer.sdp, type: answer.type });
      log("Réponse envoyée");
      sessionRef.child("offer").off();
      ecouterCandidats("master");
    });
  }

  function ecouterCandidats(role) {
    sessionRef.child("ice_" + role).on("child_added", snap => {
      const c = snap.val();
      if (!c) return;
      pc.addIceCandidate(new RTCIceCandidate({
        candidate: c.candidate,
        sdpMid: c.sdpMid,
        sdpMLineIndex: c.sdpMLineIndex
      })).catch(e => log("ICE erreur: " + e));
    });
  }

  /* ---- API publique ------------------------------------------ */
  function connect(database, sid, master, onConnect, onError) {
    db        = database;
    sessionId = sid;
    isMaster  = master;
    connectCb = onConnect;
    errorCb   = onError;

    sessionRef = db.ref(BASE + sid);

    // Nettoyer la session si on ferme l'onglet
    sessionRef.onDisconnect().remove();

    // Timeout de connexion
    const timer = setTimeout(() => {
      if (channel && channel.readyState === "open") return;
      fermer();
      if (errorCb) errorCb("Délai de connexion dépassé");
    }, TIMEOUT_MS);

    if (onConnect) {
      const origCb = onConnect;
      connectCb = () => { clearTimeout(timer); origCb(); };
    }

    if (isMaster) connectMaster().catch(e => { log(e); if (errorCb) errorCb(e.message); });
    else          connectSlave().catch(e => { log(e); if (errorCb) errorCb(e.message); });
  }

  function fermer() {
    detachLinkLayer();
    if (channel) { try { channel.close(); } catch (e) {} channel = null; }
    if (pc)      { try { pc.close();      } catch (e) {} pc = null; }
    if (sessionRef) { sessionRef.remove(); sessionRef = null; }
  }

  window.Valdoria.siolink = { connect, fermer };
})(window);
