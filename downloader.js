const axios = require("axios");
const https = require("https");

// 🕵️‍♂️ ANTI-BLOCK: User-Agent Rotator
// We pretend to be different browsers to avoid being blocked by TikTok
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
];

const getRandomAgent = () =>
  USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// 🚀 HIGH PERFORMANCE NETWORK AGENT
// Modified for "Many Users": maxSockets set to Infinity to prevent queuing
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Infinity, // ⚡ Allow unlimited concurrent connections
  maxFreeSockets: 50,
  timeout: 60000,
});

const client = axios.create({
  httpsAgent,
  timeout: 15000, // 15s timeout to fail fast and retry
});

// ⏳ HELPER: Wait function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Gets video metadata and selects the best quality that fits in Telegram (50MB).
 * Optimized to skip HEAD requests if API provides size data.
 */
async function getTikTokData(url) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      attempts++;
      // TikWM API (HD Support)
      const apiUrl = `https://tikwm.com/api/?url=${url}&hd=1`;

      console.log(`[Attempt ${attempts}] Fetching Metadata...`);

      const response = await client.get(apiUrl, {
        headers: { "User-Agent": getRandomAgent() },
      });

      // ✅ SUCCESS
      if (response.data.code === 0) {
        const data = response.data.data;

        // 1. Extract Info
        const cover = data.cover;
        const author = data.author ? data.author.nickname : "TikTok User";
        const title = data.title || "No Title";

        // 2. SMART QUALITY SELECTOR (Speed Optimized)
        // We prefer HD, but we must check if it fits Telegram's 50MB limit.

        let videoUrl = data.hdplay || data.play;
        let sizeBytes = data.hdsize || data.size || 0; // Try to get size from API directly (Fastest)

        // If API didn't give size, THEN we do the slow HEAD request
        if (sizeBytes === 0) {
          try {
            const head = await client.head(videoUrl);
            sizeBytes = parseInt(head.headers["content-length"], 10);
          } catch (e) {
            console.log("⚠️ Metadata size check failed, assuming standard.");
          }
        }

        let sizeMB = parseFloat((sizeBytes / (1024 * 1024)).toFixed(2));
        console.log(`🔍 Video Size: ${sizeMB} MB`);

        // 3. AUTO-DOWNGRADE LOGIC
        // Telegram Bot API Limit is ~50MB.
        if (sizeMB > 48) {
          console.log("⚠️ HD too big (>48MB). Switching to SD.");
          videoUrl = data.play; // Switch to SD

          // Update size info for SD if available
          if (data.size) {
            sizeMB = parseFloat((data.size / (1024 * 1024)).toFixed(2));
          }
        }

        return {
          status: "success",
          videoUrl: videoUrl,
          cover: cover,
          author: author,
          title: title,
          sizeMB: sizeMB,
        };
      }

      // ⚠️ API Busy logic
      console.log(`⚠️ API Retry... (${attempts}/${maxAttempts})`);
      await sleep(1000);
    } catch (error) {
      console.error(`❌ Network Error (${attempts}): ${error.message}`);
      if (error.response && error.response.status === 404) break;
      await sleep(1000);
    }
  }

  return {
    status: "error",
    message: "Video not found or API busy. Please try again.",
  };
}

module.exports = { getTikTokData, client };
