if (process.env.NODE_ENV !== 'production') require('dotenv').config();
process.on('uncaughtException', err => console.error('UNCAUGHT:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED:', err));
const express = require('express');
const crypto = require('crypto');
const { generatePDF } = require('./pdf');
const { sendCertificate, sendPDFToInternal, sendToCustomer } = require('./email');
const { certificateHTML } = require('./templates/certificate');
const { catalogHTML } = require('./templates/catalog');
const { quoteHTML } = require('./templates/quote');
const { receiptHTML } = require('./templates/receipt');
const { brochureHTML } = require('./templates/brochure');
const shopify = require('./shopify');
const { fetchBase64, embedProductImages, initStaticImages, STATIC } = require('./images');

const app = express();

// ── Caché simple con TTL ──────────────────────────────────────────────────────
const _cache = new Map();
function getCached(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(key); return null; }
  return e.data;
}
function setCached(key, data, ttlMs) {
  _cache.set(key, { data, exp: Date.now() + ttlMs });
  return data;
}
async function withCache(key, ttlMs, fn) {
  const hit = getCached(key);
  if (hit !== null) return hit;
  return setCached(key, await fn(), ttlMs);
}

// ── Auth store ────────────────────────────────────────────────────────────────
const pendingStates = new Map();  // state -> host
const authorizedShops = new Set(); // shops que completaron OAuth

function requireAuth(req, res, next) {
  const shop = req.query.shop || process.env.SHOPIFY_SHOP;
  if (authorizedShops.has(shop)) return next();
  const host = req.query.host || '';
  const authUrl = `/shopify/auth?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`;
  res.send(`<!DOCTYPE html><html><head>
    <script>window.top.location.href = ${JSON.stringify(authUrl)};</script>
  </head><body></body></html>`);
}

app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Bucarest PDF Generator — OK'));

// ── Geo lookup (server-side, avoids browser CORS) ─────────────────────────────
app.get('/api/geo', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  try {
    const apiKey = process.env.IPGEO_API_KEY;
    const r = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${apiKey}&ip=${ip}`);
    const d = await r.json();
    if (!d || d.message || d.country_code2 !== 'CL') return res.json({ fallback: true });
    res.json({ country_code: d.country_code2, region: d.state_prov, city: d.city, postal: d.zipcode, region_code: d.state_code });
  } catch (e) {
    res.json({ fallback: true });
  }
});

// ── Read Chilean shipping discount from Shopify delivery profiles (cached 1h) ──
async function getChileanShippingDiscount() {
  return withCache('cl_shipping_discount', 60 * 60 * 1000, async () => {
    try {
      const r = await fetch(`https://${process.env.SHOPIFY_SHOP}/admin/api/2025-01/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ query: `{
          deliveryProfiles(first: 5) { edges { node { profileLocationGroups {
            locationGroupZones(first: 20) { edges { node {
              zone { countries { code { countryCode } } }
              methodDefinitions(first: 5) { edges { node { rateProvider {
                ... on DeliveryParticipant { percentageOfRateFee }
              } } } }
            } } }
          } } } }
        }` }),
      });
      const json = await r.json();
      for (const { node: profile } of (json?.data?.deliveryProfiles?.edges || [])) {
        for (const group of profile.profileLocationGroups) {
          for (const { node: z } of group.locationGroupZones.edges) {
            if (!z.zone.countries.some(c => c.code.countryCode === 'CL')) continue;
            for (const { node: m } of z.methodDefinitions.edges) {
              const pct = m.rateProvider?.percentageOfRateFee;
              if (typeof pct === 'number' && pct !== 0) return pct;
            }
          }
        }
      }
    } catch (e) { console.warn('Could not fetch CL shipping discount:', e.message); }
    return -50; // fallback if Shopify unreachable
  });
}

// ── Domestic shipping rate via Envia.com, discount read from Shopify zones ──
app.get('/api/shipping-rate', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { postal, weight_g, city, rcode } = req.query;
  if (!postal) return res.json({ fallback: true });

  const weightKg = Math.max(0.5, parseFloat(weight_g || '1000') / 1000);
  const destCity = city || 'Santiago';
  // Envia.com expects short state code (e.g. "BI"), not ISO prefix (e.g. "CL-BI")
  const destState = rcode ? rcode.replace(/^CL-/, '') : 'RM';
  const cacheKey = `rate_${postal}_${destCity}_${Math.round(weightKg * 10)}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  try {
    const enviaRes = await fetch('https://api.envia.com/ship/rate/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ENVIA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        origin: {
          name: 'Bucarest Art & Antiques',
          street: 'Bucarest',
          number: '034',
          district: 'Providencia',
          city: 'Santiago',
          state: 'RM',
          country: 'CL',
          postalCode: '7510050',
        },
        destination: {
          name: 'Cliente',
          district: destCity,
          city: destCity,
          state: destState,
          country: 'CL',
          postalCode: postal,
        },
        packages: [{
          content: 'Arte y antigüedades',
          amount: 1,
          type: 'box',
          dimensions: { length: 40, width: 40, height: 40 },
          dimensionsUnit: 'CM',
          weight: weightKg,
          weightUnit: 'KG',
        }],
        shipment: { carrier: 'STARKEN', type: 1 },
      }),
    });

    const data = await enviaRes.json();
    console.log('Envia domestic rate response:', JSON.stringify(data).substring(0, 400));

    const rates = Array.isArray(data.data) ? data.data : [];
    // Prefer home delivery (dropOff === 0) over branch pickup
    const homeRates = rates.filter(r => r.dropOff === 0);
    const pool = homeRates.length ? homeRates : rates;
    if (!pool.length) return res.json({ fallback: true });

    const cheapest = pool.reduce((a, b) => (a.totalPrice < b.totalPrice ? a : b));
    const discountPct = await getChileanShippingDiscount(); // e.g. -50
    const multiplier = 1 + (discountPct / 100); // e.g. 0.5
    const discountedPrice = Math.round(cheapest.totalPrice * multiplier);
    const result = { price: discountedPrice, days: cheapest.deliveryEstimate || null };
    setCached(cacheKey, result, 60 * 60 * 1000);
    res.json(result);
  } catch (e) {
    console.error('Envia domestic rate error:', e.message);
    res.json({ fallback: true });
  }
});

// ── International shipping rate via Shopify DHL (draftOrderCalculate) ────────
app.get('/api/shipping-rate-intl', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { country, postal, city, rcode, variant_id } = req.query;
  if (!country || !postal || !variant_id) return res.json({ fallback: true });

  const countryUp = country.toUpperCase();
  const cacheKey = `intl_dhl_${countryUp}_${postal}_${variant_id}`;
  const cached = getCached(cacheKey);
  if (cached) return res.json(cached);

  let province = rcode ? rcode.replace(/^[A-Z]+-/, '') : '';
  if (!province) {
    const defaults = {
      US:'NY', CA:'ON', AU:'NSW', DE:'BE', FR:'IDF', ES:'MD', IT:'RM',
      GB:'ENG', NL:'NH', BE:'BRU', CH:'ZH', AT:'9', PT:'11', SE:'AB',
      NO:'03', DK:'84', FI:'18', PL:'14', IE:'L', MX:'CMX', BR:'SP',
      AR:'C', CO:'DC', PE:'LIM', JP:'13', KR:'11', IN:'MH', ZA:'GT', NZ:'AUK',
    };
    province = defaults[countryUp] || '';
  }

  try {
    const shippingAddress = {
      address1: '1 Main St',
      city: city || 'City',
      countryCode: countryUp,
      zip: postal,
      firstName: 'Cliente',
      lastName: 'Bucarest',
    };
    if (province) shippingAddress.province = province;

    const mutation = `
      mutation draftOrderCalculate($input: DraftOrderInput!) {
        draftOrderCalculate(input: $input) {
          calculatedDraftOrder {
            availableShippingRates {
              handle title price { amount currencyCode }
            }
          }
          userErrors { field message }
        }
      }
    `;

    const shopifyRes = await fetch(
      `https://${process.env.SHOPIFY_SHOP}/admin/api/2025-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          query: mutation,
          variables: {
            input: {
              lineItems: [{ variantId: `gid://shopify/ProductVariant/${variant_id}`, quantity: 1 }],
              shippingAddress,
            },
          },
        }),
      }
    );

    const json = await shopifyRes.json();
    console.log('DHL intl rate response:', JSON.stringify(json).substring(0, 500));

    const errs = json?.data?.draftOrderCalculate?.userErrors;
    if (errs?.length) console.warn('DHL userErrors:', JSON.stringify(errs));

    const rates = json?.data?.draftOrderCalculate?.calculatedDraftOrder?.availableShippingRates || [];
    if (!rates.length) return res.json({ fallback: true });

    const cheapest = rates.reduce((a, b) =>
      parseFloat(a.price.amount) <= parseFloat(b.price.amount) ? a : b
    );

    const rawPrice = parseFloat(cheapest.price.amount);
    const currency = cheapest.price.currencyCode;
    let priceCLP = Math.round(rawPrice);
    let priceUSD = null;

    try {
      const fxRate = await withCache('fx_clp_usd', 60 * 60 * 1000, async () => {
        const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(4000) });
        const d = await r.json();
        return d.result === 'success' && d.rates?.CLP ? d.rates.CLP : null;
      });
      if (fxRate) {
        if (currency === 'USD') { priceUSD = Math.round(rawPrice); priceCLP = Math.round(rawPrice * fxRate); }
        else { priceUSD = Math.round(priceCLP / fxRate); }
      }
    } catch (e) { /* skip */ }

    const result = { price: priceCLP, ...(priceUSD ? { price_usd: priceUSD } : {}), days: null };
    setCached(cacheKey, result, 60 * 60 * 1000);
    res.json(result);
  } catch (e) {
    console.error('DHL intl rate error:', e.message);
    res.json({ fallback: true });
  }
});

// ── OAuth: inicio ─────────────────────────────────────────────────────────────
app.get('/shopify/auth', (req, res) => {
  const shop = req.query.shop || process.env.SHOPIFY_SHOP;
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, req.query.host || '');

  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: 'read_products,read_orders,read_metaobjects,read_locations,read_files',
    redirect_uri: `${process.env.APP_URL}/shopify/callback`,
    state,
  });
  const authUrl = `https://${shop}/admin/oauth/authorize?${params}`;

  // Escapar el iframe con un redirect a nivel de página completa
  res.send(`<!DOCTYPE html><html><head>
    <script>window.top.location.href = ${JSON.stringify(authUrl)};</script>
  </head><body></body></html>`);
});

// ── OAuth: callback ───────────────────────────────────────────────────────────
app.get('/shopify/callback', async (req, res) => {
  const { shop, code, state, hmac } = req.query;

  if (!pendingStates.has(state)) return res.status(403).send('Estado inválido');
  const savedHost = pendingStates.get(state);
  pendingStates.delete(state);

  const { hmac: _h, ...rest } = req.query;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const digest = crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(message).digest('hex');
  if (digest !== hmac) return res.status(403).send('HMAC inválido');

  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });
  const { access_token } = await r.json();

  // Actualizar el token en memoria para que las llamadas a Shopify usen el nuevo token con los scopes actualizados
  if (access_token) process.env.SHOPIFY_ACCESS_TOKEN = access_token;

  authorizedShops.add(shop);
  const host = savedHost || Buffer.from(`${shop}/admin`).toString('base64');
  res.redirect(`/admin?shop=${encodeURIComponent(shop)}&host=${encodeURIComponent(host)}`);
});

// ── Webhook: orden pagada ─────────────────────────────────────────────────────
app.post('/webhook/orders/paid', async (req, res) => {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (secret) {
    const digest = crypto.createHmac('sha256', secret).update(req.body).digest('base64');
    if (digest !== hmac) return res.status(401).send('Unauthorized');
  }

  res.sendStatus(200);

  try {
    const order = JSON.parse(req.body);
    const customer = order.customer || {};
    const customerName = customer.first_name
      ? `${customer.first_name} ${customer.last_name || ''}`.trim()
      : 'Cliente';
    const customerEmail = customer.email;

    // Enviar comprobante de venta a todos los pedidos pagados
    const receiptHtml = receiptHTML(order);
    const receiptPdf = await generatePDF(receiptHtml);
    const filename = `Comprobante_${order.name || order.order_number}.pdf`;

    if (customerEmail) {
      await sendToCustomer(
        customerEmail, receiptPdf, filename,
        `Comprobante de venta — ${order.name || '#' + order.order_number}`,
        `<p>Estimado/a ${customerName},</p><p>Adjunto encontrará su comprobante de venta. Gracias por su compra en Bucarest Art &amp; Antiques.</p>`
      );
    }

    console.log(`✅ Comprobante enviado para orden ${order.order_number}`);
  } catch (err) {
    console.error('Error procesando webhook:', err);
  }
});

