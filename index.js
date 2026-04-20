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
    scope: 'read_products,read_orders',
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
    const pinturaId = process.env.PINTURA_COLLECTION_ID;
    const pinturaProducts = await shopify.getProductsByCollection(pinturaId);
    const pinturaIds = new Set(pinturaProducts.map(p => p.id));

    const pinturaItems = (order.line_items || []).filter(item => pinturaIds.has(item.product_id));
    if (pinturaItems.length === 0) return;

    const customer = order.customer || {};
    const customerName = customer.first_name
      ? `${customer.first_name} ${customer.last_name || ''}`.trim()
      : 'Cliente';
    const customerEmail = customer.email;

    const lineItems = pinturaItems.map(item => ({
      title: item.title,
      image: item.image?.src || null,
      price: parseFloat(item.price),
      currency: order.currency || 'CLP',
      description: null,
    }));

    const html = certificateHTML(lineItems);
    const pdf = await generatePDF(html);

    if (customerEmail) {
      await sendCertificate(customerEmail, customerName, pdf, pinturaItems.map(i => i.title).join(', '));
    }

    console.log(`✅ Certificado enviado para orden ${order.order_number}`);
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
    const collections = await shopify.getCollections();
    res.json(collections);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/products', async (req, res) => {
  try {
    const { collection_id, tag, title, metafield_namespace, metafield_key, metafield_value } = req.query;
    let products = [];
    if (collection_id) products = await shopify.getProductsByCollection(collection_id);
    else if (tag) products = await shopify.getProductsByTag(tag);
    else if (title) products = await shopify.getProductsByTitle(title);
    else if (metafield_namespace && metafield_key && metafield_value)
      products = await shopify.getProductsByMetafield(metafield_namespace, metafield_key, metafield_value);
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Generar certificado manual ────────────────────────────────────────────────
app.post('/generate/certificate', async (req, res) => {
  try {
    console.log('BODY recibido:', JSON.stringify(req.body));
    const { product_ids, send_email, to_email, to_name } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const lineItems = await Promise.all(ids.map(async id => {
      const p = await shopify.getProductById(id);
      return {
        title: p.title,
        image: p.images?.[0]?.src || null,
        price: parseFloat(p.variants?.[0]?.price || 0),
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
    const { product_ids, title, show_prices, send_email } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const products = await Promise.all(ids.map(id => shopify.getProductById(id)));
    const html = catalogHTML(products, { title: title || 'Catálogo', showPrices: show_prices !== 'false' });
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
    const { product_ids, client_name, client_email, client_rut, client_company, valid_days, notes, send_email } = req.body;
    const ids = Array.isArray(product_ids) ? product_ids : [product_ids];

    const products = await Promise.all(ids.map(id => shopify.getProductById(id)));
    const html = quoteHTML(products, {
      clientName: client_name, clientEmail: client_email,
      clientRut: client_rut, clientCompany: client_company,
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
    .product-list{max-height:320px;overflow-y:auto;border:1px solid #e8e2d9;background:#fdfcfb}
    .product-item{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #f0ece6;cursor:pointer;transition:background 0.1s}
    .product-item:hover{background:#faf8f5}
    .product-item img{width:40px;height:40px;object-fit:cover;border:1px solid #e8e2d9;flex-shrink:0}
    .product-item span{font-size:13px;color:#333;flex:1}
    .product-item input[type=checkbox]{width:16px;height:16px;accent-color:#9a7f5a;flex-shrink:0}
    .selected-count{font-size:12px;color:#9a7f5a;margin:10px 0}
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
    <p class="subtitle">Los certificados se envían automáticamente al vender productos de la colección Pintura. También puede generarlos manualmente aquí.</p>

    <div class="card">
      <span class="section-label">Seleccionar productos</span>
      <div id="cert-filters" class="filter-row">
        <button class="filter-btn active" onclick="setFilter('cert','collection')">Por colección</button>
        <button class="filter-btn" onclick="setFilter('cert','tag')">Por tag</button>
        <button class="filter-btn" onclick="setFilter('cert','title')">Por título</button>
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
      <div class="loading" id="cert-loading">Cargando productos…</div>
      <div class="product-list" id="cert-products" style="margin-top:12px"></div>
      <div class="selected-count" id="cert-count"></div>
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
      <span class="section-label">Seleccionar productos</span>
      <div id="catalog-filters" class="filter-row">
        <button class="filter-btn active" onclick="setFilter('catalog','collection')">Por colección</button>
        <button class="filter-btn" onclick="setFilter('catalog','tag')">Por tag</button>
        <button class="filter-btn" onclick="setFilter('catalog','title')">Por título</button>
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
      <div id="catalog-filter-metafield" class="filter-panel">
        <div class="row row-3">
          <label>Namespace <input id="catalog-meta-ns" placeholder="custom"></label>
          <label>Key <input id="catalog-meta-key" placeholder="material"></label>
          <label>Valor <input id="catalog-meta-val" placeholder="bronce" oninput="debounce(() => loadProducts('catalog'), 800)"></label>
        </div>
      </div>
      <div class="loading" id="catalog-loading">Cargando productos…</div>
      <div class="product-list" id="catalog-products" style="margin-top:12px"></div>
      <div class="selected-count" id="catalog-count"></div>
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
        <label>RUT <input id="quote-rut" placeholder="Ej: 12.345.678-9"></label>
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
      <div class="loading" id="quote-loading">Cargando productos…</div>
      <div class="product-list" id="quote-products" style="margin-top:12px"></div>
      <div class="selected-count" id="quote-count"></div>
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

function renderProducts(prefix, products) {
  const list = document.getElementById(prefix + '-products');
  const count = document.getElementById(prefix + '-count');
  if (!products.length) {
    list.innerHTML = '<p style="padding:12px;color:#999;font-size:13px">No se encontraron productos.</p>';
    count.textContent = '';
    return;
  }
  list.innerHTML = products.map(p => {
    const img = p.images && p.images[0] ? p.images[0].src : '';
    return \`<label class="product-item">
      <input type="checkbox" name="\${prefix}_product" value="\${p.id}" onchange="updateCount('\${prefix}')">
      \${img ? \`<img src="\${img}" alt="">\` : '<div style="width:40px;height:40px;background:#f0ece8;flex-shrink:0"></div>'}
      <span>\${p.title}</span>
    </label>\`;
  }).join('');
  count.textContent = products.length + ' productos encontrados';
}

function updateCount(prefix) {
  const checked = document.querySelectorAll('[name="' + prefix + '_product"]:checked').length;
  document.getElementById(prefix + '-count').textContent = checked + ' producto(s) seleccionado(s)';
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
    }
    if (type === 'catalog') {
      body.title = document.getElementById('catalog-title').value || 'Catálogo';
      body.show_prices = document.getElementById('catalog-prices').checked ? 'true' : 'false';
      body.send_email = sendEmail;
    }
    if (type === 'quote') {
      body.client_name = document.getElementById('quote-name').value;
      body.client_email = document.getElementById('quote-email').value;
      body.client_rut = document.getElementById('quote-rut').value;
      body.client_company = document.getElementById('quote-company').value;
      body.valid_days = document.getElementById('quote-days').value;
      body.notes = document.getElementById('quote-notes').value;
      body.send_email = sendEmail;
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
</script>
</body>
</html>`;
}
