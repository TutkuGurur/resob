"""Bot ayarları. Değiştirmek istediğin her şey burada."""

# Instagram sayfa adı (görsellerin altına ve açıklamaya yazılır).
# Ortam değişkeni IG_HANDLE varsa o kullanılır.
IG_HANDLE = "aktuel.radari"

# Marketler: kaynak, görünen ad, renkler, hashtag'ler.
# source: "bim" -> bim.com.tr resmi afiş sayfası, "akakce" -> akakce.com/brosurler/<slug>
MARKETS = {
    "bim": {
        "name": "BİM",
        "source": "bim",
        "color": "#E30613",
        "text_color": "#FFFFFF",
        "ig_username": "",  # gönderide etiketlenecek resmi hesap (boşsa etiket yok)
        "tags": ["bim", "bimaktüel", "bimaktuel", "bimindirim", "bimkatalog"],
    },
    "a101": {
        "name": "A101",
        "source": "akakce",
        "slug": "a101",
        "color": "#00A6E2",
        "text_color": "#FFFFFF",
        "ig_username": "",
        "tags": ["a101", "a101aktüel", "a101aktuel", "aldınaldın", "a101katalog"],
    },
    "sok": {
        "name": "ŞOK",
        "source": "akakce",
        "slug": "sok",
        "color": "#FFD400",
        "text_color": "#1B2A8C",
        "ig_username": "",
        "tags": ["şok", "şokaktüel", "sokaktuel", "şokmarket", "haftanınfırsatları"],
    },
    "migros": {
        "name": "Migros",
        "source": "akakce",
        "slug": "migros",
        "color": "#FF7A00",
        "text_color": "#FFFFFF",
        "ig_username": "",
        "tags": ["migros", "migroskop", "migrosaktüel", "migroskatalog", "moneyindirim"],
    },
    "carrefoursa": {
        "name": "CarrefourSA",
        "source": "akakce",
        "slug": "carrefoursa",
        "color": "#0A4DA2",
        "text_color": "#FFFFFF",
        "ig_username": "",
        "tags": ["carrefoursa", "carrefour", "carrefoursaaktüel", "carrefoursakatalog"],
    },
}

COMMON_TAGS = ["aktüel", "aktuelurunler", "aktüelkatalog", "indirim", "kampanya",
               "marketindirimleri", "haftanınindirimleri", "ucuzluk", "fırsat"]

# Başlığında bunlar geçen broşürler atlanır (marketlerin kendi sosyal medya postları,
# Akakçe'nin ürün özet sayfaları vb.). Küçük harfle yaz.
SKIP_TITLE_KEYWORDS = ["instagram", "facebook", "ürünleri"]

# Hangi broşürler paylaşılsın: başlangıcı bugünden en fazla X gün önce ...
MAX_DAYS_SINCE_START = 6
# ... ya da en fazla Y gün sonra olanlar ("Yarın BİM'de" içerikleri için).
MAX_DAYS_UNTIL_START = 3

# Bir broşürden en fazla kaç sayfa paylaşılsın.
# Instagram kaydırmalı gönderi en fazla 10 görsel alır; fazlası ayrı gönderilere bölünür.
MAX_POST_PAGES = 10
MAX_STORY_PAGES = 10
CAROUSEL_SIZE = 10

# Bir çalıştırmada en fazla kaç broşür paylaşılsın. Instagram API 24 saatte sınırlı sayıda
# içerik (gönderi + hikâye) kabul ediyor; bot paylaşmadan önce kalan kotayı kontrol eder.
MAX_BROCHURES_PER_RUN = 5

# Açıklamada listelenecek öne çıkan ürün sayısı.
CAPTION_TOP_PRODUCTS = 8

# Affiliate kısmı eklendiğinde açıklamaya düşülecek reklam etiketi.
AD_DISCLOSURE = ""  # örn. "#reklam #işbirliği"

# ---------------------------------------------------------------------------
# Günlük "Aynı ürün, farklı fiyat" paylaşımı (kaynak: marketfiyati.org.tr)
# ---------------------------------------------------------------------------
COMPARE_DAILY_COUNT = 5            # günde kaç ürün
COMPARE_MIN_MARKETS = 3            # ürün en az kaç markette satılıyor olmalı
COMPARE_MIN_SPREAD = 0.15          # en ucuz ile en pahalı arasında en az %15 fark
COMPARE_MIN_DIFF_TL = 10.0         # ... ve en az 10 TL fark
COMPARE_MAX_RATIO = 2.5            # en pahalı / en ucuz > 2.5 ise muhtemelen veri hatası, atla
COMPARE_NO_REPEAT_DAYS = 14        # aynı ürün 14 gün içinde tekrar paylaşılmaz
COMPARE_PAGES = 3                  # her arama için kaç sayfa (25 ürün/sayfa) taransın

# Fiyatların alınacağı bölge (mağaza fiyatları bölgeye göre değişir).
COMPARE_AREA_LABEL = "İstanbul / Kadıköy"
COMPARE_LAT = 40.9909
COMPARE_LON = 29.0303
COMPARE_RADIUS_KM = 5

# Taranacak ürün grupları (her gruptan günde en fazla 1 ürün seçilir).
COMPARE_KEYWORDS = [
    "süt", "yoğurt", "peynir", "yumurta", "tereyağı", "çay", "kahve", "makarna", "pirinç",
    "bulgur", "mercimek", "un", "şeker", "ayçiçek yağı", "zeytinyağı", "salça", "kola",
    "maden suyu", "meyve suyu", "çikolata", "bisküvi", "cips", "deterjan", "yumuşatıcı",
    "bulaşık", "şampuan", "diş macunu", "tuvalet kağıdı", "kağıt havlu", "bebek bezi",
    "ıslak mendil", "sabun", "zeytin", "reçel", "bal", "ton balığı", "sucuk", "gofret",
]
