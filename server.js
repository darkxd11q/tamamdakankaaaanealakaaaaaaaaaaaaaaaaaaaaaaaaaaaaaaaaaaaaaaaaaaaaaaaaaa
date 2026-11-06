const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const basicAuth = require('express-basic-auth');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const siteUser = process.env.SITE_USER || 'admin';
const sitePass = process.env.SITE_PASS || '123456';

app.use(basicAuth({
    users: { [siteUser]: sitePass },
    challenge: true,
    realm: 'QuizCraft AI Pro Koruma Alanı'
}));

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// PDF Okuma Proxy
app.post('/api/parse-pdf', upload.array('pdfs'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'PDF bulunamadı.' });
        let fullText = '';
        for (const file of req.files) {
            const parsed = await pdfParse(file.buffer);
            fullText += `--- PDF: ${file.originalname} ---\n` + parsed.text + '\n\n';
        }
        res.json({ text: fullText });
    } catch (err) {
        res.status(500).json({ error: 'PDF okunamadı: ' + err.message });
    }
});

// Ajan 1: Belge Analisti (Gemini)
app.post('/api/agent1-analyst', async (req, res) => {
    const { text } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    const models = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];

    for (const model of models) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Aşağıdaki ders materyalini analiz ederek pedagojik özet çıkar:\n"${text.substring(0, 4000)}"` }] }]
                })
            });
            if (response.ok) {
                const data = await response.json();
                const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (summary) return res.json({ result: summary, model });
            }
        } catch (e) { console.warn(e); }
    }
    res.json({ result: text.substring(0, 4000) });
});

// Ajan 2: Senaryo Mimarı (Groq 8B)
app.post('/api/agent2-scenario', async (req, res) => {
    const { summary } = req.body;
    const apiKey = process.env.GROQ_API_KEY;
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: `Bu materyal için kısa bir sınav başlığı belirle. Yalnızca JSON döndür: {"title": "Başlık"}. Materyal: "${summary.substring(0, 1000)}"` }],
                temperature: 0.5
            })
        });
        if (response.ok) {
            const data = await response.json();
            return res.json({ result: data.choices[0].message.content });
        }
    } catch (e) { console.warn(e); }
    res.json({ result: '{"title": "Kapsamlı Deneme Sınavı"}' });
});

// Ajan 3: Sınav Üreticisi (Groq 70B) - Hata Korumalı & Syntax Düzeltilmiş
app.post('/api/agent3-generator', async (req, res) => {
    const { prompt } = req.body;
    const apiKey = process.env.GROQ_API_KEY;
    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7
            })
        });
        if (response.ok) {
            const data = await response.json();
            return res.json({ result: data.choices[0].message.content });
        } else {
            const errBody = await response.text(); // 'await.text()' hatası düzeltildi!
            throw new Error(`Groq API Hatası (${response.status}): ${errBody}`);
        }
    } catch (e) {
        console.error("Ajan 3 Hatası:", e);
        const fallbackJSON = {
            "title": "Güvenli Deneme Sınavı",
            "questions": [
                {
                    "id": 1,
                    "question": "Sistem otomatik yedek moduna geçti. Bu materyalin temel odağı nedir?",
                    "options": ["Temel Bilgiler ve Kavramlar", "İleri Düzey Uygulamalar", "Özet Tekrar", "Genel Değerlendirme"],
                    "correctAnswer": 0,
                    "explanation": "Yoğunluk veya API kısıtlamasında sistemin kesintisiz devam etmesini sağlayan yedek sorudur."
                }
            ]
        };
        return res.json({ result: JSON.stringify(fallbackJSON), isFallback: true });
    }
});

// Ajan 4: Değerlendirici
app.post('/api/agent4-evaluator', async (req, res) => {
    res.json({ status: 'success' });
});

app.listen(PORT, () => {
    console.log(`🚀 QuizCraft AI Pro Backend Port ${PORT} Üzerinde Başarıyla Başlatıldı!`);
});