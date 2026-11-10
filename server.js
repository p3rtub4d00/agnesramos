require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const path = require("path");


const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE_NAME = "agnes_access";
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use("/vendor/simplewebauthn", express.static(path.join(__dirname, "node_modules/@simplewebauthn/browser/dist/bundle"), { maxAge: "1d" }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const GuestSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  checkedIn: { type: Boolean, default: false },
  checkedInAt: { type: Date, default: null },
  isResponsible: { type: Boolean, default: false }
}, { _id: true });

const RsvpSchema = new mongoose.Schema({
  responsible: { type: String, required: true, trim: true, maxlength: 100 },
  responsibleExcluded: { type: Boolean, default: false },
  responsibleCheckedIn: { type: Boolean, default: false },
  responsibleCheckedInAt: { type: Date, default: null },
  phone: { type: String, trim: true, maxlength: 30, default: "" },
  guests: { type: [GuestSchema], validate: v => v.length <= 20 },
  status: { type: String, enum: ["confirmed", "declined"], required: true },
  notes: { type: String, trim: true, maxlength: 300, default: "" },
  ticketTokenHash: { type: String, default: "", index: true },
  ticketUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

RsvpSchema.index({ responsible: 1 });
RsvpSchema.index({ "guests.name": 1 });
const Rsvp = mongoose.model("Rsvp", RsvpSchema);

const EventSettingsSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: "main" },
  eventName: { type: String, trim: true, maxlength: 80, default: "" },
  venue: { type: String, trim: true, maxlength: 120, default: "" },
  address: { type: String, trim: true, maxlength: 240, default: "" },
  mapUrl: { type: String, trim: true, maxlength: 500, default: "" },
  date: { type: String, trim: true, maxlength: 20, default: "" },
  time: { type: String, trim: true, maxlength: 80, default: "" }
}, { timestamps: true });
const EventSettings = mongoose.model("EventSettings", EventSettingsSchema);

const InvitationLinkSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, default: null },
  usedAt: { type: Date, default: null },
  usedByRsvpId: { type: mongoose.Schema.Types.ObjectId, default: null }
}, { timestamps: true });
const InvitationLink = mongoose.model("InvitationLink", InvitationLinkSchema);

const PasskeyCredentialSchema = new mongoose.Schema({
  role: { type: String, enum: ["admin", "portaria"], required: true, index: true },
  credentialId: { type: String, required: true, unique: true },
  publicKey: { type: String, required: true },
  counter: { type: Number, default: 0 },
  transports: { type: [String], default: [] },
  deviceName: { type: String, default: "" }
}, { timestamps: true });
const PasskeyCredential = mongoose.model("PasskeyCredential", PasskeyCredentialSchema);

const WebAuthnChallengeSchema = new mongoose.Schema({
  challengeId: { type: String, required: true, unique: true },
  challenge: { type: String, required: true },
  role: { type: String, enum: ["admin", "portaria"], required: true },
  purpose: { type: String, enum: ["register", "authenticate"], required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
});
const WebAuthnChallenge = mongoose.model("WebAuthnChallenge", WebAuthnChallengeSchema);

function dbReady() {
  return mongoose.connection.readyState === 1;
}
function waitForDb(timeoutMs = 15000) {
  if (dbReady()) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      mongoose.connection.off("connected", onConnected);
      resolve(dbReady());
    };
    const onConnected = () => finish();
    const timer = setTimeout(finish, timeoutMs);
    mongoose.connection.once("connected", onConnected);
  });
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
function hashToken(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function sign(value) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "development-only-change-me").update(value).digest("hex");
}
function createToken(role) {
  const payload = Buffer.from(JSON.stringify({ role, exp: Date.now() + TOKEN_TTL })).toString("base64url");
  return payload + "." + sign(payload);
}
function readToken(req) {
  const raw = (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE_NAME + "="));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice(COOKIE_NAME.length + 1));
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(parts[1], sign(parts[0]))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function requireRole(role) {
  return (req, res, next) => {
    const token = readToken(req);
    if (!token || token.role !== role) return res.status(401).json({ error: "Acesso não autorizado. Entre novamente." });
    req.accessRole = token.role;
    next();
  };
}
function requireAnyAccessRole(req, res, next) {
  const token = readToken(req);
  if (!token || !["admin", "portaria"].includes(token.role)) return res.status(401).json({ error: "Acesso não autorizado. Entre novamente." });
  req.accessRole = token.role;
  next();
}
function setAccessCookie(res, role) {
  res.cookie(COOKIE_NAME, createToken(role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: TOKEN_TTL,
    path: "/"
  });
}
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." } });

