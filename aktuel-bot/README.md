# Aktüel Bot

BİM, A101, ŞOK, Migros ve CarrefourSA'nın yeni aktüel broşürlerini otomatik bulur,
Instagram gönderisi (1080×1350, kaydırmalı) ve hikâyesi (1080×1920) olarak hazırlar ve paylaşır.

## Nasıl çalışır

1. **Kaynaklar**
   - BİM → `bim.com.tr` resmi afiş sayfası
   - A101, ŞOK, Migros, CarrefourSA → `akakce.com/brosurler/<market>`
     (A101 ve CarrefourSA siteleri sunucu IP'lerini Cloudflare ile engelliyor; ŞOK ve Migros
     sitelerinde broşür sayfası yok. Akakçe aynı resmi broşür görsellerini tarih ve ürün
     etiketleriyle yayınlıyor.)
2. **Seçim**: Başlangıcı son 6 gün içinde ya da önümüzdeki 3 gün içinde olan, bitmemiş,
   daha önce paylaşılmamış broşürler. Marketlerin kendi "Instagram/Facebook postu" kopyaları
   atlanır; aynı afiş başka başlıkla tekrar gelirse görsel benzerliğinden yakalanıp atlanır.
3. **Görseller**: Her sayfa kesilmeden ortalanır; üstte market renginde başlık
   (market, broşür adı, tarih, "Yarın mağazalarda!"), altta sayfa adı ve sayfa numarası.
4. **Açıklama**: Broşür adı, tarih, öne çıkan ürünler ve fiyatları (Akakçe kaynaklılarda), hashtag'ler.
5. **Paylaşım**: Her broşür → 1 kaydırmalı gönderi (en fazla 10 sayfa) + her sayfa ayrı hikâye.
   Paylaşmadan önce Instagram'ın 24 saatlik kotası kontrol edilir.
6. **Kayıt**: Paylaşılanlar `state/posted.json`'a yazılır, aynı broşür iki kez paylaşılmaz.

GitHub Actions ile günde 6 kez (TR saatiyle 07:17'den 22:17'ye, 3 saatte bir) çalışır.

## Günlük fiyat karşılaştırması ("Aynı ürün, farklı fiyat")

Her gün TR 09:41'de `marketfiyati.org.tr` (Ticaret Bakanlığı) verisinden aynı ürünün
BİM, A101, ŞOK, Migros, CarrefourSA, Hakmar ve Tarım Kredi fiyatları alınır.
En az 3 markette satılan, aralarında en az %15 ve 10 TL fark olan ürünlerden günde 5 tanesi seçilir
(her ürün grubundan ve markadan en fazla 1, aynı ürün 14 gün tekrar edilmez).
Kapak + ürün başına bir görsel (kaydırmalı gönderi) ve hikâyeler üretilir.

