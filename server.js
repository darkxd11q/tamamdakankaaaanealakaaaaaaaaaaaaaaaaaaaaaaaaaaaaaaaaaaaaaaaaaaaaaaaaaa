const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_, f, cb) => cb(null, f.mimetype === 'application/pdf')
});

const PORT = process.env.PORT || 3000;
const clean = v => (v || '').trim().replace(/^["']|["']$/g, '');
const GEMINI_KEY = clean(process.env.GEMINI_API_KEY);
const GROQ_KEY = clean(process.env.GROQ_API_KEY);
// Modeller .env ile değiştirilebilir; biri kapatılırsa sıradakine geçilir.
const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite,gemini-2.0-flash').split(',');
const FAST_MODELS = (process.env.GROQ_FAST_MODELS || 'openai/gpt-oss-20b,openai/gpt-oss-120b').split(',');
const BIG_MODELS = (process.env.GROQ_BIG_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.6-27b').split(',');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
require('./auth')(app); // giriş sistemi: bundan sonraki tüm /api uçları oturum ister

// ---------- Yardımcılar ----------
async function timedFetch(url, opts, ms = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

// Hesabında gerçekten var olan modelleri sorar; kapatılmış modeller otomatik atlanır, yenisi bulunursa o kullanılır
const mcache = {};
async function groqModels(preferred) {
  let avail;
  try {
    if (!mcache.groq || Date.now() - mcache.groq.t > 6e5) {
      const r = await timedFetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${GROQ_KEY}` } }, 15000);
      if (r.status === 401) { const e = new Error('GROQ_API_KEY geçersiz. .env dosyasındaki Groq anahtarını kontrol et (gsk_ ile başlamalı, tırnak/boşluk olmamalı).'); e.fatal = true; throw e; }
      if (!r.ok) throw new Error('liste alınamadı');
      mcache.groq = { t: Date.now(), ids: (await r.json()).data.map(m => m.id) };
    }
    avail = mcache.groq.ids;
  } catch (e) { if (e.fatal) throw e; return preferred; }
  const ok = preferred.filter(m => avail.includes(m));
  const BAD = /whisper|guard|safeguard|tts|orpheus|compound|embed|distil|vision|prompt|playai/i, size = m => +(m.match(/(\d+)b/i)?.[1] || 0);
  const big = preferred === BIG_MODELS;
  const rest = avail.filter(m => !BAD.test(m) && !ok.includes(m)).sort((x, y) => (big ? size(y) - size(x) : size(x) - size(y)));
  const list = [...ok, ...rest.slice(0, 2)];
  if (!list.length) throw new Error('Groq hesabında kullanılabilir sohbet modeli bulunamadı.');
  return list;
}
async function geminiModels() {
  if (mcache.g && Date.now() - mcache.g.t < 18e5) return mcache.g.v;
  let v = GEMINI_MODELS;
  try {
    const r = await timedFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': GEMINI_KEY } }, 15000);
    if (r.ok) {
      const ids = ((await r.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace('models/', ''));
      const pref = GEMINI_MODELS.filter(m => ids.includes(m));
      const extra = ids.filter(m => /^gemini-[\d.]+-flash(-lite)?$/.test(m) && !pref.includes(m)).sort().reverse();
      if ([...pref, ...extra].length) v = [...pref, ...extra].slice(0, 4);
    }
  } catch {}
  mcache.g = { t: Date.now(), v }; return v;
}

async function callGemini(prompt, images = [], { maxTokens = 4096 } = {}) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY tanımlı değil');
  const errs = [];
  for (const model of await geminiModels()) {
    try {
      const r = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mime, data: i.data } }))] }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens } })
      }, 60000);
      if (!r.ok) throw new Error(`${model}: HTTP ${r.status}`);
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
      if (text) return { text, model };
      throw new Error(`${model}: boş yanıt`);
    } catch (e) { errs.push(e.message); console.warn('Gemini:', e.message); }
  }
  throw new Error(errs.join(' | ') || 'Gemini yanıt vermedi');
}

async function callGroq(preferred, messages, { json = false, temperature = 0.4, effort = 'low', maxTokens = 8000, timeout = 90000 } = {}) {
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY tanımlı değil');
  const errs = [];
  for (const model of await groqModels(preferred)) {
    try {
      const body = { model, messages, temperature, max_completion_tokens: maxTokens };
      if (json) body.response_format = { type: 'json_object' };
      if (model.includes('gpt-oss')) body.reasoning_effort = effort;
      const post = b => timedFetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` }, body: JSON.stringify(b) }, timeout);
      let r = await post(body);
      // JSON modu bazı modellerde 400 verebilir; JSON'u kendimiz ayıkladığımız için moddan çıkıp tekrar dene
      if (r.status === 400 && body.response_format) { delete body.response_format; r = await post(body); }
      if (r.status === 401) { const e = new Error('GROQ_API_KEY geçersiz. .env dosyasındaki Groq anahtarını kontrol et.'); e.fatal = true; throw e; }
      if (!r.ok) throw new Error(`${model}: HTTP ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 160)}`);
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model };
      throw new Error(`${model}: boş yanıt`);
    } catch (e) { if (e.fatal) throw e; errs.push(e.message); console.warn('Groq:', e.message); }
  }
  throw new Error(errs.join(' | '));
}

