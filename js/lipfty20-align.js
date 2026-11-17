/* v20.0.5: keep the left-hand qualification card level with the bottom
   of the actual board frame, even when a player's status wraps or the
   desktop window is resized. This is presentation only. */
(function () {
  "use strict";
  const stage = document.querySelector(".game-stage");
  const reserve = stage?.querySelector(".reserve-panel");
  const qualification = stage?.querySelector(".qualification-panel");
  const board = stage?.querySelector(".board-frame");
  if (!stage || !reserve || !qualification || !board) return;

  const desktop = window.matchMedia("(min-width: 901px)");
  let queued = false;
  function alignCards() {
    queued = false;
    // Reset before measuring so changes in card content cannot accumulate.
    qualification.style.marginTop = "";
    if (!desktop.matches) return;
    const spare = board.getBoundingClientRect().bottom -
      qualification.getBoundingClientRect().bottom;
    if (spare > 1) qualification.style.marginTop = `${Math.round(spare)}px`;
  }
  function scheduleAlign() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(alignCards);
  }
  window.addEventListener("resize", scheduleAlign);
  window.addEventListener("load", scheduleAlign, { once:true });
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(scheduleAlign);
    observer.observe(board);
    observer.observe(reserve);
    observer.observe(qualification);
  }
  // Opening Accept/Take may temporarily occupy the right-hand grid row.
  const swap = stage.querySelector("#swap-box");
  if (swap && typeof MutationObserver === "function") {
    const mutation = new MutationObserver(scheduleAlign);
    mutation.observe(swap, {attributes:true, attributeFilter:["hidden"]});
  }
  scheduleAlign();
})();
