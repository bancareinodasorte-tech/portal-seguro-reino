require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = Number(process.env.PORT || 3000);
const ADMIN_USER = String(process.env.ADMIN_USER || "admin");
const ADMIN_PASS = String(process.env.ADMIN_PASS || "");
const JWT_SECRET = String(process.env.JWT_SECRET || "");
const APP_SHARED_KEY = String(process.env.APP_SHARED_KEY || "");
const BRAND_NAME = String(process.env.BRAND_NAME || "REINO DA SORTE");
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");

const R2_ACCOUNT_ID = String(process.env.R2_ACCOUNT_ID || "");
const R2_ACCESS_KEY_ID = String(process.env.R2_ACCESS_KEY_ID || "");
const R2_SECRET_ACCESS_KEY = String(process.env.R2_SECRET_ACCESS_KEY || "");
const R2_BUCKET = String(process.env.R2_BUCKET || "");

if (!JWT_SECRET) {
  console.error("JWT_SECRET não configurado.");
  process.exit(1);
}

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error("Credenciais do Cloudflare R2 não configuradas no .env.");
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024
  }
});

const META_CURRENT_APP = "meta/current-app.json";
const META_INSTALLER = "meta/current-installer.json";
const META_ACCESS_CODES = "meta/access-codes.json";

function agoraIso() {
  return new Date().toISOString();
}

function criarTokenAdmin() {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: "12h" });
}

function authAdmin(req, res, next) {
  try {
    const auth = String(req.headers.authorization || "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) {
      return res.status(401).json({ ok: false, error: "Token ausente." });
    }
    jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: "Token inválido." });
  }
}

function authApp(req, res, next) {
  const key = String(req.headers["x-app-key"] || "");
  if (!APP_SHARED_KEY || key !== APP_SHARED_KEY) {
    return res.status(401).json({ ok: false, error: "Acesso do app negado." });
  }
  next();
}

function gerarCodigoAcesso() {
  return crypto.randomBytes(5).toString("hex").toUpperCase();
}

async function getObjectJson(key, fallbackValue) {
  try {
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key
    });

    const response = await r2.send(command);
    const text = await response.Body.transformToString();
    return JSON.parse(text);
  } catch (error) {
    return fallbackValue;
  }
}

async function putObjectJson(key, data) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json"
  });

  await r2.send(command);
}

async function uploadBufferToR2(key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType || "application/octet-stream"
  });

  await r2.send(command);
}

async function gerarSignedGetUrl(key, expiresInSeconds = 300) {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key
  });

  return getSignedUrl(r2, command, { expiresIn: expiresInSeconds });
}

async function getCurrentAppMeta() {
  return getObjectJson(META_CURRENT_APP, null);
}

async function getCurrentInstallerMeta() {
  return getObjectJson(META_INSTALLER, null);
}

async function getAccessCodes() {
  return getObjectJson(META_ACCESS_CODES, []);
}

async function saveAccessCodes(codes) {
  await putObjectJson(META_ACCESS_CODES, codes);
}

app.get("/health", async (req, res) => {
  res.json({
    ok: true,
    service: "portal-seguro",
    brand: BRAND_NAME,
    now: agoraIso()
  });
});

app.post("/admin/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "").trim();

    if (username !== ADMIN_USER || password !== ADMIN_PASS) {
      return res.status(401).json({
        ok: false,
        error: "Usuário ou senha inválidos."
      });
    }

    return res.json({
      ok: true,
      token: criarTokenAdmin()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha no login."
    });
  }
});

app.get("/admin/current", authAdmin, async (req, res) => {
  try {
    const currentApp = await getCurrentAppMeta();
    const currentInstaller = await getCurrentInstallerMeta();
    const accessCodes = await getAccessCodes();

    return res.json({
      ok: true,
      brand: BRAND_NAME,
      currentApp,
      currentInstaller,
      accessCodes
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao carregar dados."
    });
  }
});

