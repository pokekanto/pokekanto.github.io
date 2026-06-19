(function (window) {
  "use strict";

  const $ = id => document.getElementById(id);
  // setStatus conservé pour compatibilité réseau mais n'affiche plus rien
  const setStatus = () => {};

  window.Valdoria = window.Valdoria || {};
  window.Valdoria.dom = { $, setStatus };
})(window);
