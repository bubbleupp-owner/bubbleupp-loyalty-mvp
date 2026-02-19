
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, db, seedIfNeeded } from './db.js';
import { createBot } from './bot.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

await initDb();
await seedIfNeeded();

// Serve static app
app.use('/app', express.static(path.join(__dirname)));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Helpers ---
function getTelegramIdFromRequest(req) {
  return req.query.telegram_id || req.headers['x-telegram-id'];
}

// Example endpoint
app.get('/api/profile', (req, res) => {
  const telegramId = getTelegramIdFromRequest(req);
  if (!telegramId) {
    return res.status(400).json({ error: 'telegram_id required' });
  }

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user);
});

// Create Telegram bot
createBot();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
