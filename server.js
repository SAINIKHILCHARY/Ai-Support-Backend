// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const mammoth = require('mammoth');

const Document = require('./models/Document');
const Chat = require('./models/Chat');

const app = express();
app.use(cors());
app.use(express.json());

// config
const PORT = process.env.PORT || 4000;
const MONGO = process.env.MONGO_URI || 'mongodb://localhost:27017/chat';
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// ensure uploads folder exists and serve static
async function ensureUploads() {
  try { await fs.mkdir(UPLOADS_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}
ensureUploads();
app.use('/uploads', express.static(UPLOADS_DIR));

// multer setup
const upload = multer({ dest: UPLOADS_DIR });

// connect to MongoDB
mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Mongo connected'))
  .catch(err => {
    console.error('Mongo connection error', err);
  });

// --- Helper: Extract Text from File ---
async function extractTextFromFile(filepath, originalname) {
  const ext = path.extname(originalname).toLowerCase();
  try {
    if (ext === '.pdf') {
      const dataBuffer = await fs.readFile(filepath);
      const data = await pdf(dataBuffer);
      return data.text;
    } else if (ext === '.docx') {
      const dataBuffer = await fs.readFile(filepath);
      const result = await mammoth.extractRawText({ buffer: dataBuffer });
      return result.value;
    } else if (['.txt', '.md', '.json', '.html', '.js', '.css'].includes(ext)) {
      return await fs.readFile(filepath, 'utf8');
    }
  } catch (e) {
    console.error(`Failed to extract text from ${originalname}:`, e);
  }
  return '';
}

// --- Create demo document entry (if not exists) ---
const DEMO_FILE_LOCAL_PATH = '/mnt/data/a996c08e-1a3d-4c6d-bc0e-af5dfad5a19e.png';
const DEMO_DOC_FILENAME = path.basename(DEMO_FILE_LOCAL_PATH);

async function ensureDemoDocument() {
  try {
    const existing = await Document.findOne({ filename: DEMO_DOC_FILENAME }).exec();
    if (!existing) {
      const doc = new Document({
        filename: DEMO_DOC_FILENAME,
        storedName: DEMO_DOC_FILENAME,
        url: DEMO_FILE_LOCAL_PATH,
        text: '',
        uploadedAt: new Date()
      });
      await doc.save();
      console.log('Demo document created:', DEMO_DOC_FILENAME);
    }
  } catch (e) {
    console.error('Failed to ensure demo document', e);
  }
}

setTimeout(ensureDemoDocument, 1500);

// ----------------- Admin upload -----------------
app.post('/api/admin/upload', upload.single('file'), async (req, res) => {
  try {
    const adminKey = req.headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'forbidden' });

    if (!req.file) return res.status(400).json({ error: 'no file provided' });
    const { originalname, filename, path: filepath } = req.file;

    const text = await extractTextFromFile(filepath, originalname);

    const doc = new Document({
      filename: originalname,
      storedName: filename,
      url: `/uploads/${filename}`,
      text,
      uploadedAt: new Date()
    });
    await doc.save();
    return res.json({ ok: true, doc });
  } catch (err) {
    console.error('upload error', err);
    return res.status(500).json({ error: 'upload failed' });
  }
});

// ----------------- List documents -----------------
app.get('/api/admin/docs', async (req, res) => {
  try {
    const docs = await Document.find().sort({ uploadedAt: -1 }).limit(50);
    res.json({ ok: true, docs });
  } catch (err) {
    console.error('docs list error', err);
    res.status(500).json({ error: 'failed' });
  }
});

// ----------------- Chat history -----------------
app.get('/api/history/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const chats = await Chat.find({ sessionId }).sort({ createdAt: 1 }).limit(200);
    res.json({ ok: true, chats });
  } catch (err) {
    console.error('history error', err);
    res.status(500).json({ error: 'history failed' });
  }
});

// ----------------- Chat endpoint (Gemini + File Upload) -----------------
app.post('/api/chat', upload.single('file'), async (req, res) => {
  let chatEntry = null;
  let scored = [];
  try {
    const { message, sessionId } = req.body;
    // Message might be empty if only sending a file, but usually we want some text.
    // If message is missing but file exists, treat as "Analyze this file".
    const userMessage = message || (req.file ? `[Attached File: ${req.file.originalname}]` : '');

    if (!userMessage && !req.file) return res.status(400).json({ error: 'message or file required' });

    // RAG: Find relevant docs (only if there is text to search)
    if (userMessage) {
      const docs = await Document.find().limit(50).exec();
      scored = docs.map(d => {
        const count = (d.text || '').toLowerCase().split(userMessage.toLowerCase()).length - 1;
        return { doc: d, score: count };
      }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    }

    // Build context
    let systemContext = 'You are a helpful customer support AI. Use the following company documents to answer the user request if relevant. If the answer is not in the documents, answer generally but politely.\n\n';
    scored.forEach((s, i) => {
      systemContext += `Document ${i + 1} (${s.doc.filename}):\n${(s.doc.text || '').slice(0, 1000)}\n\n`;
    });

    // Save user message
    chatEntry = new Chat({ sessionId: sessionId || null, userMessage: userMessage, createdAt: new Date() });
    await chatEntry.save();

    // Call Gemini
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    let promptParts = [systemContext, `User Query: ${userMessage}`];

    // Handle File Attachment
    if (req.file) {
      const mimeType = req.file.mimetype;
      const filePath = req.file.path;

      if (mimeType.startsWith('image/')) {
        // Send image data to Gemini
        const fileData = await fs.readFile(filePath);
        const imagePart = {
          inlineData: {
            data: fileData.toString('base64'),
            mimeType: mimeType
          }
        };
        promptParts.push(imagePart);
      } else {
        // Extract text for PDF/DOCX/TXT
        const extractedText = await extractTextFromFile(filePath, req.file.originalname);
        if (extractedText) {
          promptParts.push(`\n\n[Attached Document Content]:\n${extractedText}\n`);
        } else {
          promptParts.push(`\n\n[Attached File: ${req.file.originalname} (Could not extract text)]`);
        }
      }
    }

    const result = await model.generateContent(promptParts);
    const response = await result.response;
    const assistantText = response.text();

    // Save bot message
    chatEntry.assistantMessage = assistantText;
    await chatEntry.save();

    res.json({ ok: true, reply: assistantText, docs: scored.map(s => ({ filename: s.doc.filename, url: s.doc.url })) });

  } catch (err) {
    console.error('chat error', err);

    // Fallback
    const fallback = "I'm sorry, I'm having trouble connecting to the AI service right now. Please try again later.";
    if (chatEntry) {
      chatEntry.assistantMessage = fallback;
      await chatEntry.save();
    }
    res.status(500).json({ error: 'chat_failed', reply: fallback });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
