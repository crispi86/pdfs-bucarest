const https = require('https');

const SHOP = process.env.SHOPIFY_SHOP;

function shopifyRequest(method, path, body = null) {
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  const bodyStr = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SHOP,
      path: `/admin/api/2024-01/${path}`,
      method,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode;
        if (!data.trim()) {
          if (status >= 200 && status < 300) return resolve({ body: {}, headers: res.headers });
          return reject(new Error(`Shopify HTTP ${status} — respuesta vacía`));
        }
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) {
          return reject(new Error(`Shopify HTTP ${status} — respuesta no-JSON: ${data.slice(0, 200)}`));
        }
        if (status >= 400) {
          const detail = parsed.errors
            ? JSON.stringify(parsed.errors).slice(0, 300)
            : (parsed.error || `HTTP ${status}`);
          return reject(new Error(`Shopify ${status}: ${detail}`));
        }
        resolve({ body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
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
  return getAllPages(`products.json?collection_id=${collectionId}&fields=id,title,handle,images,variants,body_html,status`, 'products');
}

async function getProductsByTag(tag) {
  return getAllPages(`products.json?tag=${encodeURIComponent(tag)}&fields=id,title,handle,images,body_html,variants,status`, 'products');
}

async function getProductsByTitle(keyword) {
  const all = await getAllPages(`products.json?fields=id,title,handle,images,body_html,variants,status`, 'products');
  const lower = keyword.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return all.filter(p => {
    const t = (p.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return t.includes(lower);
  });
}

async function getProductsBySku(sku) {
  // variants.json?sku= ignora el parámetro en la API REST; usar GraphQL que sí filtra por SKU
  const escaped = sku.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const data = await graphqlRequest(`{
    products(first: 50, query: "sku:${escaped}") {
      edges { node { legacyResourceId } }
    }
  }`);
  const ids = (data?.data?.products?.edges || []).map(e => e.node.legacyResourceId);
  if (!ids.length) return [];
  return Promise.all(ids.map(id => getProductById(id)));
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

async function getFilesByKeyword(keyword) {
  try {
    // Intenta primero con filtro de nombre — más rápido y preciso
    const result = await graphqlRequest(`{
      files(first: 250, query: "filename:${keyword}") {
        edges { node { ... on MediaImage { image { url altText } } } }
      }
    }`);
    const fromSearch = (result?.data?.files?.edges || [])
      .map(e => e.node?.image).filter(Boolean);
    if (fromSearch.length > 0) return fromSearch;
    // Fallback: descarga hasta 250 archivos y filtra por URL
    const all = await getFiles();
    return all.filter(f => f.url && f.url.toLowerCase().includes(keyword.toLowerCase()));
  } catch(e) {
    console.error('[shopify] getFilesByKeyword error:', e.message);
    return [];
  }
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

// ── Folios persistentes (Shopify como fuente de verdad) ───────────────────────
// Sin estado en-memoria: cada folio lee Y escribe a Shopify de forma síncrona.
// Reinicios de Railway nunca pierden el contador.

const FOLIO_CONFIG = {
  cert:     { key: 'cert_counter',     prefix: 'CERT', start: 3099 },
  catalog:  { key: 'catalog_counter',  prefix: 'CAT',  start: 0    },
  brochure: { key: 'brochure_counter', prefix: 'BRO',  start: 0    },
  quote:    { key: 'quote_counter',    prefix: 'COT',  start: 0    },
};

async function getNextFolio(docType) {
  const cfg = FOLIO_CONFIG[docType];
  if (!cfg) throw new Error(`Tipo de documento desconocido: ${docType}`);
  try {
    const { body: getBody } = await shopifyRequest('GET', `shop/metafields.json?namespace=bucarest&key=${cfg.key}`);
    const existing = (getBody.metafields || [])[0];
    const current = existing ? (parseInt(existing.value) || cfg.start) : cfg.start;
    const next = current + 1;

    if (existing) {
      await shopifyRequest('PUT', `metafields/${existing.id}.json`, {
        metafield: { id: existing.id, value: String(next) },
      });
    } else {
      await shopifyRequest('POST', 'shop/metafields.json', {
        metafield: { namespace: 'bucarest', key: cfg.key, value: String(next), type: 'number_integer' },
      });
    }

    const folio = `${cfg.prefix}-${String(next).padStart(4, '0')}`;
    console.log(`[folio] ${docType} → ${folio}`);
    return folio;
  } catch (e) {
    const fallback = `${cfg.prefix}-${Date.now().toString().slice(-6)}`;
    console.error(`[folio] Error Shopify para ${docType}, fallback ${fallback}:`, e.message);
    return fallback;
  }
}

async function getNextCertFolio() {
  return getNextFolio('cert');
}

// ── Proyectos guardados (Shopify metafields, namespace=bucarest) ──────────────

const VALID_PROJECT_TYPES = new Set(['brochure', 'catalog', 'quote']);

function _parseProjectValue(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    try { const p = JSON.parse(value); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

async function _findProjectMetafield(key) {
  const { body } = await shopifyRequest('GET', 'shop/metafields.json?namespace=bucarest');
  const all = body.metafields || [];
  console.log(`[_findProjectMetafield] ${all.length} metafield(s) en namespace bucarest`);
  return all.find(m => m.key === key) || null;
}

async function getProjects(type) {
  if (!VALID_PROJECT_TYPES.has(type)) throw new Error(`Tipo inválido: ${type}`);
  const key = `${type}_projects`;
  const existing = await _findProjectMetafield(key);
  if (!existing) return [];
  return _parseProjectValue(existing.value);
}

async function saveProject(type, project) {
  if (!VALID_PROJECT_TYPES.has(type)) throw new Error(`Tipo inválido: ${type}`);
  const key = `${type}_projects`;
  const existing = await _findProjectMetafield(key);
  let projects = existing ? _parseProjectValue(existing.value) : [];
  const idx = projects.findIndex(p => p.id === project.id);
  if (idx >= 0) projects[idx] = project;
  else projects.push(project);

  const valueStr = JSON.stringify(projects);
  const byteSize = Buffer.byteLength(valueStr, 'utf8');
  console.log(`[saveProject] ${type} → ${projects.length} proyecto(s), ${byteSize} bytes`);
  if (byteSize > 65000) {
    throw new Error(`Los proyectos guardados superan el límite de Shopify (${byteSize} bytes). Elimina proyectos antiguos antes de guardar.`);
  }

  if (existing) {
    try {
      await shopifyRequest('PUT', `metafields/${existing.id}.json`, {
        metafield: { id: existing.id, value: valueStr },
      });
    } catch (putErr) {
      console.log(`[saveProject] PUT falló (${putErr.message}), recreando metafield`);
      await shopifyRequest('POST', 'shop/metafields.json', {
        metafield: { namespace: 'bucarest', key, value: valueStr, type: 'json' },
      });
    }
  } else {
    await shopifyRequest('POST', 'shop/metafields.json', {
      metafield: { namespace: 'bucarest', key, value: valueStr, type: 'json' },
    });
  }
  return projects;
}

async function deleteProject(type, projectId) {
  if (!VALID_PROJECT_TYPES.has(type)) throw new Error(`Tipo inválido: ${type}`);
  const key = `${type}_projects`;
  const existing = await _findProjectMetafield(key);
  if (!existing) return [];
  let projects = _parseProjectValue(existing.value);
  projects = projects.filter(p => p.id !== projectId);
  const valueStr = JSON.stringify(projects);
  try {
    await shopifyRequest('PUT', `metafields/${existing.id}.json`, {
      metafield: { id: existing.id, value: valueStr },
    });
  } catch (putErr) {
    console.log(`[deleteProject] PUT falló (${putErr.message}), recreando metafield`);
    await shopifyRequest('POST', 'shop/metafields.json', {
      metafield: { namespace: 'bucarest', key, value: valueStr, type: 'json' },
    });
  }
  return projects;
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
  getNextFolio,
  getNextCertFolio,
  isProductInCollection,
  getAllPages,
  getFilesByKeyword,
  getProjects,
  saveProject,
  deleteProject,
};
