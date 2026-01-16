// server.js
// 🚀 1. HIGH PERFORMANCE THREADING
process.env.UV_THREADPOOL_SIZE = 128;

require("dotenv").config();
const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const path = require("path");
const compression = require("compression");
const { v4: uuidv4 } = require("uuid");
const { setupBot, state } = require("./bot");
const { client } = require("./downloader");
const User = require("./models/User");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 2. OPTIMIZED MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI;
mongoose
  .connect(MONGO_URI, {
    maxPoolSize: 100,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
  .then(() => console.log("✅ MongoDB Connected (High Performance Mode)"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// --- 3. SERVER TUNING ---
server.keepAliveTimeout = 120 * 1000;
server.headersTimeout = 120 * 1000;

// --- 4. MIDDLEWARE ---
app.use(compression());
app.use(bodyParser.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));

const TOKEN = process.env.TELEGRAM_TOKEN;
const DOMAIN =
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${process.env.PORT || 3000}`;
const PORT = process.env.PORT || 3000;

// Temporary Link Store
const tempDownloads = new Map();

const createTempLink = (videoUrl) => {
  const id = uuidv4();
  tempDownloads.set(id, videoUrl);
  setTimeout(() => tempDownloads.delete(id), 10 * 60 * 1000);
  return `${DOMAIN}/stream/${id}`;
};

// Initialize Bot
const bot = setupBot(TOKEN, DOMAIN, createTempLink, io);

// --- ROUTES ---

// 📊 DASHBOARD (Fixed: Now includes chartData)
app.get("/", async (req, res) => {
  try {
    // 1. Run all DB queries in parallel for speed
    const [totalUsers, totalDownloadsAgg, recentDbUsers, chartRaw] =
      await Promise.all([
        // Count total users
        User.countDocuments(),
        // Sum total downloads
        User.aggregate([
          { $group: { _id: null, total: { $sum: "$downloads" } } },
        ]),
        // Get recent 10 users
        User.find().sort({ lastActive: -1 }).limit(10).lean(),
        // 📊 CHART DATA: Users joined in last 7 days
        User.aggregate([
          {
            $match: {
              joinedAt: {
                $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$joinedAt" } },
              count: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),
      ]);

    const totalDownloads =
      totalDownloadsAgg.length > 0 ? totalDownloadsAgg[0].total : 0;

    // 2. Format Chart Data for EJS
    const chartLabels = chartRaw.map((d) => d._id); // Dates
    const chartValues = chartRaw.map((d) => d.count); // Counts

    res.render("dashboard", {
      stats: {
        downloads: totalDownloads,
        total_users: totalUsers,
        active_now: state.userList.length,
      },
      // 👇 THIS WAS MISSING
      chartData: {
        labels: chartLabels,
        values: chartValues,
      },
      users: state.userList,
      dbUsers: recentDbUsers,
      uptime: process.uptime(),
    });
  } catch (e) {
    console.error("Dashboard Error:", e);
    // If DB fails, render page with empty data so it doesn't crash
    res.render("dashboard", {
      stats: { downloads: 0, total_users: 0, active_now: 0 },
      chartData: { labels: [], values: [] },
      users: [],
      dbUsers: [],
      uptime: process.uptime(),
    });
  }
});

// 🤖 WEBHOOK ROUTE
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// 🎬 STREAMING PROXY
app.get("/stream/:id", async (req, res) => {
  const id = req.params.id;
  const videoUrl = tempDownloads.get(id);

  if (!videoUrl) return res.status(404).send("Link Expired");

  try {
    const response = await client({
      method: "GET",
      url: videoUrl,
      responseType: "stream",
      headers: {
        Range: req.headers.range || "bytes=0-",
        "User-Agent": "TikTok-Downloader-Bot",
      },
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="tiktok_${id}.mp4"`
    );
    res.setHeader("Content-Type", "video/mp4");
    if (response.headers["content-length"]) {
      res.setHeader("Content-Length", response.headers["content-length"]);
    }

    response.data.pipe(res);

    req.on("close", () => {
      if (response.data) response.data.destroy();
    });
  } catch (error) {
    console.error("Stream Error:", error.message);
    if (!res.headersSent) res.status(500).send("Error streaming video.");
  }
});

// --- 📡 SOCKET.IO ---
io.on("connection", (socket) => {
  socket.emit("update_stats", state);
});

// --- CRASH PROTECTION ---
process.on("uncaughtException", (err) => console.error("🚨 Uncaught:", err));
process.on("unhandledRejection", (reason) =>
  console.error("🚨 Rejection:", reason)
);

// --- START SERVER ---
server.listen(PORT, () => {
  console.log(`
  =========================================
  🚀 TIKTOK BOT SERVER STARTED (FIXED)
  =========================================
  🌍 URL:      ${DOMAIN}
  🔌 Port:     ${PORT}
  💾 Database: Connected
  =========================================
  `);
});
