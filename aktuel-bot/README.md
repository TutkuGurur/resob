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
