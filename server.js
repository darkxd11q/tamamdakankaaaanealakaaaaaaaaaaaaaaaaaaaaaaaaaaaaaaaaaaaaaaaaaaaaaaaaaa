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

// --- PDF PARSE PROXY ---
app.post('/api/parse-pdf', upload.array('pdfs'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'PDF dosyası yüklenmedi.' });
        }
        let fullText = '';
        for (const file of req.files) {
            const parsed = await pdfParse(file.buffer);
            fullText += `--- PDF: ${file.originalname} ---\n` + parsed.text + '\n\n';
        }
        res.json({ text: fullText });
    } catch (err) {
        console.error('PDF Parse Hatası:', err);
        res.status(500).json({ error: 'PDF okunamadı: ' + err.message });
    }
});

// --- AGENT 1: GEMINI PROXY ---
app.post('/api/agent1-summary', async (req, res) => {
    const { text } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || 'AQ.Ab8RN6K0odcx_FADTp2zmR66O0LAus14At-k29d-hjoOVg-bfg';
    const modelsToTry = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    let lastError = null;

    for (const model of modelsToTry) {
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: `Aşağıdaki ders materyalini detaylı analiz et ve özetle:\n"${text.substring(0, 4000)}"` }] }]
                })
            });

            if (response.ok) {
                const data = await response.json();
                const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (summary) return res.json({ summary });
            } else {
                const errJson = await response.json().catch(() => ({}));
                lastError = errJson.error?.message || response.statusText;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    res.status(500).json({ error: 'Gemini API Hatası: ' + (lastError || 'Modeller yanıt vermedi.') });
});

// --- AGENT 2 & 3: GROQ PROXY ---
app.post('/api/agent-groq', async (req, res) => {
    const { prompt } = req.body;
    const apiKey = process.env.GROQ_API_KEY || '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';
    const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192', 'mixtral-8x7b-32768'];
    let lastError = null;

    for (const model of groqModels) {
        try {
            const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                })
            });

            if (response.ok) {
                const data = await response.json();
                const result = data.choices?.[0]?.message?.content;
                if (result) return res.json({ result, modelUsed: model });
            } else {
                const errJson = await response.json().catch(() => ({}));
                lastError = errJson.error?.message || response.statusText;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    res.status(500).json({ error: 'Groq API Hatası: ' + (lastError || 'Tüm Groq modelleri başarısız oldu.') });
});

app.listen(PORT, () => {
    console.log(`🚀 QuizCraft AI Pro Backend Sunucusu ${PORT} portunda çalışıyor!`);
});