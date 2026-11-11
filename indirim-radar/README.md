# İndirim Radarı 🇹🇷

Türkiye'deki pazaryerlerinde (Akakçe üzerinden tüm mağazalar; doğrudan Trendyol, Hepsiburada, Amazon TR, N11, Çiçeksepeti ve JSON-LD yayınlayan diğer siteler)
ürün fiyatlarını düzenli olarak kaydeder. Her indirimi **indirim öncesi son 30 günün en düşük fiyatına** göre doğrular ve
**gerçek**, **abartılı** ve **sahte** indirimleri birbirinden ayırır.

> Ölçüt, Ticaret Bakanlığı'nın *Haksız Ticari Uygulamalara Dair Yönetmelik* hükmüyle aynıdır: indirimli satışta,
> indirim öncesi fiyat olarak indirimden önceki 30 gün içinde uygulanan **en düşük fiyat** esas alınır.

## Ne yapar?

| Durum | Anlamı |
|---|---|
| 🟢 **Gerçek indirim** | Güncel fiyat, indirim öncesi 30 günün en düşük fiyatından en az %5 ucuz |
| 🟠 **Gerçek ama abartılı** | Gerçek indirim var, ancak satıcının gösterdiği oran gerçeğinden 15+ puan yüksek |
| 🔴 **Sahte indirim** | İndirim gösteriliyor ama 30 günlük en düşüğe göre ucuzlama yok (ör. önce zam sonra indirim) |
| ⚪ **İndirim yok** | Fiyat sabit/yükselişte ve indirim iddiası yok |
| ⚪ **Yetersiz veri** | Takip yeni başladı; karar için en az 7 günlük geçmiş gerekiyor |

Ek uyarılar:
- **Önce zam, sonra indirim** — indirimden önceki 30 günde ürün zaten bu fiyata satılmış
- **Üstü çizili fiyat hiç uygulanmamış** — gösterilen “eski fiyat” son 30 günde hiç görülmemiş
- **30 günde daha ucuzdu** — son 30 günde şu ankinden düşük fiyat görülmüş
- **Tarihi dip fiyat** — takip başladığından beri en düşük fiyat

Her ürün için gösterilen bilgiler: güncel fiyat, üstü çizili fiyat, **son 30 günün en düşük / en yüksek / ortalama fiyatı**,
indirim öncesi referans fiyat, gerçek ve iddia edilen indirim yüzdesi, tasarruf, indirimin kaç gündür sürdüğü,
tüm zamanların en düşüğü ve fiyat grafiği.

## Site / telefon uygulaması

`npm start` ile açılan site, giriş korumalı ve telefona kurulabilen bir web uygulamasıdır (PWA):

- **Üyelik:** Yalnızca davet kodunu bilenler kayıt olabilir. Kod sunucu açılırken ekrana yazılır ve Yönetim sayfasında görünür
  (`INVITE_CODE` ile sabitlenebilir). İlk kayıt olan kişi yöneticidir.
- **Ürün ara, hemen analiz et:** Ürün adı ya da Akakçe / Trendyol / Hepsiburada / Amazon linki yazılır; ürün Akakçe'de bulunur ve
  6 aylık geçmişiyle birkaç saniyede analiz edilir.
- **Listem:** Her üyenin kendi takip listesi. Listedeki ürünler güncellemede önceliklidir.
- **Alarmlar:** “Fiyat X TL'nin altına inince” ve “gerçek indirime girince”. Koşul sağlandığında bir kez bildirir.
- **Telefon bildirimi:** Bildirimler sayfasından açılır (Web Push). iPhone'da önce Paylaş → “Ana Ekrana Ekle” gerekir.
- **Fırsatlar:** Gerçek / sahte / indirimsiz sekmeleri, kategori filtreleri, sıralama.
- **Yönetim:** Davet kodu, otomatik taranan Akakçe sayfaları, elle güncelleme.

### Yayına alma (Docker)

Telefon bildirimi ve uygulama olarak kurulum **HTTPS** ister; bu yüzden bir alan adı gerekir.

1. Küçük bir sunucu kirala (1 GB bellek yeter) ve Docker kur.
2. Alan adının A kaydını sunucunun IP adresine yönlendir.
3. Sunucuda:
   ```bash
   git clone https://github.com/TutkuGurur/resob && cd resob/indirim-radar
   ALAN_ADI=radar.ornek.com YONETICI_EPOSTA=sen@ornek.com docker compose up -d --build
   docker compose logs radar | grep "Davet kodu"
   ```
4. `https://radar.ornek.com` adresini aç, davet koduyla kayıt ol (ilk kayıt yönetici olur).

Veritabanı `radar-data` adlı Docker biriminde tutulur; yedeklemek için `/data/indirim.db` dosyasını kopyalamak yeterlidir.
Docker dosyaları bu depoda derlenip denenmedi; ilk kurulumda sorun çıkarsa `docker compose logs` çıktısına bakın.

> Akakçe, bazı veri merkezi IP adreslerinden gelen istekleri engelleyebilir. Ürün kartlarında “HTTP 403” görürseniz
> sunucuyu Türkiye'de bir sağlayıcıya taşımak ya da evdeki bir cihazda çalıştırmak gerekir.

