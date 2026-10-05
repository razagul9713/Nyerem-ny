const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "submissions.json");

const MAX_BODY_BYTES = 10 * 1024;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

// A kerdesek lehetseges valaszai — egyezniuk kell a public/index.html-ben levo value ertekekkel.
const ALLOWED_ANSWERS = [
  ["Hetente", "Havonta 1-2 alkalommal", "Néhány havonta", "Csak ha nagyon szükséges"],
  ["Önkiszolgáló autómosó", "Gépi autómosó", "Autókozmetikába viszem", "Otthon saját magamnak"],
  ["0-2000 Ft", "2000-5000 Ft", "5000-10000 Ft", "10000 Ft felett"],
];

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

const submitTimesByIp = new Map();

function send(res, status, body, contentType) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": contentType || "text/plain; charset=utf-8" });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8");
}

function clientIp(req) {
  // Renderen a szerver proxy mogott fut, a valodi kliens IP az X-Forwarded-For elso eleme.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "ismeretlen";
}

function isRateLimited(ip) {
  const now = Date.now();
  const recent = (submitTimesByIp.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  submitTimesByIp.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of submitTimesByIp) {
    if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) submitTimesByIp.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        const err = new Error("Túl nagy kérés.");
        err.status = 413;
        req.removeAllListeners("data");
        req.resume();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function validateSubmission(data) {
  const errors = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) return ["Érvénytelen kérés."];

  if (!data.name || typeof data.name !== "string" || !data.name.trim()) {
    errors.push("A név megadása kötelező.");
  } else if (data.name.trim().length > MAX_NAME_LENGTH || CONTROL_CHARS_RE.test(data.name)) {
    errors.push(`A név legfeljebb ${MAX_NAME_LENGTH} karakter lehet, és nem tartalmazhat vezérlőkaraktert.`);
  }
  if (
    !data.email ||
    typeof data.email !== "string" ||
    data.email.trim().length > MAX_EMAIL_LENGTH ||
    !EMAIL_RE.test(data.email.trim())
  ) {
    errors.push("Érvényes e-mail cím megadása kötelező.");
  }
  if (data.privacyAccepted !== true) {
    errors.push("Az adatvédelmi tájékoztató elfogadása kötelező.");
  }
  if (
    !Array.isArray(data.answers) ||
    data.answers.length !== ALLOWED_ANSWERS.length ||
    data.answers.some((a, i) => !ALLOWED_ANSWERS[i].includes(a))
  ) {
    errors.push("Minden kérdésre kötelező válaszolni.");
  }
  return errors;
}

function readSubmissions() {
  ensureDataFile();
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

// Hamisat ad vissza, ha ezzel az e-mail cimmel mar volt bekuldes (kis- es nagybetu nem szamit).
function appendSubmission(entry) {
  const list = readSubmissions();
  const email = entry.email.toLowerCase();
  if (list.some((s) => typeof s.email === "string" && s.email.toLowerCase() === email)) return false;
  list.push(entry);
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
  return true;
}

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split("?")[0]);
  } catch {
    send(res, 400, "Hibás kérés.");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (urlPath.includes("\0") || !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    send(res, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) {
      send(res, 404, "Nem található.");
      return;
    }
    send(res, 200, content, MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
  });
}

async function handleSubmit(req, res) {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) {
    sendJson(res, 415, { ok: false, errors: ["Érvénytelen kérés."] });
    return;
  }
  if (isRateLimited(clientIp(req))) {
    sendJson(res, 429, { ok: false, errors: ["Túl sok beküldés. Kérjük, próbáld újra később."] });
    return;
  }

  let data;
  try {
    data = JSON.parse((await readBody(req)) || "{}");
  } catch (e) {
    sendJson(res, e.status || 400, { ok: false, errors: ["Érvénytelen kérés."] });
    return;
  }

  const errors = validateSubmission(data);
  if (errors.length) {
    sendJson(res, 400, { ok: false, errors });
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
  if (!appendSubmission(entry)) {
    sendJson(res, 409, { ok: false, errors: ["Ezzel az e-mail címmel már részt vettél a nyereményjátékban."] });
    return;
  }
  sendJson(res, 200, { ok: true });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/submit") {
      await handleSubmit(req, res);
      return;
    }
    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }
    send(res, 405, "Method Not Allowed");
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { ok: false, errors: ["Szerverhiba történt."] });
  }
});

ensureDataFile();
server.listen(PORT, () => {
  console.log(`Nyereményjáték szerver fut: http://localhost:${PORT}`);
});
