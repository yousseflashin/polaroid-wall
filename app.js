require("dotenv").config();
const app = require("./backend/config/server");

// Vercel expects a default export
module.exports = app;