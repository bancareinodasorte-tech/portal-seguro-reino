require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "123456";
const JWT_SECRET = process.env.JWT_SECRET || "123456";

const STORAGE_DIR = path.join(__dirname, "storage");
const META_FILE = path.join(STORAGE_DIR, "meta.json");

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);

function saveMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}

function loadMeta() {
  if (!fs.existsSync(META_FILE)) return {};
  return JSON.parse(fs.readFileSync(META_FILE));
}

const upload = multer({ dest: STORAGE_DIR });

function auth(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Não autorizado" });
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign({ user: "admin" }, JWT_SECRET);
    return res.json({ token });
  }

  res.status(401).json({ error: "Login inválido" });
});

app.post("/admin/upload", auth, upload.single("apk"), (req, res) => {
  const meta = loadMeta();

  meta.file = req.file.filename;

  saveMeta(meta);

  res.json({ ok: true });
});

app.get("/download", (req, res) => {
  const meta = loadMeta();

  if (!meta.file) {
    return res.status(404).send("Nenhum arquivo");
  }

  const filePath = path.join(STORAGE_DIR, meta.file);

  res.download(filePath);
});

app.listen(PORT, () => {
  console.log("Servidor rodando");
});