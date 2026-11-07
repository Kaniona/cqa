// Общие помощники и все запросы к серверу.
window.CQA = { views: {}, state: { group: "DEV", checklist: "chat-quality", role: "Оператор" } };

(function (CQA) {
  // Создание элементов. Текст всегда попадает как текст, а не как HTML.
  CQA.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "class") el.className = v;
      else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
      else el.setAttribute(k, v);
    });
    kids.flat(Infinity).forEach((kid) => {
      if (kid === null || kid === undefined || kid === false) return;
      el.append(kid instanceof Node ? kid : String(kid));
    });
    return el;
  };

  const h = CQA.h;

  // replaceChildren по правилам h(): массивы раскрываются, false и null пропускаются.
  CQA.fill = (el, ...kids) => el.replaceChildren(...CQA.h("div", {}, ...kids).childNodes);

  // Иконки и объёмные плитки из макета.
  const NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    chat: "M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12z", check: "M5 4h14v16H5zM9 12l2.5 2.5L15.5 9",
    law: "M12 4v16M7 20h10M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0z", bars: "M5 20v-6M12 20V5M19 20v-10",
    phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z",
    warn: "M12 3l10 18H2zM12 10v5M12 18v.5", star: "M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17l-5.6 3.1 1.2-6.2L3 9.6l6.3-.8z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", tick: "M5 13l4.5 4.5L19 7",
  };
  CQA.svgIcon = (name, width) => {
    const s = document.createElementNS(NS, "svg");
    Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "#fff", "stroke-width": width || 2.2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }).forEach(([k, v]) => s.setAttribute(k, v));
    const p = document.createElementNS(NS, "path"); p.setAttribute("d", ICONS[name]); s.append(p);
    return s;
  };
  // color: g t p a r b n; content: имя иконки или короткий текст (✓, 3)
  CQA.tile = (color, content) => h("span", { class: "cqa-tile3d cqa-" + color, "aria-hidden": "true" }, ICONS[content] ? CQA.svgIcon(content) : content);

  // Круг итога: белая дуга на цветном фоне. value null — «не оценивается».
  CQA.ring = (value, caption) => {
    const r = 47, len = 2 * Math.PI * r, none = value === null || value === undefined;
    const part = none ? 0 : Math.max(0, Math.min(100, value)) / 100;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "108"); svg.setAttribute("height", "108"); svg.setAttribute("aria-hidden", "true");
    const circle = (stroke, dash) => {
      const c = document.createElementNS(NS, "circle");
      Object.entries({ cx: 54, cy: 54, r, fill: "none", stroke, "stroke-width": 11, "stroke-linecap": "round", "stroke-dasharray": dash }).forEach(([k, v]) => c.setAttribute(k, v));
      return c;
    };
    svg.append(circle("rgba(255,255,255,.3)", `${len} 0`));
    if (part > 0) svg.append(circle("#fff", `${len * part} ${len}`));
    return h("div", { class: "cqa-ring", role: "img", "aria-label": none ? "Не оценивается" : `Итог ${CQA.num(value)} из 100` }, svg,
      h("div", {}, h("b", { style: none ? "font-size:22px" : "" }, none ? "—" : CQA.num(value)), h("span", {}, none ? "не оценивается" : caption)));
  };

  // Иллюстрация баннера (статичная, без данных).
  CQA.art = () => {
    const t = document.createElement("template");
    t.innerHTML = '<svg class="cqa-art" aria-hidden="true" width="300" height="140" viewBox="0 0 300 140"><defs><linearGradient id="cqa-a" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#7DEBCB"/></linearGradient><linearGradient id="cqa-b" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#D79BFF"/><stop offset="1" stop-color="#8A3DF0"/></linearGradient><linearGradient id="cqa-c" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFE08A"/><stop offset="1" stop-color="#F59A2E"/></linearGradient></defs><rect x="70" y="30" width="150" height="84" rx="22" fill="url(#cqa-a)" opacity=".96"/><path d="M92 112l-6 22 28-20z" fill="#BDF3E1"/><rect x="92" y="52" width="92" height="9" rx="4.5" fill="#12B981"/><rect x="92" y="72" width="62" height="9" rx="4.5" fill="#6CD8B6"/><rect x="176" y="10" width="90" height="56" rx="18" fill="url(#cqa-b)"/><rect x="194" y="26" width="52" height="7" rx="3.5" fill="#fff" opacity=".9"/><rect x="194" y="42" width="34" height="7" rx="3.5" fill="#fff" opacity=".6"/><circle cx="244" cy="102" r="31" fill="url(#cqa-c)"/><path d="M231 102l9 9 17-18" stroke="#fff" stroke-width="6.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return t.content.firstChild;
  };

  // Цвет полосы по доле 0..1, как в макете.
  CQA.barColor = (ratio) => (ratio < 0.6 ? "linear-gradient(90deg,#FF5470,#FF8A5B)" : ratio < 0.8 ? "linear-gradient(90deg,#F0902B,#FFD978)" : "linear-gradient(90deg,#2FD6B4,#3DEB8F)");
  CQA.page = (...kids) => h("div", { class: "cqa-page" }, ...kids);
  CQA.top = (title, chips, ...right) => h("div", { class: "cqa-top" },
    h("div", {}, h("h1", { class: "cqa-title" }, title), chips && chips.length ? h("div", { class: "cqa-chips" }, chips.filter(Boolean).map((c) => h("span", { class: "cqa-chip" }, c))) : null),
    h("div", { class: "cqa-row" }, ...right));

  CQA.num =(n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 }));
  CQA.time = (sec) => {
    if (sec === null || sec === undefined || isNaN(sec)) return "—";
    const s = Math.floor(sec);
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  CQA.answer = (a) => ({ yes: "Да", no: "Нет", NA: "N/A" }[a] || (a === null || a === undefined ? "—" : String(a)));
  CQA.channel = (c) => (c === "voice call" ? "Звонок" : "Чат");
  CQA.language = (l) => ({ RU: "Русский", KZ: "Казахский", EN: "Английский" }[l] || l);
  CQA.speaker = (s) => ({ client: "Клиент", operator: "Оператор", bot: "Бот", system: "Система" }[s] || s);
  CQA.statusTag = (status) => {
    const map = {
      done: ["Оценён", "cqa-tag-ok"], queued: ["В очереди", ""], running: ["Оценивается", "cqa-tag-warn"],
      needs_review: ["Нужна проверка", "cqa-tag-warn"], error: ["Ошибка", "cqa-tag-err"], new: ["Не оценён", ""],
    };
    const [text, cls] = map[status] || [status || "Не оценён", ""];
    return CQA.h("span", { class: "cqa-tag " + cls }, text);
  };
  CQA.toast = (text) => {
    const root = document.getElementById("cqa-root");
    root.querySelectorAll(".cqa-toast").forEach((t) => t.remove());
    const el = CQA.h("div", { class: "cqa-toast", role: "status" }, text);
    root.append(el);
    setTimeout(() => el.remove(), 3800);
  };
  CQA.loading = () => CQA.h("div", { class: "cqa-empty" }, "Загрузка…");
  CQA.errorBox = (e) => CQA.h("div", { class: "cqa-alert cqa-alert-err", role: "alert" }, "Не удалось выполнить действие: " + (e.message || e));

  async function request(method, path, body) {
    if (window.CQA_MOCK) return CQA.mock.request(method, path, body);
    const res = await fetch((window.CQA_API_BASE || "") + "/api" + path, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const d = data.detail;
      throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : "Сервер ответил ошибкой " + res.status);
    }
    return data;
  }

  const query = (params) => {
    const q = Object.entries(params || {}).filter(([, v]) => v !== "" && v !== null && v !== undefined)
      .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
    return q ? "?" + q : "";
  };
  const seg = encodeURIComponent;

  CQA.api = {
    importDataset: (group_id) => request("POST", "/datasets/import", { group_id }),
    upload: (group_id, data) => request("POST", "/conversations/upload" + query({ group_id }), data),
    conversations: (params) => request("GET", "/conversations" + query(params)),
    conversation: (g, id) => request("GET", `/conversations/${seg(g)}/${seg(id)}`),
    checklists: () => request("GET", "/checklists"),
    versions: (id) => request("GET", `/checklists/${seg(id)}/versions`),
    version: (id, v) => request("GET", `/checklists/${seg(id)}/versions/${v}`),
    createChecklist: (c) => request("POST", "/checklists", c),
    updateChecklist: (id, c) => request("PUT", `/checklists/${seg(id)}`, c),
    evaluate: (payload) => request("POST", "/evaluations", payload),
    job: (id) => request("GET", `/jobs/${id}`),
    evaluation: (id) => request("GET", `/evaluations/${id}`),
    appeal: (payload) => request("POST", "/appeals", payload),
    appeals: (status) => request("GET", "/appeals" + query({ status })),
    decide: (id, payload) => request("POST", `/appeals/${id}/decision`, payload),
    analytics: (params) => request("GET", "/analytics" + query(params)),
    audioUrl: (path) => (window.CQA_MOCK ? CQA.mock.audioUrl(path) : (window.CQA_API_BASE || "") + path),
  };

  // Ждать завершения задания оценки и сообщать о ходе.
  CQA.watchJob = (jobId, onTick) => new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const job = await CQA.api.job(jobId);
        onTick(job);
        if (job.status === "done" || job.done + job.failed >= job.total) resolve(job);
        else setTimeout(tick, window.CQA_MOCK ? 300 : 2000);
      } catch (e) { reject(e); }
    };
    tick();
  });
})(window.CQA);
