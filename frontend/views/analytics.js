// Экран «Аналитика»: где повторяются проблемы.
(function (CQA) {
  const { h, api } = CQA;

  CQA.views.analytics = async function () {
    const lists = await api.checklists();
    const data = await api.analytics({ group_id: CQA.state.group, checklist_id: CQA.state.checklist });
    const a = data.appeals;
    const bar = (label, ratio, text) => h("div", { class: "cqa-bg" }, h("span", {}, label),
      h("div", { class: "cqa-line" }, h("i", { style: `width:${Math.max(0, Math.min(100, ratio * 100))}%;background:${CQA.barColor(ratio)}` })), h("b", {}, text));
    const st = (color, icon, value, label, onClick) => h(onClick ? "button" : "div", { class: "cqa-st" + (onClick ? " cqa-st-link" : ""), onClick },
      CQA.tile(color, icon), h("div", {}, h("b", {}, value), h("span", {}, label)));
    const weakest = data.weak_criteria[0];
    const langColors = ["g", "t", "p", "a", "b"];
    const checklist = lists.find((c) => c.id === CQA.state.checklist);

    return CQA.page(
      CQA.top("Аналитика", [`Набор ${CQA.state.group}`, checklist && `${checklist.name} · версия ${checklist.version}`, `Оценено: ${data.evaluated}`],
        h("select", { class: "cqa-f", "aria-label": "Чек-лист", onChange: (e) => { CQA.state.checklist = e.target.value; CQA.rerender(); } },
          lists.map((c) => h("option", { value: c.id, selected: c.id === CQA.state.checklist }, c.name)))),
      h("div", { class: "cqa-banner", style: "padding-block:18px" },
        h("div", { class: "cqa-row", style: "gap:22px;flex-wrap:nowrap" },
          CQA.ring(data.average_total, "средний"),
          h("div", {},
            h("h2", {}, weakest ? `Чаще всего теряем баллы: ${weakest.title}` : "Пока нет оценок"),
            h("div", {}, "Учтены финальные оценки. Здесь видно, где менять инструкции, обучение и продукт")))),
      h("div", { class: "cqa-an" },
        h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Самые слабые критерии"),
          data.weak_criteria.length ? data.weak_criteria.map((k) => bar(k.title + (k.na_count ? ` (N/A: ${k.na_count})` : ""), k.average_ratio, Math.round(k.average_ratio * 100) + "%")) : h("div", { class: "cqa-empty" }, "Нет данных")),
        h("div", { class: "cqa-stack", style: "gap:14px" },
          h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Средний балл по языкам"),
            data.by_language.length ? h("div", { class: "cqa-lang" }, data.by_language.map((x, i) => h("div", { class: "cqa-" + langColors[i % langColors.length] },
              h("b", {}, CQA.num(x.average_total)), h("span", {}, `${CQA.language(x.language)} (${x.count})`)))) : h("div", { class: "cqa-empty" }, "Нет данных")),
          h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "По каналам"),
            data.by_channel.length ? data.by_channel.map((x) => bar(`${CQA.channel(x.channel)} (${x.count})`, (x.average_total || 0) / 100, CQA.num(x.average_total))) : h("div", { class: "cqa-empty" }, "Нет данных")),
          h("section", { class: "cqa-card" }, h("h2", { class: "cqa-card-title" }, "Риски и апелляции"),
            h("div", { class: "cqa-risks" },
              st("r", "warn", data.critical_count, "Грубые ошибки", () => { location.hash = "#/dialogs"; }),
              st("p", "law", `${a.total} (откр. ${a.open})`, "Апелляции"),
              st("a", "chat", data.needs_review, "Нужна проверка"),
              st("g", "check", `${a.changed} / ${a.confirmed}`, "Изменено / подтверждено"))))));
  };
})(window.CQA);
