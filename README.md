# QuizCraft AI Pro

## Kurulum
1. `npm install`
2. `.env` dosyasını doldur (Gemini, Groq, yönetici şifresi, Supabase).
3. Supabase > SQL Editor'de `supabase.sql` dosyasını çalıştır (tekrar çalıştırmak güvenlidir).
4. `npm start` → http://localhost:3000

## Supabase anahtarı
`SUPABASE_SERVICE_KEY` için **gizli** anahtar gerekir:
- Yeni format: `sb_secret_...`  (Project Settings > API Keys > Secret keys)
- Eski format: `service_role` JWT
`sb_publishable_...` veya `anon` anahtarı KULLANILAMAZ; sunucu açılışta bunu algılayıp açık bir hata verir.
Açılışta anahtar, URL ve tablolar otomatik doğrulanır.

## Klasör yapısı
- `server.js` : yapay zekâ ajanları (sınav, ezber, koç, sohbet koçu, görsel okuma)
- `auth.js` : giriş, oturumlar, yönetici, kullanıcı verisi, paylaşım (Supabase veya yerel dosya)
- `public/index.html` : ana arayüz
- `public/login.js`, `public/login.css` : animasyonlu giriş ekranı ve açılış ekranı
- `public/features.js`, `public/features.css` : ezber, haftalık rapor, tekrar, dersler, paylaşım, görevler, sohbet koçu, görsel yükleme, grafikler

## Yeni uç noktalar
- `POST /api/chat-coach` : yanlış yapılan soru hakkında sohbet (dakikada 20 mesaj sınırı)
- `POST /api/ocr` : PNG/JPG/WEBP görsellerden Gemini Vision ile metin/soru okuma (en fazla 6 görsel, toplam 18 MB)

## Hız
- `npm install` ile gelen `compression` paketi sayfaları ~%70 küçültür.
- Oturum çerezi varsa site açılırken kullanıcı, arşiv, ezber ve ayarlar TEK istekte (`/api/bootstrap`) gelir; giriş yanıtı da aynı paketi içerir.
- Oturum bilgisi 60 sn bellekte tutulur (her istekte veritabanına gitmez); çıkış/şifre değişimi/oturum kapatmada anında temizlenir.
- Chart.js ve konfeti yalnızca ilk kullanıldıkları anda yüklenir.
