// Аналитика → «Оценка диалогов»: набор, чек-лист, что оценить и ход оценки.
(function (CQA) {
  const { h, api } = CQA;
  const SCOPES = [["all", "Все диалоги"], ["new", "Без оценки"], ["voice call", "Только звонки"], ["agent chat", "Только чаты"]];

  CQA.views.run = async function () {
    const lists = await api.checklists();
    if (!lists.some((c) => c.id === CQA.state.checklist) && lists[0]) CQA.state.checklist = lists[0].id;
    let rows = [], scope = "all";
    const notice = h("div", {});
    const info = h("div", { class: "cqa-run-info" });
    const progress = h("div", { class: "cqa-run-progress", "aria-live": "polite" });
    const count = h("span", { class: "cqa-tag cqa-tag-ok" });
    const force = h("input", { type: "checkbox" });
    const groupInput = h("input", { class: "cqa-input", value: CQA.state.group, "aria-label": "Набор (group_id)", onChange: () => { CQA.state.group = groupInput.value.trim() || CQA.state.group; load().catch(showError); } });
    const showError = (e) => notice.replaceChildren(CQA.errorBox(e));
    const scopeBtns = {};
    const scopeSeg = h("div", { class: "cqa-segm cqa-segm-wide", role: "group", "aria-label": "Что оценить" },
      SCOPES.map(([v, t]) => (scopeBtns[v] = h("button", { onClick: () => { scope = v; drawScope(); } }, t))));
    // null — весь набор (all: true), иначе список id.
    const pickIds = () => (scope === "all" ? null : rows.filter((r) => (scope === "new" ? r.status === "new" : r.channel === scope)).map((r) => r.conversation_id));

    function drawScope() {
      Object.entries(scopeBtns).forEach(([v, b]) => { b.classList.toggle("cqa-on", v === scope); b.setAttribute("aria-pressed", v === scope ? "true" : "false"); });
      const ids = pickIds();
      count.textContent = `Будет оценено: ${ids ? ids.length : rows.length}`;
    }
    async function load() {
      rows = await api.conversations({ group_id: CQA.state.group, checklist_id: CQA.state.checklist });
      const scored = rows.filter((r) => r.final_total !== null && r.final_total !== undefined);
      const kpi = (label, value, sub) => h("div", { class: "cqa-kpi" }, h("span", {}, label), h("b", {}, value), sub && h("small", {}, sub));
      CQA.put(info,
        kpi("Диалогов", rows.length, `звонков ${rows.filter((r) => r.channel === "voice call").length} · чатов ${rows.filter((r) => r.channel !== "voice call").length}`),
        kpi("Оценено", scored.length, `без оценки ${rows.filter((r) => r.status === "new").length}`),
        kpi("Средний итог", CQA.num(scored.length ? Math.round((scored.reduce((s, r) => s + r.final_total, 0) / scored.length) * 10) / 10 : null)),
        kpi("Грубые ошибки", rows.filter((r) => r.critical_flag).length, "флаг без баллов"));
      drawScope();
    }

    function drawProgress(job, total, reused, started) {
      const finished = job.done + job.failed;
      const p = total ? Math.round((100 * finished) / total) : 100;
      CQA.put(progress,
        h("div", { class: "cqa-run-ring" }, CQA.ring(p, "% готово")),
        h("div", { class: "cqa-grow cqa-stack", style: "gap:8px" },
          h("b", {}, `Оценено ${finished} из ${total}`),
          h("div", { class: "cqa-progress" }, h("div", { style: `width:${p}%` })),
          h("div", { class: "cqa-small cqa-muted" }, `Из кэша: ${reused || 0} · Ошибок: ${job.failed} · ${Math.round((Date.now() - started) / 1000)} с`)));
    }

    const runBtn = h("button", { class: "cqa-btn cqa-go cqa-run-go", onClick: async () => {
      const ids = pickIds();
      if (ids && !ids.length) { CQA.toast("Нет диалогов для оценки"); return; }
      runBtn.disabled = true;
      notice.replaceChildren();
      const started = Date.now();
      try {
        const { job_id, total, reused } = await api.evaluate({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, force: force.checked, ...(ids ? { conversation_ids: ids } : { all: true }) });
        const job = await CQA.watchJob(job_id, (j) => drawProgress(j, total, reused, started));
        drawProgress(job, total, reused, started);
        progress.append(h("div", { class: "cqa-alert cqa-alert-ok", style: "margin:0;flex-basis:100%" },
          job.failed ? `Готово. Требуют проверки: ${job.failed}. ` : "Готово. ",
          h("a", { href: "#/analytics/summary" }, "Открыть сводку"), " · ", h("a", { href: "#/dialogs" }, "К диалогам"), " · ", h("a", { href: "#/analytics" }, "Анализ разговора")));
        CQA.toast(job.failed ? `Оценка завершена, требуют проверки: ${job.failed}` : "Оценка завершена");
        await load();
      } catch (e) { showError(e); }
      runBtn.disabled = false;
    } }, "▶ Запустить оценку");

    const fileInput = h("input", { type: "file", accept: ".json,application/json", style: "display:none", onChange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const g = groupInput.value.trim() || "UPLOAD";
        const res = await api.upload(g, JSON.parse(await file.text()));
        CQA.state.group = g;
        CQA.toast(`Загружено диалогов: ${res.imported}`);
        await load();
      } catch (err) { showError(err); }
      e.target.value = "";
    } });
    const step = (n, title, desc, ...body) => h("div", { class: "cqa-runstep" }, h("span", { class: "cqa-sec-n", "aria-hidden": "true" }, n),
      h("section", { class: "cqa-card" }, h("div", {}, h("h3", {}, title), h("p", { class: "cqa-small cqa-muted" }, desc)), ...body));

    await load();
    return CQA.page(
      CQA.anaHead("run", "Оценка диалогов", ["ИИ проверяет диалоги по чек-листу", "Повторная оценка берётся из кэша"]),
      notice,
      h("div", { class: "cqa-run" },
        step(1, "Набор диалогов", "Загрузите набор с сервера организаторов или свой файл JSON",
          h("div", { class: "cqa-row" }, h("label", { class: "cqa-field" }, "Набор (group_id)", groupInput),
            h("button", { class: "cqa-btn", style: "align-self:flex-end", onClick: async () => {
              try {
                const g = groupInput.value.trim();
                const res = await api.importDataset(g);
                CQA.state.group = g;
                CQA.toast(`Загружено диалогов: ${res.imported}`);
                notice.replaceChildren();
                await load();
              } catch (e) { showError(e); }
            } }, "+ Загрузить набор"),
            h("label", { class: "cqa-btn", style: "align-self:flex-end" }, "Загрузить файл", fileInput)),
          info),
        step(2, "Чек-лист", "По какой версии чек-листа оценивать",
          h("div", { class: "cqa-row" },
            h("select", { class: "cqa-f", "aria-label": "Чек-лист", onChange: (e) => { CQA.state.checklist = e.target.value; load().catch(showError); } },
              lists.map((c) => h("option", { value: c.id, selected: c.id === CQA.state.checklist }, `${c.name} · версия ${c.version} · критериев: ${c.criteria.length}`))),
            h("a", { class: "cqa-link", href: "#/checklists" }, "Открыть конструктор →"))),
        step(3, "Что оценить", "Весь набор, только новые диалоги или один канал",
          scopeSeg, h("div", { class: "cqa-row" }, count, h("label", { class: "cqa-check" }, force, "Оценить заново, не брать из кэша"))),
        step(4, "Запуск", "Ход оценки обновляется каждые 2 секунды", h("div", { class: "cqa-row" }, runBtn), progress)));
  };
})(window.CQA);
