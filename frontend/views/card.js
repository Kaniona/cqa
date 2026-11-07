// Аналитика → «Анализ разговора»: 1 анализ разговора, 2 расшифровка, 3 оценка качества.
(function (CQA) {
  const { h, api } = CQA;
  const AV = { client: ["К", "b"], operator: ["О", "g"], bot: ["Б", "p"], system: ["С", "n"] };
  const WHO = { client: "Клиент", operator: "Оператор", bot: "Бот" };
  const NS = "http://www.w3.org/2000/svg";

  // Значок, цвет и доля для строки критерия.
  function stateOf(r) {
    if (r.is_critical) return r.final_answer === "yes" ? ["⚠", "r", 0] : ["✓", "g", 1];
    if (r.final_answer === "NA") return ["–", "n", null];
    const ratio = r.effective_weight ? r.points / r.effective_weight : 0;
    if (ratio >= 1) return ["✓", "g", 1];
    return ratio > 0 ? ["~", "a", ratio] : ["✕", "r", 0];
  }

  // Время каждой реплики: t, а если его нет, ближайшее известное раньше (иначе 0).
  function timesOf(conv) {
    let last = 0;
    return conv.transcript.map((t) => (t.t === null || t.t === undefined ? last : (last = t.t)));
  }

  // Волна дорожки: столбики там, где говорит участник (реплика звучит до следующей, но не дольше, чем её можно произнести).
  // Высота псевдослучайная, но одна и та же при каждом показе.
  function wave(conv, at, speaker, duration) {
    const n = 240, svg = document.createElementNS(NS, "svg"), path = document.createElementNS(NS, "path");
    const spans = conv.transcript.map((t, i) => {
      const next = i + 1 < at.length ? at[i + 1] : duration;
      return t.speaker === speaker ? [at[i], Math.max(at[i] + 1, Math.min(next, at[i] + 1.5 + t.text.length / 9))] : null;
    }).filter(Boolean);
    let d = "";
    for (let i = 0; i < n; i++) {
      const a = (i * duration) / n, b = ((i + 1) * duration) / n;
      if (!spans.some(([from, to]) => from < b && to > a)) continue;
      const noise = Math.abs(Math.sin(i * 12.9898 + speaker.length * 78.233) * 43758.5453) % 1;
      const amp = 22 + 72 * (0.6 * noise + 0.4 * Math.abs(Math.sin(i / 2.7)));
      d += `M${i * 4 + 2} ${50 - amp / 2}V${50 + amp / 2}`;
    }
    path.setAttribute("d", d);
    Object.entries({ viewBox: `0 0 ${n * 4} 100`, preserveAspectRatio: "none", "aria-hidden": "true" }).forEach(([k, v]) => svg.setAttribute(k, v));
    svg.append(path);
    return svg;
  }

  // Раздел 1. Звонок: плеер с дорожками. Чат: хронология сообщений. Плюс метки доказательств и показатели.
  function buildAnalysis(conv, ev, at, audioRef, goToTurn, focusTurn) {
    const isCall = !!conv.audio_path;
    let duration = Math.max(conv.duration || 0, ...at, 1);
    const pct = (s) => Math.max(0, Math.min(100, (100 * s) / duration));
    const speakers = ["client", "operator", "bot"].filter((sp) => sp !== "bot" || conv.transcript.some((t) => t.speaker === "bot"));
    const card = h("div", { class: "cqa-card cqa-an-card" });
    const frag = h("div", { class: "cqa-frag", style: "display:none" });
    const headLine = isCall ? h("div", { class: "cqa-head-line" }) : null;
    const over = h("div", { class: "cqa-over" }, frag, headLine);
    const axis = h("div", { class: "cqa-axis", "aria-hidden": "true" });
    const lanes = {};
    const audio = isCall ? h("audio", { src: api.audioUrl(conv.audio_path), preload: "metadata" }) : null;

    const lane = (sp) => (lanes[sp] = h("div", { class: "cqa-lane cqa-lane-" + sp, title: isCall ? "Перейти к моменту записи" : "Показать реплику", onClick: (e) => {
      const box = lanes[sp].getBoundingClientRect();
      const s = ((e.clientX - box.left) / box.width) * duration;
      if (isCall) { audio.currentTime = s; return; }
      let best = 0;
      at.forEach((v, i) => { if (Math.abs(v - s) < Math.abs(at[best] - s)) best = i; });
      if (conv.transcript[best]) focusTurn(conv.transcript[best].id);
    } }));

    // Метки доказательств: по одной на критерий, цвет по результату.
    const moments = [];
    if (ev && ev.results) ev.results.forEach((r) => {
      const e = r.evidence[0];
      const i = e ? conv.transcript.findIndex((t) => t.id === e.id) : -1;
      if (i >= 0) moments.push({ r, e, t: at[i], st: stateOf(r) });
    });
    moments.sort((a, b) => a.t - b.t);
    const pins = moments.map((m) => h("button", { class: "cqa-pin cqa-pin-" + m.st[1], title: `${CQA.time(m.t)} · ${m.r.title}: ${CQA.answer(m.r.final_answer)}`, "aria-label": `${m.r.title}, ${CQA.time(m.t)}`, onClick: () => goToTurn(m.e) }));
    over.append(...pins);

    function layout() {
      speakers.forEach((sp) => {
        if (isCall) CQA.put(lanes[sp], wave(conv, at, sp, duration), h("div", { class: "cqa-wave-played" }, wave(conv, at, sp, duration)));
        else CQA.put(lanes[sp], conv.transcript.map((t, i) => t.speaker === sp && h("i", { class: "cqa-tick", style: `left:${pct(at[i])}%` })));
      });
      moments.forEach((m, i) => { pins[i].style.left = pct(m.t) + "%"; });
      CQA.put(axis, [0, 0.25, 0.5, 0.75, 1].map((f) => h("span", { style: `left:${f * 100}%` }, CQA.time(f * duration))));
    }
    audioRef.showFragment = (from, to) => { frag.style.display = ""; frag.style.left = pct(from) + "%"; frag.style.width = Math.max(pct(to) - pct(from), 0.8) + "%"; };

    // Показатели разговора.
    const count = (sp) => conv.transcript.filter((t) => t.speaker === sp).length;
    const share = {};
    speakers.forEach((sp) => {
      share[sp] = conv.transcript.reduce((s, t, i) => s + (t.speaker !== sp ? 0 : isCall ? Math.max(0, Math.min((i + 1 < at.length ? at[i + 1] : duration) - at[i], 1.5 + t.text.length / 9)) : t.text.length), 0);
    });
    const sum = Object.values(share).reduce((a, b) => a + b, 0) || 1;
    const firstOp = conv.transcript.findIndex((t) => t.speaker === "operator");
    const kpi = (label, value, sub) => h("div", { class: "cqa-kpi" }, h("span", {}, label), h("b", {}, value), sub && h("small", {}, sub));
    const kpis = h("div", { class: "cqa-kpis" },
      kpi("Длительность", CQA.time(duration)),
      kpi("Реплик", conv.transcript.length, speakers.map((sp) => `${WHO[sp].toLowerCase()} ${count(sp)}`).join(" · ")),
      kpi("Оператор подключился", firstOp < 0 ? "—" : CQA.time(at[firstOp]), firstOp < 0 ? "оператор не отвечал" : "с начала разговора"),
      h("div", { class: "cqa-kpi" }, h("span", {}, isCall ? "Доля речи" : "Доля текста"),
        h("div", { class: "cqa-share" }, speakers.map((sp) => h("i", { class: "cqa-share-" + sp, style: `width:${(100 * share[sp]) / sum}%` }))),
        h("small", {}, speakers.map((sp) => `${WHO[sp]} ${Math.round((100 * share[sp]) / sum)}%`).join(" · "))));
    const momentList = moments.length > 0 && h("div", { class: "cqa-moments" }, h("span", { class: "cqa-moments-title" }, "Ключевые моменты"),
      moments.map((m) => h("button", { class: "cqa-moment cqa-moment-" + m.st[1], onClick: () => goToTurn(m.e) }, h("b", {}, CQA.time(m.t)), ` ${m.st[0]} ${m.r.title}`)));

    let controls = null;
    if (isCall) {
      audioRef.el = audio;
      const now = h("span", {}, "00:00");
      const total = h("span", {}, " / " + CQA.time(duration));
      const fill = h("b", { style: "width:0" });
      const knob = h("u", { style: "left:0" });
      const prog = h("div", { class: "cqa-prog", role: "slider", tabindex: "0", "aria-label": "Позиция записи", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0",
        onClick: (e) => { const box = prog.getBoundingClientRect(); audio.currentTime = ((e.clientX - box.left) / box.width) * duration; },
        onKeydown: (e) => {
          if (e.key === "ArrowRight") audio.currentTime = Math.min(duration, audio.currentTime + 5);
          if (e.key === "ArrowLeft") audio.currentTime = Math.max(0, audio.currentTime - 5);
        } }, fill, knob);
      const play = h("button", { class: "cqa-play", "aria-label": "Воспроизвести или поставить на паузу", onClick: () => (audio.paused ? audio.play().catch(() => {}) : audio.pause()) }, "▶");
      const errorBox = h("div", {});
      audio.addEventListener("play", () => { play.textContent = "❚❚"; card.classList.add("cqa-is-playing"); });
      audio.addEventListener("pause", () => { play.textContent = "▶"; card.classList.remove("cqa-is-playing"); if (audioRef.onTime) audioRef.onTime(audio.currentTime); });
      audio.addEventListener("loadedmetadata", () => {
        if (isFinite(audio.duration) && audio.duration > 0) { duration = audio.duration; total.textContent = " / " + CQA.time(duration); layout(); }
      });
      audio.addEventListener("error", () => {
        errorBox.replaceChildren(h("div", { class: "cqa-alert cqa-alert-warn", style: "margin:10px 0 0" }, "Запись не загрузилась. Расшифровка и оценка работают. ", h("a", { href: audio.src, target: "_blank", rel: "noopener" }, "Открыть запись отдельно")));
      });
      audio.addEventListener("timeupdate", () => {
        const t = audio.currentTime, p = pct(t);
        card.style.setProperty("--played", p + "%");
        headLine.style.left = p + "%";
        fill.style.width = p + "%"; knob.style.left = p + "%"; prog.setAttribute("aria-valuenow", String(Math.round(p)));
        now.textContent = CQA.time(t);
        if (audioRef.onTime) audioRef.onTime(t);
      });
      audioRef.seek = (t) => { audio.currentTime = t; };
      audioRef.play = () => audio.play().catch(() => {});
      controls = [h("div", { class: "cqa-ctl" }, play, h("div", { class: "cqa-time" }, now, total), prog), errorBox];
    }

    CQA.put(card, audio, controls,
      h("div", { class: "cqa-lanes" }, speakers.map((sp) => h("div", { class: "cqa-track" }, h("span", { class: "cqa-who" }, h("i", { class: "cqa-dot cqa-dot-" + sp }), WHO[sp]), lane(sp))), over),
      h("div", { class: "cqa-axis-row" }, axis), kpis, momentList);
    layout();
    return card;
  }

  CQA.views.card = async function ([group, id], params, rows) {
    const conv = await api.conversation(group, id);
    const evalId = Number(params.get("evaluation")) || (conv.evaluations[0] && conv.evaluations[0].id);
    const ev = evalId ? await api.evaluation(evalId) : null;
    const list = rows || await api.conversations({ group_id: group, checklist_id: CQA.state.checklist }).catch(() => []);
    const isCall = !!conv.audio_path;
    const at = timesOf(conv);
    const audioRef = {};
    const reload = () => CQA.rerender();
    if (isCall) CQA.cleanup = () => { if (audioRef.el) audioRef.el.pause(); };
    try { localStorage.setItem("cqa-last", JSON.stringify([group, id])); } catch (e) { /* хранилище недоступно */ }

    // Раздел 2. Расшифровка: строки «время · кто говорит», у звонка время запускает запись с этого места.
    const turnEls = {}, metaEls = {};
    const transcript = h("div", { class: "cqa-scroll cqa-tr", tabindex: "0", "aria-label": "Расшифровка" }, conv.transcript.map((t, i) => {
      const shown = isCall ? CQA.time(t.t) : t.timestamp;
      const [letter, color] = AV[t.speaker] || ["?", "n"];
      const cls = "cqa-msg" + (t.speaker === "operator" ? " cqa-me" : "") + (t.speaker === "bot" || t.speaker === "system" ? " cqa-ctx" : "");
      const time = isCall ? h("button", { class: "cqa-ts", title: "Слушать с этого места", onClick: () => { audioRef.seek(at[i]); audioRef.play(); } }, shown) : h("span", { class: "cqa-ts" }, shown);
      metaEls[t.id] = h("small", {}, time, " · " + CQA.speaker(t.speaker));
      return (turnEls[t.id] = h("div", { class: cls, id: "cqa-turn-" + t.id },
        h("span", { class: "cqa-av cqa-" + color, "aria-hidden": "true" }, letter),
        h("div", { class: "cqa-bub" }, metaEls[t.id], h("div", {}, t.text))));
    }));
    const clearMarks = () => {
      Object.values(turnEls).forEach((el) => el.classList.remove("cqa-hl", "cqa-range"));
      transcript.querySelectorAll(".cqa-ev").forEach((b) => b.remove());
    };
    const indexOf = (uid) => conv.transcript.findIndex((t) => t.id === uid);
    const nextAt = (i) => (i + 1 < at.length ? at[i + 1] : at[i] + 5);

    function goToTurn(evidence) {
      const i = indexOf(evidence.id);
      if (i < 0) return;
      clearMarks();
      turnEls[evidence.id].classList.add("cqa-hl");
      metaEls[evidence.id].append(evidence.verified
        ? h("span", { class: "cqa-ev" }, "Доказательство")
        : h("span", { class: "cqa-ev cqa-ev-bad" }, "⚠ Доказательство не подтверждено"));
      turnEls[evidence.id].scrollIntoView({ block: "center", behavior: "smooth" });
      audioRef.showFragment(at[i], nextAt(i));
      if (audioRef.seek) audioRef.seek(at[i]);
    }
    function showRange(range) {
      const a = indexOf(range.from), b = indexOf(range.to);
      if (a < 0 || b < 0) return;
      clearMarks();
      conv.transcript.slice(a, b + 1).forEach((t) => turnEls[t.id].classList.add("cqa-range"));
      metaEls[range.from].append(h("span", { class: "cqa-ev" }, "Проверенный участок"));
      turnEls[range.from].scrollIntoView({ block: "center", behavior: "smooth" });
      audioRef.showFragment(at[a], at[b]);
      if (audioRef.seek) audioRef.seek(at[a]);
    }
    // Короткая подсветка реплики (клик по хронологии чата).
    function focusTurn(uid) {
      const el = turnEls[uid];
      el.classList.remove("cqa-turn-hl");
      void el.offsetWidth;
      el.classList.add("cqa-turn-hl");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTimeout(() => el.classList.remove("cqa-turn-hl"), 1200);
    }
    // Во время записи подсвечена текущая реплика, расшифровка прокручивается за ней.
    let playingId = null;
    audioRef.onTime = (now) => {
      let current = null;
      conv.transcript.forEach((t, i) => { if (t.t !== null && at[i] <= now) current = t.id; });
      const next = audioRef.el.paused ? null : current;
      if (next === playingId) return;
      if (playingId) turnEls[playingId].classList.remove("cqa-playing");
      playingId = next;
      if (!next) return;
      turnEls[next].classList.add("cqa-playing");
      transcript.scrollTo({ top: turnEls[next].offsetTop - transcript.clientHeight / 3, behavior: "smooth" });
    };

    // «Переиграть»: учебная симуляция с другой репликой оператора. Официальную оценку не меняет.
    const hasOperator = conv.transcript.some((t) => t.speaker === "operator");
    function replayPanel(r) {
      const box = h("div", { class: "cqa-replay", "aria-live": "polite" });
      let turnId = null, original = "", text = "";
      const close = () => h("button", { class: "cqa-btn", onClick: () => { box.style.display = "none"; } }, "Закрыть");
      const loading = (label) => CQA.fill(box, h("div", { class: "cqa-empty" }, label));
      const fail = (e, retry) => CQA.fill(box, h("div", { class: "cqa-alert cqa-alert-err" }, e.message),
        h("div", { class: "cqa-row" }, h("button", { class: "cqa-btn cqa-go", onClick: retry }, "Повторить"), close()));
      async function suggest() {
        loading("Готовим черновик…");
        try {
          const s = await api.replaySuggest(ev.id, r.criterion_id);
          turnId = s.turn_id; original = s.original_text; text = s.suggested_text;
          edit();
        } catch (e) { fail(e, suggest); }
      }
      function edit() {
        const input = h("textarea", { class: "cqa-input", "aria-label": "Новая реплика оператора", maxlength: 1000, onInput: () => { text = input.value; update(); } });
        input.value = text;
        const hint = h("div", { class: "cqa-small", style: "color:var(--cqa-amber)" });
        const run = h("button", { class: "cqa-btn cqa-go", onClick: check }, "Проверить ответ");
        const update = () => {
          const marker = /\[уточнить/i.test(text);
          hint.textContent = marker ? "Подставьте настоящее значение перед проверкой" : "";
          run.disabled = marker || !text.trim();
        };
        CQA.fill(box,
          h("div", { class: "cqa-small cqa-muted" }, `Исходная реплика оператора (${turnId})`),
          h("div", { class: "cqa-quote" }, original),
          h("div", { class: "cqa-small cqa-muted" }, "Как можно было ответить"), input, hint,
          h("div", { class: "cqa-row" }, run, close()),
          window.CQA_MOCK && h("span", { class: "cqa-tag cqa-tag-warn" }, "Демо-данные"));
        update();
      }
      async function check() {
        loading("Проверяем ответ…");
        try { result(await api.replay(ev.id, { criterion_id: r.criterion_id, turn_id: turnId, text })); } catch (e) { fail(e, check); }
      }
      function result(res) {
        CQA.fill(box,
          h("div", { class: "cqa-replay-score" }, `${CQA.num(res.before_total)} → ${CQA.num(res.after_total)}`),
          res.changes.length ? res.changes.map((c) => h("div", {}, h("b", {}, c.title), `: ${CQA.num(c.before_points)} → ${CQA.num(c.after_points)} баллов`, h("div", { class: "cqa-small cqa-muted" }, c.reason)))
            : h("div", { class: "cqa-muted" }, "Оценка по критериям не изменилась."),
          res.after_critical_flag && !res.before_critical_flag && h("div", {}, h("span", { class: "cqa-tag cqa-tag-err" }, "⚠ Грубая ошибка")),
          h("div", { class: "cqa-small cqa-muted" }, "Симуляция. Официальная оценка не изменилась" + (res.cached ? " (из кэша)" : "") + "."),
          h("div", { class: "cqa-row" }, h("button", { class: "cqa-btn cqa-dis", onClick: edit }, "Изменить ответ"), close()),
          window.CQA_MOCK && h("span", { class: "cqa-tag cqa-tag-warn" }, "Демо-данные"));
      }
      box.style.display = "none";
      box.start = () => { box.style.display = ""; if (!turnId) suggest(); else edit(); };
      return box;
    }

    // Строка критерия и раскрывающееся объяснение. el.open(true) сразу открывает форму апелляции.
    function criterion(r, open) {
      const [mark, color, ratio] = stateOf(r);
      const appeals = ev.appeals.filter((a) => a.criterion_id === r.criterion_id);
      const hasOpen = appeals.some((a) => a.status === "open");
      const canAppeal = CQA.state.role === "Оператор" && !hasOpen;
      const form = h("div", { class: "cqa-stack", style: "display:none" });
      const comment = h("textarea", { class: "cqa-input", placeholder: "Почему вы не согласны с оценкой? (обязательно)", "aria-label": "Комментарий" });
      const formErr = h("div", {});
      form.append(comment, formErr, h("div", { class: "cqa-row" },
        h("button", { class: "cqa-btn cqa-dis", onClick: async () => {
          try {
            await api.appeal({ evaluation_id: ev.id, criterion_id: r.criterion_id, comment: comment.value, created_by: CQA.state.role });
            CQA.toast("Апелляция отправлена проверяющему");
            reload();
          } catch (e) { formErr.replaceChildren(CQA.errorBox(e)); }
        } }, "Отправить"),
        h("button", { class: "cqa-btn", onClick: () => { form.style.display = "none"; } }, "Отмена")));

      const first = r.evidence[0];
      const isNA = r.final_answer === "NA";
      const lost = !r.is_critical && !isNA && r.points < r.effective_weight;
      const replay = lost && hasOperator && ev.status === "done" ? replayPanel(r) : null;
      const full = isNA || (r.is_critical ? r.final_answer === "no" : r.points >= r.effective_weight);
      const whyTitle = isNA ? "Почему N/A." : r.is_critical && r.final_answer === "yes" ? "Выявлена грубая ошибка." : full ? "Обоснование." : "Почему снижена оценка.";
      const body = h("div", { class: "cqa-crit-body", style: open ? "" : "display:none" },
        h("div", { class: "cqa-row" },
          h("span", { class: "cqa-tag" }, "Ответ: " + CQA.answer(r.final_answer)),
          !r.is_critical && h("span", { class: "cqa-tag" }, `Вес: ${CQA.num(r.base_weight)}` + (r.effective_weight && r.effective_weight !== r.base_weight ? ` → ${CQA.num(r.effective_weight)}` : "")),
          r.final_answer !== r.ai_answer && h("span", { class: "cqa-tag cqa-tag-warn" }, `ИИ: ${CQA.answer(r.ai_answer)} → проверяющий: ${CQA.answer(r.final_answer)}`)),
        h("div", { class: "cqa-why" + (full ? " cqa-why-ok" : "") }, h("b", {}, whyTitle), " ", r.reason),
        r.evidence.map((e) => h("div", { class: "cqa-quote" },
          h("div", {}, "«" + e.quote + "»"),
          h("div", { class: "cqa-small cqa-muted" }, "Реплика " + e.id + " ", !e.verified && h("span", { class: "cqa-tag cqa-tag-warn" }, "⚠ Доказательство не подтверждено")))),
        !first && r.checked_range && h("div", { class: "cqa-small cqa-muted" }, `Проверенный участок: ${r.checked_range.from}–${r.checked_range.to}`),
        h("div", { class: "cqa-acts" },
          first && h("button", { class: "cqa-btn cqa-go", onClick: () => goToTurn(first) }, "Перейти к фрагменту"),
          !first && r.checked_range && h("button", { class: "cqa-btn cqa-go", onClick: () => showRange(r.checked_range) }, "Показать проверенный участок"),
          replay && h("button", { class: "cqa-btn", onClick: () => replay.start() }, "Переиграть"),
          canAppeal && h("button", { class: "cqa-btn cqa-dis", onClick: () => { form.style.display = ""; comment.focus(); } }, "Оспорить оценку")),
        replay,
        hasOpen && h("div", {}, h("span", { class: "cqa-tag cqa-tag-warn" }, "Апелляция на рассмотрении")),
        form,
        appeals.map((a) => h("div", { class: "cqa-history" },
          h("b", {}, a.status === "open" ? "Апелляция открыта" : a.decision === "changed" ? "Оценка изменена" : "Оценка подтверждена"),
          h("div", {}, "Комментарий: " + a.comment),
          a.status === "resolved" && h("div", {}, `Исходная оценка: ${CQA.answer(r.ai_answer)}. Финальная: ${CQA.answer(r.final_answer)}.`),
          a.decision_reason && h("div", {}, "Причина решения: " + a.decision_reason))));

      const pts = r.is_critical ? h("div", { class: "cqa-pts" }, r.final_answer === "yes" ? "Выявлено" : "Нет")
        : isNA ? h("div", { class: "cqa-pts" }, "N/A")
          : h("div", { class: "cqa-pts" }, CQA.num(r.points), " ", h("span", {}, "/ " + CQA.num(r.effective_weight)));
      const head = h("button", { class: "cqa-crit-head", "aria-expanded": open ? "true" : "false", onClick: () => {
        const nowOpen = body.style.display === "none";
        body.style.display = nowOpen ? "" : "none";
        head.setAttribute("aria-expanded", nowOpen ? "true" : "false");
      } },
        CQA.tile(color, mark),
        h("div", {}, r.title, h("div", { class: "cqa-line" }, h("i", { style: ratio === null ? "width:0" : `width:${Math.max(ratio * 100, 2)}%;background:${r.is_critical && ratio === 0 ? "#E5484D" : CQA.barColor(ratio)}` }))),
        pts);
      const el = h("div", { class: "cqa-crit" }, head, body);
      el.open = (dispute) => {
        body.style.display = ""; head.setAttribute("aria-expanded", "true");
        if (dispute && canAppeal) form.style.display = "";
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        if (dispute && canAppeal) setTimeout(() => comment.focus({ preventScroll: true }), 350);
      };
      return el;
    }

    function hero(focus, critEls) {
      const total = ev.final_total;
      const applicable = ev.results.filter((r) => !r.is_critical && r.final_answer !== "NA");
      const fullCount = applicable.filter((r) => r.points >= r.effective_weight).length;
      const cls = total === null ? " cqa-hero-none" : ev.final_critical_flag || total < 60 ? " cqa-hero-bad" : total < 85 ? " cqa-hero-low" : "";
      const title = total === null ? "Не оценивается" : total >= 85 ? "Хороший результат" : total >= 60 ? "Есть замечания" : "Низкий результат";
      return h("div", { class: "cqa-hero" + cls }, CQA.ring(total, "из 100"),
        h("div", {},
          h("h3", {}, title),
          h("p", {}, ev.final_critical_flag ? "⚠ Выявлена грубая ошибка" : "✓ Грубых ошибок нет", h("br", {}), `Выполнено полностью: ${fullCount} из ${applicable.length}`),
          ev.final_total !== ev.ai_total && h("p", {}, h("b", {}, `ИИ: ${CQA.num(ev.ai_total)} → Финальный: ${CQA.num(ev.final_total)}`)),
          focus && h("div", { class: "cqa-hero-acts" },
            focus.evidence[0] && h("button", { class: "cqa-btn cqa-light", onClick: () => goToTurn(focus.evidence[0]) }, "Перейти к фрагменту"),
            CQA.state.role === "Оператор" && h("button", { class: "cqa-btn cqa-ghost", onClick: () => critEls[focus.criterion_id].open(true) }, "Оспорить оценку"))));
    }

    // «Почему снижена оценка»: грубые ошибки и критерии с потерянными баллами, самые дорогие первыми.
    function reasons(items, critEls) {
      return h("div", { class: "cqa-reasons" },
        h("h3", { class: "cqa-reasons-title" }, items.length ? "Почему снижена оценка" : "Все критерии выполнены"),
        items.length ? items.map((r) => {
          const [mark, color] = stateOf(r);
          return h("div", { class: "cqa-reason" + (r.is_critical ? " cqa-reason-bad" : "") },
            CQA.tile(color, mark),
            h("div", { class: "cqa-grow" }, h("b", {}, r.title), h("p", {}, r.reason),
              h("div", { class: "cqa-reason-acts" },
                r.evidence[0] && h("button", { class: "cqa-link", onClick: () => goToTurn(r.evidence[0]) }, "Фрагмент"),
                h("button", { class: "cqa-link", onClick: () => critEls[r.criterion_id].open() }, "Подробнее"))),
            h("span", { class: "cqa-reason-pts" }, r.is_critical ? "флаг" : "−" + CQA.num(r.effective_weight - r.points)));
        }) : h("p", { class: "cqa-muted" }, "Оператор выполнил чек-лист полностью."));
    }

    function scorePanel() {
      if (!ev) return h("div", { class: "cqa-empty" }, "Диалог ещё не оценён.", h("br", {}), h("br", {}), evaluateButton("Оценить"));
      if (ev.status === "queued" || ev.status === "running") return h("div", { class: "cqa-empty" }, "Идёт оценка. Обновите страницу через несколько секунд.");
      if (!ev.results.length) return h("div", {}, h("div", { class: "cqa-alert cqa-alert-warn" }, CQA.statusTag(ev.status), " ", ev.error || "Оценка не получена."), evaluateButton("Повторить"));
      const regular = ev.results.filter((r) => !r.is_critical);
      const critical = ev.results.filter((r) => r.is_critical);
      const issues = [...critical.filter((r) => r.final_answer === "yes"),
        ...regular.filter((r) => r.final_answer !== "NA" && r.points < r.effective_weight).sort((a, b) => (b.effective_weight - b.points) - (a.effective_weight - a.points))];
      const critEls = {};
      const rows = [regular.map((r) => (critEls[r.criterion_id] = criterion(r, false))),
        critical.length > 0 && h("div", { class: "cqa-group-title" }, "Грубые нарушения"),
        critical.map((r) => (critEls[r.criterion_id] = criterion(r, r.final_answer === "yes")))];
      const sections = ev.sections.filter((s) => s.score !== null);
      return h("div", { class: "cqa-q" },
        ev.final_critical_flag && h("div", { class: "cqa-alert cqa-alert-err", role: "alert" }, "⚠ Грубая ошибка. Диалог нужно проверить в первую очередь. Балл она не меняет."),
        h("div", { class: "cqa-q-top" }, hero(issues[0], critEls), reasons(issues, critEls)),
        sections.length > 0 && h("div", { class: "cqa-sections" }, sections.map((s) => h("span", { class: "cqa-chip" }, `${s.section}: ${CQA.num(s.score)}`))),
        h("h3", { class: "cqa-q-sub" }, "Критерии чек-листа"),
        h("div", { class: "cqa-q-list" }, rows),
        h("div", { class: "cqa-small cqa-muted", style: "margin-top:10px" }, `Чек-лист: версия ${ev.checklist_version}. Модель: ${ev.model}.`));
    }

    function evaluateButton(label) {
      return h("button", { class: "cqa-btn cqa-go", onClick: async () => {
        try {
          const { job_id } = await api.evaluate({ group_id: group, conversation_ids: [id], checklist_id: CQA.state.checklist, force: true });
          await CQA.watchJob(job_id, () => {});
          location.hash = `#/dialog/${encodeURIComponent(group)}/${encodeURIComponent(id)}`;
          reload();
        } catch (e) { CQA.toast("Не удалось оценить: " + e.message); }
      } }, label);
    }

    const evalSelect = conv.evaluations.length > 1 && h("select", { class: "cqa-f", "aria-label": "Оценка", onChange: (e) => { location.hash = `#/dialog/${encodeURIComponent(group)}/${encodeURIComponent(id)}?evaluation=${e.target.value}`; } },
      conv.evaluations.map((x) => h("option", { value: x.id, selected: ev && x.id === ev.id }, `${x.checklist_id} v${x.checklist_version}: ${CQA.num(x.final_total)}`)));
    // Выбор диалога: звонки и чаты набора, у каждого итог и знак грубой ошибки.
    const option = (r) => h("option", { value: r.conversation_id, selected: r.conversation_id === id },
      `${r.conversation_id} · ${r.language} · ${r.final_total === null || r.final_total === undefined ? "без оценки" : CQA.num(r.final_total)}${r.critical_flag ? " ⚠" : ""}`);
    const picker = list.length > 0 && h("select", { class: "cqa-f cqa-picker", "aria-label": "Диалог", onChange: (e) => { location.hash = `#/dialog/${encodeURIComponent(group)}/${encodeURIComponent(e.target.value)}`; } },
      !list.some((r) => r.conversation_id === id) && h("option", { value: id, selected: true }, id),
      [["voice call", "Звонки"], ["agent chat", "Чаты"]].map(([ch, label]) => {
        const part = list.filter((r) => r.channel === ch);
        return part.length ? h("optgroup", { label }, part.map(option)) : null;
      }));

    const scoreCard = h("div", { class: "cqa-card cqa-quality" }, scorePanel());
    const sec = (n, title, desc, extra, ...body) => h("section", { class: "cqa-sec cqa-sec-" + n, "aria-labelledby": "cqa-sec-" + n },
      h("div", { class: "cqa-sec-head" }, h("span", { class: "cqa-sec-n", "aria-hidden": "true" }, n),
        h("div", { class: "cqa-grow" }, h("h2", { class: "cqa-sec-title", id: "cqa-sec-" + n }, title), desc && h("p", { class: "cqa-sec-desc" }, desc)), extra),
      ...body);
    const legend = h("div", { class: "cqa-legend", "aria-hidden": "true" }, ["client", "operator", "bot"].filter((sp) => conv.transcript.some((t) => t.speaker === sp)).map((sp) => h("span", {}, h("i", { class: "cqa-dot cqa-dot-" + sp }), WHO[sp])));
    const hasResults = ev && ev.results && ev.results.length > 0;
    const page = h("div", { class: "cqa-page" + (isCall ? " cqa-has-player" : "") });
    const ctx = {
      page, turnEls, scroller: transcript, card: scoreCard, stateOf, goToTurn,
      enter: () => {
        if (audioRef.el) audioRef.el.pause();
        clearMarks();
        page.classList.add("cqa-live-on");
        const main = page.closest(".cqa-main");
        if (main) main.scrollTo({ top: 0, behavior: "smooth" });
      },
      restore: () => { page.classList.remove("cqa-live-on"); CQA.put(scoreCard, scorePanel()); },
    };
    const liveBtn = hasResults && CQA.startLive && h("button", { class: "cqa-pill cqa-live-btn", onClick: () => CQA.startLive(conv, ev, ctx) }, "▶ Аудит в прямом эфире");

    CQA.put(page,
      CQA.anaHead("dialog", conv.conversation_id, [CQA.channel(conv.channel), CQA.language(conv.language), CQA.time(conv.duration), `реплик: ${conv.transcript.length}`, ev && ev.status !== "done" && CQA.statusTag(ev.status)],
        picker, evalSelect, liveBtn),
      h("div", { class: "cqa-secs" },
        sec(1, "Анализ разговора", isCall ? "Дорожки клиента и оператора, метки доказательств и ключевые моменты" : "Хронология чата, метки доказательств и ключевые моменты", null,
          buildAnalysis(conv, ev, at, audioRef, goToTurn, focusTurn)),
        sec(2, "Расшифровка", isCall ? "Нажмите на время реплики, чтобы послушать запись с этого места" : "Сообщения по порядку, бот и система приглушены", legend,
          h("div", { class: "cqa-card cqa-tr-card" }, transcript)),
        sec(3, isCall ? "Оценка качества звонка" : "Оценка качества диалога", ev ? `Чек-лист «${ev.checklist_name || ev.checklist_id}» · версия ${ev.checklist_version} · модель ${ev.model}` : "Оценки ещё нет", null,
          scoreCard)));
    return page;
  };
})(window.CQA);
