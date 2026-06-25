function quoteHTML(products, options = {}) {
  function spanishDate() {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const now = new Date();
    return { dayNumber: now.getDate(), monthName: months[now.getMonth()], year: now.getFullYear() };
  }

  function formatPrice(amount, currency = 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(amount);
  }

  const {
    folio = '',
    clientName = '', clientEmail = '', clientRut = '', clientCompany = '',
    clientRazonSocial = '', clientDireccion = '', validDays = 7, notes = '',
    productsPerPage = 3, showLinks = false, showDescription = true, showSku = false,
    staticImages = {},
  } = options;

  const LOGO = staticImages.logo || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';

  const { dayNumber, monthName, year } = spanishDate();
  const quoteNumber = folio || `COT-${Date.now().toString().slice(-6)}`;
  const STORE_URL = 'https://www.bucarestart.cl';
  const ppp = Math.min(Math.max(parseInt(productsPerPage) || 3, 1), 3);

  let total = 0;
  const enriched = products.map(p => {
    const price = p.variants?.[0] ? parseFloat(p.variants[0].price) : 0;
    const currency = p.variants?.[0]?.presentment_prices?.[0]?.price?.currency_code || 'CLP';
    const image = p.images?.[0]?.src || null;
    const sku = p.variants?.[0]?.sku || null;
    const productUrl = (showLinks && p.handle) ? `${STORE_URL}/products/${p.handle}` : null;
    total += price;
    return { p, price, currency, image, sku, productUrl };
  });

  const mainCurrency = enriched.length > 0 ? enriched[0].currency : 'CLP';

  // ── Layout 1: producto a página completa ─────────────────────────────────────
  function renderFull({ p, price, currency, image, sku, productUrl }) {
    return `
      <div class="pf-product">
        ${image
          ? `<div class="pf-img-wrap"><img src="${image}" class="pf-img" alt="${p.title}"></div>`
          : '<div class="pf-img-placeholder"></div>'}
        <div class="pf-detail">
          <h2 class="pf-title">${p.title}</h2>
          ${showSku && sku ? `<div class="q-sku">SKU: ${sku}</div>` : ''}
          ${showDescription && p.body_html ? `<div class="pf-desc">${p.body_html}</div>` : ''}
          <div class="pf-price">${price > 0 ? formatPrice(price, currency) : '—'} <span class="iva-tag">IVA incluido</span></div>
          ${productUrl ? `<a href="${productUrl}" class="pf-link" target="_blank">Ver en tienda →</a>` : ''}
        </div>
      </div>`;
  }

  // ── Layout 2: dos columnas ────────────────────────────────────────────────────
  function renderCard({ p, price, currency, image, sku, productUrl }) {
    return `
      <div class="pc-card">
        ${image
          ? `<div class="pc-img-wrap"><img src="${image}" class="pc-img" alt="${p.title}"></div>`
          : '<div class="pc-img-placeholder"></div>'}
        <div class="pc-body">
          <div class="pc-title">${p.title}</div>
          ${showSku && sku ? `<div class="q-sku">SKU: ${sku}</div>` : ''}
          ${showDescription && p.body_html ? `<div class="pc-desc">${p.body_html}</div>` : ''}
          <div class="pc-price">${price > 0 ? formatPrice(price, currency) : '—'} <span class="iva-tag">IVA incluido</span></div>
          ${productUrl ? `<a href="${productUrl}" class="pc-link" target="_blank">Ver en tienda →</a>` : ''}
        </div>
      </div>`;
  }

  // ── Layout 3: tabla compacta ──────────────────────────────────────────────────
  function renderRow({ p, price, currency, image, sku, productUrl }) {
    return `
      <tr>
        <td class="q-td q-td--img">
          ${image ? `<img src="${image}" alt="${p.title}" class="q-product-img">` : ''}
        </td>
        <td class="q-td">
          <strong>${p.title}</strong>
          ${showSku && sku ? `<div class="q-sku">SKU: ${sku}</div>` : ''}
          ${showDescription && p.body_html ? `<div class="q-desc">${p.body_html}</div>` : ''}
          ${productUrl ? `<a href="${productUrl}" class="q-btn-link" target="_blank">Ver en tienda →</a>` : ''}
        </td>
        <td class="q-td q-td--price">${price > 0 ? formatPrice(price, currency) : '—'}<br><span class="iva-tag">IVA incluido</span></td>
      </tr>`;
  }

  // ── Construir sección de productos ────────────────────────────────────────────
  let productSection = '';

  if (ppp === 1) {
    productSection = enriched.map((item, i) => `
      <div class="${i < enriched.length - 1 ? 'pb-page' : ''}">
        ${renderFull(item)}
      </div>`).join('');
  } else if (ppp === 2) {
    const groups = [];
    for (let i = 0; i < enriched.length; i += 2) groups.push(enriched.slice(i, i + 2));
    productSection = groups.map((grp, i) => `
      <div class="pc-grid${i < groups.length - 1 ? ' pb-page' : ''}">
        ${grp.map(item => renderCard(item)).join('')}
      </div>`).join('');
  } else {
    productSection = `
      <table>
        <thead>
          <tr>
            <th class="q-th" colspan="2">Pieza</th>
            <th class="q-th q-th--price">Precio</th>
          </tr>
        </thead>
        <tbody>${enriched.map(item => renderRow(item)).join('')}</tbody>
      </table>`;
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { font-family: "Hanken Grotesk", sans-serif !important; box-sizing: border-box; }
    body { margin: 0; padding: 40px; background: #fff; color: #333; font-size: 14px; }

    /* ── Header ─────────────────────────────────────────────────────────────── */
    .q-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 1px solid #e8e2d9; padding-bottom: 28px; }
    .q-logo { max-width: 180px; }
    .q-meta { text-align: right; }
    .q-meta h1 { font-size: 22px; font-weight: 400; color: #1a1a1a; margin: 0 0 6px; letter-spacing: 0.08em; text-transform: uppercase; }
    .q-meta-detail { font-size: 12px; color: #888; line-height: 1.8; }
    .q-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .q-party-label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 8px; }
    .q-party-info { font-size: 13px; line-height: 1.8; color: #444; }

    /* ── Shared ──────────────────────────────────────────────────────────────── */
    .q-sku { font-size: 11px; color: #bbb; margin-top: 3px; letter-spacing: 0.04em; }
    .iva-tag { font-size: 11px; color: #bbb; font-weight: 400; vertical-align: middle; }
    .q-desc { font-size: 12px; color: #888; line-height: 1.5; margin-top: 4px; }
    .q-desc p { margin: 0; }
    .pb-page { page-break-after: always; }

    /* ── Layout 1/2: page break on intro ─────────────────────────────────────── */
    .layout-1 .q-intro, .layout-2 .q-intro { page-break-after: always; }

    /* ── Layout 1: imagen arriba centrada, texto abajo ──────────────────────── */
    .pf-product { display: flex; flex-direction: column; min-height: 930px; }
    .pf-img-wrap { flex: 0 0 530px; display: flex; align-items: center; justify-content: center; padding: 20px; background: #faf9f7; }
    .pf-img { max-width: 88%; max-height: 490px; object-fit: contain; }
    .pf-img-placeholder { flex: 0 0 530px; background: #f5f3f0; }
    .pf-detail { flex: 1; padding: 28px 0 20px; border-top: 2px solid #e8e2d9; }
    .pf-title { font-size: 22px; font-weight: 400; color: #1a1a1a; margin: 0 0 10px; line-height: 1.3; }
    .pf-desc { font-size: 13px; color: #666; line-height: 1.7; margin: 12px 0; }
    .pf-desc p { margin: 0; }
    .pf-price { font-size: 26px; font-weight: 600; color: #1a1a1a; margin: 20px 0 14px; }
    .pf-link { display: inline-block; padding: 11px 22px; background: #1a1a1a; color: #fff !important; text-decoration: none; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }

    /* ── Layout 2: dos filas, imagen izquierda + texto derecha ──────────────── */
    .pc-grid { display: flex; flex-direction: column; gap: 16px; }
    .pc-card { display: flex; flex-direction: row; min-height: 430px; border: 1px solid #e8e2d9; }
    .pc-img-wrap { flex: 0 0 42%; display: flex; align-items: center; justify-content: center; background: #faf9f7; padding: 20px; }
    .pc-img { max-width: 100%; max-height: 390px; object-fit: contain; }
    .pc-img-placeholder { flex: 0 0 42%; background: #f5f3f0; }
    .pc-body { flex: 1; padding: 28px 32px; display: flex; flex-direction: column; justify-content: center; }
    .pc-title { font-size: 17px; font-weight: 500; color: #1a1a1a; margin-bottom: 8px; line-height: 1.3; }
    .pc-desc { font-size: 13px; color: #777; line-height: 1.6; margin: 8px 0; }
    .pc-desc p { margin: 0; }
    .pc-price { font-size: 20px; font-weight: 600; color: #1a1a1a; margin-top: 20px; border-top: 1px solid #e8e2d9; padding-top: 14px; }
    .pc-link { display: inline-block; margin-top: 14px; padding: 11px 22px; background: #1a1a1a; color: #fff !important; text-decoration: none; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
    .q-btn-link { display: inline-block; margin-top: 8px; padding: 8px 16px; background: #1a1a1a; color: #fff !important; text-decoration: none; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }

    /* ── Layout 3: tabla compacta ────────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .q-th { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; padding: 10px 12px; border-bottom: 2px solid #e8e2d9; text-align: left; }
    .q-th--price { text-align: right; }
    .q-td { padding: 16px 12px; border-bottom: 1px solid #f0ece6; vertical-align: top; }
    .q-td--img { width: 70px; }
    .q-td--price { text-align: right; white-space: nowrap; font-weight: 500; color: #1a1a1a; }
    .q-product-img { width: 60px; height: 60px; object-fit: cover; border: 1px solid #e8e2d9; }
    .q-title-link { color: #1a1a1a !important; text-decoration: none; border-bottom: 1px solid #c9a96e; }

    /* ── Resumen ──────────────────────────────────────────────────────────────── */
    .q-total-row { display: flex; justify-content: flex-end; margin-bottom: 32px; }
    .q-total-box { border: 1px solid #e8e2d9; padding: 16px 24px; min-width: 220px; }
    .q-total-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 6px; }
    .q-total-amount { font-size: 22px; font-weight: 600; color: #1a1a1a; }
    .q-notes { background: #faf9f7; border: 1px solid #e8e2d9; padding: 16px 20px; margin-bottom: 32px; font-size: 13px; color: #666; line-height: 1.6; page-break-inside: avoid; }
    .q-notes-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 6px; }
    .q-validity { font-size: 12px; color: #999; margin-bottom: 24px; }
    .q-footer { text-align: center; font-size: 11px; color: #bbb; border-top: 1px solid #e8e2d9; padding-top: 20px; letter-spacing: 0.04em; page-break-inside: avoid; }
  </style>
</head>
<body class="layout-${ppp}">

  <div class="q-intro">
    <div class="q-header">
      <img class="q-logo" src="${LOGO}" alt="Bucarest Art & Antiques">
      <div class="q-meta">
        <h1>Cotización</h1>
        <div class="q-meta-detail">
          N° ${quoteNumber}<br>
          Fecha: ${dayNumber} de ${monthName} de ${year}<br>
          Validez: ${validDays} días
        </div>
      </div>
    </div>

    <div class="q-parties">
      <div>
        <div class="q-party-label">De</div>
        <div class="q-party-info">
          <strong>Bucarest Art &amp; Antiques</strong><br>
          RUT: 76.121.552-3<br>
          Tel: +569 33423442<br>
          ventas@bucarestart.cl
        </div>
      </div>
      ${clientName || clientCompany || clientEmail ? `
      <div>
        <div class="q-party-label">Para</div>
        <div class="q-party-info">
          ${clientName ? `<strong>${clientName}</strong><br>` : ''}
          ${clientCompany ? `${clientCompany}<br>` : ''}
          ${clientRazonSocial ? `${clientRazonSocial}<br>` : ''}
          ${clientRut ? `RUT: ${clientRut}<br>` : ''}
          ${clientDireccion ? `${clientDireccion}<br>` : ''}
          ${clientEmail ? `${clientEmail}` : ''}
        </div>
      </div>` : ''}
    </div>
  </div>

  ${productSection}

  <div class="q-total-row">
    <div class="q-total-box">
      <div class="q-total-label">Total</div>
      <div class="q-total-amount">${formatPrice(total, mainCurrency)}</div>
    </div>
  </div>

  ${notes ? `
  <div class="q-notes">
    <div class="q-notes-label">Notas</div>
    ${notes}
  </div>` : ''}

  <p class="q-validity">Esta cotización tiene una validez de ${validDays} días a partir de la fecha de emisión.</p>

  <div class="q-footer">
    Bucarest Art &amp; Antiques — RUT: 76.121.552-3 — Tel: +569 33423442 — ventas@bucarestart.cl — www.bucarestart.cl
  </div>

</body>
</html>`;
}

module.exports = { quoteHTML };
