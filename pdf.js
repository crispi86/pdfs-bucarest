const puppeteer = require('puppeteer');

let _browser = null;

async function getBrowser() {
  if (_browser) {
    try {
      await _browser.version(); // Verifica que sigue vivo
      return _browser;
    } catch {
      _browser = null;
    }
  }
  _browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
  return _browser;
}

async function generatePDF(html, options = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle2', timeout: 30000 });
    return await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: options.margin || { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await page.close();
  }
}

module.exports = { generatePDF };
