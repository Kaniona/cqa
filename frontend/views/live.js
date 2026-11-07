// Режим «Аудит в прямом эфире»: разговор проигрывается, критерий раскрывается в момент своего доказательства,
// у каждой цитаты видно, найдена ли она в разговоре дословно.
(function (CQA) {
  // Точность ИИ против эксперта из results/REPORT.md. Обновляйте только эту строку.
  const ACCURACY = "Точность ИИ против эксперта: 91 % (112 оценок)";
  const { h } = CQA;
  const LEN = 2 * Math.PI * 47;

  // Секунды каждой реплики: t, а без t — ближайшее известное раньше, иначе 0. end — последнее известное t.
  function timeline(conv) {
    const at = {};
    let end = 0;
    conv.transcript.forEach((t) => { if (t.t !== null && t.t !== undefined) end = t.t; at[t.id] = end; });
    return { at, end };
  }
  // Момент раскрытия: последнее доказательство, иначе конец проверенного участка, иначе (и всегда для N/A) конец разговора.
  function revealTimes(conv, ev) {
    const { at, end } = timeline(conv), out = {};
    ev.results.forEach((r) => {
      const na = r.final_answer === "NA";
      const ids = na ? [] : (r.evidence || []).map((e) => e.id).filter((id) => id in at);
      const to = !na && r.checked_range ? r.checked_range.to : null;
      out[r.criterion_id] = ids.length ? Math.max(...ids.map((id) => at[id])) : to in at ? at[to] : end;
    });
    return out;
  }
  {
    const r = revealTimes({ transcript: [{ id: "u1", t: null }, { id: "u2", t: 4 }, { id: "u3", t: null }] }, { results: [
      { criterion_id: "a", final_answer: "yes", evidence: [{ id: "u1" }, { id: "u2" }] },
      { criterion_id: "b", final_answer: "no", evidence: [], checked_range: { from: "u1", to: "u1" } },
      { criterion_id: "c", final_answer: "NA", evidence: [{ id: "u1" }] }] });
    console.assert(r.a === 4 && r.b === 0 && r.c === 4, "revealTimes: доказательство, участок, N/A", r);
  }

  CQA.startLive = function (conv, ev, ctx) {
    if (!ev || !ev.results || !ev.results.length || ctx.page.classList.contains("cqa-live-on")) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const speed = conv.channel === "voice call" ? 2 : 4;
    const { at, end } = timeline(conv), when = revealTimes(conv, ev);
    const turns = conv.transcript.map((t) => ({ el: ctx.turnEls[t.id], at: at[t.id] }));
    const order = [...ev.results.filter((r) => !r.is_critical), ...ev.results.filter((r) => r.is_critical)];
    const queue = order.map((r) => ({ r, at: when[r.criterion_id] })).sort((a, b) => a.at - b.at);
    const rows = {}, timers = [];
    let now = 0, playing = true, finished = false, raf = 0, prev = 0, idle = 0, hold = 0, ti = 0, ci = 0, current = null;
    let shown = 0, from = 0, target = 0, tweenAt = 0, drawn = null, clockText = "";
    let revealed = 0, quotes = 0, verified = 0, userScrolled = false;

    // Панель режима: часы и управление, кольцо, счётчики доверия, баннеры, критерии в ожидании.
    const ring = CQA.ring(0, "из 100");
    const arc = ring.querySelector(".cqa-ring-val"), num = ring.querySelector("b");
    const checked = h("small", { class: "cqa-live-checked" });
    const trust = h("p", { class: "cqa-live-trust" });
    const title = h("h3", {}, "Аудит в прямом эфире");
    const hero = h("div", { class: "cqa-hero cqa-hero-live" }, h("div", { class: "cqa-live-ring" }, ring, checked),
      h("div", {}, title, trust, h("p", { class: "cqa-small" }, ACCURACY)));
    const tag = h("span", { class: "cqa-live-tag" }, "● Эфир");
    const clock = h("span", { class: "cqa-live-clock" });
    const pauseBtn = h("button", { class: "cqa-btn", "aria-label": "Пауза", onClick: () => toggle() }, "❚❚");
    const skipBtn = h("button", { class: "cqa-btn", onClick: () => skip() }, "⏭ К итогу");
    const exitBtn = h("button", { class: "cqa-btn", onClick: () => exit() }, "✕ Выйти");
    const alerts = h("div", { class: "cqa-live-alerts" });
    const status = h("div", { class: "cqa-sr", role: "status" });
    const list = h("div", { class: "cqa-live-list" }, order.map((r) => {
      const mark = h("span", { class: "cqa-lc-mark", "aria-hidden": "true" }, "…");
      const pts = h("span", { class: "cqa-lc-pts" }, r.is_critical ? "—" : "— / " + CQA.num(r.effective_weight || r.base_weight));
      const body = h("div", { class: "cqa-lc-body" });
      const el = h("div", { class: "cqa-lc cqa-lc-wait" }, mark, h("b", { class: "cqa-lc-title" }, r.title), pts, body);
      rows[r.criterion_id] = { el, mark, pts, body };
      return el;
    }));

    // Цитата с меткой доверия. Клик ведёт к реплике (как «Перейти к фрагменту»).
    const quote = (e) => h("button", { class: "cqa-lq" + (e.verified ? "" : " cqa-lq-bad"), type: "button", onClick: () => { userScrolled = true; ctx.goToTurn(e); } },
      h("span", {}, (e.verified ? "🔒 «" : "⚠ «") + e.quote + "»"), h("small", {}, e.verified ? "— найдено в реплике " + e.id : "— не найдено дословно"));
    const counters = () => {
      checked.textContent = `Проверено ${revealed} из ${order.length} критериев`;
      trust.textContent = quotes ? `🔒 ${verified} из ${quotes} цитат подтверждены` : "🔒 Цитат пока нет";
    };
    const retarget = (value) => { from = shown; target = value; tweenAt = performance.now(); };
    function drawRing(v) {
      const value = Math.round(v * 100) / 100, p = Math.max(0, Math.min(100, value)) / 100;
      if (value === drawn) return;
      drawn = value; num.textContent = CQA.num(value);
      arc.setAttribute("stroke-dasharray", `${LEN * p} ${LEN}`); arc.style.opacity = p > 0 ? "1" : "0";
    }
    // Перезапустить анимацию класса и снять его через ms.
    function flash(el, cls, ms) {
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      timers.push(setTimeout(() => el.classList.remove(cls), ms));
    }
    function showTurn(i) {
      if (current) current.classList.remove("cqa-turn-playing");
      (current = turns[i].el).classList.replace("cqa-live-hidden", "cqa-turn-playing");
    }
    const follow = () => { if (!userScrolled) ctx.scroller.scrollTop = ctx.scroller.scrollHeight; };
    const onScroll = () => { const s = ctx.scroller; userScrolled = s.scrollHeight - s.scrollTop - s.clientHeight > 40; };

    // Раскрыть критерий: значок, баллы, вспышка, цитаты; у грубой ошибки баннер, вспышка карточки и пауза 2 с.
    function reveal(r, quick) {
      const row = rows[r.criterion_id];
      const [mark, color] = ctx.stateOf(r);
      const na = r.final_answer === "NA", gross = r.is_critical && r.final_answer === "yes";
      row.mark.textContent = mark;
      row.pts.textContent = r.is_critical ? (gross ? "Выявлено" : "Нет") : na ? "N/A" : `${CQA.num(r.points)} / ${CQA.num(r.effective_weight)}`;
      row.el.className = "cqa-lc cqa-lc-" + color + (quick || reduce || na ? "" : " cqa-lc-flash");
      CQA.put(row.body, r.reason && h("p", {}, r.reason), r.evidence.map(quote));
      revealed++;
      r.evidence.forEach((e) => { quotes++; if (e.verified) verified++; });
      if (r.points) retarget(target + r.points);
      counters();
      if (!quick) {
        r.evidence.forEach((e) => ctx.turnEls[e.id] && flash(ctx.turnEls[e.id], "cqa-turn-hl", 1200));
        list.scrollTo({ top: row.el.offsetTop - list.clientHeight / 3, behavior: reduce ? "auto" : "smooth" });
      }
      if (!gross) return;
      alerts.append(h("div", { class: "cqa-alert cqa-alert-err cqa-live-banner", role: "alert" },
        h("b", {}, "⚠ Грубая ошибка: " + (r.reason || r.title)), r.evidence[0] && quote(r.evidence[0])));
      if (quick) return;
      if (!reduce) flash(ctx.card, "cqa-live-alarm", 1200);
      hold = performance.now() + 2000;
    }

    function advance() {
      let moved = false;
      while (ti < turns.length && turns[ti].at <= now) { showTurn(ti++); moved = true; }
      if (moved) { idle = 0; follow(); }
      while (ci < queue.length && queue[ci].at <= now && performance.now() >= hold) reveal(queue[ci++].r, false);
      if (ti >= turns.length && ci >= queue.length) finish();
    }

    // Свои часы: 4× для чата, 2× для звонка; пауза длиннее 2 с реального времени — прыжок к следующей реплике.
    function frame(ts) {
      const dt = prev ? Math.min(0.1, (ts - prev) / 1000) : 0;
      prev = ts;
      if (playing && !finished && ts >= hold) {
        now += dt * speed;
        idle += dt;
        if (ti < turns.length && turns[ti].at > now && idle >= 2) now = turns[ti].at;
        advance();
      }
      const text = `${CQA.time(Math.min(now, end))} / ${CQA.time(end)}`;
      if (text !== clockText) clock.textContent = clockText = text;
      const k = Math.max(0, Math.min(1, (ts - tweenAt) / 300));
      shown = from + (target - from) * (1 - (1 - k) ** 3);
      drawRing(shown);
      if (finished && k >= 1 && ts >= hold) { settle(); raf = 0; return; }
      raf = playing || k < 1 ? requestAnimationFrame(frame) : 0;
    }
    const kick = () => { if (!raf) { prev = 0; raf = requestAnimationFrame(frame); } };

    function finish() {
      if (finished) return;
      finished = true;
      if (current) current.classList.remove("cqa-turn-playing");
      retarget(ev.final_total || 0);
      pauseBtn.hidden = skipBtn.hidden = true;
      tag.textContent = "✓ Итог"; exitBtn.textContent = "Показать детали"; exitBtn.className = "cqa-btn cqa-go";
    }
    function settle() {
      const total = ev.final_total;
      num.textContent = total === null ? "—" : CQA.num(total);
      ring.setAttribute("aria-label", total === null ? "Не оценивается" : `Итог ${CQA.num(total)} из 100`);
      hero.className = "cqa-hero" + (total === null ? " cqa-hero-none" : ev.final_critical_flag || total < 60 ? " cqa-hero-bad" : total < 85 ? " cqa-hero-low" : "");
      title.textContent = "Итог аудита";
      status.textContent = `Аудит завершён. Итог ${total === null ? "не оценивается" : CQA.num(total)}. ${trust.textContent}.`;
    }
    function toggle() {
      if (finished) return;
      playing = !playing;
      pauseBtn.textContent = playing ? "❚❚" : "▶"; pauseBtn.setAttribute("aria-label", playing ? "Пауза" : "Продолжить");
      if (playing) kick();
    }
    function skip() {
      hold = 0; now = end;
      while (ti < turns.length) showTurn(ti++);
      while (ci < queue.length) reveal(queue[ci++].r, true);
      follow(); finish(); kick();
    }
    // Пробел — пауза и продолжение (кроме случаев, когда фокус на кнопке или поле).
    const onKey = (e) => {
      if (e.key === " " && !/^(BUTTON|INPUT|TEXTAREA|SELECT|A)$/.test(e.target.tagName)) { e.preventDefault(); toggle(); }
    };
    const prevCleanup = CQA.cleanup;
    function stop() {
      cancelAnimationFrame(raf); raf = 0; timers.forEach(clearTimeout);
      document.removeEventListener("keydown", onKey); ctx.scroller.removeEventListener("scroll", onScroll);
      CQA.cleanup = prevCleanup;
    }
    function exit() {
      stop();
      turns.forEach(({ el }) => el.classList.remove("cqa-live-hidden", "cqa-turn-playing", "cqa-turn-hl"));
      ctx.card.classList.remove("cqa-live", "cqa-live-alarm");
      ctx.restore();
    }

    CQA.cleanup = () => { stop(); if (prevCleanup) prevCleanup(); };
    ctx.enter();
    turns.forEach(({ el }) => el.classList.add("cqa-live-hidden"));
    ctx.card.classList.add("cqa-live");
    CQA.put(ctx.card, h("div", { class: "cqa-live-bar" }, tag, clock, h("span", { class: "cqa-grow" }), pauseBtn, skipBtn, exitBtn), hero, alerts, list, status);
    counters(); drawRing(0);
    ctx.scroller.scrollTop = 0;
    ctx.scroller.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("keydown", onKey);
    pauseBtn.focus({ preventScroll: true });
    kick();
  };
})(window.CQA);
