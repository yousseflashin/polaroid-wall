// ================= SERVER.JS FOR VERCEL =================
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

// --- Prisma Client ---
const { PrismaClient } = require("@prisma/client");
let prisma;
if (!global.prisma) {
  prisma = new PrismaClient();
  global.prisma = prisma;
} else {
  prisma = global.prisma;
}

// --- Email ---
const userEmail = process.env.userEmail;
const userPassword = process.env.userPassword;
const transporter = nodemailer.createTransport({
  service: "gmail",
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: { user: userEmail, pass: userPassword },
  tls: { rejectUnauthorized: false },
});
async function sendEmail(to, subject, text, html = null) {
  try {
    const mailOptions = {
      from: `"NASA Space Apps Cairo" <${userEmail}>`,
      to,
      subject,
      text,
      html,
    };
    return await transporter.sendMail(mailOptions);
  } catch (error) {
    throw new Error("Failed to send email: " + error.message);
  }
}

// --- Status Codes ---
const HTTP_200_SUCCESS = 200;
const HTTP_400_BAD_REQUEST = 400;
const HTTP_201_CREATED = 201;
const HTTP_500_INTERNAL_SERVER_ERROR = 500;
const HTTP_401_UNAUTHORIZED = 401;
const HTTP_404_NOT_FOUND = 404;
const HTTP_403_FORBIDDEN = 403;

// --- API Response ---
const ApiSuccess = (res, data = {}, message = "OK", statusCode = HTTP_200_SUCCESS) => {
  const jsonObj = { status: "OK", message };
  if (data != {}) jsonObj["data"] = data;
  return res.status(statusCode).json(jsonObj);
};
const ApiError = (res, message, statusCode) => {
  return res.status(statusCode).json({
    status: `${statusCode}`.startsWith(4) ? "FAIL" : "ERROR",
    message,
    statusCode,
  });
};

// --- Auth Payload ---
async function getAuthPayload(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    limit: user.limit,
    photoCount: user.photoCount,
  };
}

// --- Generate OTP ---
function generateOTP() {
  return crypto.randomInt(100000, 999999).toString();
}

// --- Generate Token ---
const generateToken = async (user, secret, period = "1d") => {
  const payload = await getAuthPayload(user);
  return jwt.sign(payload, secret, { expiresIn: period });
};

// --- Verify Token ---
const verifyToken = async (token, secret) => {
  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
};

// --- Auth Middleware ---
const isAuthenticated = async (req, res, next) => {
  try {
    if (!req.headers.authorization) return ApiError(res, "Unauthorized: token is not provided", HTTP_401_UNAUTHORIZED);
    const token = req.headers.authorization.split(" ")[1];
    if (!process.env.JWT_SECRET) return ApiError(res, "Server configuration error", 500);
    const payload = await verifyToken(token, process.env.JWT_SECRET);
    if (!payload) return ApiError(res, "Unauthorized: token is invalid", HTTP_401_UNAUTHORIZED);
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return ApiError(res, "Unauthorized: user does not exist", HTTP_401_UNAUTHORIZED);
    if (!user.is_active) return ApiError(res, "Unauthorized: user is not active", HTTP_401_UNAUTHORIZED);
    req.user = user;
    next();
  } catch {
    return ApiError(res, "Authentication error", 500);
  }
};

// --- Multer for Uploads ---
const upload = multer({ storage: multer.memoryStorage() });