function extractJson(s) {
  s = String(s).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json|```/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('JSON bulunamadı');
  return JSON.parse(s.slice(a, b + 1));
}

const effortOf = sec => (sec >= 60 ? 'high' : sec >= 30 ? 'medium' : 'low');
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- Soru doğrulama ----------
// "Metne göre...", "Yukarıdaki şiirde..." gibi, ortada metin yokken metne gönderme yapan soruları yakalar.
const L = '(?<![\\p{L}])', R = '(?![\\p{L}])';
const REF = new RegExp(
  `${L}(yukarıdaki|aşağıdaki|verilen|bu|şu|söz konusu)\\s+(metin|metni|metnin|parça|parçanın|paragraf|şiir|şiirin|dize|dizeler|grafik|tablo|şekil|harita|görsel|resim|diyagram|diyalog|alıntı|cümle)${R}` +
  `|${L}(metne|parçaya|grafiğe|tabloya|şekle|haritaya|şiire|diyaloğa|görsele|resme) göre${R}` +
  `|${L}(metinde|parçada|şiirde|dizelerde|grafikte|tabloda|şekilde|haritada|görselde)${R}` +
  `|(^|[.?!:]\\s+)(metnin|parçanın|şiirin|dizenin|paragrafın|metindeki|parçadaki)${R}`, 'iu');
// Soru kökünün içine gerçekten bir parça yazılmışsa (tırnak içinde uzun alıntı) sorun yok
const hasEmbedded = t => /["“„«][^"”»]{50,}["”»]/.test(t) || t.length > 320;
const selfContained = t => !REF.test(t) || hasEmbedded(t);
const cleanTitle = (t, topics = []) => {
  t = String(t || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  if (!t || t.includes('?') || t.length > 70 || t.split(' ').length > 9)
    return topics.length ? `${topics.slice(0, 2).join(' ve ')} Sınavı`.slice(0, 70) : 'Genel Tekrar Sınavı';
  return t;
};
function normalizeQuiz(raw, p) {
  if (!raw || !Array.isArray(raw.questions)) throw new Error('questions dizisi yok');
  const out = [];
  for (const q of raw.questions) {
    if (!q || typeof q.question !== 'string' || q.question.trim().length < 8) continue;
    if (!selfContained(q.question)) continue; // metni olmayan "metne göre" soruları elenir
    const item = {
      question: q.question.trim(),
      topic: String(q.topic || '').trim().slice(0, 60),
      explanation: String(q.explanation || '').trim() || 'Açıklama üretilemedi.',
      isBonus: false
    };
    if (p.type === 'mc') {
      const opts = (q.options || []).map(o => String(o).replace(/^\s*[A-Ea-e][\)\.\:]\s+/, '').trim()).filter(Boolean);
      if (opts.length !== p.optionCount || new Set(opts.map(o => o.toLowerCase())).size !== opts.length) continue;
      let ci = q.correctAnswer;
      if (typeof ci === 'string') ci = /^[A-Ea-e]$/.test(ci.trim()) ? ci.trim().toUpperCase().charCodeAt(0) - 65 : parseInt(ci, 10);
      if (!Number.isInteger(ci) || ci < 0 || ci >= opts.length) continue;
      // Doğru cevabın hep aynı şıkta olmaması için karıştır
      const order = shuffle(opts.map((_, i) => i));
      item.options = order.map(i => opts[i]);
      item.correctAnswer = order.indexOf(ci);
    } else {
      const ans = String(q.correctAnswer || '').trim();
      if (ans.length < 2) continue;
      item.options = [];
      item.correctAnswer = ans;
    }
    item.isBonus = q.isBonus === true;
    out.push(item);
  }
  const seen = new Set();
  const uniq = out.filter(q => { const k = q.question.toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; });
  // Bonus soru, istenen soru sayısına EK olarak gelir (ör. 6 soru + 1 bonus = 7)
  let degraded = false;
  const flagged = uniq.find(q => q.isBonus);
  uniq.forEach(q => (q.isBonus = false));
  let bonusQ = p.bonus ? flagged || null : null;
  const normals = uniq.filter(q => q !== bonusQ);
  if (normals.length < p.count) throw new Error(`Yalnızca ${normals.length}/${p.count} geçerli soru üretildi`);
  const qs = normals.slice(0, p.count);
  if (p.bonus) {
    bonusQ = bonusQ || (normals.length > p.count ? normals[p.count] : null); // dizi sınırı kontrolü
    if (!bonusQ) {
      if (!p.allowDegraded) throw new Error('Bonus soru için yeterli ek soru üretilemedi');
      bonusQ = qs.pop(); // güvenli yedek: son soru bonusa çevrilir, toplam soru sayısı korunur
      degraded = true;
    }
    if (bonusQ) { bonusQ.isBonus = true; qs.push(bonusQ); }
  }
  qs.forEach((q, i) => (q.id = i + 1));
  // Başlık her zaman Ajan 2'nin belirlediği sınav konusundan gelir (modelin ürettiği rastgele başlıktan değil)
  return { title: String(p.title || 'Deneme Sınavı').slice(0, 120), questions: qs, degraded };
}

function buildPrompt(p) {
  const fmt = p.type === 'mc'
    ? `ÇOKTAN SEÇMELİ. Her soruda TAM OLARAK ${p.optionCount} şık, "options" dizisinde düz metin olarak (başına A), B) gibi harf KOYMA). "correctAnswer" doğru şıkkın 0 tabanlı indeksi (sayı).
