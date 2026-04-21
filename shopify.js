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

function graphqlRequest(query) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const bodyStr = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: process.env.SHOPIFY_SHOP,
      path: '/admin/api/2024-01/graphql.json',
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
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
  const clean = String(orderId).replace('#', '').trim();

  const { body } = await shopifyRequest('GET', `orders/${clean}.json`);
  if (body.order) return body.order;

  const { body: body2 } = await shopifyRequest('GET', `orders.json?name=%23${clean}&status=any`);
  const found = (body2.orders || [])[0];
  if (found) return found;

  throw new Error(`No se encontró la orden "${orderId}"`);
}

async function getProductsByCollection(collectionId) {
  return getAllPages(`products.json?collection_id=${collectionId}&fields=id,title,images,variants,body_html,status`, 'products');
}

async function getProductsByTag(tag) {
  return getAllPages(`products.json?tag=${encodeURIComponent(tag)}&fields=id,title,images,body_html,variants,status`, 'products');
}

async function getProductsByTitle(keyword) {
  return getAllPages(`products.json?title=${encodeURIComponent(keyword)}&fields=id,title,images,body_html,variants,status`, 'products');
}

async function getProductsBySku(sku) {
  const { body } = await shopifyRequest('GET', `variants.json?sku=${encodeURIComponent(sku)}&fields=id,product_id,sku`);
  const variants = body.variants || [];
  const productIds = [...new Set(variants.map(v => v.product_id))];
  return Promise.all(productIds.map(id => getProductById(id)));
}

async function getProductsByMetafield(namespace, key, value) {
  const all = await getAllPages(`products.json?fields=id,title,images,body_html,variants,status`, 'products');
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

// Cache para no llamar el mismo metaobjeto dos veces en la misma sesión
const metaobjectCache = {};

async function resolveMetaobjectDisplayName(gid) {
  if (metaobjectCache[gid] !== undefined) return metaobjectCache[gid];
  try {
    const result = await graphqlRequest(
      `{ node(id: ${JSON.stringify(gid)}) { ... on Metaobject { displayName } } }`
    );
    const name = result?.data?.node?.displayName || null;
    metaobjectCache[gid] = name;
    return name;
  } catch {
    metaobjectCache[gid] = null;
    return null;
  }
}

async function formatMetafieldValue(value) {
  if (value === null || value === undefined) return value;

  let parsed;
  try { parsed = JSON.parse(value); } catch { parsed = value; }

  // Medida: {"value":30.0,"unit":"cm"}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'value' in parsed && 'unit' in parsed) {
    return `${parsed.value} ${parsed.unit}`;
  }

  // Array de GIDs de metaobjetos
  if (Array.isArray(parsed)) {
    const names = await Promise.all(parsed.map(async item => {
      if (typeof item === 'string' && item.startsWith('gid://shopify/Metaobject/')) {
        return (await resolveMetaobjectDisplayName(item)) || item;
      }
      return item;
    }));
    return names.filter(Boolean).join(', ');
  }

  // GID único de metaobjeto
  const strVal = typeof parsed === 'string' ? parsed : String(value);
  if (strVal.startsWith('gid://shopify/Metaobject/')) {
    return (await resolveMetaobjectDisplayName(strVal)) || strVal;
  }

  return value;
}

async function getProductMetafields(productId) {
  const { body } = await shopifyRequest('GET', `products/${productId}/metafields.json?namespace=custom`);
  const result = {};
  await Promise.all((body.metafields || []).map(async m => {
    result[m.key] = await formatMetafieldValue(m.value);
  }));
  return result;
}

async function getFiles() {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const query = `{
    files(first: 100, query: "media_type:IMAGE") {
      edges {
        node {
          ... on MediaImage {
            image { url altText }
          }
        }
      }
    }
  }`;
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: process.env.SHOPIFY_SHOP,
      path: '/admin/api/2024-01/graphql.json',
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = require('https').request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const files = (json.data?.files?.edges || [])
            .map(e => e.node?.image)
            .filter(Boolean);
          resolve(files);
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function getCollections() {
  const custom = await getAllPages('custom_collections.json?fields=id,title', 'custom_collections');
  const smart = await getAllPages('smart_collections.json?fields=id,title', 'smart_collections');
  return [...custom, ...smart].sort((a, b) => a.title.localeCompare(b.title));
}

async function getLocations() {
  const { body } = await shopifyRequest('GET', 'locations.json');
  return (body.locations || []).filter(l => l.active);
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
  getFiles,
  getProductsByCollection,
  getProductsByTag,
  getProductsByTitle,
  getProductsBySku,
  getProductsByMetafield,
  getProductById,
  getProductMetafields,
  getCollections,
  getLocations,
  isProductInCollection,
  getAllPages,
};
