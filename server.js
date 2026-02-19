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

app.use('/app', express.static(path.join(__dirname)));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// --- Helpers ---
function getTelegramIdFromRequest(req) {
  const q = req.query.telegram_id;
  const h = req.headers['x-telegram-id'];
  return q || h || null;
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

createBot();
