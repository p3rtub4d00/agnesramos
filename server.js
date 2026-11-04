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
const TOKEN_TTL = 8 * 60 * 60 * 1000;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
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

function dbReady() {
  return mongoose.connection.readyState === 1;
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
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
app.get("/api/config", async (req, res) => {
  let settings = null;
  if (dbReady()) {
    try { settings = await EventSettings.findOne({ key: "main" }).lean(); }
    catch (err) { console.error("Erro ao carregar configurações do evento:", err.message); }
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
  try {
    const doc = await Rsvp.create({ responsible, phone, status, guests: status === "confirmed" ? [{ name: responsible, isResponsible: true }, ...guests.map(name => ({ name, isResponsible: false }))] : [], notes });
    res.status(201).json({ ok: true, message: status === "confirmed" ? "Presença registrada! Esperamos vocês nessa missão especial!" : "Resposta registrada. Obrigado por avisar!", id: String(doc._id) });
  } catch (err) {
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
app.get("/api/admin/settings", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
  try {
    const settings = await EventSettings.findOne({ key: "main" }).lean();
    res.json({ eventName: settings?.eventName || process.env.EVENT_NAME || "Agnes", venue: settings?.venue || process.env.EVENT_VENUE || "", address: settings?.address || process.env.EVENT_ADDRESS || "", mapUrl: settings?.mapUrl || process.env.EVENT_MAP_URL || "", date: settings?.date || process.env.EVENT_DATE || "", time: settings?.time || process.env.EVENT_TIME || "" });
  } catch (err) {
    console.error("Erro ao carregar configurações:", err.message);
    res.status(500).json({ error: "Não foi possível carregar os dados do evento." });
  }
});
app.put("/api/admin/settings", requireRole("admin"), async (req, res) => {
  if (!dbReady()) return res.status(503).json({ error: "Banco de dados desconectado." });
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

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/portaria", (req, res) => res.sendFile(path.join(__dirname, "public", "portaria.html")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Rota não encontrada." });
  res.sendFile(path.join(__dirname, "public", "index.html"), err => { if (err) next(err); });
});

app.listen(PORT, () => console.log("Convite Agnes iniciado na porta " + PORT));
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 })
    .then(() => console.log("MongoDB conectado"))
    .catch(err => console.error("Não foi possível conectar ao MongoDB:", err.message));
} else {
  console.warn("MONGODB_URI não configurada: APIs que dependem do banco ficarão indisponíveis.");
}
