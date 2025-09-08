// backend/config/server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");

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

// --- Static pages (adjust paths for Vercel) ---
const publicDir = path.join(process.cwd(), "public");
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "stage.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/camera", (req, res) => res.sendFile(path.join(publicDir, "camera.html")));
app.get("/login", (req, res) => res.sendFile(path.join(publicDir, "login.html")));
app.get("/qr", (req, res) => res.sendFile(path.join(publicDir, "qr.html")));

// --- Simple API test ---
app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello from Vercel Express!" });
});

// --- Export Express app for Vercel ---
module.exports = app;
