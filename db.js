import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

sqlite3.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(process.cwd(), 'data.sqlite');

export let db; // will be a Database instance with .run/.get/.all returning promises via wrappers

function promisifyDatabase(database) {
  return {
    raw: database,
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve(this);
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    },
    prepare(sql) {
      // tiny helper that mimics sync prepare API, but returns async functions
      const stmt = database.prepare(sql);
      return {
        run: (...params) => new Promise((resolve, reject) => {
          stmt.run(params, function(err){ if (err) reject(err); else resolve(this); });
        }),
        get: (...params) => new Promise((resolve, reject) => {
          stmt.get(params, (err,row)=>{ if(err) reject(err); else resolve(row); });
        }),
        all: (...params) => new Promise((resolve, reject) => {
          stmt.all(params, (err,rows)=>{ if(err) reject(err); else resolve(rows); });
        })
      };
    }
  };
}

export async function initDb() {
  const raw = new sqlite3.Database(dbPath);
  db = promisifyDatabase(raw);

  await db.run(`PRAGMA foreign_keys = ON;`);

  // Tables
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id INTEGER UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      birth_date TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer',
      created_at INTEGER NOT NULL
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS bonus_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      remaining INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      source_tx_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      cashier_id TEXT,
      type TEXT NOT NULL,
      amount_rub INTEGER NOT NULL DEFAULT 0,
      bonus_delta INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      meta TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(cashier_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS prizes (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      wheel TEXT NOT NULL,
      weight INTEGER NOT NULL,
      expires_days INTEGER NOT NULL DEFAULT 14,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS user_prizes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prize_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      issued_at INTEGER NOT NULL,
      expires_at INTEGER,
      used_at INTEGER,
      used_by_cashier_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(prize_id) REFERENCES prizes(id),
      FOREIGN KEY(used_by_cashier_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS wheel_spins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      wheel TEXT NOT NULL,
      prize_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      year INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(prize_id) REFERENCES prizes(id)
    );
  `);

  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_welcome_once
    ON wheel_spins(user_id, wheel)
    WHERE wheel = 'welcome';
  `);

  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_birthday_once_per_year
    ON wheel_spins(user_id, wheel, year)
    WHERE wheel = 'birthday';
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS menu_categories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_rub INTEGER NOT NULL,
      image_url TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY(category_id) REFERENCES menu_categories(id) ON DELETE CASCADE
    );
  `);
}

export async function seedIfNeeded() {
  const count = await db.get('SELECT COUNT(*) as c FROM prizes');
  if ((count?.c ?? 0) === 0) {
    const { seedAll } = await import('./seed.js');
    await seedAll(db);
  }
}
