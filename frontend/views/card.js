// Экран «Анализ разговора»: плеер, расшифровка и оценка.
(function (CQA) {
  const { h, api } = CQA;
  const AV = { client: ["К", "b"], operator: ["О", "g"], bot: ["Б", "p"], system: ["С", "n"] };

  // Значок, цвет и доля для строки критерия.
  function stateOf(r) {
    if (r.is_critical) return r.final_answer === "yes" ? ["⚠", "r", 0] : ["✓", "g", 1];
    if (r.final_answer === "NA") return ["–", "n", null];
    const ratio = r.effective_weight ? r.points / r.effective_weight : 0;
    if (ratio >= 1) return ["✓", "g", 1];
    return ratio > 0 ? ["~", "a", ratio] : ["✕", "r", 0];
  }

  function buildPlayer(conv, audioRef) {
    const audio = h("audio", { src: api.audioUrl(conv.audio_path), preload: "metadata" });
    audioRef.el = audio;
    const lastT = conv.transcript.reduce((m, t) => Math.max(m, t.t || 0), 0);
    let duration = Math.max(conv.duration || 0, lastT, 1);
    const pct = (s) => (100 * s) / duration;
    const heads = [], frags = [], lanes = [];

    function buildLane(speaker, cls) {
      const lane = h("div", { class: "cqa-lane " + cls, title: "Перейти к моменту записи", onClick: (e) => {
        const box = lane.getBoundingClientRect();
        audio.currentTime = ((e.clientX - box.left) / box.width) * duration;
      } });
      lanes.push({ lane, speaker });
      const f = h("div", { class: "cqa-frag", style: "display:none" });
      const l = h("div", { class: "cqa-head-line", style: "left:0" });
      frags.push(f); heads.push(l);
      lane.append(f, l);
      return lane;
    }
    function drawSegments() {
      lanes.forEach(({ lane, speaker }) => {
        lane.querySelectorAll(".cqa-seg").forEach((s) => s.remove());
        conv.transcript.forEach((t, i) => {
          if (t.speaker !== speaker || t.t === null) return;
          const next = conv.transcript.slice(i + 1).find((x) => x.t !== null);
          const end = next ? next.t : duration;
          lane.prepend(h("div", { class: "cqa-seg", style: `left:${pct(t.t)}%;width:${pct(Math.max(end - t.t, 0))}%` }));
        });
      });
    }
    const clientLane = buildLane("client", "");
    const opLane = buildLane("operator", "cqa-lane-op");
    drawSegments();

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
    const play = h("button", { class: "cqa-play", "aria-label": "Воспроизвести или поставить на паузу", onClick: () => (audio.paused ? audio.play() : audio.pause()) }, "▶");
    const errorBox = h("div", {});

    audio.addEventListener("play", () => { play.textContent = "❚❚"; });
    audio.addEventListener("pause", () => { play.textContent = "▶"; });
    audio.addEventListener("loadedmetadata", () => {
      if (isFinite(audio.duration) && audio.duration > 0) { duration = audio.duration; total.textContent = " / " + CQA.time(duration); drawSegments(); }
    });
    audio.addEventListener("error", () => {
      errorBox.replaceChildren(h("div", { class: "cqa-alert cqa-alert-warn", style: "margin:10px 0 0" }, "Запись не загрузилась. Расшифровка и оценка работают. ", h("a", { href: audio.src, target: "_blank", rel: "noopener" }, "Открыть запись отдельно")));
    });
    audio.addEventListener("timeupdate", () => {
      const t = audio.currentTime, p = Math.min(100, pct(t));
      heads.forEach((l) => { l.style.left = p + "%"; });
      fill.style.width = p + "%"; knob.style.left = p + "%"; prog.setAttribute("aria-valuenow", String(Math.round(p)));
      now.textContent = CQA.time(t);
      if (audioRef.onTime) audioRef.onTime(t);
    });
    audioRef.showFragment = (from, to) => {
      frags.forEach((f) => { f.style.display = ""; f.style.left = pct(from) + "%"; f.style.width = pct(Math.max(to - from, 0.5)) + "%"; });
    };
    audioRef.seek = (t) => { audio.currentTime = t; };

    const who = (label, color) => h("span", { class: "cqa-who" }, h("i", { class: "cqa-dot", style: `background:${color}` }), label);
    return h("section", { class: "cqa-card", "aria-label": "Запись разговора" }, audio,
      h("div", { class: "cqa-track" }, who("Клиент", "var(--cqa-client)"), clientLane),
      h("div", { class: "cqa-track" }, who("Оператор", "var(--cqa-op)"), opLane),
      h("div", { class: "cqa-ctl" }, play, h("div", { class: "cqa-time" }, now, h("span", {}, total)), prog),
      errorBox);
  }

  CQA.views.card = async function ([group, id], params) {
    const conv = await api.conversation(group, id);
    const evalId = Number(params.get("evaluation")) || (conv.evaluations[0] && conv.evaluations[0].id);
    const ev = evalId ? await api.evaluation(evalId) : null;
    const audioRef = {};
    const reload = () => CQA.rerender();
    if (conv.audio_path) CQA.cleanup = () => { if (audioRef.el) audioRef.el.pause(); };

    // Расшифровка в виде чата: оператор справа, бот и система приглушены.
    const turnEls = {}, metaEls = {};
    const transcript = h("div", { class: "cqa-scroll", tabindex: "0", "aria-label": "Расшифровка" }, conv.transcript.map((t) => {
      const shown = conv.channel === "voice call" ? CQA.time(t.t) : t.timestamp;
      const [letter, color] = AV[t.speaker] || ["?", "n"];
      const cls = "cqa-msg" + (t.speaker === "operator" ? " cqa-me" : "") + (t.speaker === "bot" || t.speaker === "system" ? " cqa-ctx" : "");
      metaEls[t.id] = h("small", {}, `${shown} · ${CQA.speaker(t.speaker)}`);
      return (turnEls[t.id] = h("div", { class: cls, id: "cqa-turn-" + t.id },
        h("span", { class: "cqa-av cqa-" + color, "aria-hidden": "true" }, letter),
        h("div", { class: "cqa-bub" }, metaEls[t.id], h("div", {}, t.text))));
    }));
    const clearMarks = () => {
      Object.values(turnEls).forEach((el) => el.classList.remove("cqa-hl", "cqa-range"));
      transcript.querySelectorAll(".cqa-ev").forEach((b) => b.remove());
    };
    const indexOf = (uid) => conv.transcript.findIndex((t) => t.id === uid);

    function goToTurn(evidence) {
      const i = indexOf(evidence.id);
      if (i < 0) return;
      clearMarks();
      turnEls[evidence.id].classList.add("cqa-hl");
      metaEls[evidence.id].append(evidence.verified
        ? h("span", { class: "cqa-ev" }, "Доказательство")
        : h("span", { class: "cqa-ev cqa-ev-bad" }, "⚠ Доказательство не подтверждено"));
      turnEls[evidence.id].scrollIntoView({ block: "center", behavior: "smooth" });
      const t = conv.transcript[i];
      if (audioRef.seek && t.t !== null) {
        audioRef.seek(t.t);
        const next = conv.transcript.slice(i + 1).find((x) => x.t !== null);
        audioRef.showFragment(t.t, next ? next.t : t.t + 5);
      }
    }
    function showRange(range) {
      const a = indexOf(range.from), b = indexOf(range.to);
      if (a < 0 || b < 0) return;
      clearMarks();
      conv.transcript.slice(a, b + 1).forEach((t) => turnEls[t.id].classList.add("cqa-range"));
      metaEls[range.from].append(h("span", { class: "cqa-ev" }, "Проверенный участок"));
      turnEls[range.from].scrollIntoView({ block: "center", behavior: "smooth" });
      const from = conv.transcript[a].t, to = conv.transcript[b].t;
      if (audioRef.seek && from !== null && to !== null) { audioRef.seek(from); audioRef.showFragment(from, to); }
    }
    audioRef.onTime = (now) => {
      let current = null;
      conv.transcript.forEach((t) => { if (t.t !== null && t.t <= now) current = t.id; });
      Object.entries(turnEls).forEach(([uid, el]) => el.classList.toggle("cqa-playing", uid === current && !audioRef.el.paused));
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

    // Строка критерия и раскрывающееся объяснение.
    function criterion(r, open) {
      const [mark, color, ratio] = stateOf(r);
      const appeals = ev.appeals.filter((a) => a.criterion_id === r.criterion_id);
      const hasOpen = appeals.some((a) => a.status === "open");
      const isOperator = CQA.state.role === "Оператор";
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
          isOperator && !hasOpen && h("button", { class: "cqa-btn cqa-dis", onClick: () => { form.style.display = ""; comment.focus(); } }, "Оспорить оценку")),
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
        h("div", {}, r.title, h("div", { class: "cqa-line" }, h("i", { style: ratio === null ? "width:0" : `width:${Math.max(ratio * 100, 2)}%;background:${r.is_critical && ratio === 0 ? "#FF5470" : CQA.barColor(ratio)}` }))),
        pts);
      return h("div", { class: "cqa-crit" }, head, body);
    }

    function hero() {
      const total = ev.final_total;
      const fullCount = ev.results.filter((r) => !r.is_critical && r.final_answer !== "NA" && r.points >= r.effective_weight).length;
      const cls = total === null ? " cqa-hero-none" : ev.final_critical_flag || total < 60 ? " cqa-hero-bad" : total < 85 ? " cqa-hero-low" : "";
      const title = total === null ? "Не оценивается" : total >= 85 ? "Хороший результат" : total >= 60 ? "Есть замечания" : "Низкий результат";
      return h("div", { class: "cqa-hero" + cls }, CQA.ring(total, "из 100"),
        h("div", {},
          h("h3", {}, title),
          h("p", {}, ev.final_critical_flag ? "⚠ Выявлена грубая ошибка" : "Грубых ошибок нет", h("br", {}), `Выполнено полностью: ${fullCount}`),
          ev.final_total !== ev.ai_total && h("p", {}, h("b", {}, `ИИ: ${CQA.num(ev.ai_total)} → Финальный: ${CQA.num(ev.final_total)}`))));
    }

    function scorePanel() {
      if (!ev) return h("div", { class: "cqa-empty" }, "Диалог ещё не оценён.", h("br", {}), h("br", {}), evaluateButton("Оценить"));
      if (ev.status === "queued" || ev.status === "running") return h("div", { class: "cqa-empty" }, "Идёт оценка. Обновите страницу через несколько секунд.");
      if (!ev.results.length) return h("div", {}, h("div", { class: "cqa-alert cqa-alert-warn" }, CQA.statusTag(ev.status), " ", ev.error || "Оценка не получена."), evaluateButton("Повторить"));
      const regular = ev.results.filter((r) => !r.is_critical);
      const critical = ev.results.filter((r) => r.is_critical);
      const firstLost = regular.find((r) => r.final_answer !== "NA" && r.points < r.effective_weight);
      return h("div", {},
        ev.final_critical_flag && h("div", { class: "cqa-alert cqa-alert-err", role: "alert" }, "⚠ Грубая ошибка. Диалог нужно проверить в первую очередь. Балл она не меняет."),
        hero(),
        ev.sections.filter((s) => s.score !== null).length > 0 && h("div", { class: "cqa-sections" }, ev.sections.filter((s) => s.score !== null).map((s) => h("span", { class: "cqa-chip" }, `${s.section}: ${CQA.num(s.score)}`))),
        h("div", { style: "margin-top:7px" }, regular.map((r) => criterion(r, r === firstLost))),
        critical.length > 0 && h("div", {}, h("div", { class: "cqa-group-title" }, "Грубые нарушения"), critical.map((r) => criterion(r, r.final_answer === "yes"))),
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

    const evalSelect = conv.evaluations.length > 1 && h("select", { class: "cqa-input", "aria-label": "Оценка", onChange: (e) => { location.hash = `#/dialog/${encodeURIComponent(group)}/${encodeURIComponent(id)}?evaluation=${e.target.value}`; } },
      conv.evaluations.map((x) => h("option", { value: x.id, selected: ev && x.id === ev.id }, `${x.checklist_id} v${x.checklist_version}: ${CQA.num(x.final_total)}`)));

    return h("div", { class: "cqa-page" + (conv.audio_path ? " cqa-has-player" : "") },
      CQA.top("Анализ разговора", [conv.conversation_id, CQA.channel(conv.channel), CQA.language(conv.language), CQA.time(conv.duration)],
        evalSelect, h("a", { class: "cqa-pill", href: "#/dialogs" }, "← К списку")),
      conv.audio_path && buildPlayer(conv, audioRef),
      h("div", { class: "cqa-cols" },
        h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Расшифровка"), transcript),
        h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Оценка качества"), h("div", { class: "cqa-scroll" }, scorePanel()))));
  };
})(window.CQA);
