// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  firstName: String,
  username: String,
  joinedAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  downloads: { type: Number, default: 0 },
});

module.exports = mongoose.model("User", userSchema);