app.post("/admin/upload-app", authAdmin, upload.single("apk"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Envie o APK do AppVendas." });
    }

    const versionCode = Number(req.body.versionCode || 0);
    const versionName = String(req.body.versionName || "").trim();
    const notes = String(req.body.notes || "").trim();
    const minInstallerVersionCode = Number(req.body.minInstallerVersionCode || 1);
    const mandatory = String(req.body.mandatory || "false") === "true";

    if (!versionCode || !versionName) {
      return res.status(400).json({
        ok: false,
        error: "Preencha versionCode e versionName."
      });
    }

    const key = `releases/appvendas/${Date.now()}-${versionName}.apk`;

    await uploadBufferToR2(
      key,
      req.file.buffer,
      "application/vnd.android.package-archive"
    );

    const meta = {
      app: "AppVendas",
      versionCode,
      versionName,
      notes,
      mandatory,
      minInstallerVersionCode,
      objectKey: key,
      uploadedAt: agoraIso(),
      fileName: req.file.originalname,
      fileSize: req.file.size
    };

    await putObjectJson(META_CURRENT_APP, meta);

    return res.json({
      ok: true,
      message: "AppVendas enviado com sucesso.",
      meta
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao enviar AppVendas."
    });
  }
});

app.post("/admin/upload-installer", authAdmin, upload.single("apk"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Envie o APK do Instalador." });
    }

    const versionCode = Number(req.body.versionCode || 0);
    const versionName = String(req.body.versionName || "").trim();
    const notes = String(req.body.notes || "").trim();

    if (!versionCode || !versionName) {
      return res.status(400).json({
        ok: false,
        error: "Preencha versionCode e versionName."
      });
    }

    const key = `releases/installer/${Date.now()}-${versionName}.apk`;

    await uploadBufferToR2(
      key,
      req.file.buffer,
      "application/vnd.android.package-archive"
    );

    const meta = {
      app: "Installer",
      versionCode,
      versionName,
      notes,
      objectKey: key,
      uploadedAt: agoraIso(),
      fileName: req.file.originalname,
      fileSize: req.file.size
    };

    await putObjectJson(META_INSTALLER, meta);

    return res.json({
      ok: true,
      message: "Instalador enviado com sucesso.",
      meta
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao enviar Instalador."
    });
  }
});

app.post("/admin/create-access-code", authAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "").trim();
    const maxUses = Number(req.body.maxUses || 1);
    const expiresAt = String(req.body.expiresAt || "").trim();
    const oneDeviceOnly = String(req.body.oneDeviceOnly || "true") === "true";
    const active = true;

    if (!name) {
      return res.status(400).json({ ok: false, error: "Informe um nome para o acesso." });
    }

    const codes = await getAccessCodes();
    const code = gerarCodigoAcesso();

    const item = {
      id: crypto.randomUUID(),
      code,
      name,
      password,
      maxUses,
      uses: 0,
      expiresAt: expiresAt || null,
      oneDeviceOnly,
      boundDeviceId: null,
      active,
      createdAt: agoraIso()
    };

    codes.unshift(item);
    await saveAccessCodes(codes);

    return res.json({
      ok: true,
      item,
      installUrl: `${PUBLIC_BASE_URL}/install.html?code=${encodeURIComponent(code)}`
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao criar acesso."
    });
  }
});

app.post("/admin/toggle-access-code", authAdmin, async (req, res) => {
  try {
    const id = String(req.body.id || "").trim();
    const active = String(req.body.active || "false") === "true";

    const codes = await getAccessCodes();
    const index = codes.findIndex((item) => item.id === id);

    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Acesso não encontrado." });
    }

    codes[index].active = active;
    codes[index].updatedAt = agoraIso();

    await saveAccessCodes(codes);

    return res.json({
      ok: true,
      item: codes[index]
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao alterar acesso."
    });
  }
});

