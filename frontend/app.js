/* سين قاف — منطق اللعبة */
(() => {
  "use strict";

  const API = (window.SEEN_QAF_API || "").replace(/\/$/, "");
  const SAVE_KEY = "seenqaf.game.v1";
  const HISTORY_KEY = "seenqaf.history.v1";
  const TEAM_COLORS = ["var(--saffron)", "var(--palm)"];
  const LEVELS = [200, 400, 600];
  const DEFAULT_SETTINGS = { questionTime: 60, callBonus: 30, points: [200, 400, 600], categoriesPerTeam: 3, helpers: { double: true, call: true, swap: true } };
  const HELPERS = {
    double: { label: "دبل", hint: () => "نقاط السؤال ضعفين إذا جاوبتوا صح" },
    call: { label: "اتصال", hint: () => ar(S().callBonus) + " ثانية زيادة وتقدرون تتصلون بأحد" },
    swap: { label: "تبديل", hint: () => "بدّل السؤال بسؤال ثاني بنفس النقاط" },
  };

  const app = document.getElementById("app");
  const modalRoot = document.getElementById("modal-root");
  const ar = (n) => Number(n).toLocaleString("ar-EG");
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let state = load() || freshState();
  let categories = []; // [{id, name, count}]
  let settings = DEFAULT_SETTINGS;
  // إعدادات اللعبة الحالية (تنحفظ مع اللعبة) أو آخر إعدادات من السيرفر
  const S = () => ({ ...DEFAULT_SETTINGS, ...(state.settings || settings) });
  const pts = (level) => S().points[LEVELS.indexOf(level)] ?? level;
  const helpersOn = () => Object.keys(HELPERS).filter((k) => S().helpers?.[k] !== false);
  const pickOrder = () => Array.from({ length: S().categoriesPerTeam * 2 }, (_, i) => i % 2);
  let localBank = null;
  let timer = null;

  function freshState(names) {
    return {
      screen: "home",
      teams: [0, 1].map((i) => ({
        name: (names && names[i]) || ["الفريق الأول", "الفريق الثاني"][i],
        score: 0,
        helpers: { double: true, call: true, swap: true },
      })),
      turn: 0,
      picks: [], // [{id, team}]
      board: null,
      results: {}, // "ci-ti": teamIndex | -1
      current: null,
    };
  }

  // ---------- حفظ ----------
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...state, current: null })); } catch {}
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.teams && s.screen) {
        if (s.screen === "question") s.screen = "board";
        return s;
      }
    } catch {}
    return null;
  }
  function history() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  }
  function addHistory(ids) {
    const merged = [...new Set([...history(), ...ids])].slice(-500);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(merged)); } catch {}
  }

  // ---------- بيانات ----------
  async function fetchJson(url, opts = {}, ms = 7000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      if (!r.ok) throw new Error(r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function getLocalBank() {
    if (!localBank) localBank = await fetchJson("questions.json", {}, 10000);
    return localBank;
  }

  const playable = (c) => c.enabled !== false && LEVELS.every((l) => c.questions.filter((q) => q.level === l).length >= 2);

  async function loadCategories() {
    if (categories.length) return categories;
    try {
      if (!API) throw 0;
      const [cats, st] = await Promise.all([
        fetchJson(API + "/api/categories", {}, 6000),
        fetchJson(API + "/api/settings", {}, 6000),
      ]);
      categories = cats; settings = { ...DEFAULT_SETTINGS, ...st };
    } catch {
      const bank = await getLocalBank();
      categories = bank.categories.filter(playable).map((c) => ({ id: c.id, name: c.name, count: c.questions.length }));
      settings = { ...DEFAULT_SETTINGS, ...(bank.settings || {}) };
    }
    return categories;
  }

  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // نفس منطق الباك إند، يشتغل إذا السيرفر نايم أو مو متوفر
  function buildLocalGame(bank, ids, exclude) {
    const ex = new Set(exclude);
    return ids.map((id) => {
      const cat = bank.categories.find((c) => c.id === id);
      const tiles = [], spares = {};
      for (const level of LEVELS) {
        const pool = cat.questions.filter((q) => q.level === level);
        const chosen = shuffle(pool.filter((q) => !ex.has(q.id))).concat(shuffle(pool.filter((q) => ex.has(q.id)))).slice(0, 3);
        tiles.push(chosen[0], chosen[1]);
        spares[level] = chosen[2] || null;
      }
      return { id: cat.id, name: cat.name, tiles, spares };
    });
  }

  async function buildGame(ids) {
    const exclude = history();
    try {
      if (!API) throw 0;
      const res = await fetchJson(API + "/api/game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ids, exclude }),
      }, 8000);
      if (res.settings) settings = { ...DEFAULT_SETTINGS, ...res.settings };
      return res.board;
    } catch {
      return buildLocalGame(await getLocalBank(), ids, exclude);
    }
  }

  // ---------- أدوات ----------
  function toast(msg) {
    const el = document.createElement("div");
    el.className = "toast"; el.setAttribute("role", "status"); el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  }

  let audio;
  function beep(freq = 520, dur = 0.18) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq; o.type = "triangle";
      g.gain.setValueAtTime(0.18, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur);
    } catch {}
  }

  function go(screen) {
    state.screen = screen; save(); render();
    window.scrollTo({ top: 0 });
  }

  // ---------- الشاشات ----------
  function render() {
    stopTimer();
    modalRoot.innerHTML = "";
    ({ home: renderHome, pick: renderPick, board: renderBoard, end: renderEnd }[state.screen] || renderHome)();
  }

  function renderHome() {
    const saved = load();
    const canResume = saved && saved.screen === "board" && saved.board;
    app.innerHTML = `
      <section class="home">
        <div class="home-inner">
          <h1 class="logo">سين قاف</h1>
          <div class="logo-weave" aria-hidden="true"></div>
          <p class="tagline">فريقين، ست فئات، ومين يجمع نقاط أكثر</p>
          <form class="teams-form" id="teams">
            ${[0, 1].map((i) => `
              <label class="team-field">
                <span class="swatch" style="background:${TEAM_COLORS[i]}"></span>
                <span class="visually-hidden" style="position:absolute;width:1px;height:1px;overflow:hidden">اسم الفريق ${i + 1}</span>
                <input name="t${i}" maxlength="22" autocomplete="off" placeholder="${i ? "الفريق الثاني" : "الفريق الأول"}" value="${saved && !canResume ? esc(saved.teams[i].name) : ""}">
              </label>`).join("")}
            <button class="btn" type="submit">يلا نبدأ</button>
          </form>
          ${canResume ? `<p class="resume-note">عندكم لعبة ما خلصت بين ${esc(saved.teams[0].name)} و${esc(saved.teams[1].name)}. <button id="resume" type="button">كمّلوها</button></p>` : ""}
        </div>
      </section>
      <a class="admin-link" href="admin.html">لوحة التحكم</a>`;

    document.getElementById("teams").addEventListener("submit", (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const names = [f.get("t0"), f.get("t1")].map((s, i) => (s || "").trim() || ["الفريق الأول", "الفريق الثاني"][i]);
      state = freshState(names);
      go("pick");
    });
    const r = document.getElementById("resume");
    if (r) r.addEventListener("click", () => { state = saved; go("board"); });

    // إيقاظ سيرفر Render المجاني مبكراً
    if (API) fetch(API + "/api/health").catch(() => {});
  }

  async function renderPick() {
    app.innerHTML = `<div class="loading">نجهز الفئات…</div>`;
    const cats = await loadCategories();
    state.settings = null; // قبل البدء نستخدم آخر إعدادات من السيرفر
    const order = pickOrder();
    const need = order.length;
    if (state.picks.length > need) state.picks = state.picks.slice(0, need);
    const picking = state.picks.length < need ? order[state.picks.length] : null;
    const team = picking !== null ? state.teams[picking] : null;

    app.innerHTML = `
      <section>
        <div class="screen-head">
          <h2>اختاروا الفئات</h2>
          ${team ? `<span class="turn-pill"><span class="dot" style="background:${TEAM_COLORS[picking]}"></span>دور ${esc(team.name)} يختار (${ar(state.picks.filter((p) => p.team === picking).length + 1)} من ${ar(S().categoriesPerTeam)})</span>`
                 : `<span class="turn-pill">الفئات جاهزة</span>`}
        </div>
        ${cats.length < need ? `<p class="notice-inline">اللعبة تحتاج ${ar(need)} فئات جاهزة، والموجود ${ar(cats.length)}. أضف فئات من لوحة التحكم.</p>` : ""}
        <div class="cat-grid">
          ${cats.map((c) => {
            const p = state.picks.find((x) => x.id === c.id);
            const style = p ? `style="background:${TEAM_COLORS[p.team]}"` : "";
            return `<button class="cat-card" data-id="${c.id}" aria-pressed="${!!p}" ${style} ${p || picking === null ? "disabled" : ""}>
              <span class="name">${esc(c.name)}</span>
              <span class="count">${p ? "اختيار " + esc(state.teams[p.team].name) : ar(c.count) + " سؤال"}</span>
            </button>`;
          }).join("")}
        </div>
        <div class="pick-actions">
          <button class="btn ghost" id="undo" ${state.picks.length ? "" : "disabled"}>تراجع</button>
          <button class="btn ghost" id="random" ${picking === null ? "disabled" : ""}>كمّلها عشوائي</button>
          <button class="btn" id="start" ${state.picks.length === need ? "" : "disabled"}>ابدأ اللعب</button>
        </div>
      </section>`;

    app.querySelectorAll(".cat-card").forEach((b) => b.addEventListener("click", () => {
      state.picks.push({ id: b.dataset.id, team: picking });
      beep(660, 0.08); save(); renderPick();
    }));
    document.getElementById("undo").onclick = () => { state.picks.pop(); save(); renderPick(); };
    document.getElementById("random").onclick = () => {
      const left = shuffle(cats.filter((c) => !state.picks.some((p) => p.id === c.id)));
      while (state.picks.length < need && left.length) state.picks.push({ id: left.shift().id, team: order[state.picks.length] });
      save(); renderPick();
    };
    document.getElementById("start").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "نوزع الأسئلة…";
      try {
        state.board = await buildGame(state.picks.map((p) => p.id));
      } catch {
        e.target.disabled = false; e.target.textContent = "ابدأ اللعب";
        return toast("ما قدرنا نحمّل الأسئلة. تأكدوا من الإنترنت وجربوا مرة ثانية.");
      }
      state.results = {};
      state.settings = { ...settings };
      state.teams.forEach((t) => { t.helpers = Object.fromEntries(Object.keys(HELPERS).map((k) => [k, helpersOn().includes(k)])); });
      addHistory(state.board.flatMap((c) => c.tiles.map((q) => q.id)));
      go("board");
    };
  }

  function tileKey(ci, ti) { return ci + "-" + ti; }

  function scorebar() {
    return `
      <div class="scorebar">
        ${[0, 1].map((i) => {
          const t = state.teams[i];
          const panel = `
            <div class="team-panel ${state.turn === i ? "active" : ""}" style="--team:${TEAM_COLORS[i]}">
              <div class="row"><span class="tname">${esc(t.name)}</span><span class="score">${ar(t.score)}</span></div>
              <div class="helpers">${helpersOn().map((k) => `<span class="helper ${t.helpers[k] ? "" : "used"}" title="${HELPERS[k].hint()}">${HELPERS[k].label}</span>`).join("")}</div>
            </div>`;
          return i === 0 ? panel + `<div class="center-turn">الدور على<strong>${esc(state.teams[state.turn].name)}</strong></div>` : panel;
        }).join("")}
      </div>`;
  }

  function renderBoard() {
    const total = state.board.length * 6;
    const done = Object.keys(state.results).length;
    if (done >= total) return go("end");

    app.innerHTML = `
      <section>
        ${scorebar()}
        <div class="board">
          ${state.board.map((cat, ci) => `
            <div class="col">
              <h3>${esc(cat.name)}</h3>
              <div class="tiles">
                ${cat.tiles.map((q, ti) => {
                  const r = state.results[tileKey(ci, ti)];
                  if (r === undefined) return `<button class="tile" data-ci="${ci}" data-ti="${ti}" aria-label="${esc(cat.name)} بـ ${ar(pts(q.level))} نقطة">${ar(pts(q.level))}</button>`;
                  const label = r === -1 ? "محد" : esc(state.teams[r].name);
                  return `<button class="tile done ${r >= 0 ? "won" : ""}" style="--team:${r >= 0 ? TEAM_COLORS[r] : "transparent"}" disabled aria-label="انلعب">${label}</button>`;
                }).join("")}
              </div>
            </div>`).join("")}
        </div>
        <div class="board-foot">
          <button class="btn ghost small" id="switch">بدّل الدور</button>
          <button class="btn ghost small" id="finish">أنهِ اللعبة</button>
          <button class="btn ghost small" id="home">الصفحة الرئيسية</button>
        </div>
      </section>`;

    app.querySelectorAll(".tile:not(.done)").forEach((b) =>
      b.addEventListener("click", () => openQuestion(+b.dataset.ci, +b.dataset.ti)));
    document.getElementById("switch").onclick = () => { state.turn = 1 - state.turn; save(); renderBoard(); };
    document.getElementById("finish").onclick = () => { if (confirm("تبون تنهون اللعبة الحين؟")) go("end"); };
    document.getElementById("home").onclick = () => { save(); state.screen = "home"; render(); };
  }

  // ---------- السؤال ----------
  function openQuestion(ci, ti) {
    const cat = state.board[ci];
    state.current = { ci, ti, q: cat.tiles[ti], double: false, revealed: false, left: S().questionTime, total: S().questionTime, called: false };
    beep(440, 0.12);
    renderQuestion();
    startTimer();
  }

  function renderQuestion() {
    const c = state.current;
    const cat = state.board[c.ci];
    const t = state.teams[state.turn];
    const color = TEAM_COLORS[state.turn];
    const pct = Math.max(0, (c.left / c.total) * 100);

    modalRoot.innerHTML = `
      <div class="overlay" role="dialog" aria-modal="true" aria-labelledby="qtext">
        <article class="qcard" style="--team:${color}">
          <div class="weave" aria-hidden="true"></div>
          <div class="qbody">
            <div class="qmeta"><span>${esc(cat.name)}</span><span class="points ${c.double ? "double" : ""}">${ar(pts(c.q.level))}</span></div>
            <p class="qtext" id="qtext">${esc(c.q.q)}</p>

            ${c.revealed ? `
              <div class="answer"><small>الجواب</small>${esc(c.q.a)}</div>
              <p class="who">مين جاوب صح؟</p>
              <div class="qactions">
                ${[0, 1].map((i) => `<button class="btn team" style="--team:${TEAM_COLORS[i]}" data-win="${i}">${esc(state.teams[i].name)}</button>`).join("")}
                <button class="btn ghost" data-win="-1">محد جاوب</button>
              </div>` : `
              <div class="timer-row">
                <span class="secs" id="secs">${ar(c.left)}</span>
                <div class="timer ${c.left <= 10 ? "low" : ""}" id="bar"><i style="width:${pct}%"></i></div>
              </div>
              ${helpersOn().length ? `<p class="who">دور ${esc(t.name)} · وسائل المساعدة</p>` : `<p class="who">دور ${esc(t.name)}</p>`}
              <div class="qactions">
                ${helpersOn().map((k) => {
                  const off = !t.helpers[k] || (k === "swap" && !cat.spares[c.q.level]);
                  return `<button class="btn helper-btn" data-help="${k}" title="${HELPERS[k].hint()}" ${off ? "disabled" : ""}>${HELPERS[k].label}</button>`;
                }).join("")}
                <span class="spacer"></span>
                <button class="btn" id="reveal">أظهر الجواب</button>
              </div>`}
          </div>
        </article>
      </div>`;

    const root = modalRoot.firstElementChild;
    if (c.revealed) {
      root.querySelectorAll("[data-win]").forEach((b) => b.addEventListener("click", () => award(+b.dataset.win)));
      root.querySelector("[data-win]").focus();
    } else {
      root.querySelector("#reveal").addEventListener("click", reveal);
      root.querySelectorAll("[data-help]").forEach((b) => b.addEventListener("click", () => useHelper(b.dataset.help)));
      root.querySelector("#reveal").focus();
    }
  }

  function useHelper(kind) {
    const c = state.current, t = state.teams[state.turn], cat = state.board[c.ci];
    if (!t.helpers[kind]) return;
    t.helpers[kind] = false;
    if (kind === "double") { c.double = true; toast("دبل! النقاط ضعفين لـ " + t.name); }
    if (kind === "call") { c.left += S().callBonus; c.total += S().callBonus; toast(ar(S().callBonus) + " ثانية زيادة، اتصلوا بسرعة"); }
    if (kind === "swap") {
      const spare = cat.spares[c.q.level];
      cat.spares[c.q.level] = null;
      cat.tiles[c.ti] = spare;
      c.q = spare; c.left = S().questionTime; c.total = S().questionTime;
      addHistory([spare.id]);
      toast("تبدّل السؤال");
    }
    beep(760, 0.1); save(); renderQuestion();
  }

  function startTimer() {
    stopTimer();
    timer = setInterval(() => {
      const c = state.current;
      if (!c || c.revealed) return stopTimer();
      c.left -= 1;
      const secs = document.getElementById("secs"), bar = document.getElementById("bar");
      if (secs) secs.textContent = ar(Math.max(0, c.left));
      if (bar) { bar.firstElementChild.style.width = Math.max(0, (c.left / c.total) * 100) + "%"; bar.classList.toggle("low", c.left <= 10); }
      if (c.left <= 5 && c.left > 0) beep(880, 0.06);
      if (c.left <= 0) { beep(220, 0.5); toast("خلص الوقت!"); reveal(); }
    }, 1000);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }

  function reveal() { stopTimer(); state.current.revealed = true; renderQuestion(); }

  function award(winner) {
    const c = state.current;
    if (winner >= 0) {
      state.teams[winner].score += pts(c.q.level) * (c.double && winner === state.turn ? 2 : 1);
      beep(winner === state.turn ? 990 : 700, 0.25);
    }
    state.results[tileKey(c.ci, c.ti)] = winner;
    state.turn = 1 - state.turn;
    state.current = null;
    save();
    modalRoot.innerHTML = "";
    renderBoard();
  }

  // ---------- النهاية ----------
  function renderEnd() {
    const [a, b] = state.teams;
    const w = a.score === b.score ? -1 : a.score > b.score ? 0 : 1;
    app.innerHTML = `
      <section class="finale" style="--team:${w >= 0 ? TEAM_COLORS[w] : "var(--wool)"}">
        <div class="crown" aria-hidden="true"></div>
        <h2>${w >= 0 ? `فاز <span class="winner-name">${esc(state.teams[w].name)}</span>` : "تعادل!"}</h2>
        <div class="final-scores">
          ${[0, 1].map((i) => `<div style="--team:${TEAM_COLORS[i]}">${esc(state.teams[i].name)}<b>${ar(state.teams[i].score)}</b></div>`).join("")}
        </div>
        <div class="pick-actions">
          <button class="btn" id="again">لعبة جديدة بنفس الفرق</button>
          <button class="btn ghost" id="new">فرق جديدة</button>
        </div>
      </section>`;
    if (w >= 0) [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, 0.22), i * 160));
    document.getElementById("again").onclick = () => { state = freshState(state.teams.map((t) => t.name)); go("pick"); };
    document.getElementById("new").onclick = () => { try { localStorage.removeItem(SAVE_KEY); } catch {} state = freshState(); go("home"); };
  }

  // مفاتيح الكيبورد: مسافة تكشف الجواب
  document.addEventListener("keydown", (e) => {
    if (state.current && !state.current.revealed && e.code === "Space" && document.activeElement?.id !== "reveal") { e.preventDefault(); reveal(); }
  });

  if (state.screen === "board" && !state.board) state.screen = "home";
  render();
})();
