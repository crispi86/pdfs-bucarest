function catalogHTML(products, options = {}) {
  const {
    title = 'Catálogo',
    showPrices = true,
    responsable = '',
    cargo = '',
    correo = '',
    telefono = '',
  } = options;

  const LOGO = 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';
  const TEXTURA = 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura21.jpg?v=1772584942';

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
    * { font-family: "Hanken Grotesk", sans-serif !important; box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #333; }

    /* ── Portada ── */
    .cover {
      width: 100vw;
      min-height: 100vh;
      page-break-after: always;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 60px 48px;
    }
    .cover-bg {
      position: absolute;
      inset: 0;
      background: url('${TEXTURA}') center center / cover no-repeat;
      z-index: 0;
    }
    .cover-content {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 28px;
      width: 100%;
    }
    .cover img { max-width: 220px; }
    .cover h1 {
      font-size: 36px;
      font-weight: 300;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #1a1a1a;
      line-height: 1.2;
    }
    .cover-divider {
      width: 60px;
      height: 1px;
      background: #9a7f5a;
    }
    .cover-store {
      font-size: 13px;
      color: #444;
      line-height: 2;
    }
    .cover-responsable {
      margin-top: 16px;
      border-top: 1px solid #d4c9b8;
      padding-top: 20px;
      width: 320px;
      text-align: left;
      font-size: 13px;
      color: #444;
      line-height: 2;
    }
    .cover-responsable strong { color: #1a1a1a; }

    /* ── Productos ── */
    .catalog-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0; }
    .catalog-item { padding: 28px 32px; border-right: 1px solid #e8e2d9; border-bottom: 1px solid #e8e2d9; page-break-inside: avoid; }
    .catalog-item:nth-child(2n) { border-right: none; }
    .catalog-image { width: 100%; aspect-ratio: 4/3; overflow: hidden; margin-bottom: 16px; background: #f5f3f0; }
    .catalog-image img { width: 100%; height: 100%; object-fit: cover; }
    .catalog-image--empty { background: #f0ede8; }
    .catalog-title { font-size: 15px; font-weight: 600; margin: 0 0 6px; color: #1a1a1a; }
    .catalog-price { font-size: 14px; color: #9a7f5a; margin: 0 0 10px; font-weight: 500; }
    .catalog-desc { font-size: 13px; color: #666; line-height: 1.6; }
    .catalog-desc p { margin: 0; }

    /* ── Contraportada ── */
    .backcover {
      width: 100vw;
      min-height: 100vh;
      page-break-before: always;
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 48px;
      text-align: center;
    }
    .backcover-bg {
      position: absolute;
      inset: 0;
      background: url('${TEXTURA}') center center / cover no-repeat;
      opacity: 0.35;
      z-index: 0;
    }
    .backcover-content {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 32px;
      width: 100%;
      max-width: 560px;
    }
    .backcover img { max-width: 180px; }
    .backcover h2 {
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #9a7f5a;
    }
    .backcover-store {
      font-size: 13px;
      color: #333;
      line-height: 2;
    }
    .backcover-divider { width: 40px; height: 1px; background: #9a7f5a; }
    .contact-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px 40px;
      text-align: left;
      width: 100%;
    }
    .contact-block { font-size: 12px; color: #444; line-height: 1.9; }
    .contact-block strong { font-size: 13px; color: #1a1a1a; display: block; margin-bottom: 2px; }
  </style>
</head>
<body>

  <!-- PORTADA -->
  <div class="cover">
    <div class="cover-bg"></div>
    <div class="cover-content">
      <img src="${LOGO}" alt="Bucarest Art & Antiques">
      <div class="cover-divider"></div>
      <h1>${title}</h1>
      <div class="cover-store">
        Bucarest Art &amp; Antiques<br>
        RUT: 76.121.552-3<br>
        ventas@bucarestart.cl — www.bucarestart.cl<br>
        Av. El Bosque Norte 0177, Las Condes, Santiago
      </div>
      ${responsable || cargo || correo || telefono ? `
      <div class="cover-responsable">
        ${responsable ? `<div><strong>Responsable:</strong> ${responsable}</div>` : ''}
        ${cargo ? `<div><strong>Cargo:</strong> ${cargo}</div>` : ''}
        ${correo ? `<div><strong>Correo:</strong> ${correo}</div>` : ''}
        ${telefono ? `<div><strong>Teléfono:</strong> ${telefono}</div>` : ''}
      </div>` : ''}
    </div>
  </div>

  <!-- PRODUCTOS -->
  <div class="catalog-grid">${items}</div>

  <!-- CONTRAPORTADA -->
  <div class="backcover">
    <div class="backcover-bg"></div>
    <div class="backcover-content">
      <img src="${LOGO}" alt="Bucarest Art & Antiques">
      <h2>Contacto</h2>
      <div class="backcover-store">
        Bucarest Art &amp; Antiques — RUT: 76.121.552-3<br>
        Av. El Bosque Norte 0177, Las Condes, Santiago<br>
        ventas@bucarestart.cl — www.bucarestart.cl<br>
        +56 9 3342 3442
      </div>
      <div class="backcover-divider"></div>
      <div class="contact-grid">
        ${responsable ? `<div class="contact-block">
          <strong>${cargo || 'Responsable'}: ${responsable}</strong>
          ${correo ? correo + '<br>' : ''}
          ${telefono ? telefono : ''}
        </div>` : ''}
        <div class="contact-block">
          <strong>Director Ejecutivo: Cristóbal Pizarro</strong>
          cristobal@bucarestart.cl<br>
          +56 9 3342 3442
        </div>
        <div class="contact-block">
          <strong>Director de Operaciones: Ricardo Pizarro</strong>
          ricardo@bucarestart.cl<br>
          +56 9 3092 3700
        </div>
      </div>
    </div>
  </div>

</body>
</html>`;
}

module.exports = { catalogHTML };
