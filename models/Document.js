const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DocumentSchema = new Schema({
  filename: String,
  storedName: String,
  url: String,
  text: String,
  uploadedAt: Date
});

module.exports = mongoose.model('Document', DocumentSchema);
