/* Giriş ekranı: etkileşimli ağ animasyonu, dönen kelimeler, giriş geçişi */
(() => {
  const $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WORDS = ['notların', 'PDF’lerin', 'fotoğrafların', 'ders kitapların'];
  const mouse = { x: -1e4, y: -1e4 };
  let raf = 0, timer = 0, pts = [], W = 0, H = 0, running = false, wi = 0;
  const rgb = () => getComputedStyle(document.documentElement).getPropertyValue('--amr').trim() || '240,180,90';
  const move = e => { mouse.x = e.clientX; mouse.y = e.clientY; };

  function size() {
    const c = $('au-canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight; c.width = W * dpr; c.height = H * dpr;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.min(80, Math.round(W * H / 15000));
    while (pts.length < n) pts.push({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random() - .5) * .4, vy: (Math.random() - .5) * .4, r: 1.2 + Math.random() * 1.8 });
    pts.length = n;
  }
  function frame() {
    const x = $('au-canvas').getContext('2d'), col = rgb(), D = 140, M = 180;
    x.clearRect(0, 0, W, H); x.lineWidth = 1;
    if (!reduce) for (const p of pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > W) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1; }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      for (let j = i + 1; j < pts.length; j++) {
        const b = pts[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < D) { x.strokeStyle = `rgba(${col},${(1 - d / D) * .3})`; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke(); }
      }
      const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y); // fare yaklaşınca noktalar ona bağlanır
      if (dm < M) { x.strokeStyle = `rgba(${col},${(1 - dm / M) * .55})`; x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(mouse.x, mouse.y); x.stroke(); }
      x.fillStyle = `rgba(${col},.85)`; x.beginPath(); x.arc(a.x, a.y, a.r, 0, 6.3); x.fill();
    }
    if (running && !reduce) raf = requestAnimationFrame(frame);
  }
  function rot() {
    const el = $('au-rot'); if (!el) return;
    el.classList.add('out');
    setTimeout(() => { wi = (wi + 1) % WORDS.length; el.textContent = WORDS[wi]; el.classList.remove('out'); }, 350);
  }
  function start() {
    if (running) return; running = true; size(); frame();
    addEventListener('resize', size); addEventListener('pointermove', move);
    if (!reduce) timer = setInterval(rot, 2600);
    document.querySelectorAll('.au-f>*').forEach((e, i) => (e.style.animationDelay = (.15 + i * .06) + 's'));
  }
  function stop() { running = false; cancelAnimationFrame(raf); clearInterval(timer); removeEventListener('resize', size); removeEventListener('pointermove', move); }

  const _sl = showLogin; showLogin = function () { _sl(); start(); };
  const _en = enter;
  enter = async function (u) { // girişten geliyorsa ekran yumuşakça kaybolur; çerezle gelindiyse hiç gösterilmez
    const a = $('auth');
    if (document.body.classList.contains('locked')) { a.classList.add('au-out'); setTimeout(() => { a.classList.remove('au-out'); stop(); }, 700); } else stop();
    return _en(u);
  };
  window.auOk = name => { const b = $('lg-btn'); b.classList.remove('loading'); b.classList.add('ok'); b.querySelector('.bt').textContent = 'Hoş geldin, ' + name; };
  window.auFail = () => { const f = $('au-form'); f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); $('lg-pass').select(); };
})();
