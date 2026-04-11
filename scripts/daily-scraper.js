const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Firebase yapılandırması
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './acele-kumulastirma-firebase-adminsdk-fbsvc-ecfd33417d.json';
  
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://acele-kumulastirma-default-rtdb.europe-west1.firebasedatabase.app'
    });
    console.log('✅ Firebase servis hesabı yüklendi');
  } else {
    console.error('❌ Firebase servis hesabı dosyası bulunamadı:', serviceAccountPath);
    process.exit(1);
  }
}
const db = admin.database();
const kamulastirmaRef = db.ref('kamulastirma');

// Kategori eşleme (örnek)
function normalizeCategory(text) { return 'Diğer'; }
function extractCity(locationText) { return 'Belirtilmemiş'; }

async function fetchResmiGazetePage(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const url = `https://www.resmigazete.gov.tr/eskiler/${year}/${month}/${year}${month}${day}.htm`;
  try {
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.log(`${date.toISOString().split('T')[0]} için Resmî Gazete bulunamadı`);
    return null;
  }
}

function extractKamulastirmaKararlari(html) {
  const $ = cheerio.load(html);
  const kararlar = [];
  $('p, div, td').each((i, elem) => {
    const text = $(elem).text();
    if (text.includes('Acele Kamulaştırılması') || text.includes('ACELE KAMULAŞTIRMA')) {
      const kararNoMatch = text.match(/Karar Sayısı[:\s]*(\d+)/i);
      const tarihMatch = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
      kararlar.push({
        proje_adi: text.split('\n')[0].substring(0, 150),
        karar_sayisi: kararNoMatch ? kararNoMatch[1] : '',
        tarih: tarihMatch ? tarihMatch[0] : '',
        tahmini_konum: 'Belirtilmemiş',
        kamulastiran_kurum: '',
        kategori: 'Diğer',
        eklenme_tarihi: new Date().toISOString()
      });
    }
  });
  return kararlar;
}

async function updateFirebase(kararlar) {
  let addedCount = 0, skippedCount = 0;
  for (const karar of kararlar) {
    if (karar.karar_sayisi) {
      const snapshot = await kamulastirmaRef.orderByChild('karar_sayisi').equalTo(karar.karar_sayisi).once('value');
      if (snapshot.exists()) { skippedCount++; continue; }
    }
    await kamulastirmaRef.push(karar);
    addedCount++;
    console.log(`Yeni karar eklendi: ${karar.proje_adi.substring(0, 50)}...`);
  }
  return { addedCount, skippedCount, addedKararlar: kararlar };
}

async function updateGeoJSONFile() {
  const snapshot = await kamulastirmaRef.once('value');
  const data = snapshot.val();
  const kamulastirmaList = data ? Object.entries(data).map(([id, val]) => ({ id, ...val })) : [];
  const geojson = {
    type: 'FeatureCollection',
    features: kamulastirmaList.filter(item => item.coordinates).map(item => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: item.coordinates },
      properties: { proje_adi: item.proje_adi, karar_sayisi: item.karar_sayisi, tarih: item.tarih }
    }))
  };
  fs.writeFileSync('veriler.geojson', JSON.stringify(geojson, null, 2));
  console.log(`GeoJSON güncellendi: ${kamulastirmaList.length} kayıt`);
}

async function sendEmailNotification(addedCount, skippedCount, addedKararlar, totalRecords) {
  console.log(`📧 Bildirim gönderilmedi (EMAIL ayarları yok). Yeni: ${addedCount}, Atlanan: ${skippedCount}, Toplam: ${totalRecords}`);
}

async function main() {
  console.log('🚀 Günlük veri toplama başladı:', new Date().toISOString());
  const sonGunler = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    sonGunler.push(date);
  }
  let allKararlar = [];
  for (const date of sonGunler) {
    const html = await fetchResmiGazetePage(date);
    if (html) {
      const kararlar = extractKamulastirmaKararlari(html);
      allKararlar.push(...kararlar);
      console.log(`${date.toISOString().split('T')[0]}: ${kararlar.length} karar bulundu`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const uniqueKararlar = [];
  const seenKeys = new Set();
  for (const karar of allKararlar) {
    const key = `${karar.karar_sayisi}-${karar.proje_adi.substring(0, 50)}`;
    if (!seenKeys.has(key)) { seenKeys.add(key); uniqueKararlar.push(karar); }
  }
  let addedCount = 0, skippedCount = 0, addedKararlar = [], totalRecords = 0;
  if (uniqueKararlar.length > 0) {
    const result = await updateFirebase(uniqueKararlar);
    addedCount = result.addedCount; skippedCount = result.skippedCount; addedKararlar = result.addedKararlar;
    totalRecords = (await kamulastirmaRef.once('value')).numChildren();
    await updateGeoJSONFile();
  } else {
    totalRecords = (await kamulastirmaRef.once('value')).numChildren();
  }
  await sendEmailNotification(addedCount, skippedCount, addedKararlar, totalRecords);
  console.log(`✅ İşlem tamamlandı. Eklendi: ${addedCount}`);
}

main().catch(console.error);