- Yalnızca bir şık kesin doğru olsun; diğerleri makul ama net biçimde yanlış çeldiriciler olsun.
- "Hepsi", "Hiçbiri", "A ve B" gibi şıklar kullanma. Şık uzunlukları birbirine yakın olsun.`
    : `AÇIK UÇLU. "options" boş dizi []. "correctAnswer" 1-3 cümlelik, gerekli anahtar kavramları içeren model cevap (metin).`;
  return `Sen deneyimli bir ölçme-değerlendirme uzmanısın. Aşağıdaki ders materyaline dayanarak sınav hazırla.

KURALLAR:
1. Toplam ${p.total} soru üret (bazıları kalite kontrolünde elenebilir). ${p.bonus ? 'Bunlardan YALNIZCA BİR tanesi bonus soru olsun ("isBonus": true) ve diğerlerinden daha zor olsun; kalan hepsinde "isBonus": false.' : 'Hepsinde "isBonus": false.'}
2. Sorular YALNIZCA materyaldeki bilgilere dayansın; materyalde olmayan bilgi uydurma. Materyalde hazır sınav soruları (görselden okunmuş olabilir) varsa uygun olanları cevabıyla birlikte kullanabilir veya benzerlerini yazabilirsin.
3. Sorular materyalin farklı konularına dengeli dağılsın${p.topics?.length ? ` (konular: ${p.topics.join('; ')})` : ''}; aynı bilgiyi tekrar sorma.
4. Zorluk: ${p.difficulty}.${p.level ? ` Öğrenci seviyesi: ${p.level}; dil ve içeriği buna uygun tut.` : ''} ${p.difficulty.includes('LGS') ? 'Yorum, çıkarım ve kavrama düzeyinde, ÖSYM/MEB tarzı sorular yaz.' : 'Ezberden çok kavramayı ölç.'}
5. Her soru TEK BAŞINA cevaplanabilmeli. Ortada olmayan bir metne, şiire, paragrafa, tabloya, grafiğe, şekle, haritaya veya görsele ASLA gönderme yapma ("metne göre", "metnin türü", "yukarıdaki şiirde", "tabloya göre" gibi ifadeler YASAK).
6. Bir parça gerekiyorsa o parçayı soru kökünün İÇİNE tırnak işaretiyle eksiksiz yaz; yoksa o tür soruyu hiç sorma. Bilgi, kavram, ilişki ve yorum soruları sor.
7. "explanation": doğru cevabın neden doğru olduğunu 1-2 cümleyle açıkla.
8. "topic": sorunun ait olduğu konu; ${p.topics?.length ? 'yukarıdaki konu listesinden birini aynen yaz' : 'kısa bir konu adı yaz (en fazla 4 kelime)'}.
9. Dil: Türkçe. Yanıt SADECE geçerli bir JSON nesnesi olsun.

