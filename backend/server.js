// سين قاف — الباك إند (Node فقط، بدون مكتبات خارجية)
//
// متغيرات البيئة:
//   ADMIN_PASSWORD   كلمة سر لوحة التحكم (إلزامي لفتح اللوحة)
//   GITHUB_TOKEN     توكن GitHub بصلاحية Contents: Read & Write على الريبو (للحفظ الدائم)
//   GITHUB_REPO      مثال: hassan/seen-qaf
//   GITHUB_BRANCH    الافتراضي main
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BANK_FILE = path.join(__dirname, "questions.json");
const LEVELS = [200, 400, 600]; // مستويات الصعوبة (المفتاح). النقاط المعروضة من الإعدادات
const PER_LEVEL = 2;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TOKEN_SECRET = crypto.createHash("sha256").update("seen-qaf:" + ADMIN_PASSWORD + ":" + (process.env.ADMIN_SECRET || "")).digest();
const GH = {
  token: process.env.GITHUB_TOKEN || "",
  repo: process.env.GITHUB_REPO || "",
  branch: process.env.GITHUB_BRANCH || "main",
};
const ghEnabled = () => !!(GH.token && GH.repo);

// ---------- البيانات ----------
const DEFAULT_SETTINGS = {
  questionTime: 60,
  callBonus: 30,
  points: [200, 400, 600],
  categoriesPerTeam: 3,
  helpers: { double: true, call: true, swap: true },
};

const clampInt = (v, min, max, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};
const cleanText = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const newId = (prefix) => prefix + "-" + crypto.randomBytes(4).toString("hex");

// يتأكد إن البيانات سليمة ويصلّح الناقص
function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  const s = src.settings || {};
  const pts = Array.isArray(s.points) ? s.points : DEFAULT_SETTINGS.points;
  const settings = {
    questionTime: clampInt(s.questionTime, 10, 600, DEFAULT_SETTINGS.questionTime),
    callBonus: clampInt(s.callBonus, 0, 300, DEFAULT_SETTINGS.callBonus),
    points: LEVELS.map((d, i) => clampInt(pts[i], 1, 100000, DEFAULT_SETTINGS.points[i])),
    categoriesPerTeam: clampInt(s.categoriesPerTeam, 1, 6, DEFAULT_SETTINGS.categoriesPerTeam),
    helpers: {
      double: s.helpers?.double !== false,
      call: s.helpers?.call !== false,
      swap: s.helpers?.swap !== false,
    },
  };

  const seenCat = new Set();
  const seenQ = new Set();
  const categories = (Array.isArray(src.categories) ? src.categories : []).slice(0, 200).map((c) => {
    let id = cleanText(c.id, 60).replace(/[^\w-]/g, "") || newId("c");
    while (seenCat.has(id)) id = newId("c");
    seenCat.add(id);
    const questions = (Array.isArray(c.questions) ? c.questions : []).slice(0, 1000).map((q) => {
      const level = LEVELS.includes(Number(q.level)) ? Number(q.level) : 200;
      let qid = cleanText(q.id, 80).replace(/[^\w-]/g, "") || newId(id + "-" + level);
      while (seenQ.has(qid)) qid = newId(id + "-" + level);
      seenQ.add(qid);
      return { id: qid, level, q: cleanText(q.q, 400), a: cleanText(q.a, 300) };
    }).filter((q) => q.q && q.a);
    return { id, name: cleanText(c.name, 40) || "فئة بدون اسم", enabled: c.enabled !== false, questions };
  });

  return { version: 2, settings, categories };
}

// الفئة تنلعب إذا كانت مفعّلة وفيها سؤالين على الأقل لكل مستوى
const playable = (c) => c.enabled && LEVELS.every((l) => c.questions.filter((q) => q.level === l).length >= PER_LEVEL);

let bank = normalize(JSON.parse(fs.readFileSync(BANK_FILE, "utf8")));

