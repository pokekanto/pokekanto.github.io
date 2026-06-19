(function (window) {
  "use strict";

  // Sortie audio via AudioWorklet (thread audio dédié).
  // Pourquoi : le ScriptProcessor de gbajs tourne sur le thread principal,
  // déjà occupé par l'émulation → callbacks en retard → craquements.
  // Le worklet rejoue les échantillons poussés par l'émulateur avec :
  // - un contrôle de débit (±0,5 %) : l'horloge de l'émulateur (calée sur
  //   l'écran) et l'horloge audio divergent légèrement ; sans correction le
  //   tampon déborde ou se vide toutes les ~30 s → saut ou coupure audible ;
  // - un amorçage : après une coupure, on attend ~60 ms de réserve avant de
  //   reprendre, au lieu d'enchaîner micro-coupures et reprises ;
  // - un passe-bas 2 pôles à 8 kHz : la musique GBA (mixée à ~13 kHz puis
  //   recopiée à 32 kHz sans interpolation) produit un aliasing métallique
  //   que le filtre adoucit, comme la sortie analogique de la vraie console ;
  // - une interpolation Catmull-Rom (4 points) au rééchantillonnage,
  //   plus propre que la linéaire dans les aigus ;
  // - un bloqueur de composante continue (supprime offset et "plocs") ;
  // - un fondu doux vers le silence quand il n'y a plus rien à jouer.

  const state = window.Valdoria.state;

  const WORKLET_CODE = `
class ValdoriaAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.N = 1 << 16;
    this.bufL = new Float32Array(this.N);
    this.bufR = new Float32Array(this.N);
    this.w = 0;          // position d'écriture (entière)
    this.r = 0;          // position de lecture (fractionnaire)
    this.inRate = 32768; this.targetSec = 0.28; // taux d'échantillonnage GBA
    this.lastL = 0;
    this.lastR = 0;
    this.primed = false;
    // passe-bas 2 pôles à 8 kHz (états L1, L2, R1, R2)
    this.lpA = 1 - Math.exp(-2 * Math.PI * 8000 / sampleRate);
    this.f0 = 0; this.f1 = 0; this.f2 = 0; this.f3 = 0;
    // bloqueur de continu (états x/y par canal)
    this.dxL = 0; this.dyL = 0; this.dxR = 0; this.dyR = 0;
    this.port.onmessage = e => {
      const d = e.data;
      if (d.rate) { this.inRate = d.rate; return; }
      if (d.targetSec) { this.targetSec = d.targetSec; return; }
      const l = d.l, r = d.r;
      for (let i = 0; i < l.length; i++) {
        this.bufL[this.w % this.N] = l[i];
        this.bufR[this.w % this.N] = r[i];
        this.w++;
      }
      // garde-fou : si vraiment trop d'avance s'accumule, on resaute à la cible
      if (this.w - this.r > this.inRate * this.targetSec * 2) this.r = this.w - this.inRate * this.targetSec;
    };
  }
  // interpolation Catmull-Rom entre p1 et p2 (t dans [0,1])
  cr(p0, p1, p2, p3, t) {
    return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const cible = this.inRate * this.targetSec; // reserve audio visee (defaut ~280 ms)
    if (!this.primed) {
      if (this.w - this.r >= cible * 0.6) this.primed = true;
      else {
        for (let i = 0; i < L.length; i++) {
          this.lastL *= 0.97; this.lastR *= 0.97;
          L[i] = this.lastL; R[i] = this.lastR;
        }
        return true;
      }
    }
    // contrôle de débit : on lit plus ou moins vite pour rester autour de
    // la réserve cible. Plage asymétrique : on accepte de ralentir un peu
    // plus (-1,5 %, à peine audible) qu'accélérer, car le risque principal
    // est le tampon qui se vide quand le téléphone rame.
    const ecart = (this.w - this.r - cible) / cible;
    const correction = Math.max(-0.015, Math.min(0.01, ecart * 0.02));
    const step = (this.inRate / sampleRate) * (1 + correction);
    const a = this.lpA;
    for (let i = 0; i < L.length; i++) {
      let l, r;
      if (this.r + 2 < this.w) {
        const i0 = Math.floor(this.r), t = this.r - i0;
        const a0 = (i0 - 1 + this.N) % this.N, a1 = i0 % this.N;
        const a2 = (i0 + 1) % this.N, a3 = (i0 + 2) % this.N;
        l = this.cr(this.bufL[a0], this.bufL[a1], this.bufL[a2], this.bufL[a3], t);
        r = this.cr(this.bufR[a0], this.bufR[a1], this.bufR[a2], this.bufR[a3], t);
        this.r += step;
      } else {
        this.primed = false;                  // plus rien : on réamorcera
        l = this.lastL * 0.97;
        r = this.lastR * 0.97;
      }
      this.f0 += a * (l - this.f0);
      this.f1 += a * (this.f0 - this.f1);
      this.f2 += a * (r - this.f2);
      this.f3 += a * (this.f2 - this.f3);
      const oL = this.f1 - this.dxL + 0.995 * this.dyL;
      this.dxL = this.f1; this.dyL = oL;
      const oR = this.f3 - this.dxR + 0.995 * this.dyR;
      this.dxR = this.f3; this.dyR = oR;
      this.lastL = L[i] = oL;
      this.lastR = R[i] = oR;
    }
    return true;
  }
}
registerProcessor("valdoria-audio", ValdoriaAudioProcessor);
`;

  async function setup(gba) {
    const audio = gba.audio;
    if (!audio || !audio.context || !audio.context.audioWorklet) return false;
    const ctx = audio.context;
    try {
      if (!ctx.__valdoriaWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        ctx.__valdoriaWorklet = true;
      }
      if (state.audioNode) { try { state.audioNode.disconnect(); } catch (e) {} }
      const node = new AudioWorkletNode(ctx, "valdoria-audio", { outputChannelCount: [2] });
      node.connect(ctx.destination);
      var fpsTest = parseFloat(new URLSearchParams(location.search).get("fps"));
      var inRate = (fpsTest >= 5 && fpsTest <= 120) ? Math.round(32768 * fpsTest / 59.7275) : 32768;
      node.port.postMessage({ rate: inRate });
      state.audioNode = node;
      state.audioLastPtr = 0;
      // neutralise la sortie d'origine (ScriptProcessor) : le worklet la remplace
      try { audio.jsAudio.disconnect(); } catch (e) { /* pas encore connecté */ }
      audio.jsAudio = { connect() {}, disconnect() {} };
      return true;
    } catch (error) {
      console.warn("[audio] worklet indisponible, sortie d'origine conservée", error);
      return false;
    }
  }

  // À appeler après chaque frame émulée : pousse les nouveaux échantillons
  // du tampon circulaire de gbajs vers le worklet.
  function pump(gba) {
    const audio = gba.audio;
    const node = state.audioNode;
    if (!node || !audio || !audio.buffers) return;
    const sp = audio.samplePointer;
    if (!audio.masterEnable || !audio.enabled) { state.audioLastPtr = sp; return; }
    const n = (sp - state.audioLastPtr) & audio.sampleMask;
    if (n <= 0 || n > 8192) { state.audioLastPtr = sp; return; }
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const idx = (state.audioLastPtr + i) & audio.sampleMask;
      l[i] = audio.buffers[0][idx];
      r[i] = audio.buffers[1][idx];
    }
    node.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    state.audioLastPtr = sp;
  }

  window.Valdoria.audio = { setup, pump };
})(window);