FORMAT: ${fmt}

ÇIKTI ŞEMASI:
{"title":"${p.title}","questions":[{"question":"...","topic":"...","options":[...],"correctAnswer":${p.type === 'mc' ? '0' : '"..."'},"explanation":"...","isBonus":false}]}

MATERYAL:
"""
${p.summary}
"""`;
}

// ---------- Uç noktalar ----------
app.get('/api/health', (_, res) => res.json({ gemini: !!GEMINI_KEY, groq: !!GROQ_KEY }));

app.post('/api/parse-pdf', upload.array('pdfs'), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'PDF bulunamadı.' });
    let text = ''; const warnings = [];
    for (const f of req.files) {
      try {
        const parsed = await pdfParse(f.buffer);
        const t = (parsed.text || '').replace(/\s+\n/g, '\n').trim();
        if (t.length < 50) warnings.push(`${f.originalname}: metin okunamadı (taranmış/görsel PDF olabilir).`);
        text += `--- ${f.originalname} ---\n${t}\n\n`;
      } catch (e) { warnings.push(`${f.originalname}: ${e.message}`); }
    }
    res.json({ text, warnings });
  } catch (e) { res.status(500).json({ error: 'PDF okunamadı: ' + e.message }); }
});

// Ajan 1: Belge Analisti (Gemini) - belgenin TAMAMINI parçalara bölerek özetler
app.post('/api/agent1-analyst', async (req, res) => {
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Metin boş.' });
  const MAX = 40000;
  const src = text.length > MAX ? text.slice(0, MAX) : text;
  if (src.length < 1500) return res.json({ result: src, model: 'doğrudan' });
  const chunks = [];
  for (let i = 0; i < src.length; i += 10000) chunks.push(src.slice(i, i + 10000));
  try {
    const parts = await Promise.all(chunks.map((c, i) => callGemini(
      `Aşağıdaki ders materyali bölümünü (${i + 1}/${chunks.length}) sınav hazırlamak için özetle. ` +
      `Önemli kavramları, tanımları, tarih/isim/sayı gibi somut bilgileri, neden-sonuç ilişkilerini madde madde ve Türkçe yaz. ` +
      `Materyalde olmayan bilgi ekleme.\n\n"""${c}"""`).then(r => r.text)));
    res.json({ result: parts.join('\n\n').slice(0, 14000), model: 'gemini' });
  } catch (e) {
    console.warn('Ajan1 yedek:', e.message);
    res.json({ result: src.slice(0, 12000), model: 'yedek', warning: e.message });
  }
});

// Ajan 2: Senaryo Mimarı - başlık + konu haritası
app.post('/api/agent2-scenario', async (req, res) => {
  const summary = String(req.body.summary || '').slice(0, 6000);
  const courses = (Array.isArray(req.body.courses) ? req.body.courses : []).map(c => String(c).slice(0, 40)).slice(0, 40);
  try {
    const r = await callGroq(FAST_MODELS, [{ role: 'user', content:
      `Aşağıdaki ders materyalini incele ve şunları belirle:\n` +
      `1. "title": materyalin GENEL KONUSUNU anlatan kısa bir sınav başlığı (3-7 kelime). Başlık bir soru, bir cümle veya materyaldeki tek bir ayrıntı OLMASIN; tüm materyali kapsayan konuyu yansıtsın. Örnek: "Kurtuluş Savaşı Cepheleri Sınavı".\n` +
      `2. "topics": ana konular (3-8 adet, kısa).\n` +
      `3. "course": ${courses.length ? `şu ders listesinden materyale en uygun olanı AYNEN seç; hiçbiri uymuyorsa boş string yaz: ${JSON.stringify(courses)}` : 'boş string'}.\n` +
      `Yalnızca JSON: {"title":"...","topics":["..."],"course":"..."}\n\nMateryal:\n"""${summary}"""` }],
      { json: true, temperature: 0.2, effort: 'low', maxTokens: 1500, timeout: 30000 });
    const j = extractJson(r.text);
    const topics = Array.isArray(j.topics) ? j.topics.slice(0, 8).map(String) : [];
    const course = courses.find(c => c.toLowerCase() === String(j.course || '').trim().toLowerCase()) || '';
    res.json({ title: cleanTitle(j.title, topics), topics, course });
  } catch (e) {
    console.warn('Ajan2 yedek:', e.message);
    res.json({ title: 'Genel Tekrar Sınavı', topics: [], course: '', warning: e.message });
  }
});

// Sınıf + dönem için ders listesi
app.post('/api/courses/suggest', async (req, res) => {
  const grade = String(req.body.grade || '').trim().slice(0, 40), term = String(req.body.term || '').slice(0, 1), field = String(req.body.field || '').trim().slice(0, 80);
  if (!grade) return res.status(400).json({ error: 'Sınıf seçilmedi.' });
  try {
    const r = await callGroq(BIG_MODELS, [{ role: 'user', content:
      `Türkiye'deki güncel MEB müfredatını esas alarak "${grade}" öğrencisinin ${term || '1'}. dönemde okuduğu dersleri listele${field ? ` (alan/bölüm: ${field})` : ''}. ` +
      `Üniversite veya mezun ise o alanın tipik derslerini yaz. Seçmeli dersleri en fazla 3 tane ekle. Ders adlarını kısa ve standart yaz (ör. "Matematik", "Türk Dili ve Edebiyatı"). Emin olmadığın dersi ekleme.\n` +
      `Yalnızca JSON: {"courses":["..."]} (en fazla 16 ders)` }],
      { json: true, temperature: 0.2, effort: 'low', maxTokens: 1500, timeout: 40000 });
    const list = [...new Set((extractJson(r.text).courses || []).map(x => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 16);
    if (!list.length) throw new Error('Ders listesi boş geldi');
    res.json({ courses: list });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Ajan 3: Sınav Üreticisi - doğrulanana kadar 3 deneme
app.post('/api/agent3-generator', async (req, res) => {
  const b = req.body || {};
  const p = {
    summary: String(b.summary || '').slice(0, 14000),
    title: String(b.title || 'Deneme Sınavı').replace(/"/g, "'"),
    topics: Array.isArray(b.topics) ? b.topics : [],
    count: Math.min(Math.max(parseInt(b.count, 10) || 6, 1), 20),
    type: b.type === 'open' ? 'open' : 'mc',
    optionCount: Math.min(Math.max(parseInt(b.optionCount, 10) || 4, 2), 5),
    difficulty: String(b.difficulty || 'Orta'),
    bonus: !!b.bonus, level: String(b.level || '').slice(0, 60),
    effort: effortOf(parseInt(b.budget, 10) || 30)
  };
  p.total = p.count + (p.bonus ? 1 : 0) + 3; // elenenlere karşı fazladan üret
  if (p.summary.length < 20) return res.status(400).json({ error: 'Materyal çok kısa.' });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await callGroq(BIG_MODELS, [
        { role: 'system', content: 'Yalnızca geçerli JSON döndüren bir sınav üretim motorusun.' },
        { role: 'user', content: buildPrompt(p) }
      ], { json: true, temperature: attempt === 1 ? 0.5 : 0.3, effort: p.effort, maxTokens: 12000 });
      const { degraded, ...quiz } = normalizeQuiz(extractJson(r.text), { ...p, allowDegraded: attempt === 3 });
      return res.json({ quiz, model: r.model, attempts: attempt, warning: degraded ? 'Yeterli ek soru üretilemediği için son soru bonus olarak işaretlendi.' : undefined });
    } catch (e) { lastErr = e; console.warn(`Ajan3 deneme ${attempt}:`, e.message); if (e.fatal) break; }
  }
  res.status(500).json({ error: 'Sınav üretilemedi: ' + (lastErr?.message || 'bilinmeyen hata') });
});

// Ajan 4: Değerlendirici - (verify) soru-cevap denetimi, (grade) açık uçlu notlama
app.post('/api/agent4-evaluator', async (req, res) => {
  const { mode } = req.body || {};
  try {
    if (mode === 'verify') {
      const { quiz, summary } = req.body;
      const qs = (quiz?.questions || []).filter(q => q.options?.length);
      if (!qs.length) return res.json({ fixed: 0, quiz });
      const list = qs.map(q => ({ id: q.id, question: q.question, options: q.options, marked: q.correctAnswer }));
      const r = await callGroq(BIG_MODELS, [{ role: 'user', content:
        `Materyale göre her sorunun işaretli doğru şık indeksini (0 tabanlı) denetle. Materyale göre başka bir şık doğruysa düzelt.\n` +
        `Yalnızca JSON: {"checks":[{"id":1,"correct":2}]}\n\nSorular:\n${JSON.stringify(list)}\n\nMateryal:\n"""${String(summary || '').slice(0, 8000)}"""` }],
        { json: true, temperature: 0, effort: 'low', maxTokens: 4000, timeout: 45000 });
      let fixed = 0;
      for (const c of extractJson(r.text).checks || []) {
        const q = quiz.questions.find(x => x.id === c.id);
        if (q && Number.isInteger(c.correct) && c.correct >= 0 && c.correct < q.options.length && c.correct !== q.correctAnswer) { q.correctAnswer = c.correct; fixed++; }
      }
      return res.json({ fixed, quiz });
    }
    if (mode === 'grade') {
      const items = (req.body.items || []).slice(0, 20);
      const r = await callGroq(FAST_MODELS, [{ role: 'user', content:
        `Öğrencinin açık uçlu cevaplarını model cevaba göre değerlendir. Anlam doğruysa farklı kelimeler kullanılsa da kabul et. ` +
        `Boş veya alakasız cevaba 0 ver. Puan: 0 (yanlış), 0.5 (kısmen doğru), 1 (doğru). "feedback": en fazla 1 kısa Türkçe cümle.\n` +
        `Yalnızca JSON: {"results":[{"id":1,"score":1,"feedback":"..."}]}\n\n${JSON.stringify(items)}` }],
        { json: true, temperature: 0, effort: 'low', maxTokens: 3000, timeout: 40000 });
      return res.json({ results: extractJson(r.text).results || [] });
    }
    res.status(400).json({ error: 'Geçersiz mod.' });
  } catch (e) {
    console.warn('Ajan4:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Görselden metin/soru okuma (Gemini Vision)
const uploadImg = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 6 }, fileFilter: (_, f, cb) => cb(null, /^image\/(png|jpe?g|webp)$/.test(f.mimetype)) });
const OCR_PROMPT = `Bu görsellerdeki (ders notu, kitap sayfası, tahta, soru kâğıdı, ekran görüntüsü olabilir) TÜM yazıları, soruları, şıkları, tabloları ve formülleri eksiksiz oku ve düzenli Türkçe metin olarak yaz.
- Görselde olmayan hiçbir şey ekleme, yorum yapma, özetleme.
- Birden fazla görsel varsa her birinin başına "--- Görsel N ---" yaz.
- Soru ve şıklar varsa numaralarıyla koru; cevap anahtarı görünüyorsa belirt.
- Okunamayan yeri [okunamadı] ile işaretle.
Yalnızca okunan metni döndür.`;
app.post('/api/ocr', (req, res, next) => uploadImg.array('images', 6)(req, res, err => err ? res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Her görsel en fazla 8 MB olabilir.' : 'Görsel yüklenemedi: ' + err.message }) : next()), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Geçerli görsel bulunamadı (PNG, JPG veya WEBP).' });
  if (files.reduce((t, f) => t + f.size, 0) > 18 * 1024 * 1024) return res.status(413).json({ error: 'Görseller toplamda 18 MB\'ı geçemez.' });
  if (!GEMINI_KEY) return res.status(400).json({ error: 'Görsel okuma için GEMINI_API_KEY gerekli.' });
  try {
    const r = await callGemini(OCR_PROMPT, files.map(f => ({ mime: f.mimetype, data: f.buffer.toString('base64') })), { maxTokens: 8192 });
    const text = r.text.trim().slice(0, 30000);
    if (text.replace(/\s|\[okunamadı\]/g, '').length < 10) return res.status(422).json({ error: 'Görselde okunabilir metin bulunamadı. Daha net bir fotoğraf dene.' });
    res.json({ text, model: r.model, count: files.length });
  } catch (e) { res.status(502).json({ error: 'Görsel okunamadı: ' + e.message }); }
});

