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
const FAST_MODELS = (process.env.GROQ_FAST_MODELS || 'openai/gpt-oss-20b,llama-3.1-8b-instant').split(',');
const BIG_MODELS = (process.env.GROQ_BIG_MODELS || 'openai/gpt-oss-120b,llama-3.3-70b-versatile').split(',');

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

async function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY tanımlı değil');
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      const r = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
        })
      }, 60000);
      if (!r.ok) throw new Error(`${model}: HTTP ${r.status}`);
      const d = await r.json();
      const text = d.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
      if (text) return { text, model };
      throw new Error(`${model}: boş yanıt`);
    } catch (e) { lastErr = e; console.warn('Gemini:', e.message); }
  }
  throw lastErr || new Error('Gemini yanıt vermedi');
}

async function callGroq(models, messages, { json = false, temperature = 0.4, effort = 'low', maxTokens = 8000, timeout = 90000 } = {}) {
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY tanımlı değil');
  let lastErr;
  for (const model of models) {
    try {
      const body = { model, messages, temperature, max_completion_tokens: maxTokens };
      if (json) body.response_format = { type: 'json_object' };
      if (model.includes('gpt-oss')) body.reasoning_effort = effort;
      const r = await timedFetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
        body: JSON.stringify(body)
      }, timeout);
      if (r.status === 401) { const e = new Error('GROQ_API_KEY geçersiz. .env dosyasındaki Groq anahtarını kontrol et (gsk_ ile başlamalı, tırnak/boşluk olmamalı).'); e.fatal = true; throw e; }
      if (!r.ok) throw new Error(`${model}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      const d = await r.json();
      const text = d.choices?.[0]?.message?.content?.trim();
      if (text) return { text, model };
      throw new Error(`${model}: boş yanıt`);
    } catch (e) { lastErr = e; console.warn('Groq:', e.message); if (e.fatal) throw e; }
  }
  throw lastErr;
}

function extractJson(s) {
  s = String(s).replace(/```json|```/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('JSON bulunamadı');
  return JSON.parse(s.slice(a, b + 1));
}

const effortOf = sec => (sec >= 60 ? 'high' : sec >= 30 ? 'medium' : 'low');
const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- Soru doğrulama ----------
function normalizeQuiz(raw, p) {
  if (!raw || !Array.isArray(raw.questions)) throw new Error('questions dizisi yok');
  const out = [];
  for (const q of raw.questions) {
    if (!q || typeof q.question !== 'string' || q.question.trim().length < 8) continue;
    const item = {
      question: q.question.trim(),
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
  if (uniq.length < p.count) throw new Error(`Yalnızca ${uniq.length}/${p.count} geçerli soru üretildi`);
  const qs = uniq.slice(0, p.count);
  // Bonus soru: ayarlıysa tam bir tane ve sonda
  qs.forEach(q => (q.isBonus = false));
  if (p.bonus) qs[qs.length - 1].isBonus = true;
  qs.forEach((q, i) => (q.id = i + 1));
  return { title: String(raw.title || p.title || 'Deneme Sınavı').slice(0, 120), questions: qs };
}

function buildPrompt(p) {
  const fmt = p.type === 'mc'
    ? `ÇOKTAN SEÇMELİ. Her soruda TAM OLARAK ${p.optionCount} şık, "options" dizisinde düz metin olarak (başına A), B) gibi harf KOYMA). "correctAnswer" doğru şıkkın 0 tabanlı indeksi (sayı).
- Yalnızca bir şık kesin doğru olsun; diğerleri makul ama net biçimde yanlış çeldiriciler olsun.
- "Hepsi", "Hiçbiri", "A ve B" gibi şıklar kullanma. Şık uzunlukları birbirine yakın olsun.`
    : `AÇIK UÇLU. "options" boş dizi []. "correctAnswer" 1-3 cümlelik, gerekli anahtar kavramları içeren model cevap (metin).`;
  return `Sen deneyimli bir ölçme-değerlendirme uzmanısın. Aşağıdaki ders materyaline dayanarak sınav hazırla.

KURALLAR:
1. Tam olarak ${p.count} soru üret${p.bonus ? `; sonuncusu daha zor bir bonus soru olsun ("isBonus": true), diğerleri false` : '; hepsinde "isBonus": false'}.
2. Sorular YALNIZCA materyaldeki bilgilere dayansın; materyalde olmayan bilgi uydurma.
3. Sorular materyalin farklı konularına dengeli dağılsın${p.topics?.length ? ` (konular: ${p.topics.join('; ')})` : ''}; aynı bilgiyi tekrar sorma.
4. Zorluk: ${p.difficulty}. ${p.difficulty.includes('LGS') ? 'Yorum, çıkarım ve kavrama düzeyinde, ÖSYM/MEB tarzı sorular yaz.' : 'Ezberden çok kavramayı ölç.'}
5. ${p.visual ? 'En az bir soruyu metin tabanlı tablo, zaman çizelgesi veya şema (soru kökünde açıkça verilen) üzerinden yorumlatarak sor.' : 'Soru kökleri kendi içinde anlaşılır olsun.'}
6. Soru kökünde "yukarıdaki metin" gibi dış referans verme; sorular tek başına anlaşılsın.
7. "explanation": doğru cevabın neden doğru olduğunu 1-2 cümleyle açıkla.
8. Dil: Türkçe. Yanıt SADECE geçerli bir JSON nesnesi olsun.

FORMAT: ${fmt}

ÇIKTI ŞEMASI:
{"title":"${p.title}","questions":[{"question":"...","options":[...],"correctAnswer":${p.type === 'mc' ? '0' : '"..."'},"explanation":"...","isBonus":false}]}

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
  try {
    const r = await callGroq(FAST_MODELS, [{ role: 'user', content:
      `Aşağıdaki materyal için kısa ve akıllı bir sınav başlığı (en fazla 8 kelime) ve materyalin ana konularını (3-8 adet, kısa) belirle. ` +
      `Yalnızca JSON döndür: {"title":"...","topics":["...","..."]}\n\nMateryal:\n"""${summary}"""` }],
      { json: true, temperature: 0.3, effort: 'low', maxTokens: 1500, timeout: 30000 });
    const j = extractJson(r.text);
    res.json({ title: String(j.title || 'Deneme Sınavı'), topics: Array.isArray(j.topics) ? j.topics.slice(0, 8).map(String) : [] });
  } catch (e) {
    console.warn('Ajan2 yedek:', e.message);
    res.json({ title: 'Kapsamlı Deneme Sınavı', topics: [], warning: e.message });
  }
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
    bonus: !!b.bonus, visual: !!b.visual,
    effort: effortOf(parseInt(b.budget, 10) || 30)
  };
  if (p.summary.length < 20) return res.status(400).json({ error: 'Materyal çok kısa.' });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await callGroq(BIG_MODELS, [
        { role: 'system', content: 'Yalnızca geçerli JSON döndüren bir sınav üretim motorusun.' },
        { role: 'user', content: buildPrompt(p) }
      ], { json: true, temperature: attempt === 1 ? 0.5 : 0.3, effort: p.effort, maxTokens: 12000 });
      const quiz = normalizeQuiz(extractJson(r.text), p);
      return res.json({ quiz, model: r.model, attempts: attempt });
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

app.get('/', (_, res) => {
  const f = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')].find(fs.existsSync);
  f ? res.sendFile(f) : res.status(404).send('index.html bulunamadı (public/ klasörüne koyun).');
});

app.listen(PORT, () => console.log(`🚀 QuizCraft AI Pro ${PORT} portunda aktif`));
