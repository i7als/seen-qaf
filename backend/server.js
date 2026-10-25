// سين قاف — الباك إند (Node فقط، بدون مكتبات خارجية)
// يوزّع الأسئلة على اللوحة بشكل عشوائي ويتجنب الأسئلة اللي انلعبت قبل
const http = require("http");
const path = require("path");
const bank = require(path.join(__dirname, "questions.json"));

const LEVELS = [200, 400, 600];
const PER_LEVEL = 2; // سؤالين لكل مستوى في كل فئة

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// يفضّل الأسئلة اللي ما انلعبت، وإذا خلصت يرجع للباقي
function pick(pool, count, exclude) {
  const fresh = shuffle(pool.filter((q) => !exclude.has(q.id)));
  const used = shuffle(pool.filter((q) => exclude.has(q.id)));
  return fresh.concat(used).slice(0, count);
}

function buildGame(ids, excludeList) {
  const exclude = new Set(Array.isArray(excludeList) ? excludeList : []);
  const cats = (Array.isArray(ids) ? ids : [])
    .map((id) => bank.categories.find((c) => c.id === id))
    .filter(Boolean);
  if (cats.length !== 6) return null;

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

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") return send(res, 204);

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/health")) {
    return send(res, 200, { ok: true, name: "seen-qaf-api" });
  }

  if (req.method === "GET" && url.pathname === "/api/categories") {
    return send(
      res,
      200,
      bank.categories.map((c) => ({ id: c.id, name: c.name, count: c.questions.length }))
    );
  }

  // POST /api/game  { categories: [6 ids], exclude: [ids played before] }
  if (req.method === "POST" && url.pathname === "/api/game") {
    const body = await readJson(req);
    const board = buildGame(body.categories, body.exclude);
    if (!board) return send(res, 400, { error: "اختاروا ست فئات بالضبط" });
    return send(res, 200, { board });
  }

  send(res, 404, { error: "مو موجود" });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`سين قاف API شغال على ${PORT}`));