// AI sohbet koçu: yanlış yapılan soru hakkında birebir sohbet
const chatHits = new Map();
app.post('/api/chat-coach', async (req, res) => {
  const now = Date.now(), hits = (chatHits.get(req.user.id) || []).filter(t => now - t < 60000);
  if (hits.length >= 20) return res.status(429).json({ error: 'Çok hızlı yazıyorsun, bir dakika sonra tekrar dene.' });
  chatHits.set(req.user.id, [...hits, now]);
  const q = req.body.question || {}, message = String(req.body.message || '').trim().slice(0, 1000);
  if (!message || typeof q.question !== 'string') return res.status(400).json({ error: 'Soru veya mesaj eksik.' });
  const options = Array.isArray(q.options) ? q.options.slice(0, 5).map(o => String(o).slice(0, 300)) : [];
  const correct = options.length && Number.isInteger(q.correctAnswer) ? options[q.correctAnswer] : String(q.correctAnswer ?? '').slice(0, 600);
  const history = (Array.isArray(req.body.history) ? req.body.history : []).slice(-10).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content || '').slice(0, 1500) }));
  const system = `Sen sabırlı, samimi ve cesaretlendirici bir özel ders hocasısın. Öğrenci aşağıdaki soruyu yanlış yaptı veya anlamadı; onunla birebir sohbet ediyorsun.
SORU: ${String(q.question).slice(0, 1500)}
${options.length ? 'ŞIKLAR:\\n' + options.map((o, i) => `${'ABCDE'[i]}) ${o}`).join('\\n') + '\\n' : ''}DOĞRU CEVAP: ${correct}
ÖĞRENCİNİN CEVABI: ${String(req.body.userAnswer || 'Boş bıraktı').slice(0, 600)}
HAZIR AÇIKLAMA: ${String(q.explanation || '').slice(0, 800)}
KONU: ${String(q.topic || '').slice(0, 80)}
KURALLAR: Türkçe yaz. Kısa ve net ol (en fazla yaklaşık 150 kelime; gerekirse kısa maddeler). Öğrencinin hatasını nazikçe ve somut göster: hangi düşünce adımı yanlış gitti? "Daha basit" istenirse günlük hayattan bir örnek veya benzetme kullan. Cevabı doğru cevapla tutarlı anlat; bilmediğin şeyi uydurma. Soruyla ilgisiz bir şey sorulursa nazikçe soruya dön.`;
  try {
    const r = await callGroq(BIG_MODELS, [{ role: 'system', content: system }, ...history, { role: 'user', content: message }], { temperature: 0.5, effort: 'low', maxTokens: 1500, timeout: 45000 });
    res.json({ reply: r.text.replace(/<think>[\s\S]*?<\/think>/g, '').trim() });
  } catch (e) { res.status(502).json({ error: 'Koç şu an yanıt veremiyor: ' + e.message }); }
});

