const TelegramBot = require("node-telegram-bot-api");
const { BakongKHQR, khqrData } = require("bakong-khqr");
const QRCode = require("qrcode");
const { createCanvas, loadImage } = require("canvas");
const { getTikTokData } = require("./downloader");
const User = require("./models/User");
require("dotenv").config();

// --- 🔧 CONFIGURATION ---
const BAKONG_ACCOUNT = process.env.BAKONG_ACCOUNT_ID;
const MERCHANT_NAME = process.env.MERCHANT_NAME || "Lorn David";
const PAYWAY_LINK = "https://link.payway.com.kh/ABAPAYFB405176Y";

// Global State
const state = {
  stats: { downloads: 0, total_users: 0 },
  userList: [],
};

// --- 🛠️ HELPER: ESCAPE MARKDOWN ---
const escapeMarkdown = (text) =>
  text ? text.replace(/[_*[\]()~>#+=|{}.!-]/g, "\\$&") : "";

// --- 🎨 HELPER: DRAW THE KHQR CARD ---
async function generateKHQRCard(qrText, name, currencyType) {
  const width = 600;
  const height = 900;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // White Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Red Header
  ctx.fillStyle = "#EE282D";
  ctx.fillRect(0, 0, width, 160);

  // Header Text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 80px Arial";
  ctx.textAlign = "center";
  ctx.fillText("KHQR", width / 2, 110);

  // QR Code
  const qrBuffer = await QRCode.toBuffer(qrText, {
    width: 450,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
  const qrImage = await loadImage(qrBuffer);
  ctx.drawImage(qrImage, (width - 450) / 2, 220, 450, 450);

  // Text Info
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.font = "bold 35px Arial";
  ctx.fillText(name, width / 2, 730);

  ctx.font = "30px Arial";
  ctx.fillStyle = "#555555";
  const currencyLabel =
    currencyType === khqrData.currency.usd
      ? "USD ($) Account"
      : "KHR (៛) Account";
  ctx.fillText(currencyLabel, width / 2, 780);

  // Footer
  ctx.fillStyle = "#EE282D";
  ctx.font = "bold 25px Arial";
  ctx.fillText("Powered by Bakong", width / 2, 850);

  return canvas.toBuffer();
}

// --- 🤖 MAIN SETUP FUNCTION ---
const setupBot = (token, domain, createTempLink, io) => {
  let bot;
  const bakong = new BakongKHQR();

  // 🌍 SMART HOSTING DETECTION (Render vs Localhost)
  // If a DOMAIN is provided (from server.js), use Webhook. If not, use Polling.
  if (domain && !domain.includes("localhost")) {
    console.log(`🌍 CLOUD MODE: Setting Webhook to ${domain}/bot${token}`);
    bot = new TelegramBot(token); // No polling
    bot.setWebHook(`${domain}/bot${token}`, {
      allowed_updates: ["message", "callback_query"],
    });
  } else {
    console.log("💻 LOCAL MODE: Starting Polling...");
    bot = new TelegramBot(token, { polling: true });
    // Clear old webhooks just in case
    bot.deleteWebHook().catch(() => {});
  }

  // Log Errors
  bot.on("polling_error", (error) =>
    console.log("🚨 Polling Error:", error.message)
  );
  bot.on("webhook_error", (error) =>
    console.log("🚨 Webhook Error:", error.message)
  );

  // --- MENUS ---
  const mainMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "💸 Donate", callback_data: "menu_donate_select" },
          { text: "📞 Contact Me", url: "https://t.me/LornDavid" },
        ],
      ],
    },
  };

  const currencyMenu = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🇺🇸 USD ($)", callback_data: "donate_final_usd" },
          { text: "🇰🇭 KHR (៛)", callback_data: "donate_final_khr" },
        ],
        [{ text: "🔙 Back", callback_data: "cmd_start" }],
      ],
    },
  };

  // ==========================================
  // 🔘 BUTTON HANDLER
  // ==========================================
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const action = query.data;

    // A. HANDLE START / BACK
    if (action === "cmd_start") {
      const welcomeMsg = `
🌟 **Welcome to TikTok Pro!**

🚀 **Fastest No-Watermark Downloader**
👇 **Just paste a link to start!**
        `;
      try {
        await bot.editMessageText(welcomeMsg, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          ...mainMenu,
        });
      } catch (e) {
        await bot.sendMessage(chatId, welcomeMsg, {
          parse_mode: "Markdown",
          ...mainMenu,
        });
      }
    }

    // B. HANDLE DONATE SELECT
    if (action === "menu_donate_select") {
      await bot.editMessageText("💖 **Select Currency:**", {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        ...currencyMenu,
      });
    }

    // C. HANDLE FINAL DONATE (Card)
    if (action === "donate_final_usd" || action === "donate_final_khr") {
      bot.sendChatAction(chatId, "upload_photo");
      try {
        const isUSD = action === "donate_final_usd";
        const currency = isUSD ? khqrData.currency.usd : khqrData.currency.khr;

        const txnId = `INV-${Date.now().toString().slice(-6)}`;

        const individualInfo = {
          bakongAccountID: BAKONG_ACCOUNT,
          merchantName: MERCHANT_NAME,
          merchantCity: "Phnom Penh",
          acquiringBank: "Bakong",
          currency: currency,
          billNumber: txnId,
        };

        const khqrResponse = bakong.generateIndividual(individualInfo);
        if (khqrResponse.status.code !== 0) throw new Error("KHQR Error");

        const cardBuffer = await generateKHQRCard(
          khqrResponse.data.qr,
          MERCHANT_NAME,
          currency
        );

        const caption = `
💸 **Donate via ${isUSD ? "USD" : "KHR"}**

1. Scan with **ABA / Bakong**.
2. Enter amount.
3. Confirm.

🔗 [PayWay Link](${PAYWAY_LINK})
        `;

        await bot.sendPhoto(chatId, cardBuffer, {
          caption: caption,
          parse_mode: "Markdown",
        });
      } catch (e) {
        bot.sendMessage(chatId, "❌ Error generating QR.");
      }
    }

    bot.answerCallbackQuery(query.id);
  });

  // ==========================================
  // 📩 MESSAGE HANDLER (TikTok)
  // ==========================================
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    // 1. /start command
    if (text === "/start") {
      const welcomeMsg = `
🌟 **Welcome to TikTok Pro!**

🚀 **Fastest No-Watermark Downloader**
👇 **Just paste a link to start!**
      `;
      await bot.sendMessage(chatId, welcomeMsg, {
        parse_mode: "Markdown",
        ...mainMenu,
      });
      return;
    }

    // 2. TikTok Link Logic
    if (text.includes("tiktok.com")) {
      // Send initial status message
      const statusMsg = await bot.sendMessage(
        chatId,
        "⏳ **Checking Link...**",
        { parse_mode: "Markdown" }
      );

      try {
        const data = await getTikTokData(text);

        if (data.status === "success") {
          // Quick Animation
          await bot.editMessageText("📥 **Downloading...**", {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "Markdown",
          });

          bot.sendChatAction(chatId, "upload_video");

          await bot.editMessageText("🚀 **Sending Video...**", {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "Markdown",
          });

          // ✅ THE FIX: Removed parse_mode: "Markdown" to prevent crash
          // And added a clean caption
          await bot.sendVideo(chatId, data.videoUrl, {
            caption: `✨ Downloaded by @nodevid_bot`,
          });

          // Delete the status message
          bot.deleteMessage(chatId, statusMsg.message_id);

          // Stats
          state.stats.downloads++;
          await User.updateOne(
            { telegramId: chatId },
            { $inc: { downloads: 1 } },
            { upsert: true }
          );
        } else {
          bot.editMessageText("❌ **Download Failed.**", {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
        }
      } catch (err) {
        console.error(err);
        bot.editMessageText("❌ **Error.**", {
          chat_id: chatId,
          message_id: statusMsg.message_id,
        });
      }
    }
  });

  return bot;
};

module.exports = { setupBot, state };