| Ek ayar | Açıklama |
|---|---|
| `INVITE_CODE` | Davet kodunu sabitler (yoksa ilk açılışta rastgele üretilir) |
| `VAPID_SUBJECT` | Bildirim servislerine iletilen iletişim adresi (`mailto:...`) |
| `TRUST_PROXY` | Ters vekil arkasında gerçek istemci IP'sini kullanır (Docker kurulumunda açık) |
| `NO_DEFAULT_LISTS` | İlk açılışta Akakçe kampanya sayfalarının otomatik eklenmesini kapatır |

## Akakçe ile anında 6 aylık geçmiş (önerilen)

Akakçe ürün sayfaları hem **tüm mağazaların güncel fiyatlarını** (Trendyol, Hepsiburada, Amazon, N11, A101, idefix …)
hem de **son 6 ayın günlük en ucuz fiyat tablosunu** içerir. Bir Akakçe ürün linki eklendiğinde bu geçmiş içe aktarılır,
böylece 30 gün veri toplamayı beklemeden analiz hemen yapılır. Fiyat, tüm satıcılar arasındaki en ucuz fiyattır.

Akakçe'de “gösterilen indirim”, son fiyat değişiminin bir önceki fiyata göre düşüş oranıdır (“fiyatı %X düştü”).
Bu oran 30 günlük en düşük fiyatla kıyaslanır.

Önerilen keşif sayfaları:

```bash
npm run kesif -- "https://www.akakce.com/fiyati-dusen-urunler/" "Fiyatı düşenler"
npm run kesif -- "https://www.akakce.com/sepette-indirimle-en-ucuz/" "Sepette indirim"
npm run kesif -- "https://www.akakce.com/black-friday-indirimleri/" "Black Friday"
```

Bilgisayar kurmadan sonuçları görmek için tek dosyalık rapor üretilebilir:

```bash
npm run rapor-html -- rapor.html   # tarayıcıda açılabilen, paylaşılabilir sayfa
```

> Cimri.com otomatik isteklere bot koruması (HTTP 403) ile yanıt verdiği için desteklenmiyor.

## Kurulum