// Ezber kartı üretici
app.post('/api/ezber', async (req, res) => {
  const topic = String(req.body.topic || '').trim().slice(0, 150), material = String(req.body.material || '').trim().slice(0, 8000);
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 15, 5), 40);
  const courses = (Array.isArray(req.body.courses) ? req.body.courses : []).map(c => String(c).slice(0, 40)).slice(0, 40);
  if (topic.length < 2) return res.status(400).json({ error: 'Bir konu yaz.' });
  const prompt = `Sen bir hafıza ve ezber koçusun. Konu: "${topic}".
${material ? `Yalnızca şu materyaldeki bilgileri kullan:\n"""${material}"""` : 'Materyal verilmedi; yalnızca kesin bildiğin doğru bilgileri kullan, emin olmadığın bilgiyi YAZMA.'}
Tam ${count} adet ezber kartı üret. Her kart: "front" (kısa soru, kavram veya ipucu), "back" (kısa ve net cevap, en fazla 25 kelime), "mnemonic" (bu bilgiyi akılda tutmak için kısa bir hafıza ipucu: kafiye, akrostiş veya canlandırma; en fazla 20 kelime).
Kartlar kolaydan zora doğru, birbirinden bağımsız ve tekrarsız olsun. Ayrıca "tip": bu konuyu topluca ezberlemek için 2-3 cümlelik bir teknik önerisi yaz. Dil: Türkçe.
${courses.length ? `"course": şu listeden konuya en uygun dersi AYNEN seç, uymuyorsa boş string: ${JSON.stringify(courses)}.\n` : ''}Yalnızca JSON döndür: {"title":"kısa deste adı","course":"","tip":"...","cards":[{"front":"...","back":"...","mnemonic":"..."}]}`;
  let lastErr;
  for (let a = 1; a <= 2; a++) {
    try {
      const r = await callGroq(BIG_MODELS, [{ role: 'system', content: 'Yalnızca geçerli JSON döndürürsün.' }, { role: 'user', content: prompt }], { json: true, temperature: 0.4, effort: 'low', maxTokens: 8000 });
      const j = extractJson(r.text), seen = new Set();
      const cards = (j.cards || []).map(c => ({ f: String(c.front || '').trim().slice(0, 300), b: String(c.back || '').trim().slice(0, 400), m: String(c.mnemonic || '').trim().slice(0, 200) }))
        .filter(c => c.f && c.b && !seen.has(c.f.toLowerCase()) && seen.add(c.f.toLowerCase()));
      if (cards.length < Math.ceil(count * 0.7)) throw new Error(`Yalnızca ${cards.length} kart üretildi`);
      return res.json({ title: String(j.title || topic).slice(0, 100), course: courses.find(c => c.toLowerCase() === String(j.course || '').trim().toLowerCase()) || '', tip: String(j.tip || '').slice(0, 500), cards: cards.slice(0, count) });
    } catch (e) { lastErr = e; console.warn('Ezber:', e.message); if (e.fatal) break; }
  }
  res.status(500).json({ error: 'Kartlar üretilemedi: ' + lastErr.message });
});

