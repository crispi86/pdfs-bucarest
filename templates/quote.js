function quoteHTML(products, options = {}) {
  const {
    clientName = '',
    clientEmail = '',
    clientRut = '',
    clientCompany = '',
    validDays = 7,
    notes = '',
  } = options;

  const { dayNumber, monthName, year } = spanishDate();

  function spanishDate() {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    const now = new Date();
    return { dayNumber: now.getDate(), monthName: months[now.getMonth()], year: now.getFullYear() };
  }

  function formatPrice(amount, currency = 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(amount);
  }

  const quoteNumber = `COT-${Date.now().toString().slice(-6)}`;

  let total = 0;
  const rows = products.map(p => {
    const price = p.variants && p.variants[0] ? parseFloat(p.variants[0].price) : 0;
    const currency = p.variants && p.variants[0] ? (p.variants[0].presentment_prices?.[0]?.price?.currency_code || 'CLP') : 'CLP';
    total += price;
    const image = p.images && p.images[0] ? p.images[0].src : null;
    return { p, price, currency, image };
  });

  const currency = rows.length > 0 ? rows[0].currency : 'CLP';

  const itemRows = rows.map(({ p, price, image }) => `
    <tr>
      <td class="q-td q-td--img">
        ${image ? `<img src="${image}" alt="${p.title}" class="q-product-img">` : ''}
      </td>
      <td class="q-td">
        <strong>${p.title}</strong>
        ${p.body_html ? `<div class="q-desc">${p.body_html}</div>` : ''}
      </td>
      <td class="q-td q-td--price">${price > 0 ? formatPrice(price, currency) : '—'}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { font-family: "Hanken Grotesk", sans-serif !important; box-sizing: border-box; }
    body { margin: 0; padding: 40px; background: #fff; color: #333; font-size: 14px; }
    .q-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 1px solid #e8e2d9; padding-bottom: 28px; }
    .q-logo { max-width: 180px; }
    .q-meta { text-align: right; }
    .q-meta h1 { font-size: 22px; font-weight: 400; color: #1a1a1a; margin: 0 0 6px; letter-spacing: 0.08em; text-transform: uppercase; }
    .q-meta-detail { font-size: 12px; color: #888; line-height: 1.8; }
    .q-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .q-party-label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 8px; }
    .q-party-info { font-size: 13px; line-height: 1.8; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .q-th { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; padding: 10px 12px; border-bottom: 2px solid #e8e2d9; text-align: left; }
    .q-th--price { text-align: right; }
    .q-td { padding: 16px 12px; border-bottom: 1px solid #f0ece6; vertical-align: top; }
    .q-td--img { width: 70px; }
    .q-td--price { text-align: right; white-space: nowrap; font-weight: 500; color: #1a1a1a; }
    .q-product-img { width: 60px; height: 60px; object-fit: cover; border: 1px solid #e8e2d9; }
    .q-desc { font-size: 12px; color: #888; line-height: 1.5; margin-top: 4px; }
    .q-desc p { margin: 0; }
    .q-total-row { display: flex; justify-content: flex-end; margin-bottom: 32px; }
    .q-total-box { border: 1px solid #e8e2d9; padding: 16px 24px; min-width: 220px; }
    .q-total-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 6px; }
    .q-total-amount { font-size: 22px; font-weight: 600; color: #1a1a1a; }
    .q-notes { background: #faf9f7; border: 1px solid #e8e2d9; padding: 16px 20px; margin-bottom: 32px; font-size: 13px; color: #666; line-height: 1.6; }
    .q-notes-label { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 6px; }
    .q-footer { text-align: center; font-size: 11px; color: #bbb; border-top: 1px solid #e8e2d9; padding-top: 20px; letter-spacing: 0.04em; }
    .q-validity { font-size: 12px; color: #999; margin-bottom: 24px; }
  </style>
</head>
<body>
  <div class="q-header">
    <img class="q-logo" src="https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776" alt="Bucarest Art & Antiques">
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
        ${clientRut ? `RUT: ${clientRut}<br>` : ''}
        ${clientEmail ? `${clientEmail}` : ''}
      </div>
    </div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th class="q-th" colspan="2">Pieza</th>
        <th class="q-th q-th--price">Precio</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="q-total-row">
    <div class="q-total-box">
      <div class="q-total-label">Total</div>
      <div class="q-total-amount">${formatPrice(total, currency)}</div>
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
