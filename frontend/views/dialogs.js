// Экран «Диалоги».
(function (CQA) {
  const { h, api } = CQA;
  const filters = { channel: "", language: "", status: "" };

  CQA.views.dialogs = async function () {
    const lists = await api.checklists();
    if (!lists.some((c) => c.id === CQA.state.checklist) && lists[0]) CQA.state.checklist = lists[0].id;
    const selected = new Set();
    const body = h("div", {});
    const notice = h("div", {});

    const groupInput = h("input", { class: "cqa-input", value: CQA.state.group, "aria-label": "group_id", style: "width:130px" });
    const force = h("input", { type: "checkbox" });
    const progress = h("div", {});
    const showError = (e) => notice.replaceChildren(CQA.errorBox(e));

    async function loadTable() {
      const rows = await api.conversations({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, ...filters });
      body.replaceChildren(rows.length ? table(rows) : h("div", { class: "cqa-empty" }, "Диалогов нет. Загрузите набор или измените фильтры."));
    }

    function table(rows) {
      return h("div", { class: "cqa-table-wrap" }, h("table", { class: "cqa-table" },
        h("thead", {}, h("tr", {}, ["", "ID", "Канал", "Язык", "Длит.", "Реплик", "Статус", "Итог ИИ", "Финальный", "Грубая ошибка", "Апелляции"].map((t) => h("th", {}, t)))),
        h("tbody", {}, rows.map((r) => h("tr", { onClick: () => { location.hash = `#/dialog/${encodeURIComponent(r.group_id)}/${encodeURIComponent(r.conversation_id)}`; } },
          h("td", { onClick: (e) => e.stopPropagation() }, h("input", { type: "checkbox", "aria-label": "Выбрать " + r.conversation_id, onChange: (e) => { if (e.target.checked) selected.add(r.conversation_id); else selected.delete(r.conversation_id); } })),
          h("td", { class: "cqa-id" }, r.conversation_id),
          h("td", {}, CQA.channel(r.channel)), h("td", {}, r.language), h("td", {}, CQA.time(r.duration)), h("td", {}, r.turn_count),
          h("td", {}, CQA.statusTag(r.status)), h("td", {}, CQA.num(r.ai_total)),
          h("td", {}, h("b", {}, CQA.num(r.final_total))),
          h("td", {}, r.critical_flag ? h("span", { class: "cqa-tag cqa-tag-err" }, "⚠ Есть") : h("span", { class: "cqa-muted" }, "Нет")),
          h("td", {}, r.open_appeals ? h("span", { class: "cqa-tag cqa-tag-warn" }, r.open_appeals + " откр.") : h("span", { class: "cqa-muted" }, "—"))
        )))));
    }

    async function evaluate(payload) {
      notice.replaceChildren();
      try {
        const { job_id, total } = await api.evaluate({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, force: force.checked, ...payload });
        const job = await CQA.watchJob(job_id, (j) => {
          const finished = j.done + j.failed;
          progress.replaceChildren(h("div", { class: "cqa-row", style: "margin-top:10px" }, h("div", { class: "cqa-progress cqa-grow" }, h("div", { style: `width:${total ? (100 * finished) / total : 100}%` })), h("span", { class: "cqa-small cqa-muted" }, `${finished} из ${total}`)));
        });
        CQA.toast(job.failed ? `Оценка завершена, требуют проверки: ${job.failed}` : "Оценка завершена");
        progress.replaceChildren();
        await loadTable();
      } catch (e) { showError(e); }
    }

    const filterSelect = (key, label, options) => h("select", { class: "cqa-input", "aria-label": label, onChange: (e) => { filters[key] = e.target.value; loadTable().catch(showError); } },
      options.map(([value, text]) => h("option", { value, selected: filters[key] === value }, text)));

    await loadTable();

    return h("div", {},
      h("div", { class: "cqa-head" }, h("div", {}, h("h1", { class: "cqa-title" }, "Диалоги"), h("p", { class: "cqa-sub" }, "Диалоги с нарушениями показаны первыми"))),
      h("div", { class: "cqa-card", style: "margin-bottom:12px" },
        h("div", { class: "cqa-row" },
          groupInput,
          h("button", { class: "cqa-btn", onClick: async () => {
            try {
              const g = groupInput.value.trim();
              const res = await api.importDataset(g);
              CQA.state.group = g;
              CQA.toast(`Загружено диалогов: ${res.imported}`);
              notice.replaceChildren();
              await loadTable();
            } catch (e) { showError(e); }
          } }, "Загрузить набор"),
          h("label", { class: "cqa-btn" }, "Загрузить файл", h("input", { type: "file", accept: ".json,application/json", style: "display:none", onChange: async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
              const res = await api.upload(groupInput.value.trim() || "UPLOAD", JSON.parse(await file.text()));
              CQA.state.group = groupInput.value.trim() || "UPLOAD";
              CQA.toast(`Загружено диалогов: ${res.imported}`);
              await loadTable();
            } catch (err) { showError(err); }
            e.target.value = "";
          } })),
          h("span", { class: "cqa-sep" }),
          h("select", { class: "cqa-input", "aria-label": "Чек-лист", onChange: (e) => { CQA.state.checklist = e.target.value; loadTable().catch(showError); } },
            lists.map((c) => h("option", { value: c.id, selected: c.id === CQA.state.checklist }, `${c.name} (версия ${c.version})`))),
          h("label", { class: "cqa-check" }, force, "Оценить заново"),
          h("button", { class: "cqa-btn", onClick: () => { if (!selected.size) { CQA.toast("Выберите диалоги в таблице"); return; } evaluate({ conversation_ids: [...selected] }); } }, "Оценить выбранные"),
          h("button", { class: "cqa-btn cqa-primary", onClick: () => evaluate({ all: true }) }, "Оценить всё")
        ),
        progress
      ),
      notice,
      h("div", { class: "cqa-card" },
        h("div", { class: "cqa-row", style: "margin-bottom:8px" },
          filterSelect("channel", "Канал", [["", "Все каналы"], ["agent chat", "Чаты"], ["voice call", "Звонки"]]),
          filterSelect("language", "Язык", [["", "Все языки"], ["RU", "RU"], ["KZ", "KZ"], ["EN", "EN"]]),
          filterSelect("status", "Статус", [["", "Все статусы"], ["done", "Оценён"], ["needs_review", "Нужна проверка"], ["error", "Ошибка"], ["new", "Не оценён"]])),
        body));
  };
})(window.CQA);
