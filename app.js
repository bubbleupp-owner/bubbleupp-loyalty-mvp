const params = new URLSearchParams(location.search);
const telegram_id = params.get('telegram_id') || '';

const api = {
  async me(){
    const r = await fetch(`/api/me?telegram_id=${encodeURIComponent(telegram_id)}`);
    return await r.json();
  },
  async spin(wheel_type='welcome'){
    const r = await fetch(`/api/wheel/start?telegram_id=${encodeURIComponent(telegram_id)}`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ wheel_type })
    });
    const j = await r.json();
    if(!r.ok) throw j;
    return j;
  },
  async cats(){
    const r = await fetch('/api/menu/categories');
    return await r.json();
  },
  async items(category_id){
    const r = await fetch(`/api/menu/items?category_id=${encodeURIComponent(category_id)}`);
    return await r.json();
  }
};

// Tabs
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// QR modal
const qrModal = document.getElementById('qrModal');
document.getElementById('qrBtn').addEventListener('click', ()=>{
  qrModal.classList.add('show');
  const payload = `Bubbleupp:${telegram_id || 'unknown'}`;
  renderPseudoQR(document.getElementById('qrCanvas'), payload);
});
document.getElementById('qrClose').addEventListener('click', ()=> qrModal.classList.remove('show'));

// Win modal
const winModal = document.getElementById('winModal');
document.getElementById('winClose').addEventListener('click', ()=> winModal.classList.remove('show'));

// Wheel rendering
const wheelCanvas = document.getElementById('wheel');
const wctx = wheelCanvas.getContext('2d');

let wheelSegments = [
  'Бесплатный топпинг',
  'S → M',
  '100 бонусов',
  'Cookies бесплатно',
  'Фруктовый чай',
  'Лимонад',
  'Молочный чай',
  'Коктейль',
  'Кофе'
];

function drawWheel(angleDeg=0){
  const cx = wheelCanvas.width/2;
  const cy = wheelCanvas.height/2;
  const r = Math.min(cx,cy)-6;
  wctx.clearRect(0,0,wheelCanvas.width,wheelCanvas.height);

  const n = wheelSegments.length;
  const slice = (Math.PI*2)/n;
  const angle = (angleDeg * Math.PI/180);

  for(let i=0;i<n;i++){
    const start = angle + i*slice;
    const end = start + slice;

    // colors: teal / light gray alternating
    wctx.beginPath();
    wctx.moveTo(cx,cy);
    wctx.arc(cx,cy,r,start,end);
    wctx.closePath();
    wctx.fillStyle = (i%2===0) ? 'rgba(16,183,199,.22)' : 'rgba(17,24,39,.06)';
    wctx.fill();
    wctx.strokeStyle = 'rgba(235,79,120,.25)';
    wctx.stroke();

    // text
    wctx.save();
    wctx.translate(cx,cy);
    wctx.rotate(start + slice/2);
    wctx.textAlign = 'right';
    wctx.fillStyle = '#111827';
    wctx.font = 'bold 12px system-ui, sans-serif';
    wctx.fillText(wheelSegments[i], r-10, 4);
    wctx.restore();
  }

  // center
  wctx.beginPath();
  wctx.arc(cx,cy,40,0,Math.PI*2);
  wctx.fillStyle = '#fff';
  wctx.fill();
  wctx.strokeStyle = 'rgba(16,183,199,.35)';
  wctx.stroke();

  wctx.fillStyle = '#111827';
  wctx.font = '800 12px system-ui, sans-serif';
  wctx.textAlign = 'center';
  wctx.fillText('Bubble upp', cx, cy+4);
}
drawWheel(0);

async function loadMenu(){
  const cats = await api.cats();
  const wrap = document.getElementById('menuCats');
  wrap.innerHTML = '';
  cats.categories.forEach(c=>{
    const div = document.createElement('div');
    div.className = 'cat';
    div.innerHTML = `<div class="catTitle">${c.title}</div><div class="muted small">Смотреть</div>`;
    div.addEventListener('click', async ()=>{
      const data = await api.items(c.id);
      const itemsWrap = document.getElementById('menuItems');
      itemsWrap.innerHTML = '';
      if(!data.items.length){
        itemsWrap.innerHTML = `<div class="card muted">Скоро добавим позиции</div>`;
        return;
      }
      data.items.forEach(it=>{
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = `<b>${it.title}</b><div class="muted small">${it.description||''}</div><div style="margin-top:6px;font-weight:800">${it.price_rub} ₽</div>`;
        itemsWrap.appendChild(el);
      });
    });
    wrap.appendChild(div);
  });
}

async function refreshMe(){
  const me = await api.me();
  if(!me.registered){
    document.getElementById('balanceValue').textContent = '—';
    document.getElementById('activePrizes').innerHTML = '<div class="muted">Сначала зарегистрируйтесь в боте: /register</div>';
    document.getElementById('wheelHint').textContent = 'Сначала зарегистрируйтесь в боте: /register';
    document.getElementById('spinBtn').disabled = true;
    return;
  }
  document.getElementById('balanceValue').textContent = `⭐ ${me.balance}`;
  document.getElementById('pFirst').textContent = me.user.first_name;
  document.getElementById('pLast').textContent = me.user.last_name;
  document.getElementById('pPhone').textContent = me.user.phone;
  document.getElementById('pBirth').textContent = me.user.birth_date;

  const prizes = me.active_prizes || [];
  if(!prizes.length){
    document.getElementById('activePrizes').innerHTML = '<div class="muted">Нет активных призов</div>';
  } else {
    document.getElementById('activePrizes').innerHTML = prizes.map(p=>{
      const exp = p.expires_at ? new Date(p.expires_at*1000).toLocaleDateString('ru-RU') : '—';
      return `<div>🎁 <b>${p.title}</b> <span class="muted small">(до ${exp})</span></div>`;
    }).join('');
  }

  if(me.welcome_used){
    document.getElementById('wheelHint').textContent = 'Welcome-колесо уже использовано ✅';
    document.getElementById('spinBtn').disabled = true;
  } else {
    document.getElementById('wheelHint').textContent = 'Доступно 1 раз после регистрации.';
    document.getElementById('spinBtn').disabled = false;
  }
}

let spinning = false;
document.getElementById('spinBtn').addEventListener('click', async ()=>{
  if(spinning) return;
  spinning = true;
  document.getElementById('spinStatus').textContent = 'Крутим...';
  try{
    const res = await api.spin('welcome');
    // animate to target_angle
    const total = res.target_angle;
    const duration = 4200; // ms
    const start = performance.now();
    const startAngle = 0;
    function easeOutCubic(t){ return 1 - Math.pow(1-t,3); }
    function frame(now){
      const p = Math.min(1, (now-start)/duration);
      const a = startAngle + total * easeOutCubic(p);
      drawWheel(a % 360);
      if(p < 1) requestAnimationFrame(frame);
      else {
        document.getElementById('spinStatus').textContent = 'Готово ✅';
        document.getElementById('winTitle').textContent = res.prize.title;
        document.getElementById('winSub').textContent = 'Приз добавлен в вашу карту';
        winModal.classList.add('show');
        refreshMe();
        spinning = false;
      }
    }
    requestAnimationFrame(frame);
  }catch(e){
    document.getElementById('spinStatus').textContent = (e && e.error) ? e.error : 'Ошибка';
    spinning = false;
  }
});

loadMenu();
refreshMe();
