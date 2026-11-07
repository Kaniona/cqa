// Экран «Диалоги».
(function (CQA) {
  const { h, api } = CQA;
  const filters = { channel: "", language: "", status: "" };

  // Метка статуса строки: нарушения и спорные оценки заметнее.
  function rowTag(r) {
    if (r.critical_flag) return h("span", { class: "cqa-tag cqa-tag-err" }, "⚠ Грубая ошибка");
    if (r.open_appeals) return h("span", { class: "cqa-tag cqa-tag-warn" }, "Спорная оценка");
    return CQA.statusTag(r.status);
  }
  function rowTile(r) {
    if (r.critical_flag) return CQA.tile("r", "warn");
    if (r.channel === "voice call") return CQA.tile("b", "phone");
    if (r.status === "needs_review" || r.status === "error" || r.open_appeals) return CQA.tile("a", "chat");
    return CQA.tile(r.status === "new" ? "n" : "g", "chat");
  }
  const needsAttention = (r) => r.critical_flag || r.open_appeals || r.status === "needs_review" || r.status === "error";
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
  }

  CQA.views.dialogs = async function () {
    const lists = await api.checklists();
    if (!lists.some((c) => c.id === CQA.state.checklist) && lists[0]) CQA.state.checklist = lists[0].id;
    const selected = new Set();
    const body = h("div", {});
    const banner = h("div", {});
    const tiles = h("div", {});
    const notice = h("div", {});
    const progress = h("div", {});
    const groupInput = h("input", { class: "cqa-bare", value: CQA.state.group, "aria-label": "group_id" });
    const force = h("input", { type: "checkbox" });
    const showError = (e) => notice.replaceChildren(CQA.errorBox(e));

    async function loadTable() {
      const rows = await api.conversations({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, ...filters });
      drawSummary(rows);
      body.replaceChildren(rows.length ? table(rows) : h("div", { class: "cqa-empty" }, "Диалогов нет. Загрузите набор или измените фильтры."));
    }

    function drawSummary(rows) {
      const scored = rows.filter((r) => r.final_total !== null && r.final_total !== undefined);
      const avg = scored.length ? scored.reduce((s, r) => s + r.final_total, 0) / scored.length : null;
      const waiting = rows.filter(needsAttention).length;
      const unrated = rows.filter((r) => r.status === "new").length;
      banner.replaceChildren(h("div", { class: "cqa-banner" },
        h("div", {},
          h("h2", {}, waiting ? `${waiting} ${plural(waiting, "диалог ждёт", "диалога ждут", "диалогов ждут")} проверки`
            : unrated ? `${unrated} ${plural(unrated, "диалог", "диалога", "диалогов")} без оценки` : "Все диалоги проверены"),
          h("div", {}, "Нарушения и спорные оценки показаны первыми"),
          h("button", { class: "cqa-cta", onClick: () => evaluate({ all: true }) }, "Оценить всё")),
        CQA.art()));
      const st = (color, icon, value, label) => h("div", { class: "cqa-card cqa-st" }, CQA.tile(color, icon), h("div", {}, h("b", {}, value), h("span", {}, label)));
      tiles.replaceChildren(h("div", { class: "cqa-tiles" },
        st("g", "chat", rows.length, "Диалогов"),
        st("t", "star", CQA.num(avg === null ? null : Math.round(avg * 10) / 10), "Средний балл"),
        st("r", "warn", rows.filter((r) => r.critical_flag).length, "Грубые ошибки"),
        st("p", "law", rows.reduce((s, r) => s + (r.open_appeals || 0), 0), "Открытые апелляции")));
    }

    function table(rows) {
      const head = h("div", { class: "cqa-rowg cqa-rowg-head", role: "row" }, ["", "Диалог", "Язык", "Канал", "Статус", "Итог", "Апелляция"].map((t) => h("div", { role: "columnheader" }, t)));
      return h("div", { role: "table", "aria-label": "Диалоги" }, head, rows.map((r) => {
        const open = () => { location.hash = `#/dialog/${encodeURIComponent(r.group_id)}/${encodeURIComponent(r.conversation_id)}`; };
        const score = r.final_total === null || r.final_total === undefined ? "—"
          : [CQA.num(r.final_total), h("i", {}, h("u", { style: `width:${Math.max(0, Math.min(100, r.final_total))}%;background:${r.critical_flag ? "#FF5470" : CQA.barColor(r.final_total / 100)}` }))];
        return h("div", { class: "cqa-rowg" + (r.critical_flag ? " cqa-rowg-alert" : ""), role: "row", tabindex: "0", onClick: open, onKeydown: (e) => { if (e.key === "Enter") open(); } },
          h("div", { class: "cqa-rowg-pick", onClick: (e) => e.stopPropagation() },
            h("input", { type: "checkbox", "aria-label": "Выбрать " + r.conversation_id, checked: selected.has(r.conversation_id), onChange: (e) => { if (e.target.checked) selected.add(r.conversation_id); else selected.delete(r.conversation_id); } }),
            rowTile(r)),
          h("div", {}, h("div", { style: "font-weight:700" }, r.conversation_id), h("div", { class: "cqa-small cqa-muted" }, `${CQA.time(r.duration)} · реплик: ${r.turn_count}`)),
          h("div", {}, r.language),
          h("div", {}, CQA.channel(r.channel)),
          h("div", {}, rowTag(r)),
          h("div", {}, h("div", { class: "cqa-sc" }, score),
            r.ai_total !== null && r.ai_total !== r.final_total && h("div", { class: "cqa-small cqa-muted" }, "ИИ: " + CQA.num(r.ai_total))),
          h("div", {}, r.open_appeals ? h("span", { class: "cqa-tag cqa-tag-warn" }, `${r.open_appeals} открыта`) : "—"));
      }));
    }

    async function evaluate(payload) {
      notice.replaceChildren();
      try {
        const { job_id, total } = await api.evaluate({ group_id: CQA.state.group, checklist_id: CQA.state.checklist, force: force.checked, ...payload });
        const job = await CQA.watchJob(job_id, (j) => {
          const finished = j.done + j.failed;
          progress.replaceChildren(h("div", { class: "cqa-row", style: "margin-bottom:10px" }, h("div", { class: "cqa-progress cqa-grow" }, h("div", { style: `width:${total ? (100 * finished) / total : 100}%` })), h("span", { class: "cqa-small cqa-muted" }, `Оценено ${finished} из ${total}`)));
        });
        CQA.toast(job.failed ? `Оценка завершена, требуют проверки: ${job.failed}` : "Оценка завершена");
        progress.replaceChildren();
        await loadTable();
      } catch (e) { showError(e); }
    }

    const filterSelect = (key, label, options) => h("select", { class: "cqa-f", "aria-label": label, onChange: (e) => { filters[key] = e.target.value; loadTable().catch(showError); } },
      options.map(([value, text]) => h("option", { value, selected: filters[key] === value }, text)));

    const fileInput = h("input", { type: "file", accept: ".json,application/json", style: "display:none", onChange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const res = await api.upload(groupInput.value.trim() || "UPLOAD", JSON.parse(await file.text()));
        CQA.state.group = groupInput.value.trim() || "UPLOAD";
        CQA.toast(`Загружено диалогов: ${res.imported}`);
        await loadTable();
      } catch (err) { showError(err); }
      e.target.value = "";
    } });

    await loadTable();

    return CQA.page(
      CQA.top("Диалоги", null,
        h("label", { class: "cqa-pill" }, "Набор", groupInput),
        h("button", { class: "cqa-pill cqa-grad", onClick: async () => {
          try {
            const g = groupInput.value.trim();
            const res = await api.importDataset(g);
            CQA.state.group = g;
            CQA.toast(`Загружено диалогов: ${res.imported}`);
            notice.replaceChildren();
            await loadTable();
          } catch (e) { showError(e); }
        } }, "+ Загрузить набор"),
        h("label", { class: "cqa-pill" }, "Загрузить файл", fileInput)),
      banner, tiles, notice,
      h("div", { class: "cqa-card", style: "padding-block:14px" },
        progress,
        h("div", { class: "cqa-bar" },
          filterSelect("channel", "Канал", [["", "Все каналы"], ["agent chat", "Чаты"], ["voice call", "Звонки"]]),
          filterSelect("language", "Язык", [["", "Все языки"], ["RU", "RU"], ["KZ", "KZ"], ["EN", "EN"]]),
          filterSelect("status", "Статус", [["", "Все статусы"], ["done", "Оценён"], ["needs_review", "Нужна проверка"], ["error", "Ошибка"], ["new", "Не оценён"]]),
          h("select", { class: "cqa-f", "aria-label": "Чек-лист", onChange: (e) => { CQA.state.checklist = e.target.value; loadTable().catch(showError); } },
            lists.map((c) => h("option", { value: c.id, selected: c.id === CQA.state.checklist }, `${c.name} · версия ${c.version}`))),
          h("span", { class: "cqa-grow" }),
          h("label", { class: "cqa-check" }, force, "Оценить заново"),
          h("button", { class: "cqa-btn", onClick: () => { if (!selected.size) { CQA.toast("Выберите диалоги в таблице"); return; } evaluate({ conversation_ids: [...selected] }); } }, "Оценить выбранные")),
        body));
  };
})(window.CQA);
