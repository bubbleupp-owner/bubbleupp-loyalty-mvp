import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb, db } from './db.js';
import { createBot } from './bot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Init DB (no seeding on every boot to avoid SQLITE_CONSTRAINT on redeploy)
await initDb();

// Static Mini App files (index.html, styles.css, etc.) live in repo root
app.use('/app', express.static(path.join(__dirname)));

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// Example: profile endpoint used by Mini App
app.get('/api/profile', (req, res) => {
  const telegramId = req.query.telegram_id || req.headers['x-telegram-id'];
  if (!telegramId) return res.status(400).json({ error: 'telegram_id required' });

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json(user);
});

// Start bot (polling)
createBot();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
