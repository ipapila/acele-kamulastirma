// 1. GEREKLİ MODÜLLERİ İÇE AKTAR
const { Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const admin = require('firebase-admin');
const fs = require('fs');

// 2. FIREBASE YAPILANDIRMASI (if BLOĞU)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync('./acele-kumulastirma-firebase-adminsdk-fbsvc-ecfd33417d.json', 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://acele-kumulastirma-default-rtdb.europe-west1.firebasedatabase.app'
  });
}
const db = admin.database();

// 3. ASYNC FONKSİYON (if'ten SONRA)
async function scrapeWithFirefox(date) {
  // ... fonksiyonun içeriği
}
// ---------------------------------------------------------

async function scrapeWithFirefox(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const url = `https://www.resmigazete.gov.tr/eskiler/${year}/${month}/${year}${month}${day}.htm`;

  // Firefox için seçenekler
  let options = new firefox.Options();
  // options.addArguments('--headless'); // İleride testler başarılı olursa bu satırı açarak tarayıcıyı arka planda çalıştırabilirsiniz.

  let driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .build();

  try {
    console.log(`🌐 Sayfa yükleniyor: ${url}`);
    await driver.get(url);
    await driver.sleep(5000); // Sayfanın tamamen yüklenmesi için bekle

    const pageSource = await driver.getPageSource();

    if (pageSource.includes('Acele Kamulaştırılması') || pageSource.includes('ACELE KAMULAŞTIRMA')) {
      console.log(`✅ ${date.toISOString().split('T')[0]}: Acele kamulaştırma kararı bulundu!`);
      // Burada ayrıştırma (parse) işlemlerinizi yapabilirsiniz.
    } else {
      console.log(`❌ ${date.toISOString().split('T')[0]}: Acele kamulaştırma kararı bulunamadı.`);
    }

  } catch (error) {
    console.error('Selenium hatası:', error.message);
  } finally {
    await driver.quit();
  }
}

async function main() {
  console.log('🚀 Firefox ile Resmî Gazete taraması başladı...');
  const today = new Date();
  await scrapeWithFirefox(today);
}

main();