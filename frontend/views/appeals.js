// Экран «Апелляции»: очередь и решение проверяющего.
(function (CQA) {
  const { h, api } = CQA;
  let statusFilter = "open";
  const AV = { client: ["К", "b"], operator: ["О", "g"], bot: ["Б", "p"], system: ["С", "n"] };

  // Реплика в виде сообщения чата, как на карточке диалога.
  function msg(t, highlight) {
    const [letter, color] = AV[t.speaker] || ["?", "n"];
    return h("div", { class: "cqa-msg" + (t.speaker === "operator" ? " cqa-me" : "") + (t.speaker === "bot" || t.speaker === "system" ? " cqa-ctx" : "") + (highlight ? " cqa-hl" : "") },
      h("span", { class: "cqa-av cqa-" + color, "aria-hidden": "true" }, letter),
      h("div", { class: "cqa-bub" }, h("small", {}, `${CQA.time(t.t)} · ${CQA.speaker(t.speaker)}`, highlight && h("span", { class: "cqa-ev" }, "Доказательство")), h("div", {}, t.text)));
  }

  CQA.views.appeals = async function () {
    let selectedId = null;
    const left = h("div", { class: "cqa-card" });
    const right = h("div", { class: "cqa-card" });
    const counter = h("span", {});
    let list = [];

    async function load() {
      list = await api.appeals(statusFilter);
      if (!list.some((a) => a.id === selectedId)) selectedId = list[0] ? list[0].id : null;
      draw();
    }

    function draw() {
      const open = list.filter((a) => a.status === "open").length;
      counter.replaceChildren(open ? h("span", { class: "cqa-pill cqa-grad" }, `Открыто: ${open}`) : "");
      CQA.fill(left,
        h("h2", { class: "cqa-card-title" }, "Очередь"),
        h("select", { class: "cqa-f", style: "width:100%;margin-bottom:10px", "aria-label": "Статус", onChange: (e) => { statusFilter = e.target.value; load(); } },
          [["open", "Открытые"], ["resolved", "Закрытые"], ["", "Все"]].map(([v, t]) => h("option", { value: v, selected: statusFilter === v }, t))),
        list.length ? list.map((a) => h("button", { class: "cqa-item" + (a.id === selectedId ? " cqa-on" : ""), onClick: () => { selectedId = a.id; draw(); } },
          a.status === "open" ? CQA.tile("p", "law") : CQA.tile(a.decision === "changed" ? "g" : "t", "check"),
          h("div", {}, h("b", {}, a.title), h("small", {}, a.conversation_id),
            a.status === "open" ? h("span", { class: "cqa-tag cqa-tag-warn" }, "Открыта") : h("span", { class: "cqa-tag cqa-tag-ok" }, a.decision === "changed" ? "Изменена" : "Подтверждена"))))
          : h("div", { class: "cqa-empty" }, "Апелляций нет"));
      const a = list.find((x) => x.id === selectedId);
      CQA.fill(right, a ? detail(a) : h("div", { class: "cqa-empty" }, "Откройте карточку диалога и оспорьте критерий в роли оператора. Здесь появится обращение."));
    }

    function detail(a) {
      const reviewer = CQA.state.role === "Проверяющий";
      const options = (a.type === "yes_no" ? [["yes", "Да"], ["no", "Нет"]] : a.steps.map((s) => [String(s.value), s.value + (s.label ? ": " + s.label : "")]));
      if (a.na_allowed) options.push(["NA", "N/A"]);
      const reason = h("textarea", { class: "cqa-input", placeholder: "Причина решения (обязательно)", "aria-label": "Причина решения" });
      const select = h("select", { class: "cqa-input", style: "width:100%;display:none", "aria-label": "Новая оценка" }, options.map(([v, t]) => h("option", { value: v, selected: v === String(a.final_answer) }, t)));
      const err = h("div", {});
      let decision = "confirmed";
      const segButtons = {};
      const choose = (value) => {
        decision = value;
        select.style.display = value === "changed" ? "" : "none";
        Object.entries(segButtons).forEach(([v, b]) => { b.classList.toggle("cqa-on", v === value); b.setAttribute("aria-pressed", v === value ? "true" : "false"); });
      };
      const seg = h("div", { class: "cqa-segm", role: "group", "aria-label": "Решение" },
        [["confirmed", "Подтвердить"], ["changed", "Изменить"]].map(([v, t]) => (segButtons[v] = h("button", { class: v === decision ? "cqa-on" : "", "aria-pressed": v === decision ? "true" : "false", onClick: () => choose(v) }, t))));
      const submit = async () => {
        try {
          const ev = await api.decide(a.id, { decision, new_answer: decision === "changed" ? select.value : null, decision_reason: reason.value, decided_by: CQA.state.role });
          CQA.toast(`Решение сохранено. Итог: ${CQA.num(ev.ai_total)} → ${CQA.num(ev.final_total)}`);
          await load();
        } catch (e) { err.replaceChildren(CQA.errorBox(e)); }
      };

      const evIds = new Set(a.evidence.map((e) => e.id));
      const resolved = a.status === "resolved";
      return h("div", { class: "cqa-stack" },
        h("div", { class: "cqa-row" },
          h("div", { class: "cqa-grow" }, h("h2", { class: "cqa-card-title", style: "margin:0" }, `${a.title} · ${a.conversation_id}`), h("div", { class: "cqa-small cqa-muted" }, `${CQA.channel(a.channel)} · ${CQA.language(a.language)}`)),
          h("a", { class: "cqa-pill", href: `#/dialog/${encodeURIComponent(a.group_id)}/${encodeURIComponent(a.conversation_id)}?evaluation=${a.evaluation_id}` }, "Открыть диалог")),
        h("div", { class: "cqa-flow" },
          h("div", { class: "cqa-fbox" }, h("span", {}, `Оценка ИИ «${CQA.answer(a.ai_answer)}»`), h("b", {}, CQA.num(a.ai_total))),
          h("div", { class: "cqa-arrow", "aria-hidden": "true" }, "→"),
          h("div", { class: "cqa-fbox cqa-fbox-new" }, h("span", {}, resolved ? `После решения «${CQA.answer(a.final_answer)}»` : `Сейчас «${CQA.answer(a.final_answer)}»`), h("b", {}, CQA.num(a.final_total)))),
        h("div", { class: "cqa-why" }, h("b", {}, "Объяснение ИИ."), " ", a.reason),
        h("div", { class: "cqa-cmt" }, h("b", {}, "Комментарий оператора."), " ", a.comment),
        h("div", {}, a.fragment.map((t) => msg(t, evIds.has(t.id)))),
        resolved
          ? h("div", { class: "cqa-history" }, h("b", {}, a.decision === "changed" ? "Оценка изменена" : "Оценка подтверждена"), h("div", {}, `Исходная: ${CQA.answer(a.ai_answer)}. Финальная: ${CQA.answer(a.final_answer)}.`), h("div", {}, "Причина: " + a.decision_reason), h("div", {}, `Итог: ${CQA.num(a.ai_total)} → ${CQA.num(a.final_total)}`))
          : reviewer
            ? h("div", { class: "cqa-stack" }, seg, select, reason, err, h("div", { class: "cqa-acts", style: "max-width:260px" }, h("button", { class: "cqa-btn cqa-go", onClick: submit }, "Сохранить решение")))
            : h("div", { class: "cqa-alert cqa-alert-warn" }, "Решение принимает проверяющий. Смените роль в меню слева."));
    }

    await load();
    return CQA.page(
      CQA.top("Апелляции", ["Спорные оценки и решения проверяющего"], counter),
      h("div", { class: "cqa-master" }, left, right));
  };
})(window.CQA);
