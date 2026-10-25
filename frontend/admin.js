/* سين قاف — لوحة التحكم */
(() => {
  "use strict";

  const API = (window.SEEN_QAF_API || "").replace(/\/$/, "");
  const TOKEN_KEY = "seenqaf.admin.token";
  const LEVELS = [200, 400, 600];
  const LEVEL_NAMES = { 200: "سهل", 400: "متوسط", 600: "صعب" };
  const root = document.getElementById("admin");

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ar = (n) => Number(n).toLocaleString("ar-EG");
  const rid = (p) => p + "-" + Math.random().toString(16).slice(2, 10);

  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let bank = null;
  let persistent = false;
  let dirty = false;
  let tab = "questions";
  let query = "";
  const openCats = new Set();

  // ---------- اتصال ----------
  async function call(path, opts = {}, ms = 70000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(API + path, {
        ...opts,
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}), ...(opts.headers || {}) },
      });
      const body = await r.json().catch(() => ({}));
      if (r.status === 401 && path !== "/api/admin/login") { logout("انتهت الجلسة، سجّل دخول من جديد"); throw new Error("401"); }
      if (!r.ok) throw new Error(body.error || "صار خطأ (" + r.status + ")");
      return body;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("السيرفر ما رد. تأكد من الإنترنت وجرّب مرة ثانية.");
      if (e instanceof TypeError) throw new Error("ما قدرنا نوصل للسيرفر. تأكد من رابط الباك إند في config.js.");
      throw e;
    } finally { clearTimeout(t); }
  }

  function toast(msg, ms = 3000) {
    const el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  function setDirty(v) {
    dirty = v;
    const bar = document.querySelector(".savebar");
    if (bar) bar.classList.toggle("show", dirty);
    const st = document.querySelector(".adm-top .status");
    if (st) { st.textContent = dirty ? "فيه تعديلات ما انحفظت" : "كل شي محفوظ"; st.classList.toggle("dirty", dirty); }
  }
  window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  function logout(msg) {
    token = ""; sessionStorage.removeItem(TOKEN_KEY); bank = null; dirty = false;
    renderLogin(msg);
  }

  // ---------- الدخول ----------
  function renderLogin(msg = "") {
    root.innerHTML = `
      <section class="adm-login">
        <h1>لوحة التحكم</h1>
        <p>هنا تعدّل أسئلة سين قاف وإعداداتها</p>
        <form id="login">
          <label style="position:absolute;width:1px;height:1px;overflow:hidden" for="pw">كلمة السر</label>
          <input class="field-dark" id="pw" type="password" autocomplete="current-password" placeholder="كلمة السر" required>
          <button class="btn" type="submit">دخول</button>
          <p class="err" role="alert">${esc(msg)}</p>
        </form>
        <a class="back" href="./">رجوع للعبة</a>
      </section>`;
    const form = document.getElementById("login");
    const pw = document.getElementById("pw");
    pw.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button"), err = form.querySelector(".err");
      btn.disabled = true; btn.textContent = "لحظة…"; err.textContent = "";
      const slow = setTimeout(() => { err.textContent = "نصحّي السيرفر، أول مرة ياخذ لين دقيقة…"; }, 3500);
      try {
        const r = await call("/api/admin/login", { method: "POST", body: JSON.stringify({ password: pw.value }) });
        token = r.token; sessionStorage.setItem(TOKEN_KEY, token);
        await loadData();
      } catch (ex) {
        err.textContent = ex.message; btn.disabled = false; btn.textContent = "دخول";
      } finally { clearTimeout(slow); }
    });
  }

  async function loadData() {
    root.innerHTML = `<div class="loading">نحمّل الأسئلة…</div>`;
    try {
      const r = await call("/api/admin/data");
      bank = r.bank; persistent = r.persistent;
      setDirty(false);
      render();
    } catch (e) {
      if (e.message !== "401") renderLogin(e.message);
    }
  }

  // ---------- الواجهة ----------
  function render() {
    const total = bank.categories.reduce((n, c) => n + c.questions.length, 0);
    root.innerHTML = `
      <div class="adm-top">
        <h1>لوحة التحكم</h1>
        <span class="status ${dirty ? "dirty" : ""}">${dirty ? "فيه تعديلات ما انحفظت" : "كل شي محفوظ"}</span>
        <a class="btn ghost small" href="./" target="_blank" rel="noopener">افتح اللعبة</a>
        <button class="btn ghost small" id="logout">خروج</button>
      </div>
      ${persistent ? "" : `<div class="notice"><b>الحفظ الدائم مو مفعّل.</b> التعديلات تنحفظ في السيرفر بس تضيع إذا طفى أو انعاد تشغيله. فعّله بإضافة GITHUB_TOKEN و GITHUB_REPO في إعدادات Render، أو نزّل نسخة احتياطية من تبويب «نسخة احتياطية».</div>`}
      <div class="tabs" role="tablist">
        ${[["questions", `الفئات والأسئلة (${ar(total)})`], ["settings", "إعدادات اللعبة"], ["backup", "نسخة احتياطية"]].map(([k, l]) =>
          `<button class="tab" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}
      </div>
      <div id="tabpanel">${tab === "questions" ? questionsTab() : tab === "settings" ? settingsTab() : backupTab()}</div>
      <div class="savebar ${dirty ? "show" : ""}">
        <button class="btn" id="save">احفظ التعديلات</button>
        <button class="btn ghost" id="discard">تراجع عنها</button>
      </div>`;
    bind();
  }

  // ----- تبويب الأسئلة -----
  const short = (c, l) => c.questions.filter((q) => q.level === l).length < 2;
  const isPlayable = (c) => c.enabled && LEVELS.every((l) => !short(c, l));
  const matches = (q) => !query || (q.q + " " + q.a).toLowerCase().includes(query.toLowerCase());

  function questionsTab() {
    const playableCount = bank.categories.filter(isPlayable).length;
    const need = bank.settings.categoriesPerTeam * 2;
    const cats = bank.categories.map((c, ci) => ({ c, ci })).filter(({ c }) =>
      !query || c.name.includes(query) || c.questions.some(matches));
    return `
      ${playableCount < need ? `<div class="notice"><b>اللعبة تحتاج ${ar(need)} فئات جاهزة</b> وعندك ${ar(playableCount)} بس. الفئة الجاهزة مفعّلة وفيها سؤالين على الأقل في كل مستوى.</div>` : ""}
      <div class="toolbar">
        <input class="field-dark" id="search" type="search" placeholder="دوّر في الأسئلة والأجوبة" value="${esc(query)}">
        <button class="btn small" id="add-cat">أضف فئة</button>
      </div>
      ${cats.length ? cats.map(({ c, ci }) => catCard(c, ci)).join("") : `<p class="empty">ما في شي يطابق «${esc(query)}»</p>`}`;
  }

  function catCard(c, ci) {
    const open = openCats.has(c.id) || (query && c.questions.some(matches));
    return `
      <details class="cat ${c.enabled ? "" : "off"}" data-cat="${c.id}" ${open ? "open" : ""}>
        <summary>
          <span class="cname">${esc(c.name)}</span>
          ${c.enabled ? "" : `<span class="badge">مخفية</span>`}
          <span class="counts">${LEVELS.map((l) => `<span class="${short(c, l) ? "short" : ""}" title="${LEVEL_NAMES[l]}">${ar(bank.settings.points[LEVELS.indexOf(l)])}: ${ar(c.questions.filter((q) => q.level === l).length)}</span>`).join("")}</span>
        </summary>
        ${open ? catBody(c, ci) : ""}
      </details>`;
  }

  function catBody(c, ci) {
    return `
      <div class="cat-body">
        <div class="cat-settings">
          <input class="inp" data-field="cat-name" data-ci="${ci}" value="${esc(c.name)}" maxlength="40" aria-label="اسم الفئة">
          <label class="switch"><input type="checkbox" data-field="cat-enabled" data-ci="${ci}" ${c.enabled ? "checked" : ""}> تظهر في اللعبة</label>
          <button class="danger-btn" data-act="del-cat" data-ci="${ci}">احذف الفئة</button>
        </div>
        ${LEVELS.map((l, li) => {
          const qs = c.questions.map((q, qi) => ({ q, qi })).filter(({ q }) => q.level === l);
          return `
            <section class="level">
              <h3>${ar(bank.settings.points[li])} نقطة <small>${LEVEL_NAMES[l]} · ${ar(qs.length)} سؤال</small>${qs.length < 2 ? `<span class="warn">يحتاج سؤالين على الأقل</span>` : ""}</h3>
              ${qs.map(({ q, qi }) => `
                <div class="qrow ${query && matches(q) ? "hit" : ""}">
                  <div><span class="lab">السؤال</span><textarea class="txt" rows="2" maxlength="400" data-field="q" data-ci="${ci}" data-qi="${qi}">${esc(q.q)}</textarea></div>
                  <div class="a-cell"><span class="lab">الجواب</span><textarea class="txt" rows="2" maxlength="300" data-field="a" data-ci="${ci}" data-qi="${qi}">${esc(q.a)}</textarea></div>
                  <button class="icon-btn" data-act="del-q" data-ci="${ci}" data-qi="${qi}" aria-label="احذف السؤال" title="احذف السؤال">×</button>
                </div>`).join("")}
              <button class="add-q" data-act="add-q" data-ci="${ci}" data-level="${l}">أضف سؤال ${ar(bank.settings.points[li])}</button>
            </section>`;
        }).join("")}
      </div>`;
  }

  // ----- تبويب الإعدادات -----
  function settingsTab() {
    const s = bank.settings;
    return `
      <section class="panel">
        <h2>الوقت</h2>
        <p>بالثواني</p>
        <div class="grid-fields">
          <label>وقت كل سؤال<input class="inp" type="number" min="10" max="600" data-set="questionTime" value="${s.questionTime}"></label>
          <label>وقت «اتصال» الإضافي<input class="inp" type="number" min="0" max="300" data-set="callBonus" value="${s.callBonus}"></label>
        </div>
      </section>
      <section class="panel">
        <h2>النقاط</h2>
        <p>كم نقطة لكل مستوى صعوبة</p>
        <div class="grid-fields">
          ${LEVELS.map((l, i) => `<label>${LEVEL_NAMES[l]}<input class="inp" type="number" min="1" max="100000" data-set="points" data-i="${i}" value="${s.points[i]}"></label>`).join("")}
        </div>
      </section>
      <section class="panel">
        <h2>الفئات</h2>
        <p>كم فئة يختار كل فريق. اللوحة فيها ضعف هالرقم.</p>
        <div class="grid-fields">
          <label>فئات لكل فريق<input class="inp" type="number" min="1" max="6" data-set="categoriesPerTeam" value="${s.categoriesPerTeam}"></label>
        </div>
      </section>
      <section class="panel">
        <h2>وسائل المساعدة</h2>
        <p>اللي تطفيها ما تطلع في اللعبة</p>
        <div class="checks">
          <label class="switch"><input type="checkbox" data-set="helpers" data-k="double" ${s.helpers.double ? "checked" : ""}> دبل</label>
          <label class="switch"><input type="checkbox" data-set="helpers" data-k="call" ${s.helpers.call ? "checked" : ""}> اتصال</label>
          <label class="switch"><input type="checkbox" data-set="helpers" data-k="swap" ${s.helpers.swap ? "checked" : ""}> تبديل</label>
        </div>
      </section>`;
  }

  // ----- تبويب النسخ الاحتياطي -----
  function backupTab() {
    return `
      <section class="panel">
        <h2>نزّل نسخة</h2>
        <p>ملف فيه كل الفئات والأسئلة والإعدادات. احتفظ فيه عندك.</p>
        <button class="btn" id="export">نزّل النسخة</button>
      </section>
      <section class="panel">
        <h2>استرجع نسخة</h2>
        <p>يستبدل كل البيانات الحالية بالملف اللي تختاره. تقدر تراجعها قبل ما تحفظ.</p>
        <label class="btn ghost" style="cursor:pointer">اختر ملف<input type="file" id="import" accept="application/json,.json" hidden></label>
      </section>`;
  }

  // ---------- الأحداث ----------
  function bind() {
    root.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
    document.getElementById("logout").onclick = () => {
      if (dirty && !confirm("عندك تعديلات ما انحفظت. تبي تطلع؟")) return;
      logout();
    };
    document.getElementById("save").onclick = save;
    document.getElementById("discard").onclick = () => { if (confirm("تتراجع عن كل التعديلات اللي ما انحفظت؟")) loadData(); };

    const search = document.getElementById("search");
    if (search) {
      let t;
      search.oninput = () => { clearTimeout(t); t = setTimeout(() => { query = search.value.trim(); renderPanel(); document.getElementById("search").focus(); }, 250); };
    }
    const addCat = document.getElementById("add-cat");
    if (addCat) addCat.onclick = () => {
      const id = rid("c");
      bank.categories.unshift({ id, name: "فئة جديدة", enabled: true, questions: [] });
      openCats.add(id); query = ""; setDirty(true); render();
      const inp = root.querySelector(`[data-cat="${id}"] [data-field="cat-name"]`);
      if (inp) { inp.focus(); inp.select(); }
    };

    root.querySelectorAll("details.cat").forEach((d) => d.addEventListener("toggle", () => {
      const id = d.dataset.cat;
      if (d.open) {
        openCats.add(id);
        if (!d.querySelector(".cat-body")) {
          const ci = bank.categories.findIndex((c) => c.id === id);
          d.insertAdjacentHTML("beforeend", catBody(bank.categories[ci], ci));
        }
      } else openCats.delete(id);
    }));

    const ex = document.getElementById("export");
    if (ex) ex.onclick = exportBank;
    const im = document.getElementById("import");
    if (im) im.onchange = importBank;
  }

  function renderPanel() {
    document.getElementById("tabpanel").innerHTML = questionsTab();
    bind();
  }

  // تعديل النصوص بدون إعادة رسم (عشان ما يضيع المؤشر)
  root.addEventListener("input", (e) => {
    const el = e.target;
    const f = el.dataset.field, set = el.dataset.set;
    if (!f && !set) return;
    if (f) {
      const c = bank.categories[+el.dataset.ci];
      if (f === "cat-name") {
        c.name = el.value;
        const label = el.closest("details").querySelector(".cname");
        if (label) label.textContent = el.value || "فئة بدون اسم";
      }
      if (f === "q" || f === "a") c.questions[+el.dataset.qi][f] = el.value;
    }
    if (set && el.type !== "checkbox") {
      const v = Number(el.value);
      if (set === "points") bank.settings.points[+el.dataset.i] = v;
      else bank.settings[set] = v;
    }
    setDirty(true);
  });

  root.addEventListener("change", (e) => {
    const el = e.target;
    if (el.dataset.field === "cat-enabled") {
      bank.categories[+el.dataset.ci].enabled = el.checked; setDirty(true); render();
    }
    if (el.dataset.set === "helpers") { bank.settings.helpers[el.dataset.k] = el.checked; setDirty(true); }
  });

  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const c = bank.categories[+b.dataset.ci];
    if (b.dataset.act === "add-q") {
      const level = +b.dataset.level;
      c.questions.push({ id: rid(c.id + "-" + level), level, q: "", a: "" });
      setDirty(true); render();
      const rows = root.querySelectorAll(`[data-cat="${c.id}"] [data-field="q"]`);
      const last = [...rows].find((r) => +r.dataset.qi === c.questions.length - 1);
      if (last) last.focus();
    }
    if (b.dataset.act === "del-q") {
      const q = c.questions[+b.dataset.qi];
      if ((q.q || q.a) && !confirm("تحذف هالسؤال؟\n\n" + q.q)) return;
      c.questions.splice(+b.dataset.qi, 1); setDirty(true); render();
    }
    if (b.dataset.act === "del-cat") {
      if (!confirm(`تحذف فئة «${c.name}» وكل أسئلتها (${c.questions.length})؟`)) return;
      bank.categories.splice(+b.dataset.ci, 1); setDirty(true); render();
    }
  });

  // ---------- الحفظ ----------
  function validate() {
    const empty = [];
    bank.categories.forEach((c) => c.questions.forEach((q) => {
      if (!q.q.trim() || !q.a.trim()) empty.push(c.name);
    }));
    if (empty.length && !confirm(`فيه ${ar(empty.length)} سؤال ناقص (بدون سؤال أو جواب) في: ${[...new Set(empty)].join("، ")}.\nالأسئلة الناقصة بتنحذف عند الحفظ. تكمّل؟`)) return false;
    const s = bank.settings;
    if (!(s.questionTime >= 10)) { toast("وقت السؤال لازم يكون ١٠ ثواني أو أكثر"); return false; }
    return true;
  }

  async function save() {
    if (!validate()) return;
    const btn = document.getElementById("save");
    btn.disabled = true; btn.textContent = "نحفظ…";
    try {
      const r = await call("/api/admin/data", { method: "PUT", body: JSON.stringify({ bank }) });
      bank = r.bank;
      setDirty(false); render();
      if (r.warning) toast(r.warning, 6000);
      else toast(r.persisted ? "انحفظ. الموقع يتحدث خلال دقيقتين" : "انحفظ مؤقتاً في السيرفر");
    } catch (e) {
      if (e.message !== "401") { toast(e.message, 5000); btn.disabled = false; btn.textContent = "احفظ التعديلات"; }
    }
  }

  function exportBank() {
    const blob = new Blob([JSON.stringify(bank, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `seen-qaf-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importBank(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.categories)) throw 0;
        bank = { version: 2, settings: { ...bank.settings, ...(data.settings || {}) }, categories: data.categories.map((c) => ({ enabled: true, ...c, questions: c.questions || [] })) };
        setDirty(true); tab = "questions"; render();
        toast("انسحبت النسخة. اضغط «احفظ التعديلات» عشان تعتمدها");
      } catch { toast("الملف مو نسخة سين قاف صحيحة"); }
    };
    reader.readAsText(file);
  }

  if (token) loadData(); else renderLogin();
})();
