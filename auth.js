const crypto = require('crypto'), fs = require('fs'), path = require('path');
const clean = v => (v || '').trim().replace(/^["']|["']$/g, '');
const rid = () => crypto.randomBytes(8).toString('hex');
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const mkHash = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') });
const check = (pw, u) => crypto.timingSafeEqual(crypto.scryptSync(pw, u.salt, 64), Buffer.from(u.hash, 'hex'));
const pub = u => ({ id: u.id, username: u.username, role: u.role, theme: u.theme || 'amber', goal: u.goal || 0, createdAt: u.createdAt, lastLogin: u.lastLogin || null });

/* ================= DEPOLAMA: Supabase (varsa) ya da yerel dosya ================= */
const SB_URL = clean(process.env.SUPABASE_URL).replace(/\/+$/, ''), SB_KEY = clean(process.env.SUPABASE_SERVICE_KEY);
const useSb = !!(SB_URL && SB_KEY);
let store;

if (useSb) {
  const H = { apikey: SB_KEY, 'Content-Type': 'application/json' };
  if (SB_KEY.startsWith('eyJ')) H.Authorization = 'Bearer ' + SB_KEY; // eski JWT anahtarlar; yeni sb_secret_ anahtarlar sadece apikey ister
  const sb = async (method, table, q = '', body, prefer = 'return=representation') => {
    const r = await fetch(`${SB_URL}/rest/v1/${table}${q}`, { method, headers: { ...H, Prefer: prefer }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) throw new Error(`Supabase (${table}) HTTP ${r.status}: ${(await r.text()).slice(0, 180)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  };
  const uFrom = r => r && ({ id: r.id, username: r.username, role: r.role, salt: r.salt, hash: r.hash, theme: r.theme, goal: r.goal, createdAt: Number(r.created_at), lastLogin: r.last_login == null ? null : Number(r.last_login) });
  const uTo = u => ({ id: u.id, username: u.username, role: u.role, salt: u.salt, hash: u.hash, theme: u.theme || 'amber', goal: u.goal || 0, created_at: u.createdAt, last_login: u.lastLogin || null });
  const e = encodeURIComponent;
  store = {
    userByName: async n => uFrom((await sb('GET', 'users', `?username=eq.${e(n)}&limit=1`))[0]),
    userById: async id => uFrom((await sb('GET', 'users', `?id=eq.${e(id)}&limit=1`))[0]),
    users: async () => (await sb('GET', 'users', '?order=created_at.asc')).map(uFrom),
    saveUser: u => sb('POST', 'users', '?on_conflict=id', uTo(u), 'resolution=merge-duplicates,return=minimal'),
    delUser: id => sb('DELETE', 'users', `?id=eq.${e(id)}`, undefined, 'return=minimal'), // oturum ve arşiv "cascade" ile silinir
    session: async h => (await sb('GET', 'sessions', `?h=eq.${h}&exp=gt.${Date.now()}&limit=1`))[0],
    addSession: s => sb('POST', 'sessions', '', s, 'return=minimal'),
    sessions: uid => sb('GET', 'sessions', `?uid=eq.${e(uid)}&exp=gt.${Date.now()}&order=created.desc`),
    delSessions: (uid, { id, exceptH } = {}) => sb('DELETE', 'sessions', `?uid=eq.${e(uid)}${id ? `&id=eq.${e(id)}` : ''}${exceptH ? `&h=neq.${exceptH}` : ''}`, undefined, 'return=minimal'),
    cleanup: () => sb('DELETE', 'sessions', `?exp=lt.${Date.now()}`, undefined, 'return=minimal'),
    archive: async uid => (await sb('GET', 'archives', `?uid=eq.${e(uid)}&limit=1`))[0]?.data || [],
    putArchive: (uid, data) => sb('POST', 'archives', '?on_conflict=uid', { uid, data, updated_at: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal'),
    getData: async (uid, k) => (await sb('GET', 'userdata', `?uid=eq.${e(uid)}&k=eq.${e(k)}&limit=1`))[0]?.data ?? null,
    putData: (uid, k, data) => sb('POST', 'userdata', '?on_conflict=uid,k', { uid, k, data }, 'resolution=merge-duplicates,return=minimal'),
    createShare: s => sb('POST', 'shares', '', s, 'return=minimal'),
    getShare: async c => (await sb('GET', 'shares', `?code=eq.${e(c)}&limit=1`))[0],
    results: c => sb('GET', 'share_results', `?code=eq.${e(c)}&order=score.desc,ts.asc`),
    upsertResult: async r => {
      const old = (await sb('GET', 'share_results', `?code=eq.${e(r.code)}&uid=eq.${e(r.uid)}&limit=1`))[0];
      if (old && old.score >= r.score) return;
      await sb('POST', 'share_results', '?on_conflict=code,uid', r, 'resolution=merge-duplicates,return=minimal');
    }
  };
} else {
  const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(DIR, { recursive: true });
  const DBF = path.join(DIR, 'db.json'), aFile = id => path.join(DIR, `archive-${id}.json`);
  let db = { users: [], sessions: [] };
  try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch {}
  db.sessions.forEach(s => (s.id = s.id || rid()));
  const persist = () => { fs.writeFileSync(DBF + '.tmp', JSON.stringify(db)); fs.renameSync(DBF + '.tmp', DBF); };
  const dFile = (u, k) => path.join(DIR, `data-${u}-${k}.json`), SF = path.join(DIR, 'shares.json');
  let sh = { shares: {}, results: [] };
  try { sh = JSON.parse(fs.readFileSync(SF, 'utf8')); } catch {}
  const pS = () => fs.writeFileSync(SF, JSON.stringify(sh));
  store = {
    getData: async (u, k) => { try { return JSON.parse(fs.readFileSync(dFile(u, k), 'utf8')); } catch { return null; } },
    putData: async (u, k, d) => fs.writeFileSync(dFile(u, k), JSON.stringify(d)),
    createShare: async s => { sh.shares[s.code] = s; pS(); },
    getShare: async c => sh.shares[c],
    results: async c => sh.results.filter(r => r.code === c).sort((a, b) => b.score - a.score || a.ts - b.ts),
    upsertResult: async r => { const i = sh.results.findIndex(x => x.code === r.code && x.uid === r.uid); if (i >= 0) { if (sh.results[i].score >= r.score) return; sh.results[i] = r; } else sh.results.push(r); pS(); },
    userByName: async n => db.users.find(u => u.username === n),
    userById: async id => db.users.find(u => u.id === id),
    users: async () => db.users,
    saveUser: async u => { const i = db.users.findIndex(x => x.id === u.id); i >= 0 ? (db.users[i] = u) : db.users.push(u); persist(); },
    delUser: async id => { db.users = db.users.filter(u => u.id !== id); db.sessions = db.sessions.filter(s => s.uid !== id); persist(); fs.rmSync(aFile(id), { force: true }); },
    session: async h => db.sessions.find(s => s.h === h && s.exp > Date.now()),
    addSession: async s => { db.sessions.push(s); persist(); },
    sessions: async uid => db.sessions.filter(s => s.uid === uid && s.exp > Date.now()).sort((a, b) => b.created - a.created),
    delSessions: async (uid, { id, exceptH } = {}) => { db.sessions = db.sessions.filter(s => !(s.uid === uid && (!id || s.id === id) && (!exceptH || s.h !== exceptH))); persist(); },
    cleanup: async () => { db.sessions = db.sessions.filter(s => s.exp > Date.now()); },
    archive: async uid => { try { return JSON.parse(fs.readFileSync(aFile(uid), 'utf8')); } catch { return []; } },
    putArchive: async (uid, data) => fs.writeFileSync(aFile(uid), JSON.stringify(data))
  };
}

/* ================= Yönetici hesabı (.env: SITE_USER / SITE_PASS) ================= */
const AU = (process.env.SITE_USER || 'admin').trim().toLowerCase(), AP = process.env.SITE_PASS || '123456';
if (AP === '123456') console.warn('⚠️  SITE_PASS varsayılan! .env dosyasında değiştirin.');
const ready = (async () => {
  let a = await store.userByName(AU);
  if (!a) a = { id: rid(), username: AU, createdAt: Date.now() };
  Object.assign(a, { role: 'admin' }, mkHash(AP));
  await store.saveUser(a);
  console.log(`💾 Depolama: ${useSb ? 'Supabase' : 'yerel dosya (data/) — kalıcı olması için Supabase bağlayın'}`);
})();
ready.catch(e => console.error('❌ Depolama başlatılamadı:', e.message));

module.exports = app => {
  app.set('trust proxy', 1);
  const fails = new Map();
  const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error(e.message); res.status(500).json({ error: 'Sunucu hatası: ' + e.message }); });
  const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split(/=(.*)/s).slice(0, 2)).filter(a => a[0]));

  app.use('/api', wrap(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    await ready;
    const tok = cookies(req).qc_session;
    if (tok) {
      const h = sha(tok), s = await store.session(h);
      if (s) { req.user = await store.userById(s.uid); req.sh = h; }
    }
    if (req.path === '/auth/login') return next();
    if (!req.user) return res.status(401).json({ error: 'Oturum gerekli', auth: true });
    next();
  }));

  app.post('/api/auth/login', wrap(async (req, res) => {
    const name = String(req.body.username || '').trim().toLowerCase(), pw = String(req.body.password || '');
    const key = req.ip + '|' + name, f = fails.get(key);
    if (f && f.until > Date.now()) return res.status(429).json({ error: 'Çok fazla hatalı deneme. 5 dakika sonra tekrar dene.' });
    const u = await store.userByName(name);
    if (!u || !check(pw, u)) {
      const n = (f?.n || 0) + 1;
      fails.set(key, { n, until: n >= 5 ? Date.now() + 300000 : 0 });
      return res.status(401).json({ error: 'Kullanıcı adı veya şifre hatalı.' });
    }
    fails.delete(key);
    const token = crypto.randomBytes(32).toString('hex'), remember = req.body.remember !== false, ttl = (remember ? 365 : 1) * 864e5;
    await store.cleanup();
    const mine = await store.sessions(u.id);
    for (const old of mine.slice(19)) await store.delSessions(u.id, { id: old.id }); // en fazla 20 cihaz
    await store.addSession({ h: sha(token), id: rid(), uid: u.id, exp: Date.now() + ttl, created: Date.now(), ua: String(req.headers['user-agent'] || '').slice(0, 160) });
    u.lastLogin = Date.now(); await store.saveUser(u);
    res.cookie('qc_session', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: remember ? ttl : undefined, path: '/' });
    res.json({ user: pub(u) });
  }));

  app.get('/api/me', (req, res) => res.json({ user: pub(req.user) }));
  app.post('/api/auth/logout', wrap(async (req, res) => {
    const s = await store.session(req.sh); if (s) await store.delSessions(req.user.id, { id: s.id });
    res.clearCookie('qc_session'); res.json({ ok: true });
  }));

  app.put('/api/me/prefs', wrap(async (req, res) => {
    const { theme, goal } = req.body || {};
    if (['amber', 'purple'].includes(theme)) req.user.theme = theme;
    const g = parseInt(goal, 10); if (g >= 1 && g <= 500) req.user.goal = g;
    await store.saveUser(req.user); res.json({ user: pub(req.user) });
  }));

  // Kullanıcı kendi şifresini değiştirir; diğer tüm cihazlardan çıkış yapılır
  app.put('/api/me/password', wrap(async (req, res) => {
    if (req.user.role === 'admin') return res.status(400).json({ error: 'Yönetici şifresi .env dosyasındaki SITE_PASS ile belirlenir.' });
    const { current, password } = req.body || {};
    if (!check(String(current || ''), req.user)) return res.status(401).json({ error: 'Mevcut şifre hatalı.' });
    if (String(password || '').length < 4 || password.length > 100) return res.status(400).json({ error: 'Yeni şifre en az 4 karakter olmalı.' });
    Object.assign(req.user, mkHash(password)); await store.saveUser(req.user);
    await store.delSessions(req.user.id, { exceptH: req.sh }); res.json({ ok: true });
  }));

  // Açık oturumlar (cihazlar)
  app.get('/api/me/sessions', wrap(async (req, res) => {
    const list = await store.sessions(req.user.id);
    res.json({ sessions: list.map(s => ({ id: s.id, ua: s.ua, created: Number(s.created), exp: Number(s.exp), current: s.h === req.sh })) });
  }));
  app.delete('/api/me/sessions', wrap(async (req, res) => { await store.delSessions(req.user.id, { exceptH: req.sh }); res.json({ ok: true }); }));
  app.delete('/api/me/sessions/:id', wrap(async (req, res) => { await store.delSessions(req.user.id, { id: req.params.id }); res.json({ ok: true }); }));

  app.get('/api/archive', wrap(async (req, res) => res.json({ archive: await store.archive(req.user.id) })));
  app.put('/api/archive', wrap(async (req, res) => {
    const a = req.body?.archive;
    if (!Array.isArray(a) || a.length > 500) return res.status(400).json({ error: 'Geçersiz arşiv.' });
    if (JSON.stringify(a).length > 8e6) return res.status(413).json({ error: 'Arşiv çok büyük, eski sınavları sil.' });
    await store.putArchive(req.user.id, a); res.json({ ok: true });
  }));

  /* ---- Kullanıcıya özel veriler: ezber desteleri, tekrar takvimi, ayarlar/görevler ---- */
  const KEYS = ['decks', 'srs', 'meta'];
  app.get('/api/data/:k', wrap(async (req, res) => {
    if (!KEYS.includes(req.params.k)) return res.status(404).json({ error: 'Bulunamadı.' });
    res.json({ data: await store.getData(req.user.id, req.params.k) });
  }));
  app.put('/api/data/:k', wrap(async (req, res) => {
    const d = req.body?.data;
    if (!KEYS.includes(req.params.k) || d === undefined || JSON.stringify(d).length > 4e6) return res.status(400).json({ error: 'Geçersiz veri.' });
    await store.putData(req.user.id, req.params.k, d); res.json({ ok: true });
  }));

  /* ---- Sınav paylaşımı ---- */
  const mkCode = () => Array.from(crypto.randomBytes(6), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  const board = async c => (await store.results(c)).map(r => ({ username: r.username, score: r.score, correct: r.correct, total: r.total }));
  app.post('/api/shares', wrap(async (req, res) => {
    const q = req.body?.quiz;
    if (!q || !Array.isArray(q.questions) || !q.questions.length || JSON.stringify(q).length > 3e5) return res.status(400).json({ error: 'Geçersiz sınav.' });
    const s = { code: mkCode(), owner: req.user.id, owner_name: req.user.username, title: String(q.title || 'Sınav').slice(0, 120), quiz: q, created: Date.now() };
    await store.createShare(s); res.json({ code: s.code });
  }));
  app.get('/api/shares/:code', wrap(async (req, res) => {
    const s = await store.getShare(req.params.code);
    if (!s) return res.status(404).json({ error: 'Paylaşım bulunamadı veya silinmiş.' });
    res.json({ code: s.code, owner: s.owner_name, title: s.title, quiz: s.quiz, results: await board(s.code) });
  }));
  app.post('/api/shares/:code/result', wrap(async (req, res) => {
    const s = await store.getShare(req.params.code);
    if (!s) return res.status(404).json({ error: 'Paylaşım bulunamadı.' });
    const n = k => Math.max(0, Math.round(Number(req.body[k]) || 0)), total = n('total');
    if (!total || n('correct') > total || n('score') > 200) return res.status(400).json({ error: 'Geçersiz sonuç.' });
    await store.upsertResult({ code: s.code, uid: req.user.id, username: req.user.username, score: n('score'), correct: n('correct'), total, ts: Date.now() });
    res.json({ results: await board(s.code) });
  }));

  /* ---- Yönetici ---- */
  const admin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Yetkisiz.' }));
  app.get('/api/admin/users', admin, wrap(async (req, res) => res.json({ users: (await store.users()).map(pub) })));
  app.post('/api/admin/users', admin, wrap(async (req, res) => {
    const name = String(req.body.username || '').trim().toLowerCase(), pw = String(req.body.password || '');
    if (!/^[a-z0-9ığüşöç._-]{3,24}$/.test(name)) return res.status(400).json({ error: 'Kullanıcı adı 3-24 karakter olmalı (harf, rakam, . _ -).' });
    if (pw.length < 4 || pw.length > 100) return res.status(400).json({ error: 'Şifre en az 4 karakter olmalı.' });
    if (await store.userByName(name)) return res.status(409).json({ error: 'Bu kullanıcı adı zaten var.' });
    const u = { id: rid(), username: name, role: 'user', createdAt: Date.now(), ...mkHash(pw) };
    await store.saveUser(u); res.json({ user: pub(u) });
  }));
  app.put('/api/admin/users/:id/password', admin, wrap(async (req, res) => {
    const u = await store.userById(req.params.id), pw = String(req.body.password || '');
    if (!u || u.role === 'admin') return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    if (pw.length < 4) return res.status(400).json({ error: 'Şifre en az 4 karakter olmalı.' });
    Object.assign(u, mkHash(pw)); await store.saveUser(u); await store.delSessions(u.id); res.json({ ok: true });
  }));
  app.delete('/api/admin/users/:id', admin, wrap(async (req, res) => {
    const u = await store.userById(req.params.id);
    if (!u || u.role === 'admin') return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    await store.delUser(u.id); res.json({ ok: true });
  }));
};
