import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, db, seedIfNeeded } from './src/db.js';
import { createBot } from './src/bot.js';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

await initDb();
await seedIfNeeded();

app.use('/app', express.static(path.join(__dirname, 'src', 'miniapp')));

// Health
app.get('/health', (req, res) => res.json({ ok: true }));

// --- Helpers ---
function getTelegramIdFromRequest(req) {
  // MVP: читаем telegram_id из query или header. В продакшне - проверяем initData подпись.
  const q = req.query.telegram_id;
  const h = req.headers['x-telegram-id'];
  const tg = q || h;
  if (!tg) return null;
  const n = Number(tg);
  return Number.isFinite(n) ? n : null;
}

function getUserByTelegramId(telegram_id) {
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
}

function getBalance(user_id) {
  const row = db.prepare('SELECT COALESCE(SUM(remaining),0) AS bal FROM bonus_ledger WHERE user_id = ? AND expires_at > strftime("%s","now")').get(user_id);
  return row?.bal ?? 0;
}

// --- API ---
app.get('/api/me', (req, res) => {
  const telegram_id = getTelegramIdFromRequest(req);
  if (!telegram_id) return res.status(401).json({ error: 'telegram_id_required' });

  const user = getUserByTelegramId(telegram_id);
  if (!user) return res.json({ registered: false });

  const balance = getBalance(user.id);
  const prizes = db.prepare(`
    SELECT up.id as user_prize_id, up.status, up.expires_at, p.title, p.code
    FROM user_prizes up
    JOIN prizes p ON p.id = up.prize_id
    WHERE up.user_id = ? AND up.status = 'active'
    ORDER BY up.issued_at DESC
  `).all(user.id);

  const welcome_used = db.prepare('SELECT 1 FROM wheel_spins WHERE user_id = ? AND wheel = "welcome" LIMIT 1').get(user.id) ? true : false;

  res.json({
    registered: true,
    user: { first_name: user.first_name, last_name: user.last_name, phone: user.phone, birth_date: user.birth_date },
    balance,
    active_prizes: prizes.map(p => ({
      id: p.user_prize_id,
      title: p.title,
      code: p.code,
      expires_at: p.expires_at ? Number(p.expires_at) : null
    })),
    welcome_used
  });
});

app.post('/api/wheel/start', (req, res) => {
  const telegram_id = getTelegramIdFromRequest(req);
  if (!telegram_id) return res.status(401).json({ error: 'telegram_id_required' });

  const user = getUserByTelegramId(telegram_id);
  if (!user) return res.status(403).json({ error: 'not_registered' });

  const { wheel_type } = req.body || {};
  const wheel = (wheel_type === 'welcome' || wheel_type === 'birthday') ? wheel_type : 'welcome';

  if (wheel === 'welcome') {
    const used = db.prepare('SELECT 1 FROM wheel_spins WHERE user_id = ? AND wheel = "welcome" LIMIT 1').get(user.id);
    if (used) return res.status(409).json({ error: 'welcome_already_used' });
  }

  const prizes = db.prepare('SELECT * FROM prizes WHERE wheel = ? AND is_active = 1').all(wheel);
  if (!prizes.length) return res.status(500).json({ error: 'no_prizes' });

  const sum = prizes.reduce((a,p) => a + (p.weight || 0), 0);
  let r = Math.floor(Math.random() * sum) + 1;
  let chosen = prizes[0];
  for (const p of prizes) {
    r -= p.weight;
    if (r <= 0) { chosen = p; break; }
  }

  const spin_id = uuidv4();
  const year = new Date().getFullYear();
  db.prepare('INSERT INTO wheel_spins (id, user_id, wheel, prize_id, created_at, year) VALUES (?,?,?,?,?,?)')
    .run(spin_id, user.id, wheel, chosen.id, Math.floor(Date.now()/1000), year);

  // apply prize
  if (chosen.code === 'bonus_100') {
    // ledger + tx
    const tx_id = uuidv4();
    db.prepare('INSERT INTO transactions (id, user_id, cashier_id, type, amount_rub, bonus_delta, created_at, meta) VALUES (?,?,?,?,?,?,?,?)')
      .run(tx_id, user.id, null, 'accrual', 0, 100, Math.floor(Date.now()/1000), JSON.stringify({ source: 'wheel', wheel }));
    const ledger_id = uuidv4();
    const expires_at = Math.floor((Date.now() + 60*24*3600*1000) / 1000);
    db.prepare('INSERT INTO bonus_ledger (id, user_id, amount, remaining, created_at, expires_at, source_tx_id) VALUES (?,?,?,?,?,?,?)')
      .run(ledger_id, user.id, 100, 100, Math.floor(Date.now()/1000), expires_at, tx_id);
  } else {
    const up_id = uuidv4();
    const expires_days = chosen.expires_days ?? 14;
    const expires_at = expires_days > 0 ? Math.floor((Date.now() + expires_days*24*3600*1000)/1000) : null;
    db.prepare('INSERT INTO user_prizes (id, user_id, prize_id, status, issued_at, expires_at, used_at, used_by_cashier_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(up_id, user.id, chosen.id, 'active', Math.floor(Date.now()/1000), expires_at, null, null);
  }

  // target angle for wheel (client renders)
  const idx = prizes.findIndex(p => p.id === chosen.id);
  const n = prizes.length;
  const slice = 360 / n;
  const baseAngle = (idx * slice) + slice/2;
  const extraTurns = 4 * 360; // 4 full turns
  const jitter = (Math.random() * slice * 0.3) - (slice * 0.15);
  const target_angle = extraTurns + (360 - baseAngle) + jitter;

  res.json({
    spin_id,
    wheel,
    prize: { code: chosen.code, title: chosen.title },
    target_angle
  });
});

app.get('/api/menu/categories', (req, res) => {
  const cats = db.prepare('SELECT id, title FROM menu_categories WHERE is_active = 1 ORDER BY sort ASC').all();
  res.json({ categories: cats });
});

app.get('/api/menu/items', (req, res) => {
  const category_id = req.query.category_id;
  if (!category_id) return res.json({ items: [] });
  const items = db.prepare('SELECT id, title, description, price_rub, image_url FROM menu_items WHERE is_active = 1 AND category_id = ? ORDER BY sort ASC').all(category_id);
  res.json({ items });
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Mini App: http://localhost:${PORT}/app`);
});

// Bot
createBot(app);
