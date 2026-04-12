require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const { uploadArquivo, gerarLink } = require("./b2");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = String(process.env.ADMIN_USER || "admin");
const ADMIN_PASS = String(process.env.ADMIN_PASS || "");
const JWT_SECRET = String(process.env.JWT_SECRET || "");

const APP_CELULAR_ARQUIVO = String(
  process.env.APP_CELULAR_ARQUIVO || "AppVendasCelularV1.0.apk"
);
const APP_MAQUININHA_ARQUIVO = String(
  process.env.APP_MAQUININHA_ARQUIVO || "AppMaquininhaV1.0.apk"
);
const WEBVENDAS_URL = String(
  process.env.WEBVENDAS_URL || "https://vendas.reinodasorte.com.br"
);

const upload = multer({ storage: multer.memoryStorage() });

function auth(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

    if (!token) {
      return res.status(401).json({ ok: false, error: "Token ausente" });
    }

    jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: "Não autorizado" });
  }
}

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/admin/login", (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "").trim();

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return res.status(401).json({ ok: false, error: "Login inválido" });
    }

    const token = jwt.sign({ user: "admin" }, JWT_SECRET, { expiresIn: "12h" });

    return res.json({
      ok: true,
      token
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "Erro no login" });
  }
});

app.post("/upload-apk", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Envie um arquivo APK" });
    }

    const nome = `apk/${Date.now()}-${req.file.originalname}`;

    await uploadArquivo(nome, req.file.buffer, req.file.mimetype);

    return res.json({
      ok: true,
      arquivo: nome
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Erro ao enviar APK" });
  }
});

app.get("/baixar-apk", async (req, res) => {
  try {
    const arquivo = String(req.query.arquivo || "").trim();

    if (!arquivo) {
      return res.status(400).json({ ok: false, error: "Arquivo não informado" });
    }

    const url = await gerarLink(arquivo);

    return res.json({
      ok: true,
      url
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Erro ao gerar link" });
  }
});

app.get("/app/celular", async (req, res) => {
  try {
    const url = await gerarLink(APP_CELULAR_ARQUIVO);
    return res.redirect(url);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Erro ao liberar APK do celular");
  }
});

app.get("/app/maquininha", async (req, res) => {
  try {
    const url = await gerarLink(APP_MAQUININHA_ARQUIVO);
    return res.redirect(url);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Erro ao liberar APK da maquininha");
  }
});

app.get("/app/webvendas", async (req, res) => {
  try {
    return res.redirect(WEBVENDAS_URL);
  } catch (err) {
    console.error(err);
    return res.status(500).send("Erro ao abrir WebVendas");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});