// Меню, роль и маршруты.
(function (CQA) {
  const { h } = CQA;
  const items = [["dialogs", "Диалоги", "chat", "g"], ["checklists", "Чек-листы", "check", "t"], ["appeals", "Апелляции", "law", "p"], ["analytics", "Аналитика", "bars", "a"]];

  try { CQA.state.role = localStorage.getItem("cqa-role") || CQA.state.role; } catch (e) { /* хранилище недоступно */ }

  const links = {};
  const nav = h("nav", { class: "cqa-nav", "aria-label": "Разделы" }, items.map(([id, label, ic, color]) => (links[id] = h("a", { href: "#/" + id }, CQA.tile(color, ic), label))));
  const roleTile = h("span", {});
  const drawRoleTile = () => roleTile.replaceChildren(CQA.tile(CQA.state.role === "Проверяющий" ? "p" : "b", "user"));
  const roleSelect = h("select", { "aria-label": "Роль", onChange: (e) => {
    CQA.state.role = e.target.value;
    drawRoleTile();
    try { localStorage.setItem("cqa-role", e.target.value); } catch (err) { /* хранилище недоступно */ }
    route();
  } }, ["Оператор", "Проверяющий"].map((r) => h("option", { value: r, selected: r === CQA.state.role }, r)));
  const main = h("main", { class: "cqa-main" });

  document.getElementById("cqa-root").append(
    h("aside", { class: "cqa-side" },
      h("div", { class: "cqa-logo" }, h("i", {}, CQA.svgIcon("tick", 3)), "CQA"), nav,
      h("label", { class: "cqa-role" }, roleTile, h("div", { class: "cqa-grow" }, "Роль", roleSelect)),
      window.CQA_MOCK && h("div", { class: "cqa-demo-note" }, "Демо-режим: диалоги и оценки придуманы, сервер и ИИ не подключены."))
  );
  document.getElementById("cqa-root").append(main);
  drawRoleTile();

  let token = 0;
  async function route() {
    const hash = location.hash.replace(/^#\/?/, "") || "dialogs";
    const [pathPart, search] = hash.split("?");
    const parts = pathPart.split("/");
    const name = parts[0];
    const active = name === "dialog" ? "dialogs" : name;
    Object.entries(links).forEach(([id, a]) => {
      a.classList.toggle("cqa-active", id === active);
      if (id === active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const view = { dialogs: CQA.views.dialogs, dialog: CQA.views.card, checklists: CQA.views.checklists, appeals: CQA.views.appeals, analytics: CQA.views.analytics }[name];
    const mine = ++token;
    if (CQA.cleanup) { CQA.cleanup(); CQA.cleanup = null; }
    main.replaceChildren(CQA.loading());
    try {
      if (!view) throw new Error("Раздел не найден");
      const node = await view(parts.slice(1).map(decodeURIComponent), new URLSearchParams(search || ""));
      if (mine === token) { main.replaceChildren(node); main.scrollTop = 0; }
    } catch (e) {
      if (mine === token) main.replaceChildren(CQA.errorBox(e));
    }
  }
  CQA.rerender = route;
  window.addEventListener("hashchange", route);
  route();
})(window.CQA);
