import { v4 as uuidv4 } from 'uuid';

export async function seedAll(db) {
  // Menu categories
  const cats = [
    { title: 'Фруктовые чаи', sort: 1 },
    { title: 'Молочные чаи', sort: 2 },
    { title: 'Молочные коктейли', sort: 3 },
    { title: 'Лимонады', sort: 4 },
    { title: 'Кофе', sort: 5 },
  ];

  for (const c of cats) {
    await db.run(
      'INSERT INTO menu_categories (id, title, sort, is_active) VALUES (?,?,?,1)',
      [uuidv4(), c.title, c.sort]
    );
  }

  // Prizes - welcome
  const welcome = [
    ['topping_free', 'Бесплатный топпинг', 20, 14],
    ['size_up_s_m', 'Увеличение размера S → M', 20, 14],
    ['bonus_100', '100 бонусов', 10, 0],
    ['cookie_free', 'Crumble cookies бесплатно', 10, 14],
    ['fruit_tea_free', 'Фруктовый чай бесплатно', 10, 14],
    ['lemonade_free', 'Лимонад бесплатно', 10, 14],
    ['milk_tea_free', 'Молочный чай бесплатно', 10, 14],
    ['milkshake_free', 'Молочный коктейль бесплатно', 5, 14],
    ['coffee_free', 'Кофе бесплатно', 5, 14],
  ];

  for (const [code, title, weight, expires_days] of welcome) {
    await db.run(
      'INSERT INTO prizes (id, code, title, wheel, weight, expires_days, is_active) VALUES (?,?,?,?,?,?,1)',
      [uuidv4(), code, title, 'welcome', weight, expires_days]
    );
  }

  // Prizes - birthday (копия)
  const rows = await db.all('SELECT code, title, weight, expires_days FROM prizes WHERE wheel = "welcome"');
  for (const r of rows) {
    await db.run(
      'INSERT INTO prizes (id, code, title, wheel, weight, expires_days, is_active) VALUES (?,?,?,?,?,?,1)',
      [uuidv4(), r.code, r.title, 'birthday', r.weight, r.expires_days]
    );
  }

  console.log('Seed completed.');
}
