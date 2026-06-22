const https = require('https');
const http  = require('http');

// Pre-fetched static images (encabezado, timbre, logo)
const STATIC = {};

function fetchBase64(url) {
  return new Promise((resolve) => {
    if (!url || url.startsWith('data:')) { resolve(url); return; }

    function get(targetUrl, hopsLeft) {
      const mod = targetUrl.startsWith('https') ? https : http;
      const req = mod.get(targetUrl, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && hopsLeft > 0) {
          res.resume(); // drain to free socket
          get(res.headers.location, hopsLeft - 1);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const buf  = Buffer.concat(chunks);
          const mime = (res.headers['content-type'] || 'image/jpeg').split(';')[0];
          resolve(`data:${mime};base64,${buf.toString('base64')}`);
        });
        res.on('error', () => resolve(url));
      });
      req.on('error', () => resolve(url));
      req.setTimeout(10000, () => { req.destroy(); resolve(url); });
    }

    get(url, 5);
  });
}

const STATIC_URLS = {
  encabezado: 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/encabezado_certificado.jpg?v=1776881313',
  timbre:     'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/Timbre_Bucarest.png?v=1737570205',
  logo:       'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776',
};

async function initStaticImages() {
  const entries = await Promise.all(
    Object.entries(STATIC_URLS).map(async ([key, url]) => [key, await fetchBase64(url)])
  );
  entries.forEach(([key, data]) => { STATIC[key] = data; });
  console.log('[images] Static images ready:', Object.keys(STATIC).join(', '));
}

async function embedProductImages(products) {
  return Promise.all(products.map(async (p) => {
    const url = p.images?.[0]?.src;
    if (!url) return p;
    const b64 = await fetchBase64(url);
    return { ...p, images: [{ ...p.images[0], src: b64 }, ...p.images.slice(1)] };
  }));
}

module.exports = { fetchBase64, embedProductImages, initStaticImages, STATIC };
