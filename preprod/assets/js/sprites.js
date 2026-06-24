(function (window) {
  "use strict";

  const DRAW_W = 32;
  const DRAW_H = 48;
  const FEET   = DRAW_H - 1;
  const ROWS   = { down: 0, left: 1, right: 2, up: 3 };
  const CYCLE  = [0, 1, 2, 1];
  const TILE   = 32;

  const SRC_HOMME = "assets/img/homme10.png";
  const SRC_FILLE = "assets/img/fille8.png";

  const imageCache = {};
  function getImage(src) {
    if (!imageCache[src]) {
      const im = new Image();
      im.src = src;
      imageCache[src] = im;
    }
    return imageCache[src];
  }

  function srcFor(friend) {
    return friend.sexe === 1 ? SRC_FILLE : SRC_HOMME;
  }

  function draw(ctx, x, y, friend) {
    const im = getImage(srcFor(friend));

    // Ombre au sol
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(x + TILE / 2, y + TILE - 3, 10, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!im.complete || !im.naturalWidth) {
      // Fallback fantome colore
      ctx.fillStyle = friend.sexe === 1 ? "rgba(255,100,180,0.8)" : "rgba(60,120,255,0.8)";
      ctx.beginPath();
      ctx.roundRect(x + 6, y - 6, 20, 34, 8);
      ctx.fill();
      return;
    }

    const moving = Date.now() < friend.movingUntil;
    const frame  = moving ? CYCLE[Math.floor(Date.now() / 100) % CYCLE.length] : 1;
    const row    = ROWS[friend.direction] !== undefined ? ROWS[friend.direction] : 0;

    const cw = im.naturalWidth  / 3;
    const ch = im.naturalHeight / 4;
    const dx = x + TILE / 2 - DRAW_W / 2;
    const dy = y + TILE - FEET;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, frame * cw, row * ch, cw, ch, dx, dy, DRAW_W, DRAW_H);
  }

  window.Valdoria.sprites = { draw };
})(window);