// Haftalık çalışma koçu
app.post('/api/coach', async (req, res) => {
  const stats = JSON.stringify(req.body.stats || {}).slice(0, 3000);
  try {
    const r = await callGroq(FAST_MODELS, [{ role: 'user', content:
      `Sen samimi ve motive edici bir çalışma koçusun. Öğrencinin son 7 günlük verisi: ${stats}\nBuna göre Türkçe, kısa ve somut bir haftalık plan hazırla. Veride olmayan konu uydurma; veri yoksa genel bir başlangıç planı ver.\n` +
      `Yalnızca JSON: {"summary":"2-3 cümle değerlendirme","focus":["en fazla 3 konu"],"plan":[{"day":"Pazartesi","task":"kısa görev"}],"motivation":"1 cümle"} (plan 7 gün olsun)` }],
      { json: true, temperature: 0.5, effort: 'low', maxTokens: 2500, timeout: 40000 });
    const j = extractJson(r.text);
    res.json({ summary: String(j.summary || ''), focus: (j.focus || []).slice(0, 3).map(String), plan: (j.plan || []).slice(0, 7).map(p => ({ day: String(p.day || ''), task: String(p.task || '') })), motivation: String(j.motivation || '') });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.get('/', (_, res) => {
  const f = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(fs.existsSync);
  f ? res.sendFile(f) : res.status(404).send('index.html bulunamadı (public/ klasörüne koyun).');
});

app.listen(PORT, () => console.log(`🚀 QuizCraft AI Pro ${PORT} portunda aktif`));
