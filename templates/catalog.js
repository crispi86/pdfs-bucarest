function catalogHTML(products, options = {}) {
  const { title = 'Catálogo', showPrices = true } = options;

  function formatPrice(amount, currency = 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(amount);
  }

  const items = products.map(p => {
    const image = p.images && p.images[0] ? p.images[0].src : null;
    const price = p.variants && p.variants[0] ? p.variants[0].price : null;
    const currency = p.variants && p.variants[0] ? (p.variants[0].presentment_prices?.[0]?.price?.currency_code || 'CLP') : 'CLP';

    return `
      <div class="catalog-item">
        ${image ? `<div class="catalog-image"><img src="${image}" alt="${p.title}"></div>` : '<div class="catalog-image catalog-image--empty"></div>'}
        <div class="catalog-info">
          <h3 class="catalog-title">${p.title}</h3>
          ${showPrices && price ? `<p class="catalog-price">${formatPrice(price, currency)}</p>` : ''}
          ${p.body_html ? `<div class="catalog-desc">${p.body_html}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { font-family: "Hanken Grotesk", sans-serif !important; box-sizing: border-box; }
    body { margin: 0; padding: 0; background: #fff; color: #333; }
    .catalog-header { text-align: center; padding: 40px 40px 20px; border-bottom: 1px solid #e0d5c5; }
    .catalog-header img { max-width: 200px; margin-bottom: 16px; }
    .catalog-header h1 { font-size: 28px; font-weight: 400; color: #1a1a1a; margin: 0; letter-spacing: 0.05em; }
    .catalog-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
    .catalog-item { padding: 28px 32px; border-right: 1px solid #e8e2d9; border-bottom: 1px solid #e8e2d9; }
    .catalog-item:nth-child(2n) { border-right: none; }
    .catalog-image { width: 100%; aspect-ratio: 4/3; overflow: hidden; margin-bottom: 16px; background: #f5f3f0; }
    .catalog-image img { width: 100%; height: 100%; object-fit: cover; }
    .catalog-image--empty { background: #f0ede8; }
    .catalog-title { font-size: 15px; font-weight: 600; margin: 0 0 6px; color: #1a1a1a; }
    .catalog-price { font-size: 14px; color: #9a7f5a; margin: 0 0 10px; font-weight: 500; }
    .catalog-desc { font-size: 13px; color: #666; line-height: 1.6; }
    .catalog-desc p { margin: 0; }
    .catalog-footer { text-align: center; padding: 28px; font-size: 12px; color: #aaa; border-top: 1px solid #e8e2d9; letter-spacing: 0.05em; }
    @media print { .catalog-item { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="catalog-header">
    <img src="https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776" alt="Bucarest Art & Antiques">
    <h1>${title}</h1>
  </div>
  <div class="catalog-grid">${items}</div>
  <div class="catalog-footer">
    Bucarest Art &amp; Antiques — RUT: 76.121.552-3 — Tel: +569 33423442 — ventas@bucarestart.cl — www.bucarestart.cl
  </div>
</body>
</html>`;
}

module.exports = { catalogHTML };
