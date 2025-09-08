// backend/config/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");

// --- Logger ---
const logFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level}]: ${message}`)
);
const fileTransport = new DailyRotateFile({ filename: "logs/application-%DATE%.log", datePattern: "YYYY-MM-DD", maxSize: "20m", maxFiles: "14d" });
const consoleTransport = new winston.transports.Console({ level: "info" });
const logger = winston.createLogger({ level: "debug", format: logFormat, transports: [fileTransport, consoleTransport] });

// --- Prisma Client ---
const { PrismaClient } = require("@prisma/client");
const prisma = global.prisma || (global.prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } }));

// --- Lazy DB connection ---
let dbConnected = false;
async function ensureDb() {
  if (!dbConnected) {
    await prisma.$connect();
    dbConnected = true;
    logger.info("✅ Database connected");
  }
}

// --- Email ---
const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: { user: process.env.userEmail, pass: process.env.userPassword },
  tls: { rejectUnauthorized: false },
});
async function sendEmail(to, subject, text, html = null) {
  return transporter.sendMail({ from: process.env.userEmail, to, subject, text, html });
}

// --- Status Codes & Responses ---
const HTTP_200_SUCCESS = 200, HTTP_400_BAD_REQUEST = 400, HTTP_500_INTERNAL_SERVER_ERROR = 500, HTTP_401_UNAUTHORIZED = 401, HTTP_403_FORBIDDEN = 403, HTTP_404_NOT_FOUND = 404;
const ApiSuccess = (res, data = {}, message = "OK", statusCode = HTTP_200_SUCCESS) => res.status(statusCode).json({ status: "OK", message, data });
const ApiError = (res, message, statusCode = HTTP_500_INTERNAL_SERVER_ERROR) => res.status(statusCode).json({ status: `${statusCode}`.startsWith(4) ? "FAIL" : "ERROR", message, statusCode });

// --- Helpers ---
function generateOTP() { return crypto.randomInt(100000, 999999).toString(); }
async function getAuthPayload(user) { return { id: user.id, email: user.email, role: user.role, limit: user.limit, photoCount: user.photoCount }; }
const generateToken = async (user, secret, period = "1d") => jwt.sign(await getAuthPayload(user), secret, { expiresIn: period });
const verifyToken = async (token, secret) => { try { return jwt.verify(token, secret); } catch { return null; } };

// --- Auth Middleware ---
const isAuthenticated = async (req, res, next) => {
  if (!req.headers.authorization) return ApiError(res, "Unauthorized: token missing", HTTP_401_UNAUTHORIZED);
  const token = req.headers.authorization.split(" ")[1];
  const payload = await verifyToken(token, process.env.JWT_SECRET);
  if (!payload) return ApiError(res, "Unauthorized: invalid token", HTTP_401_UNAUTHORIZED);
  await ensureDb();
  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user || !user.is_active) return ApiError(res, "Unauthorized: user inactive or missing", HTTP_401_UNAUTHORIZED);
  req.user = user;
  next();
};

// --- Multer ---
const upload = multer({ storage: multer.memoryStorage() });

// --- Telegram ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- Express ---
const app = express();
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static assets and pages ---
const publicDir = path.join(process.cwd(), "public");
app.use("/public", express.static(publicDir));
["/", "/admin", "/camera", "/login", "/qr"].forEach(p => app.get(p, (req, res) => res.sendFile(path.join(publicDir, p.replace("/", "") || "stage") + ".html")));

// --- Routes ---
const OTP_EXPIRATION_MINUTES = 5;

app.post("/api/auth", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return ApiError(res, "Email is required", HTTP_400_BAD_REQUEST);
    await ensureDb();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { email } });
    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60000);
    const userOTP = await prisma.oTP.findUnique({ where: { email } });
    if (userOTP) await prisma.oTP.update({ where: { email }, data: { otp: otpCode, expiresAt } });
    else await prisma.oTP.create({ data: { email, otp: otpCode, expiresAt } });
    await sendEmail(email, "Your OTP Code", `Your OTP: ${otpCode}. Valid for ${OTP_EXPIRATION_MINUTES} min.`);
    return ApiSuccess(res, { message: `OTP sent to ${email}` });
  } catch (err) { console.error(err); return ApiError(res, "Something went wrong", HTTP_500_INTERNAL_SERVER_ERROR); }
});

app.post("/api/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return ApiError(res, "Email and OTP required", HTTP_400_BAD_REQUEST);
    await ensureDb();
    const otpRecord = await prisma.oTP.findFirst({ where: { email, otp }, orderBy: { createdAt: "desc" } });
    if (!otpRecord || otpRecord.expiresAt < new Date()) return ApiError(res, "Invalid or expired OTP", HTTP_400_BAD_REQUEST);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return ApiError(res, "User not found", HTTP_400_BAD_REQUEST);
    const token = await generateToken(user, process.env.JWT_SECRET);
    return ApiSuccess(res, { message: "Login successful", token, user });
  } catch (err) { console.error(err); return ApiError(res, "Something went wrong", HTTP_500_INTERNAL_SERVER_ERROR); }
});

app.get("/api/user", isAuthenticated, async (req, res) => { await ensureDb(); return ApiSuccess(res, { user: req.user }); });

app.post("/api/upload", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    await ensureDb();
    const { id: user_id } = req.user;
    const caption = req.body.caption || "";
    const fileObject = req.file;
    if (!fileObject) return ApiError(res, "No file uploaded", HTTP_400_BAD_REQUEST);
    const formData = new FormData();
    formData.append("chat_id", TELEGRAM_CHAT_ID);
    formData.append("photo", fileObject.buffer, { filename: fileObject.originalname, contentType: fileObject.mimetype });
    if (caption) formData.append("caption", caption);
    const telegramRes = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, formData, { headers: formData.getHeaders() });
    if (!telegramRes.data.ok) throw new Error(JSON.stringify(telegramRes.data));
    const fileId = telegramRes.data.result.photo.pop().file_id;
    const photo = await prisma.photo.create({ data: { userId: user_id, driveId: fileId, caption, link: `https://t.me/PhotoUploader2026_bot?start=${fileId}` } });
    await prisma.user.update({ where: { id: user_id }, data: { limit: { decrement: 1 }, photoCount: { increment: 1 } } });
    return ApiSuccess(res, { photo });
  } catch (err) { console.error(err); return ApiError(res, "Failed to upload photo", HTTP_500_INTERNAL_SERVER_ERROR); }
});

app.get("/api/photos", async (req, res) => {
  try {
    await ensureDb(); const photos = await prisma.photo.findMany({ orderBy: { createdAt: "desc" } });
    return ApiSuccess(res, { photos });
  } catch (err) { console.error(err); return ApiError(res, err.message, HTTP_500_INTERNAL_SERVER_ERROR); }
});

app.get("/api/photos/proxy/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    const fileRes = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    if (!fileRes.data.ok) return ApiError(res, "Invalid Telegram file ID", HTTP_400_BAD_REQUEST);
    const filePath = fileRes.data.result.file_path;
    const telegramFileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
    const response = await axios.get(telegramFileUrl, { responseType: "stream" });
    res.setHeader("Content-Type", response.headers["content-type"]);
    response.data.pipe(res);
  } catch (err) { console.error(err); return ApiError(res, "Failed to fetch photo", HTTP_500_INTERNAL_SERVER_ERROR); }
});

// --- 404 ---
app.all("/*splat", (req, res) => ApiError(res, "Route not found", HTTP_404_NOT_FOUND));

// --- Export ---
module.exports = app;
