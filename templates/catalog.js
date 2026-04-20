function catalogHTML(products, options = {}) {
  const {
    title = 'Catálogo',
    showPrices = true,
    responsable = '',
    cargo = '',
    correo = '',
    telefono = '',
    bgImage = '',
    locations = [],
  } = options;

  const LOGO    = 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';
  const TEXTURA = bgImage || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura21.jpg?v=1772584942';

  function formatPrice(amount, currency = 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(parseFloat(amount));
  }

  const META_LABELS = {
    origen:           'Origen',
    epocas:           'Época',
    estilo_de_diseno: 'Estilo de diseño',
    materiales:       'Materiales',
    estado:           'Estado',
    ancho:            'Ancho',
    profundidad:      'Profundidad',
    alto:             'Alto',
  };

  function metaTable(meta = {}) {
    const rows = Object.entries(META_LABELS)
      .filter(([key]) => meta[key])
      .map(([key, label]) => `<tr><td class="meta-label">${label}</td><td class="meta-value">${meta[key]}</td></tr>`)
      .join('');
    return rows ? `<table class="meta-table">${rows}</table>` : '';
  }

  // Construir bloque de tiendas desde las ubicaciones de Shopify
  function storeAddressBlock() {
    if (locations && locations.length > 0) {
      return locations.map(loc => {
        const parts = [loc.address1, loc.city].filter(Boolean).join(', ');
        return `<div class="cover-location"><strong>${loc.name}</strong>${parts ? `<br>${parts}` : ''}</div>`;
      }).join('');
    }
    // Fallback
    return `<div>Av. El Bosque Norte 0177, Las Condes, Santiago</div>`;
  }

  function productRow(p, index) {
    const image    = p.images && p.images[0] ? p.images[0].src : null;
    const price    = p.variants && p.variants[0] ? p.variants[0].price : null;
    const currency = p.variants && p.variants[0]
      ? (p.variants[0].presentment_prices?.[0]?.price?.currency_code || 'CLP') : 'CLP';
    const meta     = p._metafields || {};
    const desc     = p.body_html ? p.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    const imgBlock = `<div class="prod-img-wrap">
      ${image
        ? `<img src="${image}" alt="${p.title}">`
        : '<div class="prod-img-empty"></div>'}
    </div>`;

    const textBlock = `<div class="prod-text">
      <h2 class="prod-title">${p.title}</h2>
      ${showPrices && price ? `<p class="prod-price">${formatPrice(price, currency)}</p>` : ''}
      ${desc ? `<p class="prod-desc">${desc}</p>` : ''}
      ${metaTable(meta)}
    </div>`;

    // Par → imagen izquierda | texto derecha; impar → texto izquierda | imagen derecha
    const [left, right] = index % 2 === 0
      ? [imgBlock, textBlock]
      : [textBlock, imgBlock];

    return `<div class="prod-row">${left}${right}</div>`;
  }

  // Agrupa en pares para que cada página tenga 2 productos
  const pairs = [];
  for (let i = 0; i < products.length; i += 2) {
    pairs.push(products.slice(i, i + 2));
  }

  const pages = pairs.map(pair => `
    <div class="prod-page">
      ${pair.map((p, j) => productRow(p, pairs.indexOf(pair) * 2 + j)).join('<div class="prod-divider"></div>')}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { font-family: "Hanken Grotesk", sans-serif !important; box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; color: #1a1a1a; }

    /* ── Portada ── */
    .cover {
      width: 100vw; min-height: 100vh; page-break-after: always;
      position: relative; display: flex; flex-direction: column;
      align-items: center; justify-content: center; text-align: center; padding: 60px 48px;
    }
    .cover-bg {
      position: absolute; inset: 0;
      background: url('${TEXTURA}') center center / cover no-repeat; z-index: 0;
    }
    .cover-content {
      position: relative; z-index: 1; display: flex; flex-direction: column;
      align-items: center; gap: 24px; width: 100%; max-width: 640px;
      background: rgba(255,255,255,0.55); padding: 52px 60px; border-radius: 4px;
    }
    .cover img { max-width: 240px; }
    .cover h1 { font-size: 44px; font-weight: 300; letter-spacing: 0.08em; text-transform: uppercase; color: #1a1a1a; line-height: 1.2; }
    .cover-divider { width: 60px; height: 1px; background: #9a7f5a; }
    .cover-web { font-size: 22px; font-weight: 300; letter-spacing: 0.06em; color: #1a1a1a; }
    .cover-social { display: flex; align-items: center; gap: 8px; font-size: 15px; color: #444; justify-content: center; }
    .cover-responsable { margin-top: 16px; border-top: 1px solid #d4c9b8; padding-top: 20px; width: 100%; text-align: left; font-size: 14px; color: #444; line-height: 2; }
    .cover-responsable strong { color: #1a1a1a; }

    /* ── Páginas de productos ── */
    .prod-page {
      page-break-after: always;
      display: flex; flex-direction: column;
      height: 100vh;
    }
    .prod-row {
      flex: 1;
      display: flex;
      align-items: stretch;
      overflow: hidden;
    }
    .prod-divider { height: 1px; background: #e8e2d9; margin: 0 32px; flex-shrink: 0; }
    .prod-img-wrap {
      width: 45%;
      flex-shrink: 0;
      overflow: hidden;
      background: #f5f3f0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .prod-img-wrap img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .prod-img-empty { width: 100%; height: 100%; background: #ede9e4; }
    .prod-text {
      flex: 1;
      padding: 40px 44px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 16px;
      border-left: 1px solid #e8e2d9;
    }
    .prod-row:nth-child(odd) .prod-text { border-left: none; border-right: 1px solid #e8e2d9; }
    .prod-title { font-size: 22px; font-weight: 400; color: #1a1a1a; line-height: 1.3; }
    .prod-price { font-size: 18px; color: #9a7f5a; font-weight: 500; }
    .prod-desc { font-size: 13px; color: #666; line-height: 1.7; }
    .meta-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .meta-label { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #9a7f5a; padding: 5px 0; width: 40%; vertical-align: top; }
    .meta-value { font-size: 13px; color: #444; padding: 5px 0; }

    /* ── Contraportada ── */
    .backcover {
      width: 100vw; min-height: 100vh; page-break-before: always;
      position: relative; display: flex; flex-direction: column;
      align-items: center; justify-content: center; padding: 60px 48px; text-align: center;
    }
    .backcover-bg { position: absolute; inset: 0; background: url('${TEXTURA}') center center / cover no-repeat; z-index: 0; }
    .backcover-content {
      position: relative; z-index: 1; display: flex; flex-direction: column;
      align-items: center; gap: 32px; width: 100%; max-width: 580px;
      background: rgba(255,255,255,0.88); padding: 52px 60px; border-radius: 4px;
    }
    .backcover img { max-width: 200px; }
    .backcover h2 { font-size: 14px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #9a7f5a; }
    .backcover-store { font-size: 14px; color: #333; line-height: 2.2; }
    .backcover-divider { width: 40px; height: 1px; background: #9a7f5a; }
    .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 40px; text-align: left; width: 100%; }
    .contact-block { font-size: 13px; color: #444; line-height: 1.9; }
    .contact-block strong { font-size: 14px; color: #1a1a1a; display: block; margin-bottom: 2px; }
    .stores-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 40px; text-align: left; width: 100%; border-top: 1px solid #e8e2d9; padding-top: 24px; }
    .store-block { font-size: 12px; color: #555; line-height: 1.8; }
    .store-block h4 { font-size: 13px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 6px; }
    .store-block .store-hours { margin-top: 8px; font-size: 11px; color: #777; line-height: 1.7; }
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
      <div class="cover-web">bucarestart.cl</div>
      <div class="cover-social">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9a7f5a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
          <circle cx="12" cy="12" r="4"/>
          <circle cx="17.5" cy="6.5" r="1" fill="#9a7f5a" stroke="none"/>
        </svg>
        @bucarestart
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
  ${pages}

  <!-- CONTRAPORTADA -->
  <div class="backcover">
    <div class="backcover-bg"></div>
    <div class="backcover-content">
      <img src="${LOGO}" alt="Bucarest Art & Antiques">
      <h2>Contacto</h2>
      <div class="backcover-store">
        Bucarest Art &amp; Antiques — RUT: 76.121.552-3<br>
        ventas@bucarestart.cl — www.bucarestart.cl<br>
        +56 9 3342 3442
      </div>
      <div class="backcover-divider"></div>
      <div class="contact-grid">
        ${responsable ? `<div class="contact-block">
          <strong>${cargo || 'Responsable'}: ${responsable}</strong>
          ${correo ? correo + '<br>' : ''}
          ${telefono || ''}
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
      <div class="stores-grid">
        <div class="store-block">
          <h4>Providencia</h4>
          Bucarest 034, esquina Av. Providencia.<br>
          Caracol Los Pájaros, locales 26 y 55,<br>
          Av. Providencia 2348.
          <div class="store-hours">
            Lun – Vie: 09:30 – 18:30 hrs.<br>
            Sáb: 10:00 – 14:00 hrs.<br>
            Dom y festivos: Cerrado.
          </div>
        </div>
        <div class="store-block">
          <h4>Lo Barnechea</h4>
          Av. Lo Barnechea 900.<br>
          A pasos de la Parroquia Santa Rosa<br>
          de Lo Barnechea y Av. Raúl Labbe.
          <div class="store-hours">
            Lun – Vie: 09:30 – 18:30 hrs.<br>
            Sáb: 10:00 – 14:00 hrs.<br>
            Dom y festivos: Cerrado.
          </div>
        </div>
      </div>
    </div>
  </div>

</body>
</html>`;
}

module.exports = { catalogHTML };
