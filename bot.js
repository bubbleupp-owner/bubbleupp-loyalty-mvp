import { Telegraf, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';

function parseIdList(s) {
  return (s || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(x => Number(x))
    .filter(n => Number.isFinite(n));
}

function isInList(telegramId, listEnv) {
  const list = parseIdList(listEnv);
  return list.includes(Number(telegramId));
}

async function getUserByTelegramId(telegram_id) {
  return await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegram_id]);
}

async function getBalance(user_id) {
  // remove expired batches lazily
  await db.run('UPDATE bonus_ledger SET remaining = 0 WHERE user_id = ? AND expires_at <= strftime("%s","now") AND remaining > 0', [user_id]);
  const row = await db.get('SELECT COALESCE(SUM(remaining),0) AS bal FROM bonus_ledger WHERE user_id = ? AND expires_at > strftime("%s","now")', [user_id]);
  return row?.bal ?? 0;
}

export function createBot() {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    console.warn('BOT_TOKEN is not set. Bot will not start.');
    return null;
  }
  const bot = new Telegraf(token);

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  function mainKeyboard() {
    return Markup.keyboard([
      ['🪪 Открыть карту', '🎁 Подарки'],
      ['📋 Меню', '👤 Профиль'],
      ['❓ Как работает бонусная программа'],
    ]).resize();
  }

  bot.start(async (ctx) => {
    const tgId = ctx.from?.id;
    const user = tgId ? await getUserByTelegramId(tgId) : null;

    const text = user
      ? `Привет! Это Bubble upp ⭐\n\nОткрой карту, посмотри бонусы и подарки.`
      : `Привет! Это Bubble upp ⭐\n\nДавай зарегистрируемся в бонусной программе — это займёт минуту.\n\nНапиши: /register`;

    await ctx.reply(text, mainKeyboard());

    const webAppUrl = `${baseUrl}/app/?telegram_id=${tgId}`;
    await ctx.reply('Открыть Mini App:', Markup.inlineKeyboard([
      Markup.button.webApp('🪪 Открыть карту Bubble upp', webAppUrl),
    ]));
  });

  // Register flow (simple step-by-step)
  const regState = new Map(); // tgId -> {step,data}

  bot.command('register', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const existing = await getUserByTelegramId(tgId);
    if (existing) return ctx.reply('Вы уже зарегистрированы ✅', mainKeyboard());

    regState.set(tgId, { step: 'first_name', data: {} });
    return ctx.reply('Введите имя:');
  });

  bot.on('text', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const st = regState.get(tgId);
    if (!st) return;

    const msg = (ctx.message.text || '').trim();

    if (st.step === 'first_name') {
      st.data.first_name = msg;
      st.step = 'last_name';
      regState.set(tgId, st);
      return ctx.reply('Введите фамилию:');
    }

    if (st.step === 'last_name') {
      st.data.last_name = msg;
      st.step = 'birth_date';
      regState.set(tgId, st);
      return ctx.reply('Введите дату рождения в формате YYYY-MM-DD (например 1999-03-15):');
    }

    if (st.step === 'birth_date') {
      // naive validate
      if (!/^\d{4}-\d{2}-\d{2}$/.test(msg)) {
        return ctx.reply('Формат неверный. Введите дату как YYYY-MM-DD:');
      }
      st.data.birth_date = msg;
      st.step = 'phone';
      regState.set(tgId, st);
      return ctx.reply('Отправьте номер телефона кнопкой ниже:', Markup.keyboard([
        [Markup.button.contactRequest('📱 Поделиться контактом')]
      ]).resize());
    }

    if (st.step === 'phone') {
      return ctx.reply('Нажмите кнопку «📱 Поделиться контактом», чтобы отправить номер.');
    }
  });

  bot.on('contact', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const st = regState.get(tgId);
    if (!st || st.step !== 'phone') return;

    const phone = ctx.message.contact?.phone_number;
    if (!phone) return ctx.reply('Не вижу номер телефона, попробуйте ещё раз.');

    // create user
    const now = Math.floor(Date.now()/1000);
    const id = uuidv4();
    const role =
      isInList(tgId, process.env.ADMIN_TELEGRAM_IDS) ? 'admin' :
      isInList(tgId, process.env.CASHIER_TELEGRAM_IDS) ? 'cashier' :
      'customer';

    try {
      await db.run(
        'INSERT INTO users (id, telegram_id, first_name, last_name, phone, birth_date, role, created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, tgId, st.data.first_name, st.data.last_name, phone, st.data.birth_date, role, now]
      );
    } catch (e) {
      console.error(e);
      return ctx.reply('Ошибка регистрации (возможно номер уже используется). Напиши /register ещё раз.');
    } finally {
      regState.delete(tgId);
    }

    await ctx.reply('Готово! Ваша карта Bubble upp активирована ⭐', mainKeyboard());

    const webAppUrl = `${baseUrl}/app/?telegram_id=${tgId}`;
    await ctx.reply('Теперь можно открыть Mini App и крутить Welcome-колесо 🎡 (1 раз):', Markup.inlineKeyboard([
      Markup.button.webApp('🎡 Открыть Bubble upp', webAppUrl),
    ]));
  });

  // Info
  bot.hears('❓ Как работает бонусная программа', async (ctx) => {
    await ctx.reply(
      '⭐ Начисление: 5% от суммы покупки\n' +
      '➖ Списание: до 30% от суммы чека (1 бонус = 1 ₽ скидки)\n' +
      '⏳ Бонусы сгорают через 60 дней\n' +
      '🎡 Welcome-колесо доступно 1 раз после регистрации\n' +
      '🎂 В день рождения: +50 бонусов и 1 вращение колеса (в этом MVP ещё не включено)',
      mainKeyboard()
    );
  });

  // Open mini app shortcuts
  bot.hears(['🪪 Открыть карту','🎁 Подарки','📋 Меню','👤 Профиль'], async (ctx) => {
    const tgId = ctx.from?.id;
    const webAppUrl = `${baseUrl}/app/?telegram_id=${tgId}`;
    await ctx.reply('Открываю Mini App:', Markup.inlineKeyboard([
      Markup.button.webApp('🪪 Bubble upp Mini App', webAppUrl),
    ]));
  });

  // Cashier mode (MVP)
  const cashierState = new Map(); // tgId -> {selectedUserId, step, amount, mode}

  bot.command('cashier', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const me = await getUserByTelegramId(tgId);
    if (!me || (me.role !== 'cashier' && me.role !== 'admin')) {
      return ctx.reply('У вас нет прав кассира.');
    }
    cashierState.set(tgId, { step: 'menu' });
    return ctx.reply('🔐 Режим кассира', Markup.keyboard([
      ['🔎 Найти по телефону'],
      ['➕ Начислить бонусы', '➖ Списать бонусы'],
      ['🎁 Использовать приз'],
      ['↩️ Выйти']
    ]).resize());
  });

  bot.hears('↩️ Выйти', async (ctx) => {
    const tgId = ctx.from?.id;
    cashierState.delete(tgId);
    return ctx.reply('Ок, вышел из режима кассира.', mainKeyboard());
  });

  async function requireCashier(ctx) {
    const tgId = ctx.from?.id;
    if (!tgId) return null;
    const me = await getUserByTelegramId(tgId);
    if (!me || (me.role !== 'cashier' && me.role !== 'admin')) return null;
    return me;
  }

  bot.hears('🔎 Найти по телефону', async (ctx) => {
    const me = await requireCashier(ctx);
    if (!me) return ctx.reply('У вас нет прав кассира.');
    const tgId = ctx.from.id;
    cashierState.set(tgId, { step: 'find_phone' });
    return ctx.reply('Введите телефон клиента (как в Telegram, например +79001234567):');
  });

  bot.hears('➕ Начислить бонусы', async (ctx) => {
    const me = await requireCashier(ctx);
    if (!me) return ctx.reply('У вас нет прав кассира.');
    const tgId = ctx.from.id;
    const st = cashierState.get(tgId) || {};
    if (!st.selectedUserId) return ctx.reply('Сначала найдите клиента по телефону (кнопка "Найти по телефону").');
    cashierState.set(tgId, { ...st, step: 'accrual_amount' });
    return ctx.reply('Введите сумму чека (₽):');
  });

  bot.hears('➖ Списать бонусы', async (ctx) => {
    const me = await requireCashier(ctx);
    if (!me) return ctx.reply('У вас нет прав кассира.');
    const tgId = ctx.from.id;
    const st = cashierState.get(tgId) || {};
    if (!st.selectedUserId) return ctx.reply('Сначала найдите клиента по телефону (кнопка "Найти по телефону").');
    cashierState.set(tgId, { ...st, step: 'redeem_amount' });
    return ctx.reply('Введите сумму чека (₽):');
  });

  bot.hears('🎁 Использовать приз', async (ctx) => {
    const me = await requireCashier(ctx);
    if (!me) return ctx.reply('У вас нет прав кассира.');
    const tgId = ctx.from.id;
    const st = cashierState.get(tgId) || {};
    if (!st.selectedUserId) return ctx.reply('Сначала найдите клиента по телефону (кнопка "Найти по телефону").');

    const prizes = await db.all(`
      SELECT up.id as upid, p.title as title, up.expires_at as expires_at
      FROM user_prizes up JOIN prizes p ON p.id = up.prize_id
      WHERE up.user_id = ? AND up.status = 'active'
      ORDER BY up.issued_at DESC
    `, [st.selectedUserId]);

    if (!prizes.length) return ctx.reply('У клиента нет активных призов.');

    const buttons = prizes.slice(0, 10).map(pr => [Markup.button.callback(pr.title, `USEPRIZE:${pr.upid}`)]);
    return ctx.reply('Выберите приз для списания:', Markup.inlineKeyboard(buttons));
  });

  bot.action(/USEPRIZE:(.+)/, async (ctx) => {
    const me = await requireCashier(ctx);
    if (!me) return ctx.reply('У вас нет прав кассира.');
    const upid = ctx.match[1];
    const row = await db.get('SELECT * FROM user_prizes WHERE id = ? AND status = "active"', [upid]);
    if (!row) return ctx.reply('Приз не найден или уже использован.');

    await db.run('UPDATE user_prizes SET status = "used", used_at = ?, used_by_cashier_id = ? WHERE id = ?', [Math.floor(Date.now()/1000), me.id, upid]);
    await ctx.answerCbQuery('Приз использован ✅');
    return ctx.reply('Готово ✅ Приз списан.');
  });

  bot.on('text', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const st = cashierState.get(tgId);
    if (!st) return;

    const me = await requireCashier(ctx);
    if (!me) return;

    const msg = (ctx.message.text || '').trim();

    if (st.step === 'find_phone') {
      const u = await db.get('SELECT * FROM users WHERE phone = ?', [msg]);
      if (!u) return ctx.reply('Клиент не найден. Проверьте телефон.');
      const bal = await getBalance(u.id);
      cashierState.set(tgId, { step: 'menu', selectedUserId: u.id });
      return ctx.reply(`Клиент найден: ${u.first_name} ${u.last_name}\nБаланс: ⭐ ${bal}`);
    }

    if (st.step === 'accrual_amount') {
      const amount = Number(msg);
      if (!Number.isFinite(amount) || amount < 0) return ctx.reply('Введите сумму числом (₽).');
      const bonus = Math.floor(amount * 0.05);
      // create tx + ledger
      const txId = uuidv4();
      const now = Math.floor(Date.now()/1000);
      await db.run('INSERT INTO transactions (id, user_id, cashier_id, type, amount_rub, bonus_delta, created_at, meta) VALUES (?,?,?,?,?,?,?,?)',
        [txId, st.selectedUserId, me.id, 'accrual', Math.floor(amount), bonus, now, JSON.stringify({ source: 'cashier' })]
      );
      const ledgerId = uuidv4();
      const expires = now + 60*24*3600;
      await db.run('INSERT INTO bonus_ledger (id, user_id, amount, remaining, created_at, expires_at, source_tx_id) VALUES (?,?,?,?,?,?,?)',
        [ledgerId, st.selectedUserId, bonus, bonus, now, expires, txId]
      );
      cashierState.set(tgId, { ...st, step: 'menu' });
      const bal = await getBalance(st.selectedUserId);
      return ctx.reply(`Начислено ⭐ ${bonus} (5% от ${amount} ₽).\nНовый баланс: ⭐ ${bal}`);
    }

    if (st.step === 'redeem_amount') {
      const amount = Number(msg);
      if (!Number.isFinite(amount) || amount < 0) return ctx.reply('Введите сумму числом (₽).');
      const bal = await getBalance(st.selectedUserId);
      const maxRule = Math.floor(amount * 0.30);
      const maxPossible = Math.min(maxRule, bal);
      cashierState.set(tgId, { ...st, step: 'redeem_enter', amount: Math.floor(amount), maxPossible });
      return ctx.reply(`Можно списать до ⭐ ${maxPossible} (30% от чека).\nСколько списать?`);
    }

    if (st.step === 'redeem_enter') {
      const want = Math.floor(Number(msg));
      if (!Number.isFinite(want) || want < 0) return ctx.reply('Введите число бонусов.');
      const spend = Math.min(want, st.maxPossible);

      // FIFO spending
      let remainingToSpend = spend;
      const batches = await db.all(
        'SELECT id, remaining FROM bonus_ledger WHERE user_id = ? AND remaining > 0 AND expires_at > strftime("%s","now") ORDER BY expires_at ASC, created_at ASC',
        [st.selectedUserId]
      );
      for (const b of batches) {
        if (remainingToSpend <= 0) break;
        const take = Math.min(b.remaining, remainingToSpend);
        await db.run('UPDATE bonus_ledger SET remaining = remaining - ? WHERE id = ?', [take, b.id]);
        remainingToSpend -= take;
      }
      const spent = spend - remainingToSpend;

      const txId = uuidv4();
      const now = Math.floor(Date.now()/1000);
      await db.run('INSERT INTO transactions (id, user_id, cashier_id, type, amount_rub, bonus_delta, created_at, meta) VALUES (?,?,?,?,?,?,?,?)',
        [txId, st.selectedUserId, me.id, 'redeem', st.amount, -spent, now, JSON.stringify({ source: 'cashier' })]
      );

      cashierState.set(tgId, { ...st, step: 'menu', amount: undefined, maxPossible: undefined });
      const bal = await getBalance(st.selectedUserId);
      return ctx.reply(`Списано ⭐ ${spent} (скидка ${spent} ₽).\nНовый баланс: ⭐ ${bal}`);
    }
  });

  bot.launch();
  console.log('Bot started.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  return bot;
}
