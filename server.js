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
                    contents: [{ parts: [{ text: `Aşağıdaki ders materyalini analiz ederek detaylı bir özet çıkar:\n"${text.substring(0, 4000)}"` }] }]
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
                messages: [{ role: 'user', content: `Bu materyal için akıllı bir sınav başlığı belirle. Yalnızca ham JSON döndür: {"title": "Başlık"}. Materyal: "${summary.substring(0, 1000)}"` }],
                temperature: 0.5
            })
        });
        if (response.ok) {
            const data = await response.json();
            let content = data.choices[0].message.content.trim();
            if (content.includes('```json')) content = content.split('```json')[1].split('```')[0].trim();
            else if (content.includes('```')) content = content.split('```')[1].split('```')[0].trim();
            return res.json({ result: content });
        }
    } catch (e) { console.warn(e); }
    res.json({ result: '{"title": "Kapsamlı Deneme Sınavı"}' });
});

// Ajan 3: Sınav Üreticisi (Groq 70B) - URL Hatası Düzeltildi
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
            let rawContent = data.choices[0].message.content.trim();
            
            if (rawContent.includes('```json')) {
                rawContent = rawContent.split('```json')[1].split('```')[0].trim();
            } else if (rawContent.includes('```')) {
                rawContent = rawContent.split('```')[1].split('```')[0].trim();
            }

            return res.json({ result: rawContent });
        } else {
            const errBody = await response.text();
            throw new Error(`Groq API Hatası (${response.status}): ${errBody}`);
        }
    } catch (e) {
        console.error("Ajan 3 Hatası:", e);
        res.status(500).json({ error: 'Soru üretilemedi: ' + e.message });
    }
});

// Ajan 4: Değerlendirici
app.post('/api/agent4-evaluator', async (req, res) => {
    res.json({ status: 'success' });
});

app.listen(PORT, () => {
    console.log(`🚀 QuizCraft AI Pro Backend Port ${PORT} Üzerinde Aktif!`);
});