app.post("/public/installer/access", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim().toUpperCase();
    const password = String(req.body.password || "").trim();
    const deviceId = String(req.body.deviceId || "").trim();

    if (!code) {
      return res.status(400).json({ ok: false, error: "Informe o código." });
    }

    const installerMeta = await getCurrentInstallerMeta();
    if (!installerMeta) {
      return res.status(404).json({ ok: false, error: "Instalador ainda não enviado." });
    }

    const codes = await getAccessCodes();
    const index = codes.findIndex((item) => item.code === code);

    if (index === -1) {
      return res.status(404).json({ ok: false, error: "Código inválido." });
    }

    const access = codes[index];

    if (!access.active) {
      return res.status(403).json({ ok: false, error: "Acesso desativado." });
    }

    if (access.expiresAt && new Date(access.expiresAt).getTime() < Date.now()) {
      return res.status(403).json({ ok: false, error: "Acesso expirado." });
    }

    if (access.password && access.password !== password) {
      return res.status(403).json({ ok: false, error: "Senha inválida." });
    }

    if (access.uses >= access.maxUses) {
      return res.status(403).json({ ok: false, error: "Limite de usos atingido." });
    }

    if (access.oneDeviceOnly) {
      if (!deviceId) {
        return res.status(400).json({ ok: false, error: "Dispositivo não informado." });
      }

      if (!access.boundDeviceId) {
        access.boundDeviceId = deviceId;
      } else if (access.boundDeviceId !== deviceId) {
        return res.status(403).json({ ok: false, error: "Código já vinculado a outro aparelho." });
      }
    }

    access.uses += 1;
    access.lastUseAt = agoraIso();
    await saveAccessCodes(codes);

    const downloadUrl = await gerarSignedGetUrl(installerMeta.objectKey, 300);

    return res.json({
      ok: true,
      brand: BRAND_NAME,
      installer: {
        versionCode: installerMeta.versionCode,
        versionName: installerMeta.versionName,
        notes: installerMeta.notes || "",
        downloadUrl
      }
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao liberar o instalador."
    });
  }
});

app.get("/api/app/check", authApp, async (req, res) => {
  try {
    const currentVersionCode = Number(req.query.currentVersionCode || 0);
    const installerVersionCode = Number(req.query.installerVersionCode || 0);

    const meta = await getCurrentAppMeta();
    if (!meta) {
      return res.status(404).json({ ok: false, error: "AppVendas ainda não enviado." });
    }

    if (installerVersionCode < Number(meta.minInstallerVersionCode || 1)) {
      return res.status(426).json({
        ok: false,
        error: "Instalador desatualizado para esta versão."
      });
    }

    const updateAvailable = Number(meta.versionCode) > currentVersionCode;
    const downloadUrl = updateAvailable ? await gerarSignedGetUrl(meta.objectKey, 300) : null;

    return res.json({
      ok: true,
      app: "AppVendas",
      latestVersionCode: Number(meta.versionCode),
      latestVersionName: meta.versionName,
      notes: meta.notes || "",
      mandatory: !!meta.mandatory,
      updateAvailable,
      downloadUrl
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao verificar atualização."
    });
  }
});

app.get("/api/installer/check", authApp, async (req, res) => {
  try {
    const currentVersionCode = Number(req.query.currentVersionCode || 0);
    const meta = await getCurrentInstallerMeta();

    if (!meta) {
      return res.status(404).json({ ok: false, error: "Instalador ainda não enviado." });
    }

    const updateAvailable = Number(meta.versionCode) > currentVersionCode;
    const downloadUrl = updateAvailable ? await gerarSignedGetUrl(meta.objectKey, 300) : null;

    return res.json({
      ok: true,
      app: "Installer",
      latestVersionCode: Number(meta.versionCode),
      latestVersionName: meta.versionName,
      notes: meta.notes || "",
      updateAvailable,
      downloadUrl
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "Falha ao verificar atualização do instalador."
    });
  }
});

app.get("/", (req, res) => {
  res.redirect("/admin.html");
});

app.listen(PORT, () => {
  console.log(`Portal Seguro rodando na porta ${PORT}`);
});