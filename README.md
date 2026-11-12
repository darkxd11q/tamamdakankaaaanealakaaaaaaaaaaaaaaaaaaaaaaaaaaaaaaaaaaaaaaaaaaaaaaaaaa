# QuizCraft AI Pro

## Kurulum
1. `npm install`
2. `.env` dosyasını doldur (Gemini, Groq, yönetici şifresi, Supabase).
3. Supabase > SQL Editor'de `supabase.sql` dosyasını çalıştır (daha önce çalıştırdıysan yine çalıştır; yeni tablolar eklenir).
4. `npm start` → http://localhost:3000

## Klasör yapısı
- `server.js` : yapay zekâ ajanları (sınav, ezber, koç)
- `auth.js` : giriş, oturumlar, yönetici, ezber/görev verisi, sınav paylaşımı (Supabase veya yerel dosya)
- `public/index.html` : ana arayüz
- `public/features.js`, `public/features.css` : ezber, haftalık rapor, aralıklı tekrar, dersler, paylaşım, görevler

Supabase anahtarı boş bırakılırsa veriler `data/` klasöründe tutulur (barındırma servisinde kalıcı olmayabilir).