app.get("/api/health", (req, res) => res.json({ ok: true, database: dbReady() ? "connected" : "disconnected" }));

app.get("/api/session", (req, res) => {
  const token = readToken(req);
  if (!token || !["admin", "portaria"].includes(token.role)) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, role: token.role, expiresAt: token.exp });
});

function webAuthnSettings(req) {
  const configuredOrigin = process.env.WEBAUTHN_ORIGIN || process.env.PUBLIC_URL;
  const origin = configuredOrigin || (req.protocol + "://" + req.get("host"));
  const parsed = new URL(origin);
  return { expectedOrigin: parsed.origin, expectedRPID: process.env.WEBAUTHN_RP_ID || parsed.hostname, rpID: process.env.WEBAUTHN_RP_ID || parsed.hostname, origin: parsed.origin };
}
async function saveWebAuthnChallenge(role, purpose, challenge) {
  const challengeId = crypto.randomBytes(18).toString("hex");
  await WebAuthnChallenge.create({ challengeId, challenge, role, purpose, expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  return challengeId;
}
async function takeWebAuthnChallenge(challengeId, role, purpose) {
  return WebAuthnChallenge.findOneAndDelete({ challengeId, role, purpose, expiresAt: { $gt: new Date() } });
}
app.get("/api/webauthn/available", async (req, res) => {
  const role = String(req.query.role || "");
  if (!["admin", "portaria"].includes(role)) return res.status(400).json({ available: false });
  try { res.json({ available: await PasskeyCredential.exists({ role }) ? true : false }); }
  catch { res.status(503).json({ available: false, error: "Não foi possível consultar a biometria." }); }
});
app.post("/api/webauthn/register/options", requireAnyAccessRole, async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const role = req.accessRole;
    const credentials = await PasskeyCredential.find({ role }).lean();
    const cfg = webAuthnSettings(req);
    const webauthn = await import("@simplewebauthn/server");
    const options = await webauthn.generateRegistrationOptions({
      rpName: "Convite Agnes",
      rpID: cfg.rpID,
      userName: role === "admin" ? "Responsável pela festa" : "Equipe da portaria",
      userDisplayName: role === "admin" ? "Painel administrativo" : "Portaria",
      userID: Buffer.from("agnes-" + role),
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      excludeCredentials: credentials.map(c => ({ id: c.credentialId, transports: c.transports }))
    });
    const challengeId = await saveWebAuthnChallenge(role, "register", options.challenge);
    res.json({ challengeId, options });
  } catch (err) {
    console.error("Erro ao preparar cadastro de biometria:", err.message);
    res.status(500).json({ error: "Não foi possível preparar o cadastro de biometria neste dispositivo." });
  }
});
app.post("/api/webauthn/register/verify", requireAnyAccessRole, async (req, res) => {
  try {
    const role = req.accessRole;
    const challenge = await takeWebAuthnChallenge(String(req.body.challengeId || ""), role, "register");
    if (!challenge) return res.status(410).json({ error: "A solicitação expirou. Tente cadastrar a biometria novamente." });
    const cfg = webAuthnSettings(req);
    const webauthn = await import("@simplewebauthn/server");
    const verification = await webauthn.verifyRegistrationResponse({
      response: req.body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: cfg.expectedOrigin,
      expectedRPID: cfg.expectedRPID,
      requireUserVerification: true
    });
    if (!verification.verified || !verification.registrationInfo) return res.status(400).json({ error: "Não foi possível validar a biometria." });
    const credential = verification.registrationInfo.credential;
    await PasskeyCredential.findOneAndUpdate(
      { credentialId: credential.id },
      { $set: { role, credentialId: credential.id, publicKey: Buffer.from(credential.publicKey).toString("base64url"), counter: credential.counter, transports: credential.transports || [], deviceName: String(req.body.deviceName || "").slice(0, 80) } },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ ok: true, message: "Biometria cadastrada neste dispositivo." });
  } catch (err) {
    console.error("Erro ao validar cadastro de biometria:", err.message);
    res.status(400).json({ error: "O cadastro biométrico não foi concluído. Verifique se o dispositivo oferece biometria ou PIN seguro." });
  }
});
app.post("/api/webauthn/auth/options", loginLimiter, async (req, res) => {
  const role = String(req.body.role || "");
  if (!["admin", "portaria"].includes(role)) return res.status(400).json({ error: "Tipo de acesso inválido." });
  try {
    const credentials = await PasskeyCredential.find({ role }).lean();
    if (!credentials.length) return res.status(404).json({ error: "Ainda não há biometria cadastrada para este acesso." });
    const cfg = webAuthnSettings(req);
    const webauthn = await import("@simplewebauthn/server");
    const options = await webauthn.generateAuthenticationOptions({
      rpID: cfg.rpID,
      allowCredentials: credentials.map(c => ({ id: c.credentialId, transports: c.transports })),
      userVerification: "required"
    });
    const challengeId = await saveWebAuthnChallenge(role, "authenticate", options.challenge);
    res.json({ challengeId, options });
  } catch (err) {
    console.error("Erro ao preparar autenticação biométrica:", err.message);
    res.status(500).json({ error: "Não foi possível iniciar o acesso biométrico." });
  }
});
app.post("/api/webauthn/auth/verify", loginLimiter, async (req, res) => {
  const role = String(req.body.role || "");
  if (!["admin", "portaria"].includes(role)) return res.status(400).json({ error: "Tipo de acesso inválido." });
  try {
    const challenge = await takeWebAuthnChallenge(String(req.body.challengeId || ""), role, "authenticate");
    if (!challenge) return res.status(410).json({ error: "A solicitação expirou. Tente novamente." });
    const credentialId = String(req.body.response?.id || "");
    const credential = await PasskeyCredential.findOne({ role, credentialId });
    if (!credential) return res.status(404).json({ error: "Biometria não cadastrada para este dispositivo." });
    const cfg = webAuthnSettings(req);
    const webauthn = await import("@simplewebauthn/server");
    const verification = await webauthn.verifyAuthenticationResponse({
      response: req.body.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: cfg.expectedOrigin,
      expectedRPID: cfg.expectedRPID,
      credential: { id: credential.credentialId, publicKey: Buffer.from(credential.publicKey, "base64url"), counter: credential.counter, transports: credential.transports },
      requireUserVerification: true
    });
    if (!verification.verified) return res.status(401).json({ error: "A validação biométrica não foi concluída." });
    credential.counter = verification.authenticationInfo.newCounter;
    await credential.save();
    setAccessCookie(res, role);
    res.json({ ok: true, role });
  } catch (err) {
    console.error("Erro na autenticação biométrica:", err.message);
    res.status(401).json({ error: "Não foi possível confirmar sua biometria. Use a senha para entrar." });
  }
});
app.get("/api/config", async (req, res) => {
  // Aguarda o MongoDB conectar antes de responder com os dados do evento.
  // Evita exibir valores padrão quando o banco ainda está acordando.
  if (!(await waitForDb())) {
    return res.status(503).json({ error: "As informações da festa estão carregando. Atualize a página em alguns segundos." });
  }
  let settings = null;
  try {
    settings = await EventSettings.findOne({ key: "main" }).lean();
  } catch (err) {
    console.error("Erro ao carregar configurações do evento:", err.message);
    return res.status(503).json({ error: "Não foi possível carregar as informações salvas da festa." });
  }
  res.json({
    eventName: settings?.eventName || process.env.EVENT_NAME || "Agnes",
    age: process.env.EVENT_AGE || "5",
    date: settings?.date || process.env.EVENT_DATE || "Data a definir",
    time: settings?.time || process.env.EVENT_TIME || "Horário a definir",
    venue: settings?.venue || process.env.EVENT_VENUE || "Local a definir",
    address: settings?.address || process.env.EVENT_ADDRESS || "Endereço a definir",
    mapUrl: settings?.mapUrl || process.env.EVENT_MAP_URL || "",
    deadline: process.env.RSVP_DEADLINE || ""
  });
});

app.post("/api/rsvp", async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "As confirmações ainda não estão disponíveis. Tente novamente mais tarde." });
  const inviteToken = String(req.body.inviteToken || "");
  if (!/^[a-f0-9]{64}$/i.test(inviteToken)) return res.status(403).json({ error: "Use o link pessoal enviado pela família para confirmar presença." });
  const responsible = String(req.body.responsible || "").trim();
  const phone = String(req.body.phone || "").trim();
  const status = req.body.status === "declined" ? "declined" : "confirmed";
  const names = Array.isArray(req.body.guests) ? req.body.guests : [];
  const guests = names.map(v => String(v || "").trim()).filter(Boolean).slice(0, 20);
  const notes = String(req.body.notes || "").trim();
  if (responsible.length < 2 || responsible.length > 100) return res.status(400).json({ error: "Informe o nome do responsável (2 a 100 caracteres)." });
  if (phone.length > 30 || notes.length > 300) return res.status(400).json({ error: "Confira os campos informados." });
  if (status === "confirmed" && guests.length === 0) return res.status(400).json({ error: "Informe pelo menos uma pessoa que irá à festa." });
  const allNames = [responsible, ...guests].map(n => n.toLocaleLowerCase("pt-BR"));
  if (new Set(allNames).size !== allNames.length) return res.status(400).json({ error: "O responsável ou algum acompanhante foi informado mais de uma vez." });
  let claimedLink = null;
  let doc = null;
  try {
    claimedLink = await InvitationLink.findOneAndUpdate({ tokenHash: hashToken(inviteToken), usedAt: null }, { $set: { usedAt: new Date() } }, { new: true });
    if (!claimedLink) return res.status(410).json({ error: "Este link já foi utilizado ou expirou. Peça um novo convite à família." });
    const ticketToken = status === "confirmed" ? crypto.randomBytes(32).toString("hex") : "";
    doc = await Rsvp.create({ responsible, phone, status, guests: status === "confirmed" ? [{ name: responsible, isResponsible: true }, ...guests.map(name => ({ name, isResponsible: false }))] : [], notes, ticketTokenHash: ticketToken ? hashToken(ticketToken) : "" });
    claimedLink.usedByRsvpId = doc._id;
    await claimedLink.save();
    res.status(201).json({ ok: true, message: status === "confirmed" ? "Presença registrada! Salve o comprovante com QR Code para apresentar na portaria." : "Resposta registrada. Obrigado por avisar!", id: String(doc._id), ticketToken: ticketToken || null, guests: status === "confirmed" ? [responsible, ...guests] : [] });
  } catch (err) {
    if (doc) await Rsvp.deleteOne({ _id: doc._id }).catch(() => {});
    if (claimedLink) await InvitationLink.updateOne({ _id: claimedLink._id, usedAt: { $ne: null } }, { $set: { usedAt: null, usedByRsvpId: null } }).catch(() => {});
    console.error("Erro ao salvar RSVP:", err.message);
    res.status(500).json({ error: "Não foi possível salvar sua resposta agora. Tente novamente." });
  }
});