Bölge, ürün grupları ve eşikler `config.py`'deki `COMPARE_*` ayarlarında.
Elle çalıştırma: `python main.py --compare` (Actions'ta mod: `karsilastirma`).

## Zernio ile paylaşım (önerilen)

Zernio (zernio.com) kendi Meta ve X uygulamalarını kullandığı için Meta geliştirici uygulaması,
işletme portföyü, Facebook sayfası ya da X geliştirici hesabı gerekmez.
Tek gereken `ZERNIO_API_KEY` secret'ı; bot bağlı Instagram ve X hesaplarını API'den kendisi bulur.

- Ücret: ilk 2 bağlı hesap ücretsiz (Instagram + X). X API çağrıları X tarifesiyle aynen yansıtılır
  (post başı ~0,015 $). Instagram ücretsiz.
- Instagram: kaydırmalı gönderi + her sayfa için hikâye. X: 4'er görsellik zincir.
- Doğrudan Instagram Graph API ya da X API anahtarları da tanımlıysa onlar önceliklidir.

## X (Twitter)

X anahtarları tanımlıysa her broşür ve günlük karşılaştırma X'te de paylaşılır:
post başına 4 görsel, broşür başına en fazla 2 post (zincir; `X_MAX_POSTS_PER_BROCHURE`).
X API kullandıkça ücretli; linkli postlar çok daha pahalı olduğu için bot link koymaz.
X hatası Instagram/Telegram akışını durdurmaz.

## Çalışma modları

| Ayarlı olanlar | Bot ne yapar |
|---|---|
| Instagram + Cloudinary | Otomatik paylaşır; Telegram da varsa "paylaşıldı" özeti gönderir |
| Sadece Telegram | Her yeni broşür için paketi telefona yollar: gönderi görselleri, kopyalanabilir açıklama, hikâye görselleri. Sen elle paylaşırsın (hikâyeye tıklanabilir etiket/link de ekleyebilirsin) |
| Hiçbiri / `--dry-run` | Sadece görsel üretir (Actions → Artifacts) |

Telegram kurulumu: @BotFather'a `/newbot` yaz, token'ı `TELEGRAM_BOT_TOKEN` secret'ı yap,
botuna Telegram'da `/start` yaz, Actions'tan `baglanti` modunu çalıştır. Test mesajı gelirse tamam.

## Yerelde deneme

```bash
cd aktuel-bot
pip install -r requirements.txt
python main.py --dry-run              # out/ klasörüne görselleri ve açıklamaları üretir
python main.py --dry-run --market bim
python -m pytest -q tests
```

## Kurulum (paylaşımı açmak için)

GitHub → repo → Settings → Secrets and variables → Actions:

| Tür | Ad | Ne |
|---|---|---|
| Secret | `IG_ACCESS_TOKEN` | Uzun ömürlü erişim anahtarı (60 gün geçerli) |
| Secret | `CLOUDINARY_CLOUD_NAME` | Cloudinary hesap adı |
| Secret | `CLOUDINARY_API_KEY` | Cloudinary API key |
| Secret | `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| Secret | `TELEGRAM_BOT_TOKEN` | Telegram bot token'ı (@BotFather → /newbot) |
| Secret | `TELEGRAM_CHAT_ID` | (isteğe bağlı) Boşsa bota son /start yazan sohbet kullanılır |
| Secret | `ZERNIO_API_KEY` | Zernio API anahtarı (Instagram + X için tek anahtar, önerilen yol) |
| Secret | `X_API_KEY`, `X_API_SECRET` | X (Twitter) uygulamasının API Key / Secret'ı |
| Secret | `X_ACCESS_TOKEN`, `X_ACCESS_SECRET` | X hesabının Access Token / Secret'ı (Read and Write) |
| Variable | `IG_HANDLE` | Instagram kullanıcı adı (@ olmadan), görsellere yazılır |
| Secret | `IG_USER_ID` | (isteğe bağlı) Boşsa anahtardan otomatik bulunur |
| Variable | `IG_GRAPH_HOST` | (isteğe bağlı) Facebook Login ile kurulduysa `graph.facebook.com` |

Cloudinary neden? Instagram API görseli dosya olarak almıyor, herkese açık bir URL'den çekiyor.
Cloudinary'nin ücretsiz planı bu iş için yeterli.

İlk kurulumda birikmiş broşürlerin hepsi birden paylaşılmasın istersen bir kez:
`python main.py --mark-seen` çalıştırıp `state/posted.json`'u commit'le.

Anahtarları test etmek için: Actions → Aktüel bot → Run workflow → mod: `baglanti`.

Secrets eklenmezse bot paylaşmadan sadece görsel üretir; görseller Actions çalıştırmasının
"Artifacts" kısmından indirilebilir.

## Ayarlar

Hepsi `config.py`'de: market renkleri ve hashtag'leri, resmi hesap etiketi (`ig_username`),
sayfa sınırları, broşür seçim aralığı, açıklamadaki ürün sayısı, reklam etiketi.

## Bilinen sınırlar

- Instagram API hikâyelere tıklanabilir @etiket, link ya da anket çıkartması ekleyemiyor.
  Gönderilerde resmi hesap etiketi (`ig_username`) eklenebiliyor.
- Erişim anahtarı 60 günde bir yenilenmeli (otomatik yenileme sonraki adım).
- Kaynak siteler tasarım değiştirirse ilgili okuyucu (`aktuel/sources/`) güncellenmeli.
