const { Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// ---------- FIREBASE YAPILANDIRMASI ----------
if (!admin.apps.length) {
  const serviceAccountPath = './acele-kamulastirma-firebase-adminsdk-fbsvc-ecfd33417d.json';
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://acele-kumulastirma-default-rtdb.europe-west1.firebasedatabase.app'
    });
    console.log('✅ Firebase servis hesabı yüklendi');
  } else {
    console.error('❌ Firebase dosyası bulunamadı:', serviceAccountPath);
    process.exit(1);
  }
}
const db = admin.database();
const kamulastirmaRef = db.ref('kamulastirma');

// ---------- YARDIMCI FONKSİYONLAR ----------
function extractCity(locationText) {
  const cities = [
    'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Aksaray', 'Amasya', 'Ankara', 'Antalya', 'Ardahan', 'Artvin',
    'Aydın', 'Balıkesir', 'Bartın', 'Batman', 'Bayburt', 'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur',
    'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli', 'Diyarbakır', 'Düzce', 'Edirne', 'Elazığ', 'Erzincan',
    'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkâri', 'Hatay', 'Iğdır', 'Isparta', 'İstanbul',
    'İzmir', 'Kahramanmaraş', 'Karabük', 'Karaman', 'Kars', 'Kastamonu', 'Kayseri', 'Kırıkkale', 'Kırklareli',
    'Kırşehir', 'Kilis', 'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Mardin', 'Mersin', 'Muğla',
    'Muş', 'Nevşehir', 'Niğde', 'Ordu', 'Osmaniye', 'Rize', 'Sakarya', 'Samsun', 'Şanlıurfa', 'Siirt',
    'Sinop', 'Sivas', 'Şırnak', 'Tekirdağ', 'Tokat', 'Trabzon', 'Tunceli', 'Uşak', 'Van', 'Yalova', 'Yozgat', 'Zonguldak'
  ];
  for (const city of cities) {
    if (locationText.includes(city)) return city;
  }
  return 'Belirtilmemiş';
}

function normalizeCategory(text) {
  const kategoriKeywords = {
    'enerji iletim': 'Enerji İletim/Dağıtım',
    'demiryolu': 'Demiryolu/Raylı Sistem',
    'doğal gaz': 'Doğal Gaz',
    'ges': 'GES (Güneş/Biyogaz Enerjisi)',
    'hes': 'HES (Hidroelektrik)',
    'sulama': 'Su/Sulama/Baraj',
    'baraj': 'Su/Sulama/Baraj',
    'deprem': 'Afet/Deprem',
    'maden': 'Maden/Petrol',
    'petrol': 'Maden/Petrol',
    'karayolu': 'Karayolu',
    'kentsel dönüşüm': 'Kentsel Dönüşüm',
    'toki': 'Konut (TOKİ/Sosyal)',
    'konut': 'Konut (TOKİ/Sosyal)',
    'rüzgar': 'RES (Rüzgar Enerjisi)',
    'res': 'RES (Rüzgar Enerjisi)',
    'sanayi': 'Sanayi Bölgesi (OSB)',
    'arkeoloji': 'Arkeoloji/Kültürel Miras'
  };
  for (const [keyword, cat] of Object.entries(kategoriKeywords)) {
    if (text.toLowerCase().includes(keyword)) return cat;
  }
  return 'Diğer';
}

// ---------- SAYFA ALMA (SELENIUM) ----------
async function fetchResmiGazetePageWithSelenium(url, driver) {
  try {
    await driver.get(url);
    await driver.sleep(3000); // Sayfanın yüklenmesi için bekle
    return await driver.getPageSource();
  } catch (error) {
    console.error(`Selenium hatası (${url}): ${error.message}`);
    return null;
  }
}

// ---------- KARARLARI ÇIKAR (CHEERIO) ----------
function extractKamulastirmaKararlari(html) {
  const $ = cheerio.load(html);
  const kararlar = [];
  $('p, div, td').each((i, elem) => {
    const text = $(elem).text();
    if (text.includes('Acele Kamulaştırılması') || text.includes('ACELE KAMULAŞTIRMA')) {
      const kararNoMatch = text.match(/Karar Sayısı[:\s]*(\d+)/i);
      const tarihMatch = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
      let projeAdi = text.split('\n')[0].substring(0, 150);
      let kategori = normalizeCategory(text);
      let konum = 'Belirtilmemiş';
      const locationMatch = text.match(/([A-ZİĞÜŞÖÇ][a-zığüşöç]+)\s+İli/i);
      if (locationMatch) konum = locationMatch[1];
      let kurum = '';
      const kurumMatch = text.match(/([A-ZİĞÜŞÖÇ][a-zığüşöç\s]+(Bakanlığı|Müdürlüğü|Başkanlığı|İdaresi))/i);
      if (kurumMatch) kurum = kurumMatch[1];
      kararlar.push({
        proje_adi: projeAdi,
        karar_sayisi: kararNoMatch ? kararNoMatch[1] : '',
        tarih: tarihMatch ? tarihMatch[0] : '',
        tahmini_konum: extractCity(konum),
        kamulastiran_kurum: kurum,
        kategori: kategori,
        coordinates: null,
        eklenme_tarihi: new Date().toISOString()
      });
    }
  });
  return kararlar;
}

