// Оформление: числа набегают, свет следует за курсором по карточке, волна от нажатия кнопки. Данных не касается.
(function (CQA) {
  const root = document.getElementById("cqa-root");
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Числа в плитках и кольцах набегают от нуля (формат ru-RU: «63,75», «65»).
  CQA.fx = {
    count(scope) {
      if (reduce()) return;
      const items = [];
      scope.querySelectorAll(".cqa-st b, .cqa-ring b, .cqa-kpi b, .cqa-lang b").forEach((el) => {
        const m = /^(\d+(?:,\d+)?)$/.exec(el.textContent.trim());
        if (!m) return;
        const to = Number(m[1].replace(",", "."));
        if (to > 0) items.push({ el, to, digits: (m[1].split(",")[1] || "").length });
      });
      if (!items.length) return;
      const start = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - start) / 900), e = 1 - (1 - k) ** 3;
        items.forEach(({ el, to, digits }) => { if (el.isConnected) el.textContent = (to * e).toLocaleString("ru-RU", { minimumFractionDigits: k < 1 ? 0 : digits, maximumFractionDigits: digits }); });
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
  };

  // Свет за курсором: координаты в --mx/--my карточки, не чаще раза за кадр.
  let lit = null, last = null, queued = false;
  root.addEventListener("pointermove", (e) => {
    last = e;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const ev = last, card = ev.target.closest && ev.target.closest(".cqa-card");
      if (lit && lit !== card) { lit.style.removeProperty("--mx"); lit.style.removeProperty("--my"); }
      lit = card;
      if (!card) return;
      const box = card.getBoundingClientRect();
      card.style.setProperty("--mx", ev.clientX - box.left + "px");
      card.style.setProperty("--my", ev.clientY - box.top + "px");
    });
  }, { passive: true });

  // Волна от нажатия на кнопку.
  root.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest && e.target.closest(".cqa-btn, .cqa-pill, .cqa-cta, .cqa-tabs a");
    if (!btn || btn.classList.contains("cqa-live-btn") || reduce()) return;
    const box = btn.getBoundingClientRect(), size = Math.max(box.width, box.height) * 2.2;
    const wave = document.createElement("span");
    wave.className = "cqa-ripple";
    wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - box.left - size / 2}px;top:${e.clientY - box.top - size / 2}px`;
    btn.append(wave);
    wave.addEventListener("animationend", () => wave.remove());
  });
})(window.CQA);
