// backend/config/index.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDatabase = require("./db");
const logger = require("./logger");
const { ApiError } = require("../utils/apiResponse");
const { registerOrLogin, verifyOtp, userInfo } = require("../routes/auth.controller");
const {
  upload,
  uploadPhotoController,
  getAllPhotos,
  proxyTelegramPhoto,
} = require("../routes/photo.controller");
const { specs, swaggerUi } = require("./swagger");
const isAuthenticated = require('../middlewares/isAuthenticated');
const path = require("path");

const app = express();

// Middleware
const corsOptions = {
  origin: (origin, cb) => cb(null, true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));
app.options('/*splat', cors(corsOptions));
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes for different views (public is auto-served by Vercel, but we keep them for direct mapping)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/stage.html"));
});
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/admin.html"));
});
app.get("/camera", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/camera.html"));
});
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/login.html"));
});
app.get("/qr", (req, res) => {
  res.sendFile(path.join(__dirname, "../../public/qr.html"));
});

// Swagger docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// Auth routes
app.use("/api/auth", registerOrLogin);
app.use("/api/verify", verifyOtp);
app.use("/api/user", isAuthenticated, userInfo);

// Photo upload
app.post("/api/upload", isAuthenticated, upload.single("file"), uploadPhotoController);

// Get all photos
app.get("/api/photos", async (req, res) => {
  try {
    const photos = await getAllPhotos();
    res.json({ success: true, photos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Proxy Telegram photo
app.get("/api/photos/proxy/:id", proxyTelegramPhoto);

// 404
app.all("/*splat", (req, res) => ApiError(res, "Route not found", 404));

// Export for Vercel
async function createServer() {
  if (!global.dbConnected) {
    await connectDatabase();
    global.dbConnected = true;
    logger.info("Database connected.");
  }
  return app;
}

// Export a handler for Vercel
module.exports = async (req, res) => {
  try {
    const server = await createServer();
    return server(req, res);
  } catch (err) {
    logger.error("Handler error: " + err.message);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};