// ---------- FIREBASE'İ GÜNCELLE ----------
async function updateFirebase(kararlar) {
  let addedCount = 0, skippedCount = 0;
  const addedKararlar = [];
  for (const karar of kararlar) {
    if (karar.karar_sayisi) {
      const snapshot = await kamulastirmaRef.orderByChild('karar_sayisi').equalTo(karar.karar_sayisi).once('value');
      if (snapshot.exists()) {
        console.log(`⏩ Karar ${karar.karar_sayisi} zaten mevcut, atlanıyor`);
        skippedCount++;
        continue;
      }
    }
    const newRef = await kamulastirmaRef.push(karar);
    addedCount++;
    addedKararlar.push({ ...karar, id: newRef.key });
    console.log(`✅ Yeni karar eklendi: ${karar.proje_adi.substring(0, 50)}...`);
  }
  return { addedCount, skippedCount, addedKararlar };
}

async function updateGeoJSONFile() {
  const snapshot = await kamulastirmaRef.once('value');
  const data = snapshot.val();
  const kamulastirmaList = data ? Object.entries(data).map(([id, val]) => ({ id, ...val })) : [];
  const geojson = {
    type: 'FeatureCollection',
    name: 'Acele Kamulaştırma Kararları',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
    metadata: { created: new Date().toISOString(), total: kamulastirmaList.length },
    features: kamulastirmaList
      .filter(item => item.coordinates && Array.isArray(item.coordinates))
      .map(item => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: item.coordinates },
        properties: {
          proje_adi: item.proje_adi,
          karar_sayisi: item.karar_sayisi,
          tarih: item.tarih,
          kategori: item.kategori,
          tahmini_konum: item.tahmini_konum,
          yil: item.tarih ? item.tarih.split('.')[2] : '',
          resmi_gazete_linki: item.tarih ? `https://www.resmigazete.gov.tr/fihrist?tarih=${item.tarih.split('.').reverse().join('-')}` : '',
          kamulastiran_kurum: item.kamulastiran_kurum
        }
      }))
  };
  const geojsonPath = path.join(__dirname, '..', '2023-2026 Acele Kamulaştırma01.geojson');
  fs.writeFileSync(geojsonPath, JSON.stringify(geojson, null, 2), 'utf-8');
  console.log(`🗺️ GeoJSON güncellendi: ${kamulastirmaList.length} kayıt`);
  return kamulastirmaList.length;
}

// ---------- ANA FONKSİYON ----------
async function main() {
  console.log('🚀 Günlük veri toplama başladı:', new Date().toISOString());

  // Selenium driver'ı başlat
  const service = new firefox.ServiceBuilder('./geckodriver.exe');
  let driver;
  try {
    driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxService(service)
      .build();
    console.log('🦊 Firefox başlatıldı.');
  } catch (err) {
    console.error('❌ Selenium başlatılamadı:', err.message);
    process.exit(1);
  }

  // Son 7 gün
  const sonGunler = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    sonGunler.push(date);
  }

  let allKararlar = [];
  for (const date of sonGunler) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const url = `https://www.resmigazete.gov.tr/eskiler/${year}/${month}/${year}${month}${day}.htm`;
    console.log(`🌐 Taranıyor: ${date.toISOString().split('T')[0]}`);
    const html = await fetchResmiGazetePageWithSelenium(url, driver);
    if (html) {
      const kararlar = extractKamulastirmaKararlari(html);
      console.log(`   → ${kararlar.length} karar bulundu`);
      allKararlar.push(...kararlar);
    } else {
      console.log(`   → Sayfa alınamadı.`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  await driver.quit();
  console.log('🔒 Tarayıcı kapatıldı.');

  // Tekrarları temizle
  const uniqueKararlar = [];
  const seenKeys = new Set();
  for (const karar of allKararlar) {
    const key = `${karar.karar_sayisi}-${karar.proje_adi.substring(0, 50)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueKararlar.push(karar);
    }
  }

  console.log(`${uniqueKararlar.length} tekil karar işlenecek.`);

  let addedCount = 0, skippedCount = 0, addedKararlar = [], totalRecords = 0;
  if (uniqueKararlar.length > 0) {
    const result = await updateFirebase(uniqueKararlar);
    addedCount = result.addedCount;
    skippedCount = result.skippedCount;
    addedKararlar = result.addedKararlar;
    totalRecords = await updateGeoJSONFile();
  } else {
    const snapshot = await kamulastirmaRef.once('value');
    totalRecords = snapshot.numChildren();
  }

  console.log(`✅ İşlem tamamlandı. Eklendi: ${addedCount}, Atlanan: ${skippedCount}, Toplam: ${totalRecords}`);
}

main().catch(console.error);