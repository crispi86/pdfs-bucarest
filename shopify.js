const https = require('https');

const SHOP = process.env.SHOPIFY_SHOP;

function shopifyRequest(method, path, body = null) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SHOP,
      path: `/admin/api/2024-01/${path}`,
      method,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ body: JSON.parse(data), headers: res.headers }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function getNextPageInfo(linkHeader) {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function getAllPages(path, key) {
  let results = [];
  const separator = path.includes('?') ? '&' : '?';
  let currentPath = `${path}${separator}limit=250`;
  while (true) {
    const { body, headers } = await shopifyRequest('GET', currentPath);
    const items = body[key];
    if (!items || items.length === 0) break;
    results = results.concat(items);
    const next = getNextPageInfo(headers['link']);
    if (!next) break;
    const base = path.split('?')[0];
    currentPath = `${base}?limit=250&page_info=${next}`;
    await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function getOrder(orderId) {
  const { body } = await shopifyRequest('GET', `orders/${orderId}.json`);
  return body.order;
}

async function getProductsByCollection(collectionId) {
  return getAllPages(`products.json?collection_id=${collectionId}&fields=id,title,images,variants,body_html`, 'products');
}

async function getProductsByTag(tag) {
  return getAllPages(`products.json?tag=${encodeURIComponent(tag)}&fields=id,title,images,body_html,variants`, 'products');
}

async function getProductsByTitle(keyword) {
  const all = await getAllPages(`products.json?fields=id,title,images,body_html,variants`, 'products');
  const lower = keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return all.filter(p => {
    const t = (p.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.includes(lower);
  });
}

async function getProductsByMetafield(namespace, key, value) {
  const all = await getAllPages(`products.json?fields=id,title,images,body_html,variants`, 'products');
  const results = [];
  for (const product of all) {
    const { body } = await shopifyRequest('GET', `products/${product.id}/metafields.json`);
    const match = (body.metafields || []).find(m =>
      m.namespace === namespace && m.key === key &&
      String(m.value).toLowerCase().includes(value.toLowerCase())
    );
    if (match) results.push(product);
    await new Promise(r => setTimeout(r, 100));
  }
  return results;
}

async function getProductById(productId) {
  const { body } = await shopifyRequest('GET', `products/${productId}.json`);
  return body.product;
}

async function getCollections() {
  const custom = await getAllPages('custom_collections.json?fields=id,title', 'custom_collections');
  const smart = await getAllPages('smart_collections.json?fields=id,title', 'smart_collections');
  return [...custom, ...smart].sort((a, b) => a.title.localeCompare(b.title));
}

async function isProductInCollection(productId, collectionId) {
  const { body } = await shopifyRequest('GET', `collects.json?product_id=${productId}&collection_id=${collectionId}`);
  if (body.collects && body.collects.length > 0) return true;
  const products = await getProductsByCollection(collectionId);
  return products.some(p => p.id === productId);
}

module.exports = {
  shopifyRequest,
  getOrder,
  getProductsByCollection,
  getProductsByTag,
  getProductsByTitle,
  getProductsByMetafield,
  getProductById,
  getCollections,
  isProductInCollection,
  getAllPages,
};
