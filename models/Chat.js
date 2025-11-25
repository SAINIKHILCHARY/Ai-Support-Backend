// models/Chat.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ChatSchema = new Schema({
  sessionId: { type: String, default: null },
  userMessage: { type: String, required: true },
  assistantMessage: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
}, { collection: 'message' }); // use exact collection name "message"

module.exports = mongoose.model('Chat', ChatSchema);