app.post("/api/admin/login", loginLimiter, (req, res) => {
  if (!process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) return res.status(503).json({ error: "Configure ADMIN_PASSWORD e SESSION_SECRET nas variáveis de ambiente." });
  if (!safeEqual(req.body.password, process.env.ADMIN_PASSWORD)) return res.status(401).json({ error: "Senha incorreta." });
  setAccessCookie(res, "admin");
  res.json({ ok: true });
});
app.post("/api/admin/invitation-links", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const token = crypto.randomBytes(32).toString("hex");
    await InvitationLink.create({ tokenHash: hashToken(token), usedAt: null });
    const origin = process.env.PUBLIC_URL || (req.protocol + "://" + req.get("host"));
    res.status(201).json({ url: (origin.endsWith("/") ? origin.slice(0, -1) : origin) + "/convite/" + token });
  } catch (err) {
    console.error("Erro ao gerar link de convite:", err.message);
    res.status(500).json({ error: "Não foi possível gerar o link agora." });
  }
});
app.get("/api/invitation/:token", async (req, res) => {
  if (!dbReady()) return res.status(503).json({ valid: false, error: "Convites temporariamente indisponíveis." });
  const token = String(req.params.token || "");
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(404).json({ valid: false, error: "Este link de convite é inválido." });
  const link = await InvitationLink.findOne({ tokenHash: hashToken(token), usedAt: null }).lean();
  if (!link) return res.status(410).json({ valid: false, error: "Este link já foi utilizado. Peça um novo convite à família." });
  res.json({ valid: true });
});
app.get("/api/admin/settings", requireRole("admin"), async (req, res) => {
  if (!(await waitForDb())) return res.status(503).json({ error: "Banco de dados desconectado. Aguarde alguns segundos e tente novamente." });
  try {
    const settings = await EventSettings.findOne({ key: "main" }).lean();
    res.json({
      eventName: settings?.eventName || process.env.EVENT_NAME || "Agnes",
      venue: settings?.venue || process.env.EVENT_VENUE || "",
      address: settings?.address || process.env.EVENT_ADDRESS || "",
      mapUrl: settings?.mapUrl || process.env.EVENT_MAP_URL || "",
      date: settings?.date || process.env.EVENT_DATE || "",
      time: settings?.time || process.env.EVENT_TIME || "",
      databaseConnected: dbReady(),
      settingsStored: !!settings
    });
  } catch (err) {
    console.error("Erro ao carregar configurações:", err.message);
    res.status(500).json({ error: "Não foi possível carregar os dados do evento." });
  }
});
app.put("/api/admin/settings", requireRole("admin"), async (req, res) => {
  if (!(await waitForDb())) return res.status(503).json({ error: "Banco de dados desconectado. Aguarde alguns segundos e tente novamente." });
  const venue = String(req.body.venue || "").trim();
  const eventName = String(req.body.eventName || "").trim();
  const address = String(req.body.address || "").trim();
  const mapUrl = String(req.body.mapUrl || "").trim();
  const date = String(req.body.date || "").trim();
  const time = String(req.body.time || "").trim();
  if (eventName.length < 2 || eventName.length > 80) return res.status(400).json({ error: "Informe o nome da aniversariante (2 a 80 caracteres)." });
  if (venue.length > 120 || address.length > 240 || mapUrl.length > 500 || date.length > 20 || time.length > 80) return res.status(400).json({ error: "Confira os limites dos campos de local, endereço, data e horário." });
  if (mapUrl && !/^https:\/\//i.test(mapUrl)) return res.status(400).json({ error: "O link do mapa deve começar com https://" });
  try {
    await EventSettings.findOneAndUpdate({ key: "main" }, { $set: { eventName, venue, address, mapUrl, date, time } }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao salvar configurações:", err.message);
    res.status(500).json({ error: "Não foi possível salvar os dados do evento." });
  }
});
app.post("/api/portaria/login", loginLimiter, (req, res) => {
  if (!process.env.PORTARIA_PASSWORD || !process.env.SESSION_SECRET) return res.status(503).json({ error: "Configure PORTARIA_PASSWORD e SESSION_SECRET nas variáveis de ambiente." });
  if (!safeEqual(req.body.password, process.env.PORTARIA_PASSWORD)) return res.status(401).json({ error: "Senha incorreta." });
  setAccessCookie(res, "portaria");
  res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  res.json({ ok: true });
});

app.get("/api/admin/rsvps", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const docs = await Rsvp.find().sort({ createdAt: -1 }).lean();
    const items = docs.map(d => {
      const guests = (d.guests || []).map(g => ({
        id: String(g._id), name: g.name, isResponsible: !!g.isResponsible || String(g.name).trim().toLocaleLowerCase("pt-BR") === String(d.responsible).trim().toLocaleLowerCase("pt-BR"),
        checkedIn: !!g.checkedIn, checkedInAt: g.checkedInAt
      }));
      const hasResponsible = guests.some(g => g.isResponsible);
      if (d.status === "confirmed" && !hasResponsible && !d.responsibleExcluded) guests.unshift({
        id: "responsible", name: d.responsible, isResponsible: true,
        checkedIn: !!d.responsibleCheckedIn, checkedInAt: d.responsibleCheckedInAt || null
      });
      return { id: String(d._id), responsible: d.responsible, responsibleExcluded: !!d.responsibleExcluded, phone: d.phone || "", status: d.status, notes: d.notes || "", createdAt: d.createdAt, guests };
    });
    const confirmedItems = items.filter(i => i.status === "confirmed");
    res.json({
      items,
      totals: {
        families: confirmedItems.length,
        people: confirmedItems.reduce((sum, item) => sum + item.guests.length, 0),
        pending: docs.filter(d => d.status === "declined").length,
        checkedIn: confirmedItems.reduce((sum, item) => sum + item.guests.filter(g => g.checkedIn).length, 0)
      }
    });
  } catch (err) {
    console.error("Erro ao listar confirmações:", err.message);
    res.status(500).json({ error: "Não foi possível carregar a lista." });
  }
});
app.get("/api/admin/rsvps/:id/ticket", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const doc = await Rsvp.findById(req.params.id).lean();
    if (!doc || doc.status !== "confirmed" || !doc.ticketTokenHash) return res.status(404).json({ error: "Comprovante não encontrado para esta confirmação." });
    res.json({ ticketToken: doc.ticketTokenHash, responsible: doc.responsible, phone: doc.phone || "", names: (doc.guests || []).map(g => g.name), used: !!doc.ticketUsedAt });
  } catch (err) {
    console.error("Erro ao recuperar comprovante:", err.message);
    res.status(400).json({ error: "Não foi possível recuperar este comprovante." });
  }
});
app.delete("/api/admin/rsvps", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  if (req.body.confirmation !== "ZERAR") return res.status(400).json({ error: "Confirmação inválida." });
  try {
    const records = await Rsvp.find({});
    for (const record of records) await record.deleteOne();
    await InvitationLink.deleteMany({});
    res.json({ ok: true, deletedCount: records.length });
  } catch (err) {
    console.error("Erro ao zerar confirmações:", err.message);
    res.status(500).json({ error: "Não foi possível zerar a lista de convidados." });
  }
});
app.delete("/api/admin/rsvps/:id/guests/:guestId", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const doc = await Rsvp.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Confirmação não encontrada." });
    if (req.params.guestId === "responsible") {
      const responsibleGuest = doc.guests.find(g => g.isResponsible || String(g.name).trim().toLocaleLowerCase("pt-BR") === String(doc.responsible).trim().toLocaleLowerCase("pt-BR"));
      if (responsibleGuest) responsibleGuest.deleteOne();
      doc.responsibleExcluded = true;
      doc.responsibleCheckedIn = false;
      doc.responsibleCheckedInAt = null;
    } else {
      const guest = doc.guests.id(req.params.guestId);
      if (!guest) return res.status(404).json({ error: "Convidado não encontrado." });
      if (guest.isResponsible) {
        guest.deleteOne();
        doc.responsibleExcluded = true;
        doc.responsibleCheckedIn = false;
        doc.responsibleCheckedInAt = null;
      } else guest.deleteOne();
    }
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao excluir convidado:", err.message);
    res.status(400).json({ error: "Não foi possível excluir este convidado." });
  }
});
app.patch("/api/admin/rsvps/:id", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  const status = req.body.status;
  if (!["confirmed", "declined"].includes(status)) return res.status(400).json({ error: "Status inválido." });
  try {
    const doc = await Rsvp.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: "Confirmação não encontrada." });
    doc.status = status;
    if (status === "declined") doc.guests = [];
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  } catch { res.status(400).json({ error: "Não foi possível atualizar esta confirmação." }); }
});
app.get("/api/portaria/guests", requireRole("portaria"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  const q = String(req.query.q || "").trim().slice(0, 100);
  try {
    const docs = await Rsvp.find({ status: "confirmed" }).lean();
    const normalized = q.toLocaleLowerCase("pt-BR");
    const results = [];
    for (const d of docs) {
      const guests = (d.guests || []).map(g => ({
        guestId: String(g._id), name: g.name,
        checkedIn: !!g.checkedIn, checkedInAt: g.checkedInAt,
        isResponsible: !!g.isResponsible || String(g.name).trim().toLocaleLowerCase("pt-BR") === String(d.responsible).trim().toLocaleLowerCase("pt-BR")
      }));
      if (!guests.some(g => g.isResponsible) && !d.responsibleExcluded) guests.unshift({
        guestId: "responsible", name: d.responsible, checkedIn: !!d.responsibleCheckedIn,
        checkedInAt: d.responsibleCheckedInAt || null, isResponsible: true
      });
      const matches = guests.filter(g => !q || g.name.toLocaleLowerCase("pt-BR").includes(normalized));
      for (const g of matches) results.push({ id: String(d._id), guestId: g.guestId, name: g.name, responsible: d.responsible, total: guests.length, checkedIn: g.checkedIn, checkedInAt: g.checkedInAt });
    }
    res.json({ items: results.slice(0, 100) });
  } catch (err) {
    console.error("Erro na busca da portaria:", err.message);
    res.status(500).json({ error: "Não foi possível consultar a lista." });
  }
});
app.post("/api/portaria/checkin", requireRole("portaria"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const doc = await Rsvp.findById(req.body.id);
    if (!doc || doc.status !== "confirmed") return res.status(404).json({ error: "Convidado não encontrado na lista de confirmados." });
    if (req.body.guestId === "responsible") {
      if (doc.responsibleCheckedIn) return res.status(409).json({ error: "Esta entrada já foi registrada." });
      doc.responsibleCheckedIn = true;
      doc.responsibleCheckedInAt = new Date();
      await doc.save();
      return res.json({ ok: true, message: "Entrada registrada para " + doc.responsible + "." });
    }
    const guest = doc.guests.id(req.body.guestId);
    if (!guest) return res.status(404).json({ error: "Nome não encontrado nesta confirmação." });
    if (guest.checkedIn) return res.status(409).json({ error: "Esta entrada já foi registrada." });
    guest.checkedIn = true;
    guest.checkedInAt = new Date();
    await doc.save();
    res.json({ ok: true, message: "Entrada registrada para " + guest.name + "." });
  } catch { res.status(400).json({ error: "Não foi possível registrar a entrada." }); }
});

