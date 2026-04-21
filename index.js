if (process.env.NODE_ENV !== 'production') require('dotenv').config();
process.on('uncaughtException', err => console.error('UNCAUGHT:', err));
process.on('unhandledRejection', err => console.error('UNHANDLED:', err));
const express = require('express');
const crypto = require('crypto');
const { generatePDF } = require('./pdf');
const { sendCertificate, sendPDFToInternal } = require('./email');
const { certificateHTML } = require('./templates/certificate');
const { catalogHTML } = require('./templates/catalog');
const { quoteHTML } = require('./templates/quote');
const { receiptHTML } = require('./templates/receipt');
const shopify = require('./shopify');

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.send('Bucarest PDF Generator — OK'));

// ── OAuth: inicio ─────────────────────────────────────────────────────────────
app.get('/shopify/auth', (req, res) => {
  const shop = req.query.shop || process.env.SHOPIFY_SHOP;
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, req.query.host || '');

  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: 'read_products,read_orders,read_metaobjects,read_locations',
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
      await sendPDFToInternal(receiptPdf, filename,
        `Comprobante de venta — ${order.name || '#' + order.order_number}`,
        `<p>Estimado/a ${customerName},</p><p>Adjunto encontrará su comprobante de venta. Gracias por su compra en Bucarest Art &amp; Antiques.</p>`,
        customerEmail
      );
    }

    // Certificado de autenticidad solo para productos de la colección Pintura
    const pinturaId = process.env.PINTURA_COLLECTION_ID;
    if (pinturaId) {
      const pinturaProducts = await shopify.getProductsByCollection(pinturaId);
      const pinturaIds = new Set(pinturaProducts.map(p => p.id));
      const pinturaItems = (order.line_items || []).filter(item => pinturaIds.has(item.product_id));

      if (pinturaItems.length > 0) {
        const lineItems = pinturaItems.map(item => ({
          title: item.title,
          image: item.image?.src || null,
          price: parseFloat(item.price),
          currency: order.currency || 'CLP',
          description: null,
        }));
        const certHtml = certificateHTML(lineItems);
        const certPdf = await generatePDF(certHtml);
        if (customerEmail) {
          await sendCertificate(customerEmail, customerName, certPdf, pinturaItems.map(i => i.title).join(', '));
        }
        console.log(`✅ Certificado enviado para orden ${order.order_number}`);
      }
    }

    console.log(`✅ Comprobante enviado para orden ${order.order_number}`);
  } catch (err) {
    console.error('Error procesando webhook:', err);
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
      if (metafield_namespace && metafield_key && metafield_value)
        return shopify.getProductsByMetafield(metafield_namespace, metafield_key, metafield_value);
      return [];
    });
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Generar certificado manual ────────────────────────────────────────────────
app.post('/generate/certificate', async (req, res) => {
  try {
    console.log('BODY recibido:', JSON.stringify(req.body));
    const { product_ids, send_email, to_email, to_name, price_overrides } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const lineItems = await Promise.all(ids.map(async id => {
      const p = await shopify.getProductById(id);
      const priceRaw = price_overrides?.[id] || p.variants?.[0]?.price || 0;
      return {
        title: p.title,
        image: p.images?.[0]?.src || null,
        price: parseFloat(priceRaw),
        currency: 'CLP',
        description: p.body_html ? p.body_html.replace(/<[^>]*>/g, '') : null,
      };
    }));

    const html = certificateHTML(lineItems);
    const pdf = await generatePDF(html);

    if (send_email && to_email) {
      console.log('Enviando certificado a:', to_email);
      await sendCertificate(to_email, to_name || 'Cliente', pdf, lineItems.map(i => i.title).join(', '));
      console.log('Certificado enviado OK');
      res.json({ ok: true, message: 'Certificado enviado por correo.' });
    } else {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'attachment; filename="certificado.pdf"');
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
    const { product_ids, title, show_prices, send_email, responsable, cargo, correo, telefono, bg_image, price_overrides } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const [products, locations] = await Promise.all([
      Promise.all(ids.map(async id => {
        const p = await shopify.getProductById(id);
        p._metafields = await shopify.getProductMetafields(id);
        if (price_overrides && price_overrides[id] && p.variants && p.variants[0]) {
          p.variants[0].price = String(price_overrides[id]);
        }
        return p;
      })),
      withCache('locations', 60 * 60 * 1000, () => shopify.getLocations()),
    ]);

    const html = catalogHTML(products, {
      title: title || 'Catálogo',
      showPrices: show_prices !== 'false',
      responsable, cargo, correo, telefono,
      bgImage: bg_image,
      locations,
    });
    const pdf = await generatePDF(html);

    if (send_email) {
      await sendPDFToInternal(pdf, 'catalogo.pdf', `Catálogo — ${title || 'Bucarest Art & Antiques'}`,
        `<p>Catálogo generado el ${new Date().toLocaleDateString('es-CL')}.</p>`);
      res.json({ ok: true, message: 'Catálogo enviado por correo.' });
    } else {
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', 'attachment; filename="catalogo.pdf"');
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
    const { product_ids, client_name, client_email, client_rut, client_company, client_razon_social, client_direccion, valid_days, notes, send_email, price_overrides } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const products = await Promise.all(ids.map(async id => {
      const p = await shopify.getProductById(id);
      if (price_overrides?.[id] && p.variants?.[0]) p.variants[0].price = String(price_overrides[id]);
      return p;
    }));
    const html = quoteHTML(products, {
      clientName: client_name, clientEmail: client_email,
      clientRut: client_rut, clientCompany: client_company,
      clientRazonSocial: client_razon_social, clientDireccion: client_direccion,
      validDays: valid_days || 7, notes,
    });
    const pdf = await generatePDF(html);
    const filename = `Cotizacion_${(client_name || 'Bucarest').replace(/\s/g, '_')}.pdf`;

    if (send_email && client_email) {
      await sendPDFToInternal(pdf, filename, `Cotización — ${client_name || 'Sin nombre'}`,
        `<p>Cotización generada para ${client_name || 'cliente sin nombre'}.</p>`);
      res.json({ ok: true, message: 'Cotización enviada por correo.' });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Bucarest PDF Generator corriendo en puerto ${PORT}`));

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
    .sidebar{position:fixed;top:0;left:0;width:220px;height:100vh;background:#1a1a1a;padding:28px 20px;display:flex;flex-direction:column;gap:8px}
    .sidebar-logo{color:#fff;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:24px;opacity:0.7}
    .nav-btn{background:none;border:none;color:#aaa;font-size:13px;padding:10px 14px;text-align:left;cursor:pointer;border-radius:4px;width:100%;font-family:inherit;transition:all 0.15s}
    .nav-btn:hover,.nav-btn.active{background:#2a2a2a;color:#fff}
    .nav-btn.active{color:#c9a96e}
    .main{margin-left:220px;padding:40px 48px;min-height:100vh}
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
    .file-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center}
    .file-modal-overlay.open{display:flex}
    .file-modal{background:#fff;width:680px;max-height:80vh;display:flex;flex-direction:column;border-radius:4px;overflow:hidden}
    .file-modal-header{padding:20px 24px;border-bottom:1px solid #e8e2d9;display:flex;justify-content:space-between;align-items:center}
    .file-modal-header h3{font-size:15px;font-weight:500;color:#1a1a1a}
    .file-modal-close{background:none;border:none;font-size:20px;cursor:pointer;color:#999;line-height:1}
    .file-modal-body{overflow-y:auto;padding:20px;flex:1}
    .file-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
    .file-thumb{aspect-ratio:1;overflow:hidden;border:2px solid transparent;border-radius:4px;cursor:pointer;transition:border-color 0.15s}
    .file-thumb:hover{border-color:#9a7f5a}
    .file-thumb img{width:100%;height:100%;object-fit:cover}
    .file-modal-loading{text-align:center;padding:40px;color:#999;font-size:13px}
    .automation-notice{background:#faf8f5;border-left:3px solid #9a7f5a;padding:10px 14px;font-size:13px;color:#555;line-height:1.4;margin-bottom:20px}
    .automation-notice strong{color:#1a1a1a;margin-right:4px}
  </style>
</head>
<body>

<div class="sidebar">
  <div class="sidebar-logo">Bucarest Art &amp; Antiques</div>
  <button class="nav-btn active" onclick="showPage('certificates')">Certificados</button>
  <button class="nav-btn" onclick="showPage('catalog')">Catálogos</button>
  <button class="nav-btn" onclick="showPage('quote')">Cotizaciones</button>
  <button class="nav-btn" onclick="showPage('receipt')">Comprobantes</button>
</div>

<div class="main">

  <!-- CERTIFICADOS -->
  <div class="page active" id="page-certificates">
    <h1>Certificados de Autenticidad</h1>
    <p class="subtitle">Genera certificados de autenticidad manualmente o déjalos enviar de forma automática.</p>
    <div class="automation-notice">
      <strong>Automatización activa</strong>
      Los certificados se generan automáticamente para todos los pedidos que incluyan productos de la colección <strong>Pintura</strong>. Se envía una copia al correo del cliente y otra a los correos internos: <strong>bucarestart@gmail.com</strong> y <strong>comunicaciones@bucarestart.cl</strong> para su impresión.
    </div>

    <div class="card">
      <span class="section-label">Seleccionar productos</span>
      <div id="cert-filters" class="filter-row">
        <button class="filter-btn active" onclick="setFilter('cert','collection')">Por colección</button>
        <button class="filter-btn" onclick="setFilter('cert','tag')">Por tag</button>
        <button class="filter-btn" onclick="setFilter('cert','title')">Por título</button>
        <button class="filter-btn" onclick="setFilter('cert','sku')">Por SKU</button>
        <button class="filter-btn" onclick="setFilter('cert','metafield')">Por metacampo</button>
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
        <label>Palabra en título <input id="cert-title" placeholder="Ej: óleo" oninput="debounce(() => loadProducts('cert'), 600)"></label>
      </div>
      <div id="cert-filter-sku" class="filter-panel">
        <label>SKU <input id="cert-sku" placeholder="Ej: ART-001" oninput="debounce(() => loadProducts('cert'), 600)"></label>
      </div>
      <div id="cert-filter-metafield" class="filter-panel">
        <div class="row row-3">
          <label>Namespace <input id="cert-meta-ns" placeholder="custom"></label>
          <label>Key <input id="cert-meta-key" placeholder="material"></label>
          <label>Valor <input id="cert-meta-val" placeholder="bronce" oninput="debounce(() => loadProducts('cert'), 800)"></label>
        </div>
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
    </div>

    <div class="card">
      <span class="section-label">Enviar por correo (opcional)</span>
      <div class="row row-2">
        <label>Nombre del destinatario <input id="cert-to-name" placeholder="Ej: María González"></label>
        <label>Correo del destinatario <input id="cert-to-email" type="email" placeholder="cliente@ejemplo.com"></label>
      </div>
      <p style="font-size:12px;color:#999">Si no ingresa un correo se descargará el PDF directo.</p>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="generate('certificate')">Generar certificado</button>
    </div>
    <div class="msg" id="cert-msg"></div>
  </div>

  <!-- CATÁLOGOS -->
  <div class="page" id="page-catalog">
    <h1>Catálogos</h1>
    <p class="subtitle">Genera catálogos PDF filtrando productos por colección, tag, título o metacampos.</p>

    <div class="card">
      <span class="section-label">Título del catálogo</span>
      <input id="catalog-title" placeholder="Ej: Catálogo Pintura Siglo XIX" style="width:100%;margin-bottom:16px">
      <div class="checkbox-row"><input type="checkbox" id="catalog-prices" checked><label for="catalog-prices" style="text-transform:none;letter-spacing:0;font-size:13px">Mostrar precios</label></div>
    </div>

    <div class="card">
      <span class="section-label">Imagen de fondo (portada y contraportada)</span>
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">
        <input id="catalog-bg-url" placeholder="URL de la imagen (o elige desde la biblioteca)" style="flex:1">
        <button class="btn btn-secondary" onclick="openFilePicker()" style="white-space:nowrap;padding:10px 16px">Biblioteca Shopify</button>
      </div>
      <div id="catalog-bg-preview" style="display:none;margin-top:8px">
        <img id="catalog-bg-img" style="max-height:80px;border:1px solid #e8e2d9;border-radius:4px" alt="Vista previa">
        <button onclick="clearBgImage()" style="background:none;border:none;color:#999;cursor:pointer;font-size:12px;margin-left:8px">✕ Quitar</button>
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
        <button class="filter-btn" onclick="setFilter('catalog','metafield')">Por metacampo</button>
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
      <div id="catalog-filter-metafield" class="filter-panel">
        <div class="row row-3">
          <label>Namespace <input id="catalog-meta-ns" placeholder="custom"></label>
          <label>Key <input id="catalog-meta-key" placeholder="material"></label>
          <label>Valor <input id="catalog-meta-val" placeholder="bronce" oninput="debounce(() => loadProducts('catalog'), 800)"></label>
        </div>
      </div>
      <div class="loading" id="catalog-loading">Cargando productos…</div>
      <div class="status-filter" id="catalog-status-filter" style="display:none;margin-top:12px">
        <button class="status-btn active" onclick="filterByStatus('catalog','all',this)">Todos</button>
        <button class="status-btn" onclick="filterByStatus('catalog','active',this)">Activos</button>
        <button class="status-btn" onclick="filterByStatus('catalog','draft',this)">Borrador</button>
      </div>
      <div class="product-list" id="catalog-products"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="selected-count" id="catalog-count"></div>
        <button class="select-all-btn" id="catalog-select-all" onclick="toggleSelectAll('catalog')" style="display:none">Seleccionar todos</button>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn btn-primary" onclick="generate('catalog')">Descargar catálogo</button>
      <button class="btn btn-secondary" onclick="generate('catalog', true)">Enviar a correo interno</button>
    </div>
    <div class="msg" id="catalog-msg"></div>
  </div>

  <!-- COTIZACIONES -->
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
        <button class="filter-btn" onclick="setFilter('quote','metafield')">Por metacampo</button>
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
      <div id="quote-filter-metafield" class="filter-panel">
        <div class="row row-3">
          <label>Namespace <input id="quote-meta-ns" placeholder="custom"></label>
          <label>Key <input id="quote-meta-key" placeholder="material"></label>
          <label>Valor <input id="quote-meta-val" placeholder="bronce" oninput="debounce(() => loadProducts('quote'), 800)"></label>
        </div>
      </div>
      <div class="loading" id="quote-loading">Cargando productos…</div>
      <div class="status-filter" id="quote-status-filter" style="display:none;margin-top:12px">
        <button class="status-btn active" onclick="filterByStatus('quote','all',this)">Todos</button>
        <button class="status-btn" onclick="filterByStatus('quote','active',this)">Activos</button>
        <button class="status-btn" onclick="filterByStatus('quote','draft',this)">Borrador</button>
      </div>
      <div class="product-list" id="quote-products"></div>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="selected-count" id="quote-count"></div>
        <button class="select-all-btn" id="quote-select-all" onclick="toggleSelectAll('quote')" style="display:none">Seleccionar todos</button>
      </div>
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

</div>

<!-- MODAL SELECTOR DE IMÁGENES -->
<div class="file-modal-overlay" id="file-modal-overlay" onclick="closeFilePicker(event)">
  <div class="file-modal">
    <div class="file-modal-header">
      <h3>Biblioteca de imágenes</h3>
      <button class="file-modal-close" onclick="closeFilePicker()">×</button>
    </div>
    <div style="padding:12px 20px;border-bottom:1px solid #e8e2d9">
      <input id="file-search" type="text" placeholder="Buscar por nombre de producto…"
        oninput="filterFiles(this.value)"
        style="width:100%;padding:9px 14px;border:1px solid #ddd6cc;font-size:13px;font-family:inherit;background:#fdfcfb;outline:none">
      <p style="font-size:11px;color:#9a7f5a;margin-top:6px">Sugerencia: busca la palabra "textura"</p>
    </div>
    <div class="file-modal-body">
      <div id="file-grid-container" class="file-modal-loading">Cargando imágenes…</div>
    </div>
  </div>
</div>

<script>
const collections = {};

async function init() {
  const res = await fetch('/api/collections');
  const data = await res.json();
  ['cert-collection','catalog-collection','quote-collection'].forEach(id => {
    const sel = document.getElementById(id);
    data.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.title;
      sel.appendChild(opt);
    });
  });
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
    const titleInput = prefix === 'catalog' ? 'catalog-title-filter' : prefix + '-title';
    const t = document.getElementById(titleInput).value.trim();
    if (!t) { loading.style.display = 'none'; return; }
    url += 'title=' + encodeURIComponent(t);
  } else if (activeFilter.includes('sku')) {
    const s = document.getElementById(prefix + '-sku').value.trim();
    if (!s) { loading.style.display = 'none'; return; }
    url += 'sku=' + encodeURIComponent(s);
  } else if (activeFilter.includes('metacampo')) {
    const ns = document.getElementById(prefix + '-meta-ns').value.trim();
    const key = document.getElementById(prefix + '-meta-key').value.trim();
    const val = document.getElementById(prefix + '-meta-val').value.trim();
    if (!ns || !key || !val) { loading.style.display = 'none'; return; }
    url += 'metafield_namespace=' + encodeURIComponent(ns) + '&metafield_key=' + encodeURIComponent(key) + '&metafield_value=' + encodeURIComponent(val);
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

function statusBadge(status) {
  const map = { active: ['Activo','status-active'], draft: ['Borrador','status-draft'], archived: ['Archivado','status-archived'] };
  const [label, cls] = map[status] || ['—','status-draft'];
  return \`<span class="status-badge \${cls}">\${label}</span>\`;
}

function renderProducts(prefix, products, filter) {
  productCache[prefix] = products;
  const statusFilter = document.getElementById(prefix + '-status-filter');
  if (statusFilter) statusFilter.style.display = products.length ? 'flex' : 'none';

  const filtered = filter && filter !== 'all' ? products.filter(p => p.status === filter) : products;
  const list = document.getElementById(prefix + '-products');
  const count = document.getElementById(prefix + '-count');

  if (!filtered.length) {
    list.innerHTML = '<p style="padding:12px;color:#999;font-size:13px">No se encontraron productos.</p>';
    count.textContent = '';
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
      <th class="col-status">Disponible</th>
      <th class="col-status">Estado</th>
    </tr></thead>
    <tbody>
      \${filtered.map(p => {
        const sku = p.variants && p.variants[0] && p.variants[0].sku ? p.variants[0].sku : '—';
        const rawPrice = p.variants && p.variants[0] ? p.variants[0].price : '';
        const displayPrice = rawPrice ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(parseFloat(rawPrice)) : '—';
        const inventory = (p.variants || []).reduce((sum, v) => sum + (parseInt(v.inventory_quantity) || 0), 0);
        return \`<tr onclick="toggleRow(this)">
          <td class="col-check"><input type="checkbox" name="\${prefix}_product" value="\${p.id}" onchange="updateCount('\${prefix}');event.stopPropagation()"></td>
          <td>\${p.title}</td>
          <td class="col-sku">\${sku}</td>
          <td class="col-price" onclick="event.stopPropagation()">
            <div class="price-row"><span class="price-lbl">Precio</span><span class="price-display">\${displayPrice}</span></div>
            <div class="price-row"><span class="price-lbl">Editar</span><input type="number" class="price-override" data-id="\${p.id}" data-prefix="\${prefix}" value="\${rawPrice}" placeholder="Personalizado"></div>
          </td>
          <td style="font-size:13px;color:#555;text-align:center">\${inventory}</td>
          <td>\${statusBadge(p.status)}</td>
        </tr>\`;
      }).join('')}
    </tbody>
  </table>\`;
  count.textContent = filtered.length + ' producto(s) encontrado(s)';
  const btn = document.getElementById(prefix + '-select-all');
  if (btn) { btn.style.display = 'block'; btn.textContent = 'Seleccionar todos'; }
}

function toggleRow(tr) {
  const cb = tr.querySelector('input[type=checkbox]');
  cb.checked = !cb.checked;
  const prefix = cb.name.replace('_product', '');
  updateCount(prefix);
}

function filterByStatus(prefix, status, el) {
  document.querySelectorAll('#' + prefix + '-status-filter .status-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderProducts(prefix, productCache[prefix] || [], status);
}

function toggleSelectAll(prefix) {
  const checkboxes = document.querySelectorAll('[name="' + prefix + '_product"]');
  const allChecked = Array.from(checkboxes).every(c => c.checked);
  checkboxes.forEach(c => c.checked = !allChecked);
  const btn = document.getElementById(prefix + '-select-all');
  btn.textContent = allChecked ? 'Seleccionar todos' : 'Deseleccionar todos';
  updateCount(prefix);
}

function updateCount(prefix) {
  const all = document.querySelectorAll('[name="' + prefix + '_product"]');
  const checked = Array.from(all).filter(c => c.checked).length;
  document.getElementById(prefix + '-count').textContent = checked + ' producto(s) seleccionado(s)';
  const btn = document.getElementById(prefix + '-select-all');
  if (btn) btn.textContent = checked === all.length && all.length > 0 ? 'Deseleccionar todos' : 'Seleccionar todos';
}

function getSelectedIds(prefix) {
  return Array.from(document.querySelectorAll('[name="' + prefix + '_product"]:checked')).map(c => c.value);
}

function showMsg(prefix, text, type) {
  const el = document.getElementById(prefix + '-msg');
  el.textContent = text; el.className = 'msg ' + type; el.style.display = 'block';
  setTimeout(() => el.style.display = 'none', 5000);
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
  } else {
    const ids = getSelectedIds(prefix);
    if (!ids.length) return showMsg(prefix, 'Seleccione al menos un producto.', 'err');
    body = { product_ids: ids };

    if (type === 'certificate') {
      body.to_name = document.getElementById('cert-to-name').value;
      body.to_email = document.getElementById('cert-to-email').value;
      body.send_email = !!body.to_email;
      const certOverrides = {};
      document.querySelectorAll('.price-override[data-prefix="cert"]').forEach(input => {
        if (input.value) certOverrides[input.dataset.id] = input.value;
      });
      body.price_overrides = certOverrides;
    }
    if (type === 'catalog') {
      body.title = document.getElementById('catalog-title').value || 'Catálogo';
      body.show_prices = document.getElementById('catalog-prices').checked ? 'true' : 'false';
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

init();

// ── File picker ───────────────────────────────────────────────────────────────
document.getElementById('catalog-bg-url').addEventListener('input', function() {
  updateBgPreview(this.value.trim());
});

function updateBgPreview(url) {
  const preview = document.getElementById('catalog-bg-preview');
  const img = document.getElementById('catalog-bg-img');
  if (url) { img.src = url; preview.style.display = 'block'; }
  else { preview.style.display = 'none'; }
}

function clearBgImage() {
  document.getElementById('catalog-bg-url').value = '';
  document.getElementById('catalog-bg-preview').style.display = 'none';
}

let fileCache = null;

function renderFileGrid(files) {
  const container = document.getElementById('file-grid-container');
  if (!files.length) {
    container.className = '';
    container.innerHTML = '<p style="padding:20px;color:#999;font-size:13px">No se encontraron imágenes.</p>';
    return;
  }
  container.className = 'file-grid';
  container.innerHTML = files.map(f =>
    \`<div class="file-thumb" onclick="selectBgImage('\${f.url}')" title="\${f.altText || ''}">
      <img src="\${f.url}" alt="\${f.altText || ''}" loading="lazy">
    </div>\`
  ).join('');
}

function filterFiles(query) {
  if (!fileCache) return;
  const q = query.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
  const filtered = q
    ? fileCache.filter(f => (f.altText || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').includes(q))
    : fileCache;
  renderFileGrid(filtered);
}

async function openFilePicker() {
  document.getElementById('file-modal-overlay').classList.add('open');
  document.getElementById('file-search').value = '';
  const container = document.getElementById('file-grid-container');

  if (fileCache) {
    renderFileGrid(fileCache);
    return;
  }

  container.className = 'file-modal-loading';
  container.innerHTML = 'Cargando imágenes…';
  try {
    const res = await fetch('/api/files');
    fileCache = await res.json();
    renderFileGrid(fileCache);
  } catch(e) {
    container.innerHTML = 'Error cargando imágenes.';
  }
}

function selectBgImage(url) {
  document.getElementById('catalog-bg-url').value = url;
  updateBgPreview(url);
  closeFilePicker();
}

function closeFilePicker(e) {
  if (e && e.target !== document.getElementById('file-modal-overlay')) return;
  document.getElementById('file-modal-overlay').classList.remove('open');
}
</script>
</body>
</html>`;
}