// ---------- GitHub (الحفظ الدائم) ----------
async function gh(pathname, opts = {}) {
  const r = await fetch((process.env.GITHUB_API || "https://api.github.com") + pathname, {
    ...opts,
    headers: {
      Authorization: "Bearer " + GH.token,
      Accept: "application/vnd.github+json",
      "User-Agent": "seen-qaf",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${body.message || "خطأ"}`);
  return body;
}

async function ghReadFile(file) {
  const meta = await gh(`/repos/${GH.repo}/contents/${file}?ref=${encodeURIComponent(GH.branch)}`);
  return { sha: meta.sha, text: Buffer.from(meta.content, "base64").toString("utf8") };
}

async function ghWriteFile(file, text, message) {
  let sha;
  try { sha = (await ghReadFile(file)).sha; } catch {}
  await gh(`/repos/${GH.repo}/contents/${file}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: Buffer.from(text, "utf8").toString("base64"),
      branch: GH.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

// عند التشغيل: ناخذ آخر نسخة من GitHub عشان ما تضيع أي تعديلات
async function syncFromGitHub() {
  if (!ghEnabled()) return;
  try {
    const { text } = await ghReadFile("backend/questions.json");
    bank = normalize(JSON.parse(text));
    console.log("تم تحميل الأسئلة من GitHub");
  } catch (e) {
    console.log("ما قدرنا نقرأ من GitHub، نستخدم الملف المحلي:", e.message);
  }
}

let saving = Promise.resolve();
function persist(next) {
  const text = JSON.stringify(next, null, 1);
  try { fs.writeFileSync(BANK_FILE, text); } catch {}
  if (!ghEnabled()) return Promise.resolve({ persisted: false });
  // نحفظ بالترتيب عشان ما يتعارض حفظين ورا بعض
  const job = saving.then(async () => {
    const msg = "تحديث الأسئلة من لوحة التحكم";
    await ghWriteFile("backend/questions.json", text, msg);
    await ghWriteFile("frontend/questions.json", text, msg);
    return { persisted: true };
  });
  saving = job.catch(() => {});
  return job;
}

// ---------- الدخول ----------
function signToken(hours = 12) {
  const exp = Date.now() + hours * 3600 * 1000;
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(String(exp)).digest("hex");
  return exp + "." + sig;
}
function verifyToken(token) {
  if (!ADMIN_PASSWORD || typeof token !== "string") return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac("sha256", TOKEN_SECRET).update(exp).digest("hex");
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
function passwordOk(p) {
  const a = crypto.createHash("sha256").update(String(p || "")).digest();
  const b = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
  return ADMIN_PASSWORD && crypto.timingSafeEqual(a, b);
}
const attempts = new Map(); // حماية من التخمين
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 8;
}

// ---------- اللعبة ----------
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pick(pool, count, exclude) {
  const fresh = shuffle(pool.filter((q) => !exclude.has(q.id)));
  const used = shuffle(pool.filter((q) => exclude.has(q.id)));
  return fresh.concat(used).slice(0, count);
}
function buildGame(ids, excludeList) {
  const exclude = new Set(Array.isArray(excludeList) ? excludeList : []);
  const need = bank.settings.categoriesPerTeam * 2;
  const cats = (Array.isArray(ids) ? ids : [])
    .map((id) => bank.categories.find((c) => c.id === id))
    .filter((c) => c && playable(c));
  if (cats.length !== need) return null;
  return cats.map((cat) => {
    const tiles = [];
    const spares = {};
    for (const level of LEVELS) {
      const chosen = pick(cat.questions.filter((q) => q.level === level), PER_LEVEL + 1, exclude);
      chosen.slice(0, PER_LEVEL).forEach((q) => tiles.push(q));
      spares[level] = chosen[PER_LEVEL] || null;
    }
    return { id: cat.id, name: cat.name, tiles, spares };
  });
}

// ---------- HTTP ----------
function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
function readJson(req, limit) {
  return new Promise((resolve) => {
    let raw = "";
    let tooBig = false;
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > limit) { tooBig = true; req.destroy(); }
    });
    req.on("end", () => {
      if (tooBig) return resolve(null);
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}
const isAdmin = (req) => verifyToken((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  try {
    if (req.method === "OPTIONS") return send(res, 204);

    if (req.method === "GET" && (p === "/" || p === "/api/health")) {
      return send(res, 200, { ok: true, name: "seen-qaf-api" });
    }

    if (req.method === "GET" && p === "/api/settings") return send(res, 200, bank.settings);

    if (req.method === "GET" && p === "/api/categories") {
      return send(res, 200, bank.categories.filter(playable).map((c) => ({ id: c.id, name: c.name, count: c.questions.length })));
    }

    if (req.method === "POST" && p === "/api/game") {
      const body = (await readJson(req, 64 * 1024)) || {};
      const board = buildGame(body.categories, body.exclude);
      if (!board) return send(res, 400, { error: `اختاروا ${bank.settings.categoriesPerTeam * 2} فئات` });
      return send(res, 200, { board, settings: bank.settings });
    }

    // ----- لوحة التحكم -----
    if (req.method === "POST" && p === "/api/admin/login") {
      if (!ADMIN_PASSWORD) return send(res, 503, { error: "كلمة سر لوحة التحكم مو محددة في السيرفر (ADMIN_PASSWORD)" });
      if (tooMany(ip)) return send(res, 429, { error: "محاولات كثيرة. جرّب بعد ١٠ دقايق" });
      const body = (await readJson(req, 4096)) || {};
      if (!passwordOk(body.password)) {
        attempts.get(ip).push(Date.now());
        return send(res, 401, { error: "كلمة السر غلط" });
      }
      return send(res, 200, { token: signToken(), persistent: ghEnabled() });
    }

    if (p === "/api/admin/data") {
      if (!isAdmin(req)) return send(res, 401, { error: "سجّل دخول من جديد" });
      if (req.method === "GET") return send(res, 200, { bank, persistent: ghEnabled() });
      if (req.method === "PUT") {
        const body = await readJson(req, 4 * 1024 * 1024);
        if (!body || !body.bank) return send(res, 400, { error: "البيانات مو سليمة" });
        const next = normalize(body.bank);
        bank = next;
        try {
          const r = await persist(next);
          return send(res, 200, { ok: true, bank, persisted: r.persisted });
        } catch (e) {
          return send(res, 200, { ok: true, bank, persisted: false, warning: "انحفظ مؤقتاً بس فشل الحفظ في GitHub: " + e.message });
        }
      }
    }

    send(res, 404, { error: "مو موجود" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "صار خطأ في السيرفر" });
  }
});

const PORT = process.env.PORT || 3001;
syncFromGitHub().finally(() => {
  server.listen(PORT, () => console.log(`سين قاف API شغال على ${PORT} | لوحة التحكم: ${ADMIN_PASSWORD ? "مفعّلة" : "مقفلة"} | حفظ دائم: ${ghEnabled() ? "GitHub" : "لا"}`));
});