Gereken tek şey **Node.js 22.5+** (harici paket yok; veritabanı olarak Node'un yerleşik SQLite modülü kullanılır).

```bash
cd indirim-radar
npm start            # http://localhost:3000
```

Paneli denemek için örnek senaryoları yükleyin (panelde “demo verisini yükleyin” düğmesi veya):

```bash
npm run demo         # 12 örnek ürün, 60 günlük simüle fiyat geçmişi
npm run rapor -- --hepsi
```

## Kullanım

### 1. Tek tek ürün takibi
Panelde **Ürün / kampanya sayfası ekle → Ürün linki** alanına ürün adresini yapıştırın ya da:

```bash
npm run ekle -- "https://www.trendyol.com/marka/urun-p-123456" "https://www.amazon.com.tr/dp/B0XXXXXXXX"
```

### 2. Otomatik keşif (sürekli güncel liste)
Kampanya, kategori, “çok satanlar” veya arama sonuç sayfası ekleyin. Sayfadaki ürünler otomatik bulunur, takibe alınır
ve sayfa her gün yeniden taranır; böylece yeni ürünler kendiliğinden listeye düşer.

```bash
npm run kesif -- "https://www.hepsiburada.com/ara?q=robot+supurge" "Robot süpürgeler"
```

### 3. Sürekli güncelleme
`npm start` çalıştığı sürece yerleşik zamanlayıcı ürünleri **6 saatte bir**, keşif sayfalarını **24 saatte bir** tarar.
Sunucuyu sürekli açık tutmak istemiyorsanız cron ile tetikleyebilirsiniz:

```cron
0 */6 * * *  cd /yol/indirim-radar && npm run -s guncelle
```

### Komutlar

| Komut | Açıklama |
|---|---|
| `npm start` | Web paneli + zamanlayıcı (`-- --no-scheduler` ile zamanlayıcısız) |
| `npm run guncelle` | Vakti gelen ürünleri tara (`-- --hepsi` ile tümünü) |
| `npm run ekle -- <url...>` | Ürün ekle |
| `npm run kesif -- <url> [etiket]` | Keşif sayfası ekle |
| `npm run rapor` | Gerçek indirimleri terminalde listele (`-- --hepsi` ile tümü) |
| `npm run rapor-html -- <dosya>` | Paylaşılabilir tek dosyalık HTML rapor |
| `npm run demo` / `node src/cli.js demo-sil` | Demo verisini yükle / sil |
| `npm test` | Testler |

### Ayarlar (ortam değişkenleri)

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | 3000 | Panel portu |
| `DB_PATH` | `data/indirim.db` | SQLite dosyası |
| `REFRESH_HOURS` | 6 | Ürün fiyat kontrol aralığı |
| `DISCOVER_HOURS` | 24 | Keşif sayfası tarama aralığı |
| `REQUEST_DELAY_MS` | 4000 | Aynı siteye iki istek arası bekleme |
| `WINDOW_DAYS` | 30 | Referans pencere (gün) |
| `MIN_REAL_DISCOUNT_PCT` | 5 | Gerçek indirim eşiği (%) |
| `MIN_CLAIM_PCT` | 5 | “İndirim iddiası var” eşiği (%) |
| `MINOR_CLAIM_PCT` | 1 | Fiyat 30 günlük en düşüğün altına inmediyse bu kadar küçük iddia da “sahte” sayılır |
| `EXAGGERATION_GAP_PCT` | 15 | Abartılı sayılması için puan farkı |
| `MIN_COVERAGE_DAYS` | 7 | Karar için gereken en az geçmiş (gün) |

Bir proxy arkasındaysanız Node'un proxy desteğini açın: `NODE_USE_ENV_PROXY=1 npm start`.

## Nasıl hesaplanır?

```
güncel fiyat (p)       = son kaydedilen satış fiyatı (sepette indirim dahil, stokta olan kayıtlar)
indirim başlangıcı     = geriye doğru giderken fiyatın p'nin %5'ten fazla üstüne çıktığı son noktadan sonraki ilk kayıt
referans fiyat (ref)   = [başlangıç − 30 gün, başlangıç) aralığındaki EN DÜŞÜK fiyat
gerçek indirim %       = (ref − p) / ref
iddia edilen indirim % = (üstü çizili − p) / üstü çizili
```

- Kampanya süresince yaşanan küçük (%5'ten az) dalgalanmalar indirimi “yeniden başlatmaz”; kademeli kampanyalarda referans,
  kampanyanın ilk başladığı andan öncesine göre hesaplanır (yönetmelikteki kademeli indirim istisnasıyla uyumlu).
- Stokta olmayan kayıtlar hesaplamaya katılmaz.
- Referans penceresinin ne kadarının veriyle dolu olduğuna göre **güven** düzeyi (yüksek / orta / düşük) verilir.

Kod: `src/analysis.js` · testler: `test/analysis.test.js`.

## Mimari

```
src/
  config.js          ayarlar
  db.js              SQLite şeması (products, price_snapshots, watchlists)
  analysis.js        gerçek/sahte indirim analizi
  extractors/        site bazlı fiyat çıkarıcılar (JSON-LD + siteye özel kalıplar)
  tracker.js         nazik (rate-limit'li) indirme, kayıt, keşif, zamanlayıcı mantığı
  users.js           üyelik, oturum, kişisel liste, alarm, bildirim kayıtları
  alerts.js          alarm değerlendirme
  push.js            Web Push (VAPID + şifreleme), harici paket yok
  batch.js           ürün bulma (ad/link → Akakçe), toplu rapor
  server.js          HTTP API + statik site
  cli.js             komut satırı
  demo.js            demo senaryoları
public/              site (index.html, app.js, app.css, sw.js, manifest)
```

### API (hepsi giriş ister)

| Yöntem | Yol | Açıklama |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` | Üyelik (kayıt davet kodu ister) |
| GET | `/api/deals?status=&category=&q=&sort=&mine=1` | Analizli ürün listesi, kategori sayıları |
| GET | `/api/search?q=<ad veya link>` | Ürünü bul, şimdi çek, analiz et |
| GET | `/api/products/:id` | Ürün + analiz + fiyat geçmişi + satıcılar |
| POST/DELETE | `/api/products/:id/follow` | Listeme ekle / çıkar |
| GET/POST/DELETE | `/api/alerts` | Alarmlar |
| GET | `/api/notifications` | Bildirim geçmişi |
| POST | `/api/push/subscribe` · `/unsubscribe` · `/test` | Telefon bildirimi |
| GET/POST/DELETE | `/api/admin…` | Yönetici: davet kodu, taranan sayfalar, güncelleme |

## Bilinmesi gerekenler

- **Geçmiş veri:** Sistem fiyatı takibe aldığı andan itibaren kaydeder. Bir ürünün değerlendirilmesi için en az 7 gün,
  tam güvenilir sonuç için ~30 gün veri gerekir. Bu yüzden ilgilendiğiniz ürünleri/kategorileri erkenden ekleyin.
- **Site değişiklikleri ve bot koruması:** Pazaryerleri sayfa yapısını değiştirebilir veya otomatik istekleri engelleyebilir
  (HTTP 403 / captcha). Bu durumda ürün kartında ⚠ hata mesajı görünür. Çıkarıcılar önce standart `schema.org` JSON-LD
  verisini, sonra siteye özel kalıpları dener; yapı değişirse `src/extractors/index.js` güncellenmelidir.
  Testlerdeki HTML örnekleri bu yapıları taklit eden sentetik örneklerdir.
- **Kullanım koşulları:** Siteleri yormamak için her siteye istekler arası bekleme uygulanır. Sistemi kişisel kullanım
  amacıyla, makul aralıklarla çalıştırın ve ilgili sitelerin kullanım koşullarına/robots.txt kurallarına uyun.
- Farklı satıcıların aynı ürünü farklı fiyatla satması durumunda sayfada öne çıkan (buybox) satıcının fiyatı kaydedilir.
