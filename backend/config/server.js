// api/index.js (serverless function)
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDatabase = require("../../api/db");
const logger = require("../../api/logger");
const { ApiError } = require("../../utils/apiResponse");
const { registerOrLogin, verifyOtp, userInfo } = require("../../routes/auth.controller");
const { upload, uploadPhotoController, getAllPhotos, proxyTelegramPhoto } = require("../../routes/photo.controller");
const isAuthenticated = require('../../middlewares/isAuthenticated');
const { specs, swaggerUi } = require("../../api/swagger");

const app = express();

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth routes
app.use("/api/auth", registerOrLogin);
app.use("/api/verify", verifyOtp);
app.use("/api/user", isAuthenticated, userInfo);

// Photo upload route
app.post("/api/upload", isAuthenticated, upload.single("file"), uploadPhotoController);

// Get all photos (HTTP)
app.get("/api/photos", async (req, res) => {
  const photos = await getAllPhotos();
  res.json({ success: true, photos });
});

// Proxy Telegram photo
app.get("/api/photos/proxy/:id", proxyTelegramPhoto);

// Swagger docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(specs));

// 404 handler
app.all("/*", (req, res) => ApiError(res, "Route not found", 404));

// Connect DB (once per cold start)
connectDatabase();

module.exports = app;