// --- Telegram Bot API ---
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- Express App ---
const app = express();
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static pages ---
const publicDir = path.join(process.cwd(), "public");
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "stage.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/camera", (req, res) => res.sendFile(path.join(publicDir, "camera.html")));
app.get("/login", (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/qr", (req, res) => res.sendFile(path.join(publicDir, "qr.html")));

// --- Auth/Register/Login ---
const OTP_EXPIRATION_MINUTES = 5;

app.post("/api/auth", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return ApiError(res, "Email is required", HTTP_400_BAD_REQUEST);

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) user = await prisma.user.create({ data: { email } });

    const otpCode = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRATION_MINUTES * 60000);
    const userOTP = await prisma.oTP.findUnique({ where: { email } });
    if (userOTP) {
      await prisma.oTP.update({ where: { email }, data: { otp: otpCode, expiresAt } });
    } else {
      await prisma.oTP.create({ data: { email, otp: otpCode, expiresAt } });
    }

    await sendEmail(email, "Your OTP Code", `Your OTP code is: ${otpCode}. It is valid for ${OTP_EXPIRATION_MINUTES} minutes.`);
    return ApiSuccess(res, `OTP sent to ${email}. Valid for ${OTP_EXPIRATION_MINUTES} minutes.`);
  } catch (err) {
    return ApiError(res, "Something went wrong", HTTP_500_INTERNAL_SERVER_ERROR);
  }
});

app.post("/api/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return ApiError(res, "Email and OTP required", HTTP_400_BAD_REQUEST);

    const otpRecord = await prisma.oTP.findFirst({
      where: { email, otp },
      orderBy: { createdAt: "desc" },
    });

    if (!otpRecord || otpRecord.expiresAt < new Date()) return ApiError(res, "Invalid or expired OTP", HTTP_400_BAD_REQUEST);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return ApiError(res, "User not found", HTTP_400_BAD_REQUEST);

    const token = await generateToken({ id: user.id, role: user.role }, process.env.JWT_SECRET, "1d");

    return ApiSuccess(res, { message: "Login successful", token, user: { id: user.id, email: user.email, role: user.role, limit: user.limit, photoCount: user.photoCount } });
  } catch {
    return ApiError(res, "Something went wrong", HTTP_500_INTERNAL_SERVER_ERROR);
  }
});

app.get("/api/user", isAuthenticated, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return ApiError(res, "User not found", HTTP_400_BAD_REQUEST);
  return ApiSuccess(res, { user: { id: user.id, email: user.email, role: user.role, limit: user.limit, photoCount: user.photoCount } });
});

// --- Photo Upload ---
app.post("/api/upload", isAuthenticated, upload.single("file"), async (req, res) => {
  try {
    const { id: user_id } = req.user;
    const caption = req.body.caption || "";
    const fileObject = req.file;
    if (!fileObject) return res.status(400).json({ error: "No file uploaded" });

    const formData = new FormData();
    formData.append("chat_id", TELEGRAM_CHAT_ID);
    formData.append("photo", fileObject.buffer, { filename: fileObject.originalname, contentType: fileObject.mimetype });
    if (caption) formData.append("caption", caption);

    const telegramRes = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, formData, { headers: formData.getHeaders() });
    if (!telegramRes.data.ok) throw new Error("Telegram API error: " + JSON.stringify(telegramRes.data));

    const fileId = telegramRes.data.result.photo.pop().file_id;
    const photo = await prisma.photo.create({ data: { userId: user_id, driveId: fileId, caption, link: `https://t.me/PhotoUploader2026_bot?start=${fileId}` } });

    await prisma.user.update({ where: { id: user_id }, data: { limit: { decrement: 1 }, photoCount: { increment: 1 } } });

    res.json({ success: true, photo });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload photo", details: err.message });
  }
});

// --- Get All Photos ---
app.get("/api/photos", async (req, res) => {
  try {
    const photos = await prisma.photo.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, photos: photos.map(p => ({ id: p.id, driveId: p.driveId, userId: p.userId, caption: p.caption || "" })) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// --- Proxy Telegram Photo ---
app.get("/api/photos/proxy/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    const fileRes = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    if (!fileRes.data.ok) return res.status(400).json({ error: "Invalid Telegram file ID" });

    const filePath = fileRes.data.result.file_path;
    const telegramFileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
    const response = await axios.get(telegramFileUrl, { responseType: "stream" });
    res.setHeader("Content-Type", response.headers["content-type"]);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch photo" });
  }
});

// --- 404 handler ---
app.all("/*splat", (req, res) => ApiError(res, "Route not found", 404));

module.exports = app;
