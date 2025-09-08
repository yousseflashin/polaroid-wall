// backend/config/server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

const connectDatabase = require("/backend/config/db");
// const logger = require("./logger");
// const { ApiError } = require("../utils/apiResponse");
// const { registerOrLogin, verifyOtp, userInfo } = require("../routes/auth.controller");
// const {
//   upload,
//   uploadPhotoController,
//   getAllPhotos,
//   proxyTelegramPhoto,
// } = require("../routes/photo.controller");
// // const { specs, swaggerUi } = require("./swagger");
// const isAuthenticated = require("../middlewares/isAuthenticated");

const app = express();

// --- Middleware ---
app.use(cors());
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Static assets ---
const publicDir = path.join(process.cwd(), "public");
app.use("/public", express.static(publicDir)); // ✅ serve CSS/JS

// --- Static pages ---
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "stage.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/camera", (req, res) => res.sendFile(path.join(publicDir, "camera.html")));
app.get("/login", (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/qr", (req, res) => res.sendFile(path.join(publicDir, "qr.html")));

// --- Swagger docs ---
// app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// --- API routes ---
// app.use("/api/auth", registerOrLogin);
// app.use("/api/verify", verifyOtp);
// app.use("/api/user", isAuthenticated, userInfo);

// app.post("/api/upload", isAuthenticated, upload.single("file"), uploadPhotoController);

// app.get("/api/photos", async (req, res) => {
//   try {
//     const photos = await getAllPhotos();
//     res.json({ success: true, photos });
//   } catch (err) {
//     logger.error("Photos error: " + err.message);
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// app.get("/api/photos/proxy/:id", proxyTelegramPhoto);

// --- 404 handler ---
// app.all("/*splat", (req, res) => ApiError(res, "Route not found", 404));

// --- Connect database immediately on import (synchronous init) ---
connectDatabase()
  .then(() => logger.info("✅ Database connected"))
  .catch((err) => logger.error("❌ DB connection failed: " + err.message));

// --- Export Express app for Vercel ---
module.exports = app;