// ── Datos de producto para formulario de certificado ──────────────────────────
app.get('/api/product-cert-data', async (req, res) => {
  try {
    const { id } = req.query;
    const [product, metafields] = await Promise.all([
      shopify.getProductById(id),
      shopify.getProductMetafields(id),
    ]);
    res.json({
      id: product.id,
      title: product.title || '',
      image: product.images?.[0]?.src || '',
      description: product.body_html ? product.body_html.replace(/<[^>]*>/g, '').trim() : '',
      price: product.variants?.[0]?.price || '',
      origen: metafields.origen || '',
      alto: metafields.alto || '',
      ancho: metafields.ancho || '',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Interfaz web ──────────────────────────────────────────────────────────────
app.get('/admin', requireAuth, (req, res) => {
  res.setHeader('Content-Security-Policy',
    `frame-ancestors https://${process.env.SHOPIFY_SHOP} https://admin.shopify.com`);
  res.send(adminUI(req.query.host || ''));
});

// ── API: colecciones y tags ───────────────────────────────────────────────────
app.get('/api/collections', async (req, res) => {
  try {
    const collections = await withCache('collections', 30 * 60 * 1000, () => shopify.getCollections());
    res.json(collections);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/collection-products/:id', async (req, res) => {
  try {
    const products = await shopify.getProductsByCollection(req.params.id);
    const filtered = products.filter(p =>
      p.status === 'active' &&
      (p.variants || []).reduce((s, v) => s + (parseInt(v.inventory_quantity) || 0), 0) >= 1
    );
    res.json(filtered.map(p => ({
      id: p.id,
      title: p.title,
      image: p.images?.[0]?.src || '',
      price: p.variants?.[0]?.price || null,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const products = await shopify.getAllPages('products.json?fields=id,title,images&limit=250', 'products');
    const images = [];
    const seen = new Set();
    for (const p of products) {
      for (const img of (p.images || [])) {
        if (img.src && !seen.has(img.src)) {
          seen.add(img.src);
          images.push({ url: img.src, altText: p.title });
        }
      }
    }
    res.json(images);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

const TEXTURES = [
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura_marmolsi.png?v=1774832085',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura28.jpg?v=1772673637',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura27.jpg?v=1772586779',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura26.png?v=1772586525',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura25.jpg?v=1772585745',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura24.jpg?v=1772585547',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura23.jpg?v=1772585360',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura22.jpg?v=1772585012',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura21.jpg?v=1772584942',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura111.jpg?v=1771817210',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura9_c4b6a85d-6e54-4224-a5bf-87e48008a8c4.jpg?v=1768408593',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura10.jpg?v=1768404369',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura9.jpg?v=1768261937',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura8.jpg?v=1768252336',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura7.jpg?v=1767989572',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura6.jpg?v=1767989537',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura5.jpg?v=1767989506',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura4.jpg?v=1767987760',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura3.jpg?v=1767987732',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura2.jpg?v=1767991848',
  'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura_madera.jpg?v=1761008010',
];

app.get('/api/textures', (req, res) => {
  res.json(TEXTURES.map(url => ({ url, alt: url.split('/').pop().split('?')[0].replace(/\.[^.]+$/, '').replace(/_/g, ' ') })));
});

app.get('/api/contextos', async (req, res) => {
  try {
    const files = await shopify.getFilesByKeyword('contexto');
    res.json(files.map(f => ({
      url: f.url,
      alt: f.altText || f.url.split('/').pop().split('?')[0].replace(/\.[^.]+$/, '').replace(/_/g, ' '),
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { collection_id, tag, title, sku, metafield_namespace, metafield_key, metafield_value } = req.query;
    const cacheKey = JSON.stringify(req.query);
    const TTL = 5 * 60 * 1000;
    let products = [];
    products = await withCache(cacheKey, TTL, async () => {
      if (collection_id) return shopify.getProductsByCollection(collection_id);
      if (tag) return shopify.getProductsByTag(tag);
      if (title) return shopify.getProductsByTitle(title);
      if (sku) return shopify.getProductsBySku(sku);
      return [];
    });
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Proyectos guardados ───────────────────────────────────────────────────────
app.get('/api/projects/:type', async (req, res) => {
  try {
    const projects = await shopify.getProjects(req.params.type);
    res.json(projects);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/projects/:type', async (req, res) => {
  try {
    const { id, name, data } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });
    const project = { id, name, savedAt: new Date().toISOString(), data: data || {} };
    console.log(`[projects] guardando ${req.params.type}:`, id, name);
    const projects = await shopify.saveProject(req.params.type, project);
    console.log(`[projects] guardado OK, total: ${projects.length}`);
    res.json(projects);
  } catch (e) {
    console.error(`[projects] error guardando ${req.params.type}:`, e.message);
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/projects/:type/:id', async (req, res) => {
  try {
    const projects = await shopify.deleteProject(req.params.type, req.params.id);
    res.json(projects);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Generar certificado ───────────────────────────────────────────────────────
app.post('/generate/certificate', async (req, res) => {
  try {
    const { title, description, price, image, origen, alto, ancho,
            send_email, to_email, to_name, nominative_honorific, nominative_name, expert,
            emission_date } = req.body;

    const folio     = await shopify.getNextCertFolio();
    const imageData = await fetchBase64(image);

    const item = {
      title: title || '',
      image: imageData || null,
      price: parseFloat(price) || 0,
      currency: 'CLP',
      description: description || null,
      metafields: { origen: origen || null, alto: alto || null, ancho: ancho || null },
    };

    const nominative = nominative_name ? { honorific: nominative_honorific || '', name: nominative_name } : null;
    const html = certificateHTML([item], { folio, nominative, expert: expert || 'ricardo', staticImages: STATIC, emissionDate: emission_date || '' });
    const pdf = await generatePDF(html, { format: 'Letter', margin: { top: '20mm', right: '25mm', bottom: '20mm', left: '25mm' } });

    if (send_email && to_email) {
      await sendCertificate(to_email, to_name || 'Cliente', pdf, title);
      res.json({ ok: true, message: `Certificado ${folio} enviado por correo.`, folio });
    } else {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="Certificado_${folio}.pdf"`);
      res.send(pdf);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Generar catálogo ──────────────────────────────────────────────────────────
app.post('/generate/catalog', async (req, res) => {
  try {
    const { product_ids, title, show_prices, show_estado, show_quienes_somos, send_email, responsable, cargo, correo, telefono, bg_image, price_overrides, meta_fields } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const [folio, rawProducts, locations, bgImageData] = await Promise.all([
      shopify.getNextFolio('catalog'),
      Promise.all(ids.map(async id => {
        const p = await shopify.getProductById(id);
        if (!p) return null;
        p._metafields = await shopify.getProductMetafields(id);
        if (price_overrides && price_overrides[id] && p.variants && p.variants[0]) {
          p.variants[0].price = String(price_overrides[id]);
        }
        return p;
      })),
      withCache('locations', 60 * 60 * 1000, () => shopify.getLocations()),
      bg_image ? fetchBase64(bg_image, 1200) : Promise.resolve(''),
    ]);

    const products = await embedProductImages(rawProducts.filter(Boolean), 800);

    const html = catalogHTML(products, {
      title: title || 'Catálogo',
      folio,
      showPrices: show_prices !== 'false',
      showEstado: show_estado === 'true',
      showQuienesSomos: show_quienes_somos === 'true' || show_quienes_somos === true,
      showMetaFields: Array.isArray(meta_fields) ? meta_fields : null,
      responsable, cargo, correo, telefono,
      bgImage: bg_image,
      bgImageData,
      locations,
      staticImages: STATIC,
    });
    const pdf = await generatePDF(html);
    const filename = `Catalogo_${folio}.pdf`;

    if (send_email) {
      await sendPDFToInternal(pdf, filename, `Catálogo — ${title || 'Bucarest Art & Antiques'}`,
        `<p>Catálogo ${folio} generado el ${new Date().toLocaleDateString('es-CL')}.</p>`);
      res.json({ ok: true, message: `Catálogo ${folio} enviado por correo.`, folio });
    } else {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Generar cotización ────────────────────────────────────────────────────────
app.post('/generate/quote', async (req, res) => {
  try {
    const { product_ids, client_name, client_email, client_rut, client_company, client_razon_social, client_direccion, valid_days, notes, send_email, price_overrides, products_per_page, show_links, show_description, show_sku } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const [folio, rawProducts] = await Promise.all([
      shopify.getNextFolio('quote'),
      Promise.all(ids.map(async id => {
        const p = await shopify.getProductById(id);
        if (price_overrides?.[id] && p.variants?.[0]) p.variants[0].price = String(price_overrides[id]);
        return p;
      })),
    ]);
    const products = await embedProductImages(rawProducts);

    const html = quoteHTML(products, {
      folio,
      clientName: client_name, clientEmail: client_email,
      clientRut: client_rut, clientCompany: client_company,
      clientRazonSocial: client_razon_social, clientDireccion: client_direccion,
      validDays: valid_days || 7, notes,
      productsPerPage: products_per_page || 3,
      showLinks: show_links === true || show_links === 'true',
      showDescription: show_description !== false && show_description !== 'false',
      showSku: show_sku === true || show_sku === 'true',
      staticImages: STATIC,
    });
    const pdf = await generatePDF(html);
    const filename = `Cotizacion_${folio}.pdf`;

    if (send_email && client_email) {
      await sendPDFToInternal(pdf, filename, `Cotización ${folio} — ${client_name || 'Sin nombre'}`,
        `<p>Cotización ${folio} generada para ${client_name || 'cliente sin nombre'}.</p>`);
      res.json({ ok: true, message: `Cotización ${folio} enviada por correo.`, folio });
    } else {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Generar comprobante de venta ──────────────────────────────────────────────
app.post('/generate/receipt', async (req, res) => {
  try {
    const { order_id, send_email } = req.body;
    const order = await shopify.getOrder(order_id);
    const html = receiptHTML(order);
    const pdf = await generatePDF(html);
    const filename = `Comprobante_Orden_${order.order_number || order_id}.pdf`;

    if (send_email) {
      const customerEmail = order.customer?.email;
      const customerName = order.customer?.first_name
        ? `${order.customer.first_name} ${order.customer.last_name || ''}`.trim()
        : 'Cliente';
      if (customerEmail) {
        await sendCertificate(customerEmail, customerName, pdf, `Orden #${order.order_number}`);
      }
      res.json({ ok: true, message: 'Comprobante enviado por correo.' });
    } else {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdf);
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ── Generar brochure corporativo ──────────────────────────────────────────────
app.post('/generate/brochure', async (req, res) => {
  try {
    const {
      company_name, responsable, cargo, correo, telefono,
      show_prices, textura_url, contexto_images = {}, product_ids = [],
      proyecto, products_per_page, collections = [], meta_fields,
      cover_tag, cover_title, cover_sub, pages,
    } = req.body;

    let products = [];
    if (product_ids.length) {
      const raw = await Promise.all(product_ids.map(id => shopify.getProductById(id)));
      const withMeta = await Promise.all(raw.filter(Boolean).map(async p => {
        const meta = await shopify.getProductMetafields(p.id);
        return { ...p, _metafields: meta };
      }));
      products = await embedProductImages(withMeta, 900);
    }

    const CTX_SECTIONS = ['quienes','rescate','servicios','regalos','porque','europa','proceso','contacto'];
    const [texturaData, ...ctxDataArr] = await Promise.all([
      textura_url ? fetchBase64(textura_url, 1400) : Promise.resolve(''),
      ...CTX_SECTIONS.map(k => contexto_images[k] ? fetchBase64(contexto_images[k], 1400) : Promise.resolve('')),
    ]);
    const contextoImages = Object.fromEntries(CTX_SECTIONS.map((k, i) => [k, ctxDataArr[i]]));

    const collectionsEmbedded = await Promise.all((collections || []).map(async col => ({
      ...col,
      products: await Promise.all((col.products || []).map(async p => ({
        ...p,
        image: p.image ? await fetchBase64(p.image, 400) : '',
      }))),
    })));

    const folio = await shopify.getNextFolio('brochure');

    const html = brochureHTML(products, {
      folio,
      companyName: company_name,
      responsable, cargo, correo, telefono,
      showPrices: show_prices === true || show_prices === 'true',
      showMetaFields: Array.isArray(meta_fields) ? meta_fields : null,
      texturaImage: texturaData,
      contextoImages,
      staticImages: STATIC,
      proyecto: proyecto || '',
      productsPerPage: parseInt(products_per_page) || 1,
      collections: collectionsEmbedded,
      ...(cover_tag   && { coverTag:   cover_tag   }),
      ...(cover_title && { coverTitle: cover_title }),
      ...(cover_sub   && { coverSub:   cover_sub   }),
      ...(Array.isArray(pages) ? { pages } : {}),
    });

    const pdf = await generatePDF(html, { landscape: true });
    const safeName = (company_name || '').replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    const filename = `Brochure-Bucarest-${folio}${safeName ? '-' + safeName : ''}.pdf`;
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (e) {
    console.error('[brochure]', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bucarest PDF Generator corriendo en puerto ${PORT}`);
  // Pre-fetch imágenes estáticas de templates (encabezado, timbre, logo)
  initStaticImages().catch(() => {});
  // Pre-calentar caché de colecciones y ubicaciones en background
  shopify.getCollections()
    .then(data => setCached('collections', data, 30 * 60 * 1000))
    .catch(() => {});
  shopify.getLocations()
    .then(data => setCached('locations', data, 60 * 60 * 1000))
    .catch(() => {});
});

// ── Interfaz de administración ────────────────────────────────────────────────
function adminUI(host) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bucarest — Generador de Documentos</title>
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&display=swap" rel="stylesheet">
  <script src="https://unpkg.com/@shopify/app-bridge@3"></script>
  <script>
    (function() {
      var host = new URLSearchParams(location.search).get('host') || '${host}';
      if (host && window['app-bridge']) {
        window.__shopifyApp = window['app-bridge'].default({
          apiKey: '${process.env.SHOPIFY_API_KEY}',
          host: host,
        });
      }
    })();
  </script>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:"Hanken Grotesk",sans-serif;background:#faf9f7;color:#333;font-size:14px}
    .topnav{position:fixed;top:0;left:0;right:0;height:56px;background:#1a1a1a;display:flex;align-items:center;padding:0 32px;gap:0;z-index:100}
    .topnav-logo{color:#fff;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.6;margin-right:32px;white-space:nowrap}
    .nav-btn{background:none;border:none;border-bottom:2px solid transparent;color:#aaa;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;padding:0 18px;height:56px;cursor:pointer;font-family:inherit;transition:all 0.15s;white-space:nowrap}
    .nav-btn:hover{color:#fff}
    .nav-btn.active{color:#c9a96e;border-bottom-color:#c9a96e}
    .main{margin-left:0;padding:32px 48px;min-height:100vh;margin-top:56px}
    @media(max-width:768px){
      .topnav{padding:0 16px;gap:0;overflow-x:auto}
      .topnav-logo{display:none}
      .nav-btn{padding:0 12px;font-size:11px}
      .main{padding:24px 16px}
      .row-2,.row-3{grid-template-columns:1fr}
      .card{padding:18px 16px}
      h1{font-size:20px}
      .product-list{overflow-x:auto}
      .product-table thead th.col-sku{display:none}
      .product-table tbody td:nth-child(3){display:none}
      .btn-row{flex-direction:column}
      .btn{text-align:center}
      .filter-row{gap:6px}
      .filter-btn{padding:6px 10px;font-size:11px}
    }
    .page{display:none}.page.active{display:block}
    h1{font-size:24px;font-weight:400;color:#1a1a1a;margin-bottom:6px}
    .subtitle{color:#999;font-size:13px;margin-bottom:32px}
    .card{background:#fff;border:1px solid #e8e2d9;padding:28px 32px;margin-bottom:20px}
    .section-label{font-size:10px;letter-spacing:0.15em;text-transform:uppercase;color:#9a7f5a;margin-bottom:12px;display:block}
    .row{display:grid;gap:16px;margin-bottom:16px}
    .row-2{grid-template-columns:1fr 1fr}
    .row-3{grid-template-columns:1fr 1fr 1fr}
    label{display:flex;flex-direction:column;gap:6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#666}
    input,select,textarea{padding:10px 14px;border:1px solid #ddd6cc;background:#fdfcfb;font-size:14px;font-family:inherit;outline:none;color:#1a1a1a;transition:border-color 0.2s}
    input:focus,select:focus,textarea:focus{border-color:#9a7f5a}
    textarea{resize:vertical;min-height:80px}
    .filter-row{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
    .filter-btn{padding:8px 16px;border:1px solid #ddd6cc;background:#fff;font-size:12px;cursor:pointer;font-family:inherit;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.15s;color:#666}
    .filter-btn.active{border-color:#9a7f5a;background:#faf8f5;color:#9a7f5a}
    .filter-panel{display:none}.filter-panel.active{display:block}
    .product-list{max-height:360px;overflow-y:auto;border:1px solid #e8e2d9;background:#fdfcfb}
    .product-table{width:100%;border-collapse:collapse}
    .product-table thead th{font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9a7f5a;padding:8px 12px;border-bottom:2px solid #e8e2d9;text-align:left;background:#fdfcfb;position:sticky;top:0}
    .product-table thead th.col-check{width:36px}
    .product-table thead th.col-sku{width:130px}
    .product-table thead th.col-status{width:90px}
    .product-table thead th.col-price{width:180px}
    .price-row{display:flex;align-items:center;gap:7px;margin-bottom:5px}
    .price-row:last-child{margin-bottom:0}
    .price-lbl{font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:#9a7f5a;width:38px;flex-shrink:0}
    .price-override{width:100px;padding:4px 7px;border:1px solid #ddd6cc;font-size:12px;font-family:inherit;background:#fdfcfb;color:#1a1a1a}
    .price-override:focus{outline:none;border-color:#9a7f5a}
    .price-display{font-size:12px;color:#555}
    .product-table tbody tr{border-bottom:1px solid #f0ece6;cursor:pointer;transition:background 0.1s}
    .product-table tbody tr:hover{background:#faf8f5}
    .product-table tbody td{padding:10px 12px;font-size:13px;color:#333;vertical-align:middle}
    .product-table td.col-check input{width:16px;height:16px;accent-color:#9a7f5a;cursor:pointer}
    .product-table td.col-sku{font-size:12px;color:#999}
    .status-badge{font-size:10px;letter-spacing:0.08em;text-transform:uppercase;padding:2px 7px;border-radius:10px;flex-shrink:0}
    .status-active{background:#e6f4ea;color:#2d6a2d}
    .status-draft{background:#f0f0f0;color:#888}
    .status-archived{background:#fff3e0;color:#b45300}
    .status-filter{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
    .status-btn{padding:4px 12px;border:1px solid #ddd6cc;background:#fff;font-size:11px;cursor:pointer;font-family:inherit;letter-spacing:0.06em;text-transform:uppercase;border-radius:12px;color:#666;transition:all 0.15s}
    .status-btn.active{border-color:#9a7f5a;background:#faf8f5;color:#9a7f5a}
    .selected-count{font-size:12px;color:#9a7f5a;margin:10px 0}
    .select-all-btn{background:none;border:none;font-size:12px;color:#9a7f5a;cursor:pointer;font-family:inherit;padding:10px 0;text-decoration:underline}
    .ms-basket{border:1px solid #e8e2d9;border-radius:4px;padding:14px;margin-top:12px;background:#fdfcfb;display:none;max-height:220px;overflow-y:auto}
    .ms-basket-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
    .ms-basket-title{font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#9a7f5a;font-weight:500}
    .ms-basket-clear{background:none;border:none;color:#999;font-size:11px;cursor:pointer;font-family:inherit;text-decoration:underline;padding:0}
    .ms-basket-item{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #f0ece8}
    .ms-basket-item:last-child{border-bottom:none}
    .ms-basket-name{font-size:12px;color:#444;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px}
    .ms-basket-remove{background:none;border:none;color:#c00;font-size:13px;cursor:pointer;padding:0;font-family:inherit;flex-shrink:0;line-height:1}
    .checkbox-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#555;margin-bottom:8px}
    .checkbox-row input{width:16px;height:16px;accent-color:#9a7f5a}
    .btn-row{display:flex;gap:12px;margin-top:24px;flex-wrap:wrap}
    .btn{padding:13px 28px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;border:none;cursor:pointer;font-family:inherit;transition:all 0.2s}
    .btn-primary{background:#1a1a1a;color:#fff}.btn-primary:hover{background:#9a7f5a}
    .btn-secondary{background:#fff;color:#555;border:1px solid #ddd6cc}.btn-secondary:hover{border-color:#9a7f5a;color:#9a7f5a}
    .btn:disabled{opacity:0.5;cursor:not-allowed}
    .msg{padding:12px 16px;font-size:13px;margin-top:16px;display:none}
    .msg.ok{background:#f0faf0;border:1px solid #b8e0b8;color:#2d6a2d}
    .msg.err{background:#fff5f5;border:1px solid #f5c0c0;color:#c0392b}
    .loading{display:none;font-size:13px;color:#999;margin-top:12px}
    .texture-thumb{aspect-ratio:4/3;overflow:hidden;border:2px solid transparent;border-radius:3px;cursor:pointer;transition:border-color 0.15s;background:#f0ece8;max-height:60px}
    .texture-thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .texture-thumb:hover{border-color:#c9a96e}
    .texture-thumb.selected{border-color:#9a7f5a;box-shadow:0 0 0 2px #9a7f5a33}
    .automation-notice{background:#faf8f5;border-left:3px solid #9a7f5a;padding:10px 14px;font-size:13px;color:#555;line-height:1.4;margin-bottom:20px}
    .automation-notice strong{color:#1a1a1a;margin-right:4px}
    .ppp-btn{padding:8px 16px;border:1px solid #ddd6cc;background:#fff;font-size:12px;cursor:pointer;font-family:inherit;letter-spacing:0.06em;text-transform:uppercase;transition:all 0.15s;color:#666}
    .ppp-btn.active{border-color:#9a7f5a;background:#faf8f5;color:#9a7f5a;font-weight:500}
    .avail-btn{padding:4px 12px;border:1px solid #ddd6cc;background:#fff;font-size:11px;cursor:pointer;font-family:inherit;letter-spacing:0.06em;text-transform:uppercase;border-radius:12px;color:#666;transition:all 0.15s}
    .avail-btn.active{border-color:#9a7f5a;background:#faf8f5;color:#9a7f5a}
    .texture-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;margin-top:8px}
    .cert-mode-tabs{display:flex;gap:0;margin-bottom:24px;border-bottom:2px solid #e8e2d9}
    .cert-mode-tab{background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;padding:10px 24px;font-size:13px;font-family:inherit;color:#999;cursor:pointer;letter-spacing:0.06em;transition:all 0.15s}
    .cert-mode-tab:hover{color:#555}
    .cert-mode-tab.active{color:#1a1a1a;border-bottom-color:#1a1a1a;font-weight:500}
    .file-upload-area{border:2px dashed #ddd6cc;border-radius:4px;padding:28px 20px;cursor:pointer;transition:all 0.15s;background:#fdfcfb;display:flex;align-items:center;justify-content:center;min-height:120px}
    .file-upload-area:hover,.file-upload-area.drag-over{border-color:#9a7f5a;background:#faf8f5}
  </style>
</head>
<body>

<div class="topnav">
  <div class="topnav-logo">Bucarest Art &amp; Antiques</div>
  <button class="nav-btn active" onclick="showPage('certificates')">Certificados</button>
  <button class="nav-btn" onclick="showPage('catalog')">Brochures y Catálogos</button>
  <button class="nav-btn" onclick="showPage('quote')">Cotizaciones</button>
  <button class="nav-btn" onclick="showPage('receipt')">Comprobantes</button>
</div>

<div class="main">

  <!-- CERTIFICADOS -->
  <div class="page active" id="page-certificates">
    <h1>Certificados de Autenticidad</h1>

    <div class="cert-mode-tabs">
      <button class="cert-mode-tab active" id="cert-tab-catalog" onclick="switchCertMode('catalog')">Desde catálogo</button>
      <button class="cert-mode-tab" id="cert-tab-scratch" onclick="switchCertMode('scratch')">Desde cero</button>
    </div>

    <!-- MODO: DESDE CATÁLOGO -->
    <div id="cert-mode-catalog">
      <div class="card" id="cert-step-search">
        <span class="section-label" id="cert-step-label">1. Seleccionar producto</span>
        <div id="cert-filters" class="filter-row">
          <button class="filter-btn active" onclick="setFilter('cert','collection')">Por colección</button>
          <button class="filter-btn" onclick="setFilter('cert','tag')">Por tag</button>
          <button class="filter-btn" onclick="setFilter('cert','title')">Por título</button>
          <button class="filter-btn" onclick="setFilter('cert','sku')">Por SKU</button>
        </div>
        <div id="cert-filter-collection" class="filter-panel active">
          <label>Colección
            <select id="cert-collection" onchange="loadProducts('cert')"><option value="">Seleccione…</option></select>
          </label>
        </div>
        <div id="cert-filter-tag" class="filter-panel">
          <label>Tag <input id="cert-tag" placeholder="Ej: pintura" oninput="debounce(() => loadProducts('cert'), 600)"></label>
        </div>
        <div id="cert-filter-title" class="filter-panel">
          <label>Palabra en título <input id="cert-title-filter" placeholder="Ej: óleo" oninput="debounce(() => loadProducts('cert'), 600)"></label>
        </div>
        <div id="cert-filter-sku" class="filter-panel">
          <label>SKU <input id="cert-sku" placeholder="Ej: ART-001" oninput="debounce(() => loadProducts('cert'), 600)"></label>
        </div>
        <div class="loading" id="cert-loading">Cargando productos…</div>
        <div class="status-filter" id="cert-status-filter" style="display:none;margin-top:12px">
          <button class="status-btn active" onclick="filterByStatus('cert','all',this)">Todos</button>
          <button class="status-btn" onclick="filterByStatus('cert','active',this)">Activos</button>
          <button class="status-btn" onclick="filterByStatus('cert','draft',this)">Borrador</button>
        </div>
        <div class="product-list" id="cert-products"></div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div class="selected-count" id="cert-count"></div>
          <button class="select-all-btn" id="cert-select-all" onclick="toggleSelectAll('cert')" style="display:none">Seleccionar todos</button>
        </div>
        <div class="btn-row" style="margin-top:16px">
          <button class="btn btn-primary" onclick="loadCertData()">Cargar datos del producto →</button>
        </div>
      </div>

      <div class="card" id="cert-step-edit" style="display:none">
        <span class="section-label">2. Editar datos</span>
        <div id="cert-preview"></div>
        <div class="row row-2">
          <label>Título <input id="cert-title" placeholder="Título de la pieza"></label>
          <label>Precio (CLP) <input id="cert-price" type="number" placeholder="Ej: 450000"></label>
        </div>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#666;margin-bottom:16px">Descripción <textarea id="cert-description" placeholder="Descripción de la pieza…"></textarea></label>
        <div class="row row-3">
          <label>Origen <input id="cert-origen" placeholder="Ej: Francia"></label>
          <label>Alto <input id="cert-alto" placeholder="Ej: 50 cm"></label>
          <label>Ancho <input id="cert-ancho" placeholder="Ej: 30 cm"></label>
        </div>
        <input type="hidden" id="cert-image-url">
        <hr style="border:none;border-top:1px solid #e8e2d9;margin:20px 0">
        <div class="row row-2" style="margin-bottom:20px">
          <label>Fecha de emisión <input type="date" id="cert-emission-date"></label>
        </div>
        <span class="section-label">Experto certificador</span>
        <label style="margin-bottom:20px">Certifica
          <select id="cert-expert">
            <option value="ricardo">Ricardo Pizarro Pacheco — RUT: 5.571.169-0</option>
            <option value="osvaldo">Osvaldo Yañez Lara — RUT: 9.051.374-5</option>
          </select>
        </label>
        <hr style="border:none;border-top:1px solid #e8e2d9;margin:0 0 20px">
        <span class="section-label">Destinatario</span>
        <div class="checkbox-row" style="margin-bottom:12px">
          <input type="checkbox" id="cert-nominative-check" onchange="toggleNominative()">
          <label for="cert-nominative-check" style="text-transform:none;letter-spacing:0;font-size:13px">Certificado nominativo (con nombre del cliente)</label>
        </div>
        <div id="cert-nominative-fields" style="display:none;margin-bottom:16px">
          <div class="row row-2">
            <label>Tratamiento
              <select id="cert-honorific">
                <option value="Sr.">Sr.</option>
                <option value="Sra.">Sra.</option>
                <option value="Dr.">Dr.</option>
                <option value="Dra.">Dra.</option>
              </select>
            </label>
            <label>Nombre del cliente <input id="cert-client-name" placeholder="Ej: Juan Pérez"></label>
          </div>
        </div>
        <div class="row row-2">
          <label>Correo del destinatario <input id="cert-to-email" type="email" placeholder="cliente@ejemplo.com"></label>
          <label>Nombre para el correo <input id="cert-to-name" placeholder="Ej: María González"></label>
        </div>
        <p style="font-size:12px;color:#999;margin-top:6px">Si no ingresa correo se descargará el PDF directamente.</p>
      </div>

      <div class="btn-row" id="cert-btn-row" style="display:none">
        <button class="btn btn-primary" onclick="generateCert()">Descargar certificado</button>
        <button class="btn btn-secondary" onclick="generateCert(true)">Enviar por correo</button>
        <button class="btn btn-secondary" onclick="resetCert()">← Cambiar producto</button>
      </div>
    </div>

    <!-- MODO: DESDE CERO -->
    <div id="cert-mode-scratch" style="display:none">
      <div class="card">
        <span class="section-label">Datos de la pieza</span>
        <div class="row row-2">
          <label>Título <input id="scratch-title" placeholder="Ej: Óleo sobre tela, paisaje costero"></label>
          <label>Precio (CLP) <input id="scratch-price" type="number" placeholder="Ej: 450000"></label>
        </div>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#666;margin-bottom:16px">Descripción <textarea id="scratch-description" placeholder="Descripción técnica de la pieza…"></textarea></label>
        <div class="row row-3">
          <label>Origen <input id="scratch-origen" placeholder="Ej: Francia"></label>
          <label>Alto <input id="scratch-alto" placeholder="Ej: 50 cm"></label>
          <label>Ancho <input id="scratch-ancho" placeholder="Ej: 30 cm"></label>
        </div>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#666">Imagen
          <div class="file-upload-area" id="scratch-drop-zone" onclick="document.getElementById('scratch-file-input').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleScratchDrop(event)">
            <input type="file" id="scratch-file-input" accept="image/*" style="display:none" onchange="handleScratchFile(this.files[0])">
            <div id="scratch-upload-prompt" style="pointer-events:none">
              <div style="font-size:28px;margin-bottom:6px;opacity:0.35">↑</div>
              <div style="font-size:13px;color:#999;letter-spacing:0">Haz clic o arrastra una imagen aquí</div>
              <div style="font-size:11px;color:#bbb;margin-top:4px;letter-spacing:0">JPG, PNG, WEBP</div>
            </div>
            <div id="scratch-img-preview" style="display:none;text-align:center;pointer-events:none">
              <img id="scratch-img-tag" style="max-height:160px;max-width:100%;object-fit:contain;border-radius:4px">
              <div id="scratch-img-name" style="font-size:11px;color:#999;margin-top:6px;letter-spacing:0"></div>
            </div>
          </div>
          <button type="button" id="scratch-clear-img" onclick="clearScratchImage()" style="display:none;background:none;border:none;color:#999;font-size:11px;cursor:pointer;text-decoration:underline;font-family:inherit;text-align:left;padding:0;margin-top:4px">Quitar imagen</button>
        </label>
        <input type="hidden" id="scratch-image-data">
      </div>

      <div class="card">
        <span class="section-label">Experto certificador</span>
        <label style="margin-bottom:20px">Certifica
          <select id="scratch-expert">
            <option value="ricardo">Ricardo Pizarro Pacheco — RUT: 5.571.169-0</option>
            <option value="osvaldo">Osvaldo Yañez Lara — RUT: 9.051.374-5</option>
          </select>
        </label>
        <hr style="border:none;border-top:1px solid #e8e2d9;margin:0 0 20px">
        <span class="section-label">Destinatario</span>
        <div class="checkbox-row" style="margin-bottom:12px">
          <input type="checkbox" id="scratch-nominative-check" onchange="toggleNominativeScratch()">
          <label for="scratch-nominative-check" style="text-transform:none;letter-spacing:0;font-size:13px">Certificado nominativo (con nombre del cliente)</label>
        </div>
        <div id="scratch-nominative-fields" style="display:none;margin-bottom:16px">
          <div class="row row-2">
            <label>Tratamiento
              <select id="scratch-honorific">
                <option value="Sr.">Sr.</option>
                <option value="Sra.">Sra.</option>
                <option value="Dr.">Dr.</option>
                <option value="Dra.">Dra.</option>
              </select>
            </label>
            <label>Nombre del cliente <input id="scratch-client-name" placeholder="Ej: Juan Pérez"></label>
          </div>
        </div>
        <div class="row row-2">
          <label>Correo del destinatario <input id="scratch-to-email" type="email" placeholder="cliente@ejemplo.com"></label>
          <label>Nombre para el correo <input id="scratch-to-name" placeholder="Ej: María González"></label>
        </div>
        <p style="font-size:12px;color:#999;margin-top:6px">Si no ingresa correo se descargará el PDF directamente.</p>
      </div>

      <div class="btn-row">
        <button class="btn btn-primary" onclick="generateCertScratch()">Descargar certificado</button>
        <button class="btn btn-secondary" onclick="generateCertScratch(true)">Enviar por correo</button>
      </div>
    </div>

    <div class="msg" id="cert-msg"></div>
  </div>

  <!-- BROCHURES Y CATÁLOGOS -->
  <div class="page" id="page-catalog">
    <h1>Brochures y Catálogos</h1>

    <div class="cert-mode-tabs" style="margin-bottom:28px">
      <button class="cert-mode-tab active" id="catbroch-tab-catalog" onclick="switchCatBrochMode('catalog')">Catálogos</button>
      <button class="cert-mode-tab" id="catbroch-tab-brochure" onclick="switchCatBrochMode('brochure')">Brochure Corporativo</button>
    </div>

    <!-- SUB: CATÁLOGOS -->
    <div id="catbroch-mode-catalog">
    <p class="subtitle">Genera catálogos PDF filtrando productos por colección, tag, título o metacampos.</p>

    <div class="card">
      <span class="section-label">Título del catálogo</span>
      <input id="catalog-title" placeholder="Ej: Catálogo Pintura Siglo XIX" style="width:100%;margin-bottom:16px">
      <div class="checkbox-row"><input type="checkbox" id="catalog-prices" checked><label for="catalog-prices" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar precios</label></div>
      <div class="checkbox-row"><input type="checkbox" id="catalog-show-estado"><label for="catalog-show-estado" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar metacampo Estado</label></div>
      <div class="checkbox-row"><input type="checkbox" id="catalog-quienes-somos"><label for="catalog-quienes-somos" style="text-transform:none;letter-spacing:0;font-size:13px">Incluir página "Quiénes somos"</label></div>
      <div style="margin-top:14px;border-top:1px solid #f0ece8;padding-top:12px">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9a7f5a;margin-bottom:10px;font-weight:500">Metacampos a incluir</div>
        <div class="checkbox-row"><input type="checkbox" id="catalog-mf-origen" checked><label for="catalog-mf-origen" style="text-transform:none;letter-spacing:0;font-size:13px">Origen</label></div>
        <div class="checkbox-row"><input type="checkbox" id="catalog-mf-estilo" checked><label for="catalog-mf-estilo" style="text-transform:none;letter-spacing:0;font-size:13px">Estilo</label></div>
        <div class="checkbox-row"><input type="checkbox" id="catalog-mf-epocas" checked><label for="catalog-mf-epocas" style="text-transform:none;letter-spacing:0;font-size:13px">Época</label></div>
        <div class="checkbox-row"><input type="checkbox" id="catalog-mf-materiales" checked><label for="catalog-mf-materiales" style="text-transform:none;letter-spacing:0;font-size:13px">Materiales</label></div>
        <div class="checkbox-row"><input type="checkbox" id="catalog-mf-medidas" checked><label for="catalog-mf-medidas" style="text-transform:none;letter-spacing:0;font-size:13px">Medidas (Ancho · Profundidad · Alto)</label></div>
      </div>
    </div>

    <div class="card">
      <span class="section-label">Imagen de fondo (portada y contraportada)</span>
      <input type="hidden" id="catalog-bg-url">
      <div id="texture-picker-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:8px">
        <div style="color:#999;font-size:13px;grid-column:1/-1">Cargando texturas…</div>
      </div>
      <div id="catalog-bg-selected" style="display:none;margin-top:10px;font-size:12px;color:#9a7f5a">
        ✓ <span id="catalog-bg-selected-name"></span>
        <button onclick="clearBgImage()" style="background:none;border:none;color:#999;cursor:pointer;font-size:12px;margin-left:8px;text-decoration:underline">Quitar</button>
      </div>
    </div>

    <div class="card">
      <span class="section-label">Responsable del catálogo (aparece en portada y contraportada)</span>
      <div class="row row-2">
        <label>Responsable <input id="catalog-responsable" placeholder="Nombre Apellido"></label>
        <label>Cargo <input id="catalog-cargo" placeholder="Ej: Ejecutivo de Ventas"></label>
      </div>
      <div class="row row-2">
        <label>Correo <input id="catalog-correo" type="email" placeholder="correo@bucarestart.cl"></label>
        <label>Teléfono <input id="catalog-telefono" placeholder="+56 9 XXXX XXXX"></label>
      </div>
    </div>

    <div class="card">
      <span class="section-label">Seleccionar productos</span>
      <div id="catalog-filters" class="filter-row">
        <button class="filter-btn active" onclick="setFilter('catalog','collection')">Por colección</button>
        <button class="filter-btn" onclick="setFilter('catalog','tag')">Por tag</button>
        <button class="filter-btn" onclick="setFilter('catalog','title')">Por título</button>
        <button class="filter-btn" onclick="setFilter('catalog','sku')">Por SKU</button>
      </div>
      <div id="catalog-filter-collection" class="filter-panel active">
        <label>Colección <select id="catalog-collection" onchange="loadProducts('catalog')"><option value="">Seleccione…</option></select></label>
      </div>
      <div id="catalog-filter-tag" class="filter-panel">
        <label>Tag <input id="catalog-tag" placeholder="Ej: oleo" oninput="debounce(() => loadProducts('catalog'), 600)"></label>
      </div>
      <div id="catalog-filter-title" class="filter-panel">
        <label>Palabra en título <input id="catalog-title-filter" placeholder="Ej: silla" oninput="debounce(() => loadProducts('catalog'), 600)"></label>
      </div>
      <div id="catalog-filter-sku" class="filter-panel">
        <label>SKU <input id="catalog-sku" placeholder="Ej: ART-001" oninput="debounce(() => loadProducts('catalog'), 600)"></label>
      </div>
      <div class="loading" id="catalog-loading">Cargando productos…</div>
      <div class="status-filter" id="catalog-status-filter" style="display:none;margin-top:12px">
        <button class="status-btn active" data-status="all" onclick="filterByStatus('catalog','all',this)">Todos</button>
        <button class="status-btn" onclick="filterByStatus('catalog','active',this)">Activos</button>
        <button class="status-btn" onclick="filterByStatus('catalog','draft',this)">Borrador</button>
      </div>
      <div class="status-filter" id="catalog-avail-filter" style="display:none;margin-top:6px">
        <button class="avail-btn active" data-avail="all" onclick="filterByAvailability('catalog','all',this)">Todo stock</button>
        <button class="avail-btn" data-avail="available" onclick="filterByAvailability('catalog','available',this)">Disponible</button>
        <button class="avail-btn" data-avail="unavailable" onclick="filterByAvailability('catalog','unavailable',this)">Sin stock</button>
      </div>
      <div class="product-list" id="catalog-products"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="selected-count" id="catalog-count"></div>
        <button class="select-all-btn" id="catalog-select-all" onclick="toggleSelectAll('catalog')" style="display:none">Seleccionar todos</button>
      </div>
      <div class="ms-basket" id="catalog-basket"></div>
    </div>

    <div class="card">
      <span class="section-label">Proyectos guardados</span>
      <p style="font-size:12px;color:#999;margin-bottom:12px">Guarda la configuración actual para retomar o reutilizar luego desde cualquier dispositivo.</p>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="catalog-project-name" placeholder="Nombre del proyecto (ej: Catálogo verano 2026)" style="flex:1">
        <button class="btn btn-secondary" onclick="saveProject('catalog')" style="white-space:nowrap">Guardar</button>
      </div>
      <div id="catalog-projects-list"></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="generate('catalog')">Descargar catálogo</button>
      <button class="btn btn-secondary" onclick="generate('catalog', true)">Enviar a correo interno</button>
    </div>
    <div class="msg" id="catalog-msg"></div>
    </div><!-- /catbroch-mode-catalog -->

    <!-- SUB: BROCHURE -->
    <div id="catbroch-mode-brochure" style="display:none">
    <p class="subtitle">Propuesta de negocios para empresas — arte, decoración y regalos corporativos exclusivos.</p>
  <div class="page" id="page-quote">
    <h1>Cotizaciones</h1>
    <p class="subtitle">Genera cotizaciones con o sin datos del cliente.</p>

    <div class="card">
      <span class="section-label">Datos del cliente (opcionales)</span>
      <div class="row row-2">
        <label>Nombre <input id="quote-name" placeholder="Nombre del cliente"></label>
        <label>Empresa <input id="quote-company" placeholder="Nombre empresa (opcional)"></label>
      </div>
      <div class="row row-2">
        <label>Razón social <input id="quote-razon-social" placeholder="Razón social legal"></label>
        <label>RUT <input id="quote-rut" placeholder="Ej: 12.345.678-9"></label>
      </div>
      <div class="row row-2">
        <label>Dirección <input id="quote-direccion" placeholder="Dirección comercial"></label>
        <label>Correo <input id="quote-email" type="email" placeholder="cliente@ejemplo.com"></label>
      </div>
      <div class="row row-2">
        <label>Validez (días) <input id="quote-days" type="number" value="7" min="1"></label>
      </div>
      <label>Notas <textarea id="quote-notes" placeholder="Condiciones de pago, observaciones…"></textarea></label>
    </div>

    <div class="card">
      <span class="section-label">Seleccionar productos</span>
      <div id="quote-filters" class="filter-row">
        <button class="filter-btn active" onclick="setFilter('quote','collection')">Por colección</button>
        <button class="filter-btn" onclick="setFilter('quote','tag')">Por tag</button>
        <button class="filter-btn" onclick="setFilter('quote','title')">Por título</button>
        <button class="filter-btn" onclick="setFilter('quote','sku')">Por SKU</button>
      </div>
      <div id="quote-filter-collection" class="filter-panel active">
        <label>Colección <select id="quote-collection" onchange="loadProducts('quote')"><option value="">Seleccione…</option></select></label>
      </div>
      <div id="quote-filter-tag" class="filter-panel">
        <label>Tag <input id="quote-tag" placeholder="Ej: pintura" oninput="debounce(() => loadProducts('quote'), 600)"></label>
      </div>
      <div id="quote-filter-title" class="filter-panel">
        <label>Palabra en título <input id="quote-title" placeholder="Ej: velador" oninput="debounce(() => loadProducts('quote'), 600)"></label>
      </div>
      <div id="quote-filter-sku" class="filter-panel">
        <label>SKU <input id="quote-sku" placeholder="Ej: ART-001" oninput="debounce(() => loadProducts('quote'), 600)"></label>
      </div>
      <div class="loading" id="quote-loading">Cargando productos…</div>
      <div class="status-filter" id="quote-status-filter" style="display:none;margin-top:12px">
        <button class="status-btn active" data-status="all" onclick="filterByStatus('quote','all',this)">Todos</button>
        <button class="status-btn" data-status="active" onclick="filterByStatus('quote','active',this)">Activos</button>
        <button class="status-btn" data-status="draft" onclick="filterByStatus('quote','draft',this)">Borrador</button>
      </div>
      <div class="status-filter" id="quote-avail-filter" style="display:none;margin-top:6px">
        <button class="avail-btn active" data-avail="all" onclick="filterByAvailability('quote','all',this)">Todo stock</button>
        <button class="avail-btn" data-avail="available" onclick="filterByAvailability('quote','available',this)">Con stock</button>
        <button class="avail-btn" data-avail="unavailable" onclick="filterByAvailability('quote','unavailable',this)">Sin stock</button>
      </div>
      <div class="product-list" id="quote-products"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="selected-count" id="quote-count"></div>
        <button class="select-all-btn" id="quote-select-all" onclick="toggleSelectAll('quote')" style="display:none">Seleccionar todos</button>
      </div>
    </div>

    <div class="card">
      <span class="section-label">Presentación del PDF</span>
      <div style="margin-bottom:16px">
        <label style="margin-bottom:8px;display:block">Productos por página</label>
        <div style="display:flex;gap:8px;margin-top:6px">
          <button class="ppp-btn" data-ppp="1" onclick="setPPP(this,1)">1 — Ampliado</button>
          <button class="ppp-btn" data-ppp="2" onclick="setPPP(this,2)">2 — Estándar</button>
          <button class="ppp-btn active" data-ppp="3" onclick="setPPP(this,3)">3 — Compacto</button>
        </div>
        <p style="font-size:12px;color:#999;margin-top:8px">Ampliado: imagen grande, ideal para piezas destacadas. Compacto: lista eficiente para muchos productos.</p>
        <input type="hidden" id="quote-ppp" value="3">
      </div>
      <div class="checkbox-row"><input type="checkbox" id="quote-show-links"><label for="quote-show-links" style="text-transform:none;letter-spacing:0;font-size:13px">Incluir enlace clickeable a la tienda en cada producto</label></div>
      <div class="checkbox-row"><input type="checkbox" id="quote-show-desc" checked><label for="quote-show-desc" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar descripción del producto</label></div>
      <div class="checkbox-row"><input type="checkbox" id="quote-show-sku"><label for="quote-show-sku" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar SKU</label></div>
    </div>

    <div class="card">
      <span class="section-label">Proyectos guardados</span>
      <p style="font-size:12px;color:#999;margin-bottom:12px">Guarda la configuración actual para retomar o reutilizar luego desde cualquier dispositivo.</p>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="quote-project-name" placeholder="Nombre del proyecto (ej: Cotización empresa ABC)" style="flex:1">
        <button class="btn btn-secondary" onclick="saveProject('quote')" style="white-space:nowrap">Guardar</button>
      </div>
      <div id="quote-projects-list"></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="generate('quote')">Descargar cotización</button>
    </div>
    <div class="msg" id="quote-msg"></div>
  </div>

  <!-- COMPROBANTES -->
  <div class="page" id="page-receipt">
    <h1>Comprobantes de Venta</h1>
    <p class="subtitle">Genera un comprobante en PDF para cualquier orden.</p>
    <div class="automation-notice">
      <strong>Automatización activa</strong>
      Por cada pedido pagado en la tienda, se envía automáticamente un comprobante de venta al correo del cliente.
    </div>

    <div class="card">
      <label>Número o ID de la orden
        <input id="receipt-order" placeholder="Ej: 1234 o el ID completo">
      </label>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="generate('receipt')">Descargar comprobante</button>
      <button class="btn btn-secondary" onclick="generate('receipt', true)">Enviar al cliente</button>
    </div>
    <div class="msg" id="receipt-msg"></div>
  </div>

    <div class="card">
      <span class="section-label">Empresa destinataria</span>
      <label>Nombre de la empresa <input id="brochure-company" placeholder="Ej: Constructora XYZ S.A."></label>
    </div>

    <div class="card">
      <span class="section-label">Responsable Bucarest</span>
      <div class="row row-2">
        <label>Nombre <input id="brochure-responsable" placeholder="Ej: Cristóbal Pizarro"></label>
        <label>Cargo <input id="brochure-cargo" placeholder="Ej: Director Ejecutivo"></label>
      </div>
      <div class="row row-2">
        <label>Correo <input id="brochure-correo" type="email" placeholder="cristobal@bucarestart.cl"></label>
        <label>Teléfono <input id="brochure-telefono" placeholder="+56 9 3342 3442"></label>
      </div>
    </div>

    <div class="card">
      <span class="section-label">Textos de portada</span>
      <label>Sobre-título
        <input id="brochure-cover-tag" placeholder="Propuesta Corporativa">
      </label>
      <label>Título principal
        <textarea id="brochure-cover-title" rows="2" placeholder="Soluciones Corporativas en Arte &amp; Antigüedades" style="width:100%;resize:vertical;font-family:inherit;font-size:14px;padding:8px;border:1px solid #e0d8cc;border-radius:4px;background:#faf8f5"></textarea>
      </label>
      <label>Bajada de título
        <textarea id="brochure-cover-sub" rows="3" placeholder="Mobiliario, decoración exclusiva y regalos corporativos para empresas que buscan diferenciarse." style="width:100%;resize:vertical;font-family:inherit;font-size:14px;padding:8px;border:1px solid #e0d8cc;border-radius:4px;background:#faf8f5"></textarea>
      </label>
    </div>

    <div class="card">
      <span class="section-label">Imagen de portada (textura de fondo)</span>
      <div class="texture-grid" id="brochure-texture-grid">
        <div style="color:#999;font-size:13px;grid-column:1/-1">Cargando texturas…</div>
      </div>
      <input type="hidden" id="brochure-textura-url">
    </div>

    <div class="card">
      <span class="section-label">Páginas del brochure</span>
      <p style="font-size:12px;color:#999;margin-bottom:16px">Selecciona qué secciones incluir. Portada, piezas seleccionadas y contacto siempre se incluyen.</p>
      ${[
        ['brochure-page-quienes',   'quienes',   'Quiénes somos'],
        ['brochure-page-rescate',   'rescate',   'Rescate patrimonial'],
        ['brochure-page-servicios', 'servicios', 'Servicios para empresas e instituciones'],
        ['brochure-page-regalos',   'regalos',   'Regalos corporativos'],
        ['brochure-page-porque',    'porque',    'Por qué elegirnos'],
        ['brochure-page-europa',    'europa',    'Selección e importación directa'],
        ['brochure-page-proceso',   'proceso',   'Proceso de trabajo'],
      ].map(([id, , label]) => `
      <div class="checkbox-row">
        <input type="checkbox" id="${id}" checked>
        <label for="${id}" style="text-transform:none;letter-spacing:0;font-size:13px">${label}</label>
      </div>`).join('')}
    </div>

    <div class="card">
      <span class="section-label">Imágenes de contexto por sección</span>
      <p style="font-size:12px;color:#999;margin-bottom:20px">Elige una imagen distinta para cada sección del brochure. Se cargan desde los archivos de Shopify nombrados "contexto".</p>
      ${[
        ['quienes',   'Quiénes somos'],
        ['rescate',   'Rescate patrimonial'],
        ['servicios', 'Servicios para empresas e instituciones'],
        ['regalos',   'Regalos corporativos'],
        ['porque',    'Por qué elegirnos'],
        ['europa',    'Selección e importación directa'],
        ['proceso',   'Proceso de trabajo'],
        ['contacto',  'Contacto (última página)'],
      ].map(([sec, label]) => `
      <div style="margin-bottom:18px">
        <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:#9a7f5a;margin-bottom:8px">${label}</div>
        <div class="texture-grid ctx-grid" id="ctx-${sec}-grid" style="max-height:130px;overflow-y:auto">
          <div style="color:#999;font-size:13px;grid-column:1/-1">Cargando…</div>
        </div>
        <input type="hidden" id="ctx-${sec}-url">
      </div>`).join('')}
    </div>

    <div class="card">
      <span class="section-label">Piezas destacadas (opcional)</span>
      <p style="font-size:12px;color:#999;margin-bottom:12px">Agrega productos de tu catálogo. Cada uno aparecerá en una página dedicada con imagen grande.</p>
      <div id="brochure-filters" class="filter-row">
        <button class="filter-btn active" onclick="setFilter('brochure','collection')">Por colección</button>
        <button class="filter-btn" onclick="setFilter('brochure','tag')">Por tag</button>
        <button class="filter-btn" onclick="setFilter('brochure','title')">Por título</button>
        <button class="filter-btn" onclick="setFilter('brochure','sku')">Por SKU</button>
      </div>
      <div id="brochure-filter-collection" class="filter-panel active">
        <label>Colección
          <select id="brochure-collection" onchange="loadProducts('brochure')"><option value="">Seleccione…</option></select>
        </label>
      </div>
      <div id="brochure-filter-tag" class="filter-panel">
        <label>Tag <input id="brochure-tag" placeholder="Ej: pintura" oninput="debounce(() => loadProducts('brochure'), 600)"></label>
      </div>
      <div id="brochure-filter-title" class="filter-panel">
        <label>Palabra en título <input id="brochure-title-filter" placeholder="Ej: óleo" oninput="debounce(() => loadProducts('brochure'), 600)"></label>
      </div>
      <div id="brochure-filter-sku" class="filter-panel">
        <label>SKU <input id="brochure-sku" placeholder="Ej: ART-001" oninput="debounce(() => loadProducts('brochure'), 600)"></label>
      </div>
      <div class="loading" id="brochure-loading">Cargando productos…</div>
      <div class="status-filter" id="brochure-status-filter" style="display:none;margin-top:12px">
        <button class="status-btn active" data-status="all" onclick="filterByStatus('brochure','all',this)">Todos</button>
        <button class="status-btn" onclick="filterByStatus('brochure','active',this)">Activos</button>
        <button class="status-btn" onclick="filterByStatus('brochure','draft',this)">Borrador</button>
      </div>
      <div class="status-filter" id="brochure-avail-filter" style="display:none;margin-top:6px">
        <button class="avail-btn active" data-avail="all" onclick="filterByAvailability('brochure','all',this)">Todo stock</button>
        <button class="avail-btn" data-avail="available" onclick="filterByAvailability('brochure','available',this)">Disponible</button>
        <button class="avail-btn" data-avail="unavailable" onclick="filterByAvailability('brochure','unavailable',this)">Sin stock</button>
      </div>
      <div class="product-list" id="brochure-products"></div>
      <div class="selected-count" id="brochure-count"></div>
      <div class="ms-basket" id="brochure-basket"></div>
      <div class="checkbox-row" style="margin-top:16px">
        <input type="checkbox" id="brochure-show-prices">
        <label for="brochure-show-prices" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar precios en el brochure</label>
      </div>
      <div style="margin-top:14px;border-top:1px solid #f0ece8;padding-top:12px">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9a7f5a;margin-bottom:10px;font-weight:500">Metacampos a incluir</div>
        <div class="checkbox-row"><input type="checkbox" id="brochure-mf-origen" checked><label for="brochure-mf-origen" style="text-transform:none;letter-spacing:0;font-size:13px">Origen</label></div>
        <div class="checkbox-row"><input type="checkbox" id="brochure-mf-estilo" checked><label for="brochure-mf-estilo" style="text-transform:none;letter-spacing:0;font-size:13px">Estilo</label></div>
        <div class="checkbox-row"><input type="checkbox" id="brochure-mf-epocas" checked><label for="brochure-mf-epocas" style="text-transform:none;letter-spacing:0;font-size:13px">Época</label></div>
        <div class="checkbox-row"><input type="checkbox" id="brochure-mf-materiales" checked><label for="brochure-mf-materiales" style="text-transform:none;letter-spacing:0;font-size:13px">Materiales</label></div>
        <div class="checkbox-row"><input type="checkbox" id="brochure-mf-medidas" checked><label for="brochure-mf-medidas" style="text-transform:none;letter-spacing:0;font-size:13px">Medidas (Ancho · Profundidad · Alto)</label></div>
      </div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:20px">
        <span style="font-size:12px;color:#666;letter-spacing:0.06em;text-transform:uppercase">Productos por página:</span>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#1a1a1a;text-transform:none;letter-spacing:0">
          <input type="radio" name="brochure-ppp" value="1" id="brochure-ppp-1" checked> 1 (página completa)
        </label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#1a1a1a;text-transform:none;letter-spacing:0">
          <input type="radio" name="brochure-ppp" value="2" id="brochure-ppp-2"> 2 (media página c/u)
        </label>
      </div>
    </div>

    <div class="card">
      <span class="section-label">Colecciones <span style="text-transform:none;letter-spacing:0;font-size:11px;color:#999;font-weight:400">(opcional)</span></span>
      <p style="font-size:12px;color:#999;margin-bottom:16px">Cada colección añadida ocupa una página con grilla de fotos. Recomendado máximo 9 piezas por colección.</p>
      <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:12px">
        <label style="flex:1;margin:0">Colección
          <select id="brochure-col-select" style="margin-top:6px"><option value="">Seleccione una colección…</option></select>
        </label>
        <button class="btn btn-secondary" onclick="loadBrochureCollection()" style="height:38px;flex-shrink:0">Cargar piezas</button>
      </div>
      <div id="brochure-col-products" style="display:none;margin-bottom:16px">
        <p style="font-size:11px;color:#999;margin-bottom:10px">Selecciona las piezas a incluir:</p>
        <div id="brochure-col-product-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;margin-bottom:14px"></div>
        <div class="checkbox-row" style="margin-bottom:14px">
          <input type="checkbox" id="brochure-col-prices">
          <label for="brochure-col-prices" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar precios en esta colección</label>
        </div>
        <button class="btn btn-primary" onclick="addBrochureCollection()">+ Añadir colección al brochure</button>
      </div>
      <div id="brochure-col-list"></div>
    </div>

    <div class="card">
      <span class="section-label">El Proyecto <span style="text-transform:none;letter-spacing:0;font-size:11px;color:#999;font-weight:400">(opcional)</span></span>
      <p style="font-size:12px;color:#999;margin-bottom:12px">Describe el proyecto específico que estás ofreciendo a esta empresa — decorar sus oficinas, renovar la sala del directorio, regalos para sus clientes VIP, etc. Aparece como página propia en el brochure.</p>
      <textarea id="brochure-proyecto" rows="7" placeholder="Ejemplo: En base a nuestra reunión del 15 de junio, proponemos intervenir el salón del directorio y la recepción principal de su sede con una selección de 8 piezas antiguas de origen francés…" style="resize:vertical"></textarea>
      <p style="font-size:11px;color:#bbb;margin-top:6px">Si lo dejas vacío, el brochure irá directo de la portada a «Quiénes somos».</p>
    </div>

    <div class="card">
      <span class="section-label">Proyectos guardados</span>
      <p style="font-size:12px;color:#999;margin-bottom:12px">Guarda la configuración actual para retomar o reutilizar luego desde cualquier dispositivo.</p>
      <div style="display:flex;gap:8px;margin-bottom:14px">
        <input id="brochure-project-name" placeholder="Nombre del proyecto (ej: Empresa XYZ jun 2026)" style="flex:1">
        <button class="btn btn-secondary" onclick="saveProject('brochure')" style="white-space:nowrap">Guardar</button>
      </div>
      <div id="brochure-projects-list"></div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="generateBrochure()">Descargar brochure</button>
    </div>
    <div class="msg" id="brochure-msg"></div>
    </div><!-- /catbroch-mode-brochure -->

  </div><!-- /page-catalog -->

</div>


<script>
const collections = {};

async function init() {
  try {
    const res = await fetch('/api/collections');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    ['cert-collection','catalog-collection','quote-collection','brochure-collection','brochure-col-select'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      data.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.title;
        sel.appendChild(opt);
      });
    });
  } catch(e) {
    console.error('[init] Error cargando colecciones:', e);
  }
  loadTexturePicker();
  loadBrochurePickers();
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  event.target.classList.add('active');
}

function setFilter(prefix, type) {
  document.querySelectorAll('#' + prefix + '-filters .filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  document.querySelectorAll('[id^="' + prefix + '-filter-"]').forEach(p => p.classList.remove('active'));
  document.getElementById(prefix + '-filter-' + type).classList.add('active');
  document.getElementById(prefix + '-products').innerHTML = '';
  document.getElementById(prefix + '-count').textContent = '';
}

let debounceTimer;
function debounce(fn, ms) { clearTimeout(debounceTimer); debounceTimer = setTimeout(fn, ms); }

async function loadProducts(prefix) {
  const loading = document.getElementById(prefix + '-loading');
  const list = document.getElementById(prefix + '-products');
  loading.style.display = 'block';
  list.innerHTML = '';

  const activeFilter = document.querySelector('#' + prefix + '-filters .filter-btn.active').textContent.toLowerCase();
  let url = '/api/products?';

  if (activeFilter.includes('colección')) {
    const col = document.getElementById(prefix + '-collection').value;
    if (!col) { loading.style.display = 'none'; return; }
    url += 'collection_id=' + col;
  } else if (activeFilter.includes('tag')) {
    const tag = document.getElementById(prefix + '-tag').value.trim();
    if (!tag) { loading.style.display = 'none'; return; }
    url += 'tag=' + encodeURIComponent(tag);
  } else if (activeFilter.includes('título')) {
    const titleInput = ['catalog', 'cert', 'brochure'].includes(prefix) ? prefix + '-title-filter' : prefix + '-title';
    const t = document.getElementById(titleInput).value.trim();
    if (!t) { loading.style.display = 'none'; return; }
    url += 'title=' + encodeURIComponent(t);
  } else if (activeFilter.includes('sku')) {
    const s = document.getElementById(prefix + '-sku').value.trim();
    if (!s) { loading.style.display = 'none'; return; }
    url += 'sku=' + encodeURIComponent(s);
  }

  try {
    const res = await fetch(url);
    const products = await res.json();
    loading.style.display = 'none';
    renderProducts(prefix, products);
  } catch(e) {
    loading.style.display = 'none';
    list.innerHTML = '<p style="padding:12px;color:#c00;font-size:13px">Error cargando productos.</p>';
  }
}

const productCache = {};

function totalInventory(p) {
  return (p.variants || []).reduce((s, v) => s + (parseInt(v.inventory_quantity) || 0), 0);
}

function filterByAvailability(prefix, avail, el) {
  document.querySelectorAll('#' + prefix + '-avail-filter .avail-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  const activeStatusEl = document.querySelector('#' + prefix + '-status-filter .status-btn.active');
  const status = activeStatusEl?.dataset?.status || 'all';
  renderProductsFiltered(prefix, productCache[prefix] || [], status, avail);
}

function renderProductsFiltered(prefix, allProducts, statusFilter, availFilter) {
  let products = allProducts;
  if (statusFilter && statusFilter !== 'all') products = products.filter(p => p.status === statusFilter);
  if (availFilter === 'available') products = products.filter(p => totalInventory(p) > 0);
  if (availFilter === 'unavailable') products = products.filter(p => totalInventory(p) === 0);
  renderRows(prefix, products);
}

function setPPP(el, val) {
  document.querySelectorAll('.ppp-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('quote-ppp').value = val;
}

function statusBadge(status) {
  const map = { active: ['Activo','status-active'], draft: ['Borrador','status-draft'], archived: ['Archivado','status-archived'] };
  const [label, cls] = map[status] || ['—','status-draft'];
  return \`<span class="status-badge \${cls}">\${label}</span>\`;
}

function renderProducts(prefix, products, filter) {
  productCache[prefix] = products;
  const statusFilterEl = document.getElementById(prefix + '-status-filter');
  if (statusFilterEl) statusFilterEl.style.display = products.length ? 'flex' : 'none';
  const availFilterEl = document.getElementById(prefix + '-avail-filter');
  if (availFilterEl) availFilterEl.style.display = products.length ? 'flex' : 'none';

  const activeAvailEl = document.querySelector('#' + prefix + '-avail-filter .avail-btn.active');
  const avail = activeAvailEl?.dataset?.avail || 'all';
  renderProductsFiltered(prefix, products, filter || 'all', avail);
}

// Selección persistente multi-búsqueda: Map(id → {id, title, price}) por prefix
const _msSelection = {};
const MS_PREFIXES = new Set(['catalog', 'brochure']);

function _msMap(prefix) {
  if (!_msSelection[prefix]) _msSelection[prefix] = new Map();
  return _msSelection[prefix];
}

function _msAdd(prefix, p) {
  const price = p.variants && p.variants[0] ? p.variants[0].price : '';
  _msMap(prefix).set(String(p.id), { id: p.id, title: p.title, price });
  _msRenderBasket(prefix);
}

function _msDel(prefix, id) {
  _msMap(prefix).delete(String(id));
  const cb = document.querySelector('[name="' + prefix + '_product"][value="' + id + '"]');
  if (cb) cb.checked = false;
  _msRenderBasket(prefix);
}

function _msSync(prefix, id, checked) {
  if (!MS_PREFIXES.has(prefix)) return;
  if (checked) {
    const p = (productCache[prefix] || []).find(x => String(x.id) === String(id));
    if (p) _msAdd(prefix, p);
  } else {
    _msDel(prefix, id);
  }
}

function _msClear(prefix) {
  _msMap(prefix).clear();
  document.querySelectorAll('[name="' + prefix + '_product"]').forEach(cb => { cb.checked = false; });
  _msRenderBasket(prefix);
  const countEl = document.getElementById(prefix + '-count');
  if (countEl) countEl.textContent = '';
  const btn = document.getElementById(prefix + '-select-all');
  if (btn) btn.textContent = 'Seleccionar todos';
}

function _msRenderBasket(prefix) {
  const basket = document.getElementById(prefix + '-basket');
  if (!basket) return;
  const map = _msMap(prefix);
  const countEl = document.getElementById(prefix + '-count');
  if (!map.size) {
    basket.style.display = 'none';
    if (countEl) countEl.textContent = '';
    const btn = document.getElementById(prefix + '-select-all');
    if (btn) btn.textContent = 'Seleccionar todos';
    return;
  }
  basket.style.display = 'block';
  const items = [...map.values()];
  const n = items.length;
  basket.innerHTML =
    \`<div class="ms-basket-header">
      <span class="ms-basket-title">\${n} producto\${n !== 1 ? 's' : ''} seleccionado\${n !== 1 ? 's' : ''}</span>
      <button class="ms-basket-clear" onclick="_msClear('\${prefix}')">Limpiar selección</button>
    </div>\` +
    items.map(function(p) {
      return \`<div class="ms-basket-item">
        <span class="ms-basket-name">\${p.title || 'ID: ' + p.id}</span>
        <button class="ms-basket-remove" onclick="_msDel('\${prefix}','\${p.id}')">✕</button>
      </div>\`;
    }).join('');
  if (countEl) countEl.textContent = n + ' producto' + (n !== 1 ? 's' : '') + ' seleccionado' + (n !== 1 ? 's' : '');
}

function renderRows(prefix, filtered) {
  const list = document.getElementById(prefix + '-products');
  const count = document.getElementById(prefix + '-count');
  const msActive = MS_PREFIXES.has(prefix);
  const msMap = msActive ? _msMap(prefix) : null;

  if (!filtered.length) {
    list.innerHTML = '<p style="padding:12px;color:#999;font-size:13px">No se encontraron productos.</p>';
    if (!msActive) count.textContent = '';
    const btn = document.getElementById(prefix + '-select-all');
    if (btn) btn.style.display = 'none';
    return;
  }
  list.innerHTML = \`<table class="product-table">
    <thead><tr>
      <th class="col-check"></th>
      <th>Título</th>
      <th class="col-sku">SKU</th>
      <th class="col-price">Precio</th>
      <th class="col-status">Stock</th>
      <th class="col-status">Estado</th>
    </tr></thead>
    <tbody>
      \${filtered.map(p => {
        const sku = p.variants && p.variants[0] && p.variants[0].sku ? p.variants[0].sku : '—';
        const rawPrice = p.variants && p.variants[0] ? p.variants[0].price : '';
        const displayPrice = rawPrice ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(parseFloat(rawPrice)) : '—';
        const inventory = totalInventory(p);
        const stockColor = inventory > 0 ? '#2d6a2d' : '#c0392b';
        const preChecked = msActive && msMap.has(String(p.id)) ? ' checked' : '';
        const onchangeHandler = msActive
          ? \`_msSync('\${prefix}','\${p.id}',this.checked);updateCount('\${prefix}');event.stopPropagation()\`
          : \`updateCount('\${prefix}');event.stopPropagation()\`;
        return \`<tr onclick="toggleRow(this)">
          <td class="col-check"><input type="checkbox" name="\${prefix}_product" value="\${p.id}"\${preChecked} onchange="\${onchangeHandler}"></td>
          <td>\${p.title}</td>
          <td class="col-sku">\${sku}</td>
          <td class="col-price" onclick="event.stopPropagation()">
            <div class="price-row"><span class="price-lbl">Precio</span><span class="price-display">\${displayPrice}</span></div>
            <div class="price-row"><span class="price-lbl">Editar</span><input type="number" class="price-override" data-id="\${p.id}" data-prefix="\${prefix}" value="\${rawPrice}" placeholder="Personalizado"></div>
          </td>
          <td style="font-size:13px;color:\${stockColor};text-align:center;font-weight:500">\${inventory}</td>
          <td>\${statusBadge(p.status)}</td>
        </tr>\`;
      }).join('')}
    </tbody>
  </table>\`;
  if (msActive) {
    const selCount = msMap.size;
    count.textContent = selCount > 0
      ? selCount + ' producto' + (selCount !== 1 ? 's' : '') + ' seleccionado' + (selCount !== 1 ? 's' : '') + ' · ' + filtered.length + ' encontrado' + (filtered.length !== 1 ? 's' : '')
      : filtered.length + ' producto' + (filtered.length !== 1 ? 's' : '') + ' encontrado' + (filtered.length !== 1 ? 's' : '');
  } else {
    count.textContent = filtered.length + ' producto(s) encontrado(s)';
  }
  const btn = document.getElementById(prefix + '-select-all');
  if (btn) { btn.style.display = 'block'; btn.textContent = 'Seleccionar todos'; }
}

function toggleRow(tr) {
  const cb = tr.querySelector('input[type=checkbox]');
  cb.checked = !cb.checked;
  const prefix = cb.name.replace('_product', '');
  _msSync(prefix, cb.value, cb.checked);
  updateCount(prefix);
}

function filterByStatus(prefix, status, el) {
  document.querySelectorAll('#' + prefix + '-status-filter .status-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  el.dataset.status = status;
  const activeAvailEl = document.querySelector('#' + prefix + '-avail-filter .avail-btn.active');
  const avail = activeAvailEl?.dataset?.avail || 'all';
  renderProductsFiltered(prefix, productCache[prefix] || [], status, avail);
}

function toggleSelectAll(prefix) {
  const checkboxes = document.querySelectorAll('[name="' + prefix + '_product"]');
  const allChecked = Array.from(checkboxes).every(c => c.checked);
  checkboxes.forEach(function(cb) {
    cb.checked = !allChecked;
    _msSync(prefix, cb.value, cb.checked);
  });
  const btn = document.getElementById(prefix + '-select-all');
  if (btn) btn.textContent = allChecked ? 'Seleccionar todos' : 'Deseleccionar todos';
  updateCount(prefix);
}

function updateCount(prefix) {
  if (MS_PREFIXES.has(prefix)) {
    // Para ms-prefixes el basket se encarga del count; solo actualizamos el botón si aplica
    const all = document.querySelectorAll('[name="' + prefix + '_product"]');
    const allCheckedInView = all.length > 0 && Array.from(all).every(c => c.checked);
    const btn = document.getElementById(prefix + '-select-all');
    if (btn) btn.textContent = allCheckedInView ? 'Deseleccionar todos' : 'Seleccionar todos';
    _msRenderBasket(prefix);
    return;
  }
  const all = document.querySelectorAll('[name="' + prefix + '_product"]');
  const checked = Array.from(all).filter(c => c.checked).length;
  document.getElementById(prefix + '-count').textContent = checked + ' producto(s) seleccionado(s)';
  const btn = document.getElementById(prefix + '-select-all');
  if (btn) btn.textContent = checked === all.length && all.length > 0 ? 'Deseleccionar todos' : 'Seleccionar todos';
}

function getSelectedIds(prefix) {
  if (MS_PREFIXES.has(prefix)) return [..._msMap(prefix).keys()];
  return Array.from(document.querySelectorAll('[name="' + prefix + '_product"]:checked')).map(c => c.value);
}

function showMsg(prefix, text, type) {
  const el = document.getElementById(prefix + '-msg');
  if (!text) { el.style.display = 'none'; return; }
  el.textContent = text;
  el.className = 'msg ' + type;
  el.style.display = 'block';
  const isLoadingMsg = text.startsWith('Generando') || text.startsWith('Cargando');
  if (type !== 'ok' || !isLoadingMsg) {
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  }
}

async function generate(type, sendEmail = false) {
  const prefixMap = { certificate: 'cert', catalog: 'catalog', quote: 'quote', receipt: 'receipt' };
  const prefix = prefixMap[type];
  let body = {};
  let endpoint = '/generate/' + type;

  if (type === 'receipt') {
    const orderId = document.getElementById('receipt-order').value.trim();
    if (!orderId) return showMsg(prefix, 'Ingrese un número de orden.', 'err');
    body = { order_id: orderId, send_email: sendEmail };
  } else if (type === 'certificate') {
    const title = document.getElementById('cert-title').value.trim();
    if (!title) return showMsg(prefix, 'Cargue primero un producto.', 'err');
    body = {
      title,
      description: document.getElementById('cert-description').value,
      price: document.getElementById('cert-price').value,
      image: document.getElementById('cert-image-url').value,
      origen: document.getElementById('cert-origen').value,
      alto: document.getElementById('cert-alto').value,
      ancho: document.getElementById('cert-ancho').value,
      to_name: document.getElementById('cert-to-name').value,
      to_email: document.getElementById('cert-to-email').value,
      send_email: sendEmail,
    };
    const nominativeCheck = document.getElementById('cert-nominative-check');
    if (nominativeCheck?.checked) {
      body.nominative_honorific = document.getElementById('cert-honorific').value;
      body.nominative_name = document.getElementById('cert-client-name').value;
    }
  } else {
    const ids = getSelectedIds(prefix);
    if (!ids.length) return showMsg(prefix, 'Seleccione al menos un producto.', 'err');
    body = { product_ids: ids };
    if (type === 'catalog') {
      body.title = document.getElementById('catalog-title').value || 'Catálogo';
      body.show_prices = document.getElementById('catalog-prices').checked ? 'true' : 'false';
      body.show_estado = document.getElementById('catalog-show-estado').checked ? 'true' : 'false';
      body.show_quienes_somos = document.getElementById('catalog-quienes-somos').checked ? 'true' : 'false';
      body.meta_fields = ['origen','estilo','epocas','materiales','medidas']
        .filter(f => document.getElementById('catalog-mf-' + f)?.checked);
      body.responsable = document.getElementById('catalog-responsable').value;
      body.cargo = document.getElementById('catalog-cargo').value;
      body.correo = document.getElementById('catalog-correo').value;
      body.telefono = document.getElementById('catalog-telefono').value;
      body.bg_image = document.getElementById('catalog-bg-url').value;
      body.send_email = sendEmail;
      const overrides = {};
      document.querySelectorAll('.price-override').forEach(input => {
        if (input.value) overrides[input.dataset.id] = input.value;
      });
      body.price_overrides = overrides;
    }
    if (type === 'quote') {
      body.client_name = document.getElementById('quote-name').value;
      body.client_email = document.getElementById('quote-email').value;
      body.client_rut = document.getElementById('quote-rut').value;
      body.client_company = document.getElementById('quote-company').value;
      body.client_razon_social = document.getElementById('quote-razon-social').value;
      body.client_direccion = document.getElementById('quote-direccion').value;
      body.valid_days = document.getElementById('quote-days').value;
      body.notes = document.getElementById('quote-notes').value;
      body.send_email = sendEmail;
      body.products_per_page = parseInt(document.getElementById('quote-ppp').value) || 3;
      body.show_links = document.getElementById('quote-show-links').checked;
      body.show_description = document.getElementById('quote-show-desc').checked;
      body.show_sku = document.getElementById('quote-show-sku').checked;
      const quoteOverrides = {};
      document.querySelectorAll('.price-override[data-prefix="quote"]').forEach(input => {
        if (input.value) quoteOverrides[input.dataset.id] = input.value;
      });
      body.price_overrides = quoteOverrides;
    }
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.headers.get('content-type')?.includes('application/pdf')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = type + '.pdf'; a.click();
      URL.revokeObjectURL(url);
    } else {
      const data = await res.json();
      showMsg(prefix, data.message || data.error, data.ok ? 'ok' : 'err');
    }
  } catch(e) {
    showMsg(prefix, 'Error generando el documento.', 'err');
  }
}

function switchCatBrochMode(mode) {
  document.getElementById('catbroch-mode-catalog').style.display  = mode === 'catalog'  ? 'block' : 'none';
  document.getElementById('catbroch-mode-brochure').style.display = mode === 'brochure' ? 'block' : 'none';
  document.getElementById('catbroch-tab-catalog').classList.toggle('active',  mode === 'catalog');
  document.getElementById('catbroch-tab-brochure').classList.toggle('active', mode === 'brochure');
}

function switchCertMode(mode) {
  document.getElementById('cert-mode-catalog').style.display = mode === 'catalog' ? 'block' : 'none';
  document.getElementById('cert-mode-scratch').style.display = mode === 'scratch' ? 'block' : 'none';
  document.getElementById('cert-tab-catalog').classList.toggle('active', mode === 'catalog');
  document.getElementById('cert-tab-scratch').classList.toggle('active', mode === 'scratch');
  showMsg('cert', '', '');
}

function handleScratchFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1400;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width  = Math.round(width  * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      const data = canvas.toDataURL('image/jpeg', 0.85);
      document.getElementById('scratch-image-data').value = data;
      document.getElementById('scratch-img-tag').src = data;
      document.getElementById('scratch-img-name').textContent = file.name;
      document.getElementById('scratch-img-preview').style.display = 'block';
      document.getElementById('scratch-upload-prompt').style.display = 'none';
      document.getElementById('scratch-clear-img').style.display = 'inline';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function handleScratchDrop(event) {
  event.preventDefault();
  document.getElementById('scratch-drop-zone').classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleScratchFile(file);
}

function clearScratchImage() {
  document.getElementById('scratch-image-data').value = '';
  document.getElementById('scratch-file-input').value = '';
  document.getElementById('scratch-img-preview').style.display = 'none';
  document.getElementById('scratch-upload-prompt').style.display = 'block';
  document.getElementById('scratch-clear-img').style.display = 'none';
}

function toggleNominativeScratch() {
  const checked = document.getElementById('scratch-nominative-check').checked;
  document.getElementById('scratch-nominative-fields').style.display = checked ? 'block' : 'none';
}

async function generateCert(sendEmail = false) {
  const title = document.getElementById('cert-title').value.trim();
  if (!title) return showMsg('cert', 'Cargue primero un producto.', 'err');
  const body = {
    title,
    description: document.getElementById('cert-description').value,
    price: document.getElementById('cert-price').value,
    image: document.getElementById('cert-image-url').value,
    origen: document.getElementById('cert-origen').value,
    alto: document.getElementById('cert-alto').value,
    ancho: document.getElementById('cert-ancho').value,
    to_name: document.getElementById('cert-to-name').value,
    to_email: document.getElementById('cert-to-email').value,
    send_email: sendEmail,
    expert: document.getElementById('cert-expert').value,
  };
  const check = document.getElementById('cert-nominative-check');
  if (check?.checked) {
    body.nominative_honorific = document.getElementById('cert-honorific').value;
    body.nominative_name = document.getElementById('cert-client-name').value;
  }
  await submitCertBody(body, sendEmail);
}

async function generateCertScratch(sendEmail = false) {
  const title = document.getElementById('scratch-title').value.trim();
  if (!title) return showMsg('cert', 'Ingrese al menos el título de la pieza.', 'err');
  const body = {
    title,
    description: document.getElementById('scratch-description').value,
    price: document.getElementById('scratch-price').value,
    image: document.getElementById('scratch-image-data').value,
    origen: document.getElementById('scratch-origen').value,
    alto: document.getElementById('scratch-alto').value,
    ancho: document.getElementById('scratch-ancho').value,
    to_name: document.getElementById('scratch-to-name').value,
    to_email: document.getElementById('scratch-to-email').value,
    send_email: sendEmail,
    expert: document.getElementById('scratch-expert').value,
  };
  const check = document.getElementById('scratch-nominative-check');
  if (check?.checked) {
    body.nominative_honorific = document.getElementById('scratch-honorific').value;
    body.nominative_name = document.getElementById('scratch-client-name').value;
  }
  await submitCertBody(body, sendEmail);
}

async function submitCertBody(body, sendEmail) {
  const msgEl = document.getElementById('cert-msg');
  msgEl.style.display = 'none';
  showMsg('cert', 'Generando certificado…', 'ok');
  msgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  try {
    const res = await fetch('/generate/certificate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 413) {
      showCertErr('La imagen es demasiado grande. Intenta con una imagen más pequeña.');
      return;
    }
    if (!res.ok && !res.headers.get('content-type')?.includes('application/pdf')) {
      let errMsg = 'Error del servidor (' + res.status + ').';
      try { const d = await res.json(); errMsg = d.error || d.message || errMsg; } catch {}
      showCertErr(errMsg);
      return;
    }
    if (res.headers.get('content-type')?.includes('application/pdf')) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'Certificado.pdf'; a.click();
      URL.revokeObjectURL(url);
      msgEl.style.display = 'none';
    } else {
      const data = await res.json();
      showMsg('cert', data.message || data.error || 'Respuesta inesperada.', data.ok ? 'ok' : 'err');
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch(e) {
    showCertErr('No se pudo conectar con el servidor: ' + e.message);
  }
}

function showCertErr(text) {
  showMsg('cert', text, 'err');
  document.getElementById('cert-msg').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadCertData() {
  const ids = getSelectedIds('cert');
  if (!ids.length) return showMsg('cert', 'Seleccione un producto de la lista.', 'err');
  if (ids.length > 1) return showMsg('cert', 'Seleccione solo un producto para el certificado.', 'err');
  showMsg('cert', 'Cargando datos del producto…', 'ok');
  try {
    const res = await fetch('/api/product-cert-data?id=' + ids[0]);
    const data = await res.json();
    document.getElementById('cert-title').value = data.title || '';
    document.getElementById('cert-description').value = data.description || '';
    document.getElementById('cert-price').value = data.price || '';
    document.getElementById('cert-image-url').value = data.image || '';
    document.getElementById('cert-origen').value = data.origen || '';
    document.getElementById('cert-alto').value = data.alto || '';
    document.getElementById('cert-ancho').value = data.ancho || '';
    const preview = document.getElementById('cert-preview');
    if (data.image) {
      preview.innerHTML = \`<div style="text-align:center;margin-bottom:16px"><img src="\${data.image}" style="max-height:140px;max-width:100%;object-fit:contain;border-radius:4px;border:1px solid #e8e2d9"></div>\`;
    } else {
      preview.innerHTML = '';
    }
    document.getElementById('cert-step-edit').style.display = 'block';
    document.getElementById('cert-btn-row').style.display = 'flex';
    document.getElementById('cert-step-label').textContent = '1. Producto seleccionado ✓';
    showMsg('cert', '', '');
  } catch(e) {
    showMsg('cert', 'Error cargando datos del producto.', 'err');
  }
}

function toggleNominative() {
  const checked = document.getElementById('cert-nominative-check').checked;
  document.getElementById('cert-nominative-fields').style.display = checked ? 'block' : 'none';
}

function resetCert() {
  document.getElementById('cert-step-edit').style.display = 'none';
  document.getElementById('cert-btn-row').style.display = 'none';
  document.getElementById('cert-step-label').textContent = '1. Seleccionar producto';
  document.getElementById('cert-title').value = '';
  document.getElementById('cert-description').value = '';
  document.getElementById('cert-price').value = '';
  document.getElementById('cert-image-url').value = '';
  document.getElementById('cert-origen').value = '';
  document.getElementById('cert-alto').value = '';
  document.getElementById('cert-ancho').value = '';
  document.getElementById('cert-preview').innerHTML = '';
  document.getElementById('cert-nominative-check').checked = false;
  document.getElementById('cert-nominative-fields').style.display = 'none';
  document.getElementById('cert-client-name').value = '';
  document.getElementById('cert-to-name').value = '';
  document.getElementById('cert-to-email').value = '';
  showMsg('cert', '', '');
}

init();

// ── Brochure ──────────────────────────────────────────────────────────────────
async function loadBrochurePickers() {
  // Textura de portada
  const texGrid = document.getElementById('brochure-texture-grid');
  try {
    const res = await fetch('/api/textures');
    const textures = await res.json();
    texGrid.innerHTML = textures.map(t =>
      \`<div class="texture-thumb brochure-tex-thumb" onclick="selectBrochureTextura('\${t.url}', this)" title="\${t.alt || ''}">
        <img src="\${t.url}" alt="\${t.alt || ''}" loading="lazy">
      </div>\`
    ).join('');
  } catch(e) {
    texGrid.innerHTML = '<div style="color:#c00;font-size:13px;grid-column:1/-1">Error cargando texturas.</div>';
  }

  // Imágenes de contexto — una por sección
  const CTX_SECTIONS = ['quienes','rescate','servicios','regalos','porque','europa','proceso','contacto'];
  try {
    const res = await fetch('/api/contextos');
    const images = await res.json();
    const thumbsHTML = images.length
      ? images.map(img =>
          \`<div class="texture-thumb" onclick="selectBrochureCtx(this)" data-url="\${img.url}" title="\${img.alt || ''}">
            <img src="\${img.url}" alt="\${img.alt || ''}" loading="lazy">
          </div>\`
        ).join('')
      : '<div style="color:#999;font-size:13px;grid-column:1/-1">Sin imágenes de contexto en Shopify.</div>';
    CTX_SECTIONS.forEach(sec => {
      const grid = document.getElementById(\`ctx-\${sec}-grid\`);
      if (grid) grid.innerHTML = thumbsHTML;
    });
  } catch(e) {
    CTX_SECTIONS.forEach(sec => {
      const grid = document.getElementById(\`ctx-\${sec}-grid\`);
      if (grid) grid.innerHTML = '<div style="color:#c00;font-size:13px;grid-column:1/-1">Error cargando contextos.</div>';
    });
  }
}

function selectBrochureTextura(url, el) {
  document.querySelectorAll('.brochure-tex-thumb').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('brochure-textura-url').value = url;
}

function selectBrochureCtx(el) {
  const grid = el.closest('.ctx-grid');
  const sec  = grid.id.replace('ctx-', '').replace('-grid', '');
  grid.querySelectorAll('.texture-thumb').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(\`ctx-\${sec}-url\`).value = el.dataset.url;
}

let _brochureColProducts = [];
let _brochureCollections  = [];

async function loadBrochureCollection() {
  const sel = document.getElementById('brochure-col-select');
  if (!sel.value) return;
  const grid = document.getElementById('brochure-col-product-grid');
  const panel = document.getElementById('brochure-col-products');
  grid.innerHTML = '<div style="color:#999;font-size:13px;grid-column:1/-1">Cargando piezas…</div>';
  panel.style.display = 'block';
  try {
    const res = await fetch(\`/api/collection-products/\${sel.value}\`);
    _brochureColProducts = await res.json();
    grid.innerHTML = _brochureColProducts.map((p, i) => \`
      <label style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="position:relative;width:100%;aspect-ratio:1;background:#e8e4df;overflow:hidden;border-radius:3px;border:2px solid transparent" id="bcp-wrap-\${i}">
          \${p.image ? \`<img src="\${p.image}" style="width:100%;height:100%;object-fit:cover" loading="lazy">\` : '<div style="width:100%;height:100%;background:#ddd8d2"></div>'}
          <div style="position:absolute;top:4px;right:4px;width:18px;height:18px;background:#fff;border-radius:3px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center">
            <input type="checkbox" data-idx="\${i}" onchange="toggleBrochureColProduct(\${i},this)" style="margin:0">
          </div>
        </div>
        <span style="font-size:9px;color:#666;text-align:center;line-height:1.3;max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">\${p.title}</span>
      </label>\`).join('');
  } catch(e) {
    grid.innerHTML = '<div style="color:#c00;font-size:13px;grid-column:1/-1">Error cargando piezas.</div>';
  }
}

function toggleBrochureColProduct(i, cb) {
  const wrap = document.getElementById(\`bcp-wrap-\${i}\`);
  if (wrap) wrap.style.borderColor = cb.checked ? '#9a7f5a' : 'transparent';
}

function addBrochureCollection() {
  const sel = document.getElementById('brochure-col-select');
  const checked = [...document.querySelectorAll('#brochure-col-product-grid input[type="checkbox"]:checked')];
  if (!checked.length) return showMsg('brochure', 'Selecciona al menos una pieza.', 'err');
  _brochureCollections.push({
    id:         sel.value,
    title:      sel.options[sel.selectedIndex].text,
    showPrices: document.getElementById('brochure-col-prices').checked,
    products:   checked.map(cb => _brochureColProducts[parseInt(cb.dataset.idx)]),
  });
  renderBrochureCollectionList();
  document.getElementById('brochure-col-products').style.display = 'none';
  sel.value = '';
  document.getElementById('brochure-col-prices').checked = false;
}

function removeBrochureCollection(i) {
  _brochureCollections.splice(i, 1);
  renderBrochureCollectionList();
}

function renderBrochureCollectionList() {
  const list = document.getElementById('brochure-col-list');
  if (!_brochureCollections.length) { list.innerHTML = ''; return; }
  list.innerHTML = _brochureCollections.map((col, i) => \`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f5f3f0;border-radius:4px;margin-bottom:8px;border-left:3px solid #9a7f5a">
      <div>
        <div style="font-size:13px;font-weight:500;color:#1a1a1a">\${col.title}</div>
        <div style="font-size:11px;color:#999;margin-top:2px">\${col.products.length} pieza\${col.products.length !== 1 ? 's' : ''}\${col.showPrices ? ' · con precios' : ''}</div>
      </div>
      <button onclick="removeBrochureCollection(\${i})" style="background:none;border:none;color:#c00;font-size:12px;cursor:pointer;font-family:inherit;padding:0">Quitar</button>
    </div>\`).join('');
}

async function generateBrochure() {
  showMsg('brochure', 'Generando brochure…', 'ok');
  const ids = getSelectedIds('brochure');
  const body = {
    company_name:   document.getElementById('brochure-company').value.trim(),
    responsable:    document.getElementById('brochure-responsable').value.trim(),
    cargo:          document.getElementById('brochure-cargo').value.trim(),
    correo:         document.getElementById('brochure-correo').value.trim(),
    telefono:       document.getElementById('brochure-telefono').value.trim(),
    show_prices:  document.getElementById('brochure-show-prices').checked,
    meta_fields:  ['origen','estilo','epocas','materiales','medidas']
      .filter(f => document.getElementById('brochure-mf-' + f)?.checked),
    textura_url:  document.getElementById('brochure-textura-url').value,
    contexto_images: Object.fromEntries(
      ['quienes','rescate','servicios','regalos','porque','europa','proceso','contacto']
        .map(s => [s, document.getElementById(\`ctx-\${s}-url\`)?.value || ''])
        .filter(([, v]) => v)
    ),
    pages: [
      ['brochure-page-quienes',   'quienes'],
      ['brochure-page-rescate',   'rescate'],
      ['brochure-page-servicios', 'servicios'],
      ['brochure-page-regalos',   'regalos'],
      ['brochure-page-porque',    'porque'],
      ['brochure-page-europa',    'europa'],
      ['brochure-page-proceso',   'proceso'],
    ].filter(([id]) => document.getElementById(id)?.checked).map(([, key]) => key),
    product_ids:  ids,
    proyecto:     document.getElementById('brochure-proyecto').value.trim(),
    products_per_page: document.querySelector('input[name="brochure-ppp"]:checked')?.value || '1',
    collections: _brochureCollections.map(col => ({
      title:      col.title,
      showPrices: col.showPrices,
      products:   col.products.map(p => ({ title: p.title, image: p.image, price: p.price })),
    })),
    cover_tag:   document.getElementById('brochure-cover-tag').value.trim() || undefined,
    cover_title: document.getElementById('brochure-cover-title').value.trim() || undefined,
    cover_sub:   document.getElementById('brochure-cover-sub').value.trim() || undefined,
  };
  try {
    const res = await fetch('/generate/brochure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: \`Error \${res.status}\` }));
      showMsg('brochure', err.error || 'Error generando el brochure.', 'err');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = body.company_name ? '-' + body.company_name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() : '';
    a.download = \`Brochure-Bucarest\${safeName}.pdf\`;
    a.click();
    URL.revokeObjectURL(url);
    showMsg('brochure', 'Brochure generado correctamente.', 'ok');
  } catch(e) {
    showMsg('brochure', 'Error de conexión.', 'err');
  }
}

// ── Texture picker ────────────────────────────────────────────────────────────
async function loadTexturePicker() {
  const grid = document.getElementById('texture-picker-grid');
  try {
    const res = await fetch('/api/textures');
    const textures = await res.json();
    if (!textures.length) {
      grid.innerHTML = '<div style="color:#999;font-size:13px;grid-column:1/-1">No se encontraron texturas.</div>';
      return;
    }
    grid.innerHTML = textures.map((t, i) =>
      \`<div class="texture-thumb" onclick="selectTexture('\${t.url}', this)" title="\${t.alt || ''}">
        <img src="\${t.url}" alt="\${t.alt || ''}" loading="lazy">
      </div>\`
    ).join('');
  } catch(e) {
    grid.innerHTML = '<div style="color:#c00;font-size:13px;grid-column:1/-1">Error cargando texturas.</div>';
  }
}

function selectTexture(url, el) {
  document.querySelectorAll('#texture-picker-grid .texture-thumb').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('catalog-bg-url').value = url;
  const name = url.split('/').pop().split('?')[0];
  document.getElementById('catalog-bg-selected-name').textContent = name;
  document.getElementById('catalog-bg-selected').style.display = 'block';
}

function clearBgImage() {
  document.querySelectorAll('#texture-picker-grid .texture-thumb').forEach(t => t.classList.remove('selected'));
  document.getElementById('catalog-bg-url').value = '';
  document.getElementById('catalog-bg-selected').style.display = 'none';
}

// ── Proyectos guardados ───────────────────────────────────────────────────────

function _collectBrochureState() {
  return {
    company_name:    document.getElementById('brochure-company')?.value.trim() || '',
    responsable:     document.getElementById('brochure-responsable')?.value.trim() || '',
    cargo:           document.getElementById('brochure-cargo')?.value.trim() || '',
    correo:          document.getElementById('brochure-correo')?.value.trim() || '',
    telefono:        document.getElementById('brochure-telefono')?.value.trim() || '',
    show_prices:     document.getElementById('brochure-show-prices')?.checked || false,
    textura_url:     document.getElementById('brochure-textura-url')?.value || '',
    cover_tag:       document.getElementById('brochure-cover-tag')?.value.trim() || '',
    cover_title:     document.getElementById('brochure-cover-title')?.value.trim() || '',
    cover_sub:       document.getElementById('brochure-cover-sub')?.value.trim() || '',
    meta_fields:     ['origen','estilo','epocas','materiales','medidas'].filter(f => document.getElementById('brochure-mf-' + f)?.checked),
    products_per_page: document.querySelector('input[name="brochure-ppp"]:checked')?.value || '1',
    proyecto:        document.getElementById('brochure-proyecto')?.value.trim() || '',
    product_ids:     getSelectedIds('brochure'),
    _ms_products:    [..._msMap('brochure').values()],
    collections:     _brochureCollections.map(col => ({ title: col.title, showPrices: col.showPrices, products: col.products.map(p => ({ title: p.title, image: p.image, price: p.price })) })),
    contexto_images: Object.fromEntries(['quienes','rescate','servicios','regalos','porque','europa','proceso','contacto'].map(s => [s, document.getElementById(\`ctx-\${s}-url\`)?.value || '']).filter(([,v]) => v)),
    pages: [
      ['brochure-page-quienes',   'quienes'],
      ['brochure-page-rescate',   'rescate'],
      ['brochure-page-servicios', 'servicios'],
      ['brochure-page-regalos',   'regalos'],
      ['brochure-page-porque',    'porque'],
      ['brochure-page-europa',    'europa'],
      ['brochure-page-proceso',   'proceso'],
    ].filter(([id]) => document.getElementById(id)?.checked).map(([, key]) => key),
  };
}

function _collectCatalogState() {
  return {
    title:          document.getElementById('catalog-title')?.value.trim() || '',
    show_prices:    document.getElementById('catalog-prices')?.checked || false,
    show_estado:    document.getElementById('catalog-show-estado')?.checked || false,
    show_quienes:   document.getElementById('catalog-quienes-somos')?.checked || false,
    responsable:    document.getElementById('catalog-responsable')?.value.trim() || '',
    cargo:          document.getElementById('catalog-cargo')?.value.trim() || '',
    correo:         document.getElementById('catalog-correo')?.value.trim() || '',
    telefono:       document.getElementById('catalog-telefono')?.value.trim() || '',
    meta_fields:    ['origen','estilo','epocas','materiales','medidas'].filter(f => document.getElementById('catalog-mf-' + f)?.checked),
    bg_image:       document.getElementById('catalog-bg-url')?.value || '',
    product_ids:    getSelectedIds('catalog'),
    _ms_products:   [..._msMap('catalog').values()],
  };
}

function _collectQuoteState() {
  return {
    client_name:      document.getElementById('quote-name')?.value.trim() || '',
    client_email:     document.getElementById('quote-email')?.value.trim() || '',
    client_rut:       document.getElementById('quote-rut')?.value.trim() || '',
    client_company:   document.getElementById('quote-company')?.value.trim() || '',
    client_razon:     document.getElementById('quote-razon-social')?.value.trim() || '',
    client_direccion: document.getElementById('quote-direccion')?.value.trim() || '',
    valid_days:       document.getElementById('quote-days')?.value.trim() || '',
    notes:            document.getElementById('quote-notes')?.value.trim() || '',
    products_per_page: document.getElementById('quote-ppp')?.value || '3',
    show_links:       document.getElementById('quote-show-links')?.checked || false,
    show_description: document.getElementById('quote-show-desc')?.checked !== false,
    show_sku:         document.getElementById('quote-show-sku')?.checked || false,
    product_ids:      getSelectedIds('quote'),
  };
}

function _restoreBrochureState(data) {
  if (!data) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  set('brochure-company', data.company_name || '');
  set('brochure-responsable', data.responsable || '');
  set('brochure-cargo', data.cargo || '');
  set('brochure-correo', data.correo || '');
  set('brochure-telefono', data.telefono || '');
  chk('brochure-show-prices', !!data.show_prices);
  set('brochure-textura-url', data.textura_url || '');
  set('brochure-cover-tag', data.cover_tag || '');
  set('brochure-cover-title', data.cover_title || '');
  set('brochure-cover-sub', data.cover_sub || '');
  set('brochure-proyecto', data.proyecto || '');
  if (data.textura_url) {
    document.querySelectorAll('#brochure-texture-grid .texture-thumb').forEach(t => {
      t.classList.toggle('selected', t.dataset.url === data.textura_url);
    });
  }
  ['origen','estilo','epocas','materiales','medidas'].forEach(f => chk('brochure-mf-' + f, (data.meta_fields || []).includes(f)));
  [
    ['brochure-page-quienes',   'quienes'],
    ['brochure-page-rescate',   'rescate'],
    ['brochure-page-servicios', 'servicios'],
    ['brochure-page-regalos',   'regalos'],
    ['brochure-page-porque',    'porque'],
    ['brochure-page-europa',    'europa'],
    ['brochure-page-proceso',   'proceso'],
  ].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el && Array.isArray(data.pages)) el.checked = data.pages.includes(key);
  });
  if (data.contexto_images) {
    ['quienes','rescate','servicios','regalos','porque','europa','proceso','contacto'].forEach(s => {
      const el = document.getElementById(\`ctx-\${s}-url\`);
      if (el) el.value = data.contexto_images[s] || '';
    });
  }
  const ppp = data.products_per_page || '1';
  const pppEl = document.querySelector(\`input[name="brochure-ppp"][value="\${ppp}"]\`);
  if (pppEl) pppEl.checked = true;
  const msItems = Array.isArray(data._ms_products) && data._ms_products.length ? data._ms_products
    : (Array.isArray(data.product_ids) && data.product_ids.length ? data.product_ids.map(id => ({ id })) : null);
  if (msItems) {
    const map = _msMap('brochure');
    map.clear();
    msItems.forEach(p => map.set(String(p.id), p));
    _msRenderBasket('brochure');
  }
}

function _restoreCatalogState(data) {
  if (!data) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  set('catalog-title', data.title || '');
  chk('catalog-prices', !!data.show_prices);
  chk('catalog-show-estado', !!data.show_estado);
  chk('catalog-quienes-somos', !!data.show_quienes);
  set('catalog-responsable', data.responsable || '');
  set('catalog-cargo', data.cargo || '');
  set('catalog-correo', data.correo || '');
  set('catalog-telefono', data.telefono || '');
  ['origen','estilo','epocas','materiales','medidas'].forEach(f => chk('catalog-mf-' + f, (data.meta_fields || []).includes(f)));
  set('catalog-bg-url', data.bg_image || '');
  const msItems = Array.isArray(data._ms_products) && data._ms_products.length ? data._ms_products
    : (Array.isArray(data.product_ids) && data.product_ids.length ? data.product_ids.map(id => ({ id })) : null);
  if (msItems) {
    const map = _msMap('catalog');
    map.clear();
    msItems.forEach(p => map.set(String(p.id), p));
    _msRenderBasket('catalog');
  }
}

function _restoreQuoteState(data) {
  if (!data) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const chk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  set('quote-name', data.client_name || '');
  set('quote-email', data.client_email || '');
  set('quote-rut', data.client_rut || '');
  set('quote-company', data.client_company || '');
  set('quote-razon-social', data.client_razon || '');
  set('quote-direccion', data.client_direccion || '');
  set('quote-days', data.valid_days || '');
  set('quote-notes', data.notes || '');
  chk('quote-show-links', !!data.show_links);
  chk('quote-show-desc', data.show_description !== false);
  chk('quote-show-sku', !!data.show_sku);
}

const _projectCollectors = { brochure: _collectBrochureState, catalog: _collectCatalogState, quote: _collectQuoteState };
const _projectRestorers  = { brochure: _restoreBrochureState, catalog: _restoreCatalogState, quote: _restoreQuoteState };

async function saveProject(type) {
  const nameEl = document.getElementById(\`\${type}-project-name\`);
  const name = nameEl?.value.trim();
  if (!name) { alert('Escribe un nombre para el proyecto antes de guardar.'); return; }
  const data = (_projectCollectors[type] || (() => ({})))();
  const id = \`\${type}-\${Date.now()}\`;
  try {
    const res = await fetch(\`/api/projects/\${type}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name, data }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || \`HTTP \${res.status}\`);
    }
    if (nameEl) nameEl.value = '';
    await loadProjects(type);
  } catch(e) {
    alert('Error guardando proyecto: ' + e.message);
  }
}

async function loadProjects(type) {
  const listEl = document.getElementById(\`\${type}-projects-list\`);
  if (!listEl) return;
  try {
    const res = await fetch(\`/api/projects/\${type}\`);
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const projects = await res.json();
    if (!Array.isArray(projects) || !projects.length) { listEl.innerHTML = '<p style="font-size:12px;color:#bbb;margin:0">No hay proyectos guardados.</p>'; return; }
    listEl.innerHTML = projects.map(p => \`
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0ece5">
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#3d2b1f">\${p.name}</div>
          <div style="font-size:11px;color:#bbb">\${new Date(p.savedAt).toLocaleString('es-CL')}</div>
        </div>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px" onclick="applyProject('\${type}','\${p.id}')">Cargar</button>
        <button class="btn" style="padding:4px 10px;font-size:11px;background:#fff0f0;color:#c00;border:1px solid #fcc" onclick="deleteProjectUI('\${type}','\${p.id}')">Eliminar</button>
      </div>
    \`).join('');
    listEl._projects = projects;
  } catch(e) {
    listEl.innerHTML = '<p style="font-size:12px;color:#c00;margin:0">Error cargando proyectos.</p>';
  }
}

function applyProject(type, id) {
  const listEl = document.getElementById(\`\${type}-projects-list\`);
  const projects = listEl?._projects || [];
  const p = projects.find(x => x.id === id);
  if (!p) return;
  const nameEl = document.getElementById(\`\${type}-project-name\`);
  if (nameEl) nameEl.value = p.name;
  (_projectRestorers[type] || (() => {}))(p.data);
}

async function deleteProjectUI(type, id) {
  if (!confirm('¿Eliminar este proyecto?')) return;
  try {
    await fetch(\`/api/projects/\${type}/\${id}\`, { method: 'DELETE' });
    await loadProjects(type);
  } catch(e) {
    alert('Error eliminando proyecto: ' + e.message);
  }
}

// Cargar proyectos al inicio
window.addEventListener('DOMContentLoaded', () => {
  loadProjects('brochure');
  loadProjects('catalog');
  loadProjects('quote');
});

</script>
</body>
</html>`;
}
