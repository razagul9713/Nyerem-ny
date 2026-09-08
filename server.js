const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");
const QUESTION_COUNT = 10;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function validateSubmission(data) {
  const errors = [];
  if (!data || typeof data !== "object") return ["Érvénytelen kérés."];

  if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
    errors.push("A név megadása kötelező.");
  }
  if (!data.email || typeof data.email !== "string" || !EMAIL_RE.test(data.email.trim())) {
    errors.push("Érvényes e-mail cím megadása kötelező.");
  }
  if (!data.privacyAccepted) {
    errors.push("Az adatvédelmi tájékoztató elfogadása kötelező.");
  }
  if (
    !Array.isArray(data.answers) ||
    data.answers.length !== QUESTION_COUNT ||
    data.answers.some((a) => typeof a !== "string" || !a.trim())
  ) {
    errors.push("Minden kérdésre kötelező válaszolni.");
  }
  return errors;
}

function appendSubmission(entry) {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  let list = [];
  try {
    list = JSON.parse(raw);
  } catch {
    list = [];
  }
  list.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Nem található.");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/submit") {
    try {
      const body = await readBody(req);
      const data = JSON.parse(body || "{}");
      const errors = validateSubmission(data);
      if (errors.length) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, errors }));
        return;
      }
      const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        name: data.name.trim(),
        email: data.email.trim(),
        answers: data.answers,
        privacyAccepted: true,
        submittedAt: new Date().toISOString(),
      };
      appendSubmission(entry);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, errors: ["Szerverhiba történt."] }));
    }
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method Not Allowed");
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Nyereményjáték szerver fut: http://localhost:${PORT}`);
});