app.post("/api/portaria/checkin-ticket", requireRole("portaria"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  const ticketToken = String(req.body.ticketToken || "");
  if (!/^[a-f0-9]{64}$/i.test(ticketToken)) return res.status(400).json({ error: "QR Code inválido." });
  try {
    const now = new Date();
    const ticketQuery = { $or: [{ ticketTokenHash: hashToken(ticketToken) }, { ticketTokenHash: ticketToken }], ticketUsedAt: null, status: "confirmed" };
    const doc = await Rsvp.findOneAndUpdate(ticketQuery, { $set: { ticketUsedAt: now, responsibleCheckedIn: true, responsibleCheckedInAt: now, "guests.$[].checkedIn": true, "guests.$[].checkedInAt": now } }, { new: true });
    if (!doc) {
      const existing = await Rsvp.findOne({ $or: [{ ticketTokenHash: hashToken(ticketToken) }, { ticketTokenHash: ticketToken }] }).lean();
      if (existing?.ticketUsedAt) return res.status(409).json({ error: "Este comprovante já foi utilizado. A entrada desta família já foi registrada." });
      return res.status(404).json({ error: "Comprovante não encontrado ou confirmação inválida." });
    }
    const names = (doc.guests || []).map(g => g.name);
    res.json({ ok: true, responsible: doc.responsible, names, total: names.length, message: "Entrada liberada! " + doc.responsible + " · " + names.length + " pessoa(s) registrada(s)." });
  } catch (err) {
    console.error("Erro ao validar QR Code:", err.message);
    res.status(500).json({ error: "Não foi possível validar este comprovante." });
  }
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/portaria", (req, res) => res.sendFile(path.join(__dirname, "public", "portaria.html")));
app.get("/convite/:token", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota não encontrada." });
  res.sendFile(path.join(__dirname, "public", "index.html"), err => { if (err) next(err); });
});

app.listen(PORT, () => console.log("Convite Agnes iniciado na porta " + PORT));
if (process.env.MONGODB_URI) {
  mongoose.connection.once("connected", async () => {
    try {
      await InvitationLink.collection.dropIndex("expiresAt_1");
      console.log("Índice de expiração dos links removido.");
    } catch (err) {
      if (!/index not found|ns does not exist/i.test(err.message || "")) console.warn("Aviso ao remover índice de expiração:", err.message);
    }
  });
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
    .then(() => console.log("MongoDB conectado"))
    .catch(err => console.error("Não foi possível conectar ao MongoDB:", err.message));
} else {
  console.warn("MONGODB_URI não configurada: APIs que dependem do banco ficarão indisponíveis.");
}
