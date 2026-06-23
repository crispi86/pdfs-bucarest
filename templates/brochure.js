function formatPrice(amount, currency = 'CLP') {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(parseFloat(amount));
}

function brochureHTML(products, options = {}) {
  const {
    companyName = '',
    responsable = '',
    cargo = '',
    correo = '',
    telefono = '',
    showPrices = false,
    texturaImage = '',
    contextoImage = '',
    staticImages = {},
  } = options;

  const LOGO    = staticImages.logo || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';
  const TEXTURA = texturaImage || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura21.jpg?v=1772584942';
  const CONTEXTO = contextoImage || TEXTURA;

  const productPages = products.map((p, i) => {
    const image = p.images?.[0]?.src || null;
    const price = p.variants?.[0]?.price || null;
    const desc = p.body_html
      ? p.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
    const meta = p._metafields || {};

    const metaRows = [
      meta.origen    && `<div class="prod-meta-row"><strong>Origen:</strong> ${meta.origen}</div>`,
      meta.epocas    && `<div class="prod-meta-row"><strong>Época:</strong> ${meta.epocas}</div>`,
      (meta.alto || meta.ancho) && `<div class="prod-meta-row"><strong>Dimensiones:</strong> ${[meta.alto && `Alto ${meta.alto}`, meta.ancho && `Ancho ${meta.ancho}`].filter(Boolean).join(' · ')}</div>`,
      meta.materiales && `<div class="prod-meta-row"><strong>Materiales:</strong> ${meta.materiales}</div>`,
    ].filter(Boolean).join('');

    return `
    <div class="prod-page page">
      <div class="prod-img">
        ${image
          ? `<img src="${image}" alt="${p.title}">`
          : '<div class="prod-img-empty"></div>'}
      </div>
      <div class="prod-text">
        <div class="prod-num">${String(i + 1).padStart(2, '0')} — Pieza seleccionada</div>
        <h2 class="prod-name">${p.title}</h2>
        <div class="prod-divider"></div>
        ${showPrices && price ? `<div class="prod-price">${formatPrice(price)}</div>` : ''}
        ${desc ? `<p class="prod-desc">${desc.length > 320 ? desc.substring(0, 320) + '…' : desc}</p>` : ''}
        ${metaRows ? `<div class="prod-meta">${metaRows}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Hanken Grotesk", sans-serif !important; }
    body { background: #1a1a1a; color: #1a1a1a; }

    .page { page-break-after: always; width: 100%; min-height: 100vh; }
    .page:last-child { page-break-after: avoid; }

    /* ── PORTADA ── */
    .cover {
      min-height: 100vh; position: relative;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      background: #1a1a1a; padding: 80px 60px; text-align: center;
    }
    .cover-bg {
      position: absolute; inset: 0;
      background-image: url('${TEXTURA}');
      background-size: cover; background-position: center; opacity: 0.18;
    }
    .cover-content {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: center; gap: 26px; max-width: 560px;
    }
    .cover-logo { max-width: 200px; filter: brightness(0) invert(1); opacity: 0.92; }
    .cover-line { width: 48px; height: 1px; background: #9a7f5a; }
    .cover-tag { font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: #9a7f5a; }
    .cover-title { font-size: 38px; font-weight: 300; letter-spacing: 0.04em; text-transform: uppercase; line-height: 1.18; color: #fff; }
    .cover-sub { font-size: 14px; color: rgba(255,255,255,0.5); line-height: 1.8; font-weight: 300; max-width: 420px; }
    .cover-company {
      margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 22px; width: 100%;
      font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 0.14em; text-transform: uppercase;
    }
    .cover-company-name { font-size: 17px; color: rgba(255,255,255,0.82); font-weight: 300; letter-spacing: 0.05em; margin-top: 5px; }

    /* ── QUIÉNES SOMOS ── */
    .quienes { min-height: 100vh; display: flex; background: #f5f3f0; }
    .quienes-img {
      width: 55%; flex-shrink: 0;
      background-image: url('${CONTEXTO}');
      background-size: cover; background-position: center;
    }
    .quienes-text {
      flex: 1; padding: 80px 64px;
      display: flex; flex-direction: column; justify-content: center; gap: 22px;
    }
    .s-tag { font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: #9a7f5a; font-weight: 500; }
    .s-title { font-size: 27px; font-weight: 300; line-height: 1.32; color: #1a1a1a; }
    .s-body { font-size: 13px; line-height: 1.9; color: #666; }
    .s-line { width: 36px; height: 1px; background: #9a7f5a; }
    .s-stats { display: flex; gap: 32px; margin-top: 6px; }
    .s-stat-num { font-size: 28px; font-weight: 300; color: #1a1a1a; display: block; line-height: 1; }
    .s-stat-label { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #9a7f5a; margin-top: 5px; display: block; }

    /* ── SERVICIOS ── */
    .servicios {
      min-height: 100vh; background: #1a1a1a; color: #fff;
      padding: 80px 72px; display: flex; flex-direction: column; justify-content: center; gap: 52px;
    }
    .svc-header { display: flex; flex-direction: column; gap: 12px; }
    .svc-title { font-size: 30px; font-weight: 300; color: #fff; line-height: 1.25; }
    .svc-grid { display: grid; grid-template-columns: repeat(3, 1fr); }
    .svc-block { padding: 28px 28px 28px 0; border-right: 1px solid rgba(154,127,90,0.2); }
    .svc-block:last-child { border-right: none; padding-right: 0; }
    .svc-block:not(:first-child) { padding-left: 28px; }
    .svc-num { font-size: 10px; letter-spacing: 0.2em; color: #9a7f5a; margin-bottom: 14px; display: block; }
    .svc-name { font-size: 15px; font-weight: 300; color: #fff; margin-bottom: 14px; line-height: 1.35; }
    .svc-list { list-style: none; font-size: 12px; color: rgba(255,255,255,0.42); line-height: 2.2; }

    /* ── POR QUÉ ELEGIRNOS ── */
    .porque {
      min-height: 100vh; background: #fff; padding: 80px 80px;
      display: flex; flex-direction: column; justify-content: center; gap: 46px;
    }
    .porque-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 60px; }
    .porque-item { border-left: 2px solid #9a7f5a; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
    .porque-title { font-size: 14px; font-weight: 500; color: #1a1a1a; }
    .porque-desc { font-size: 12px; color: #777; line-height: 1.8; }
    .porque-single { border-left: 2px solid #9a7f5a; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }

    /* ── EUROPA ── */
    .europa {
      min-height: 100vh; background: #1a1a1a;
      display: flex; align-items: center; justify-content: center; padding: 80px 80px; text-align: center;
    }
    .europa-content { display: flex; flex-direction: column; align-items: center; gap: 26px; max-width: 520px; }
    .europa-label { font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: #9a7f5a; }
    .europa-quote { font-size: 25px; font-weight: 300; color: #fff; line-height: 1.5; }
    .europa-line { width: 40px; height: 1px; background: #9a7f5a; }
    .europa-sub { font-size: 13px; color: rgba(255,255,255,0.42); line-height: 1.85; }

    /* ── PRODUCTOS ── */
    .prod-page { min-height: 100vh; display: flex; background: #f5f3f0; }
    .prod-img {
      width: 55%; flex-shrink: 0; background: #e8e4df;
      overflow: hidden; display: flex; align-items: center; justify-content: center;
    }
    .prod-img img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .prod-img-empty { width: 100%; min-height: 400px; background: #ddd8d2; }
    .prod-text {
      flex: 1; padding: 80px 64px;
      display: flex; flex-direction: column; justify-content: center; gap: 18px;
      border-left: 1px solid #ddd8d2;
    }
    .prod-num { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a7f5a; }
    .prod-name { font-size: 22px; font-weight: 300; color: #1a1a1a; line-height: 1.35; }
    .prod-divider { width: 36px; height: 1px; background: #9a7f5a; }
    .prod-price { font-size: 16px; color: #9a7f5a; font-weight: 400; }
    .prod-desc { font-size: 12px; color: #777; line-height: 1.85; }
    .prod-meta { display: flex; flex-direction: column; gap: 5px; border-top: 1px solid #e8e2d9; padding-top: 16px; margin-top: 4px; }
    .prod-meta-row { font-size: 11px; color: #999; }
    .prod-meta-row strong { color: #555; font-weight: 500; margin-right: 5px; }

    /* ── PROCESO ── */
    .proceso {
      min-height: 100vh; background: #fff; padding: 80px 80px;
      display: flex; flex-direction: column; justify-content: center; gap: 46px;
    }
    .proceso-steps { display: flex; flex-direction: column; }
    .proceso-step { display: flex; align-items: flex-start; gap: 28px; padding: 24px 0; border-bottom: 1px solid #e8e2d9; }
    .proceso-step:first-child { border-top: 1px solid #e8e2d9; }
    .paso-num { font-size: 11px; letter-spacing: 0.18em; color: #9a7f5a; min-width: 28px; padding-top: 3px; flex-shrink: 0; }
    .paso-content { display: flex; flex-direction: column; gap: 4px; }
    .paso-title { font-size: 15px; font-weight: 400; color: #1a1a1a; }
    .paso-desc { font-size: 12px; color: #888; line-height: 1.7; }

    /* ── CONTACTO ── */
    .contacto {
      min-height: 100vh; background: #1a1a1a; position: relative;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 80px 60px; text-align: center;
    }
    .contacto-bg { position: absolute; inset: 0; background-image: url('${TEXTURA}'); background-size: cover; opacity: 0.1; }
    .contacto-content {
      position: relative; z-index: 1;
      display: flex; flex-direction: column; align-items: center; gap: 28px; max-width: 500px;
    }
    .contacto-logo { max-width: 160px; filter: brightness(0) invert(1); opacity: 0.85; }
    .contacto-line { width: 40px; height: 1px; background: #9a7f5a; }
    .contacto-tagline { font-size: 16px; font-weight: 300; color: rgba(255,255,255,0.68); line-height: 1.75; }
    .contacto-data { font-size: 13px; color: rgba(255,255,255,0.38); line-height: 2.1; }
    .contacto-data strong { color: rgba(255,255,255,0.75); font-weight: 400; }
    .contacto-resp {
      border-top: 1px solid rgba(255,255,255,0.1); padding-top: 24px; width: 100%;
      display: flex; flex-direction: column; gap: 3px;
    }
    .contacto-resp-name { font-size: 14px; color: #fff; font-weight: 300; }
    .contacto-resp-role { font-size: 10px; color: #9a7f5a; letter-spacing: 0.16em; text-transform: uppercase; margin-top: 1px; }
    .contacto-resp-detail { font-size: 12px; color: rgba(255,255,255,0.32); margin-top: 3px; }
  </style>
</head>
<body>

  <!-- PORTADA -->
  <div class="cover page">
    <div class="cover-bg"></div>
    <div class="cover-content">
      <img src="${LOGO}" alt="Bucarest Art &amp; Antiques" class="cover-logo">
      <div class="cover-line"></div>
      <div class="cover-tag">Propuesta Corporativa</div>
      <div class="cover-title">Soluciones Corporativas<br>en Arte &amp; Antigüedades</div>
      <div class="cover-sub">Mobiliario, decoración exclusiva y regalos corporativos para empresas que buscan diferenciarse.</div>
      ${companyName ? `
      <div class="cover-company">
        Propuesta para<br>
        <div class="cover-company-name">${companyName}</div>
      </div>` : ''}
    </div>
  </div>

  <!-- QUIÉNES SOMOS -->
  <div class="quienes page">
    <div class="quienes-img"></div>
    <div class="quienes-text">
      <div class="s-tag">Quiénes somos</div>
      <div class="s-title">36 años seleccionando piezas únicas con historia</div>
      <div class="s-line"></div>
      <div class="s-body">Somos una galería especializada en arte, antigüedades y objetos de colección seleccionados en Chile y Europa. Trabajamos con piezas únicas que aportan carácter, identidad y distinción a espacios residenciales y corporativos.</div>
      <div class="s-body">Cada objeto que ofrecemos ha sido elegido personalmente por nuestros directores, con criterio estético, histórico y de calidad excepcional.</div>
      <div class="s-stats">
        <div>
          <span class="s-stat-num">36</span>
          <span class="s-stat-label">años de experiencia</span>
        </div>
        <div>
          <span class="s-stat-num">2</span>
          <span class="s-stat-label">locales en Santiago</span>
        </div>
        <div>
          <span class="s-stat-num">∞</span>
          <span class="s-stat-label">piezas únicas</span>
        </div>
      </div>
    </div>
  </div>

  <!-- SERVICIOS PARA EMPRESAS -->
  <div class="servicios page">
    <div class="svc-header">
      <div class="s-tag">Servicios para empresas</div>
      <div class="svc-title">Todo lo que necesita para transformar<br>sus espacios y reconocimientos.</div>
    </div>
    <div class="svc-grid">
      <div class="svc-block">
        <span class="svc-num">01</span>
        <div class="svc-name">Mobiliario corporativo de alta gama</div>
        <ul class="svc-list">
          <li>Oficinas ejecutivas</li>
          <li>Salas de reuniones</li>
          <li>Recepciones y lobbies</li>
          <li>Hoteles y restaurantes</li>
          <li>Proyectos inmobiliarios premium</li>
        </ul>
      </div>
      <div class="svc-block">
        <span class="svc-num">02</span>
        <div class="svc-name">Decoración corporativa exclusiva</div>
        <ul class="svc-list">
          <li>Cuadros y arte chileno</li>
          <li>Esculturas y bronces</li>
          <li>Espejos y luminarias antiguas</li>
          <li>Alfombras persas</li>
          <li>Objetos decorativos únicos</li>
        </ul>
      </div>
      <div class="svc-block">
        <span class="svc-num">03</span>
        <div class="svc-name">Regalos corporativos exclusivos</div>
        <ul class="svc-list">
          <li>Clientes y socios VIP</li>
          <li>Reconocimientos empresariales</li>
          <li>Aniversarios corporativos</li>
          <li>Inauguraciones y eventos</li>
          <li>Regalos para equipos directivos</li>
        </ul>
      </div>
    </div>
  </div>

  <!-- POR QUÉ ELEGIRNOS -->
  <div class="porque page">
    <div>
      <div class="s-tag">Por qué elegirnos</div>
      <div class="s-title" style="margin-top:10px">Lo que nos diferencia de cualquier<br>proveedor de decoración.</div>
    </div>
    <div class="porque-grid">
      <div class="porque-item">
        <div class="porque-title">Piezas únicas, no masivas</div>
        <div class="porque-desc">Cada objeto es una búsqueda y selección personal. No trabajamos con productos replicados ni industriales.</div>
      </div>
      <div class="porque-item">
        <div class="porque-title">Historia y autenticidad</div>
        <div class="porque-desc">Cada pieza posee una historia y un valor cultural que la diferencia radicalmente de cualquier artículo de producción en serie.</div>
      </div>
      <div class="porque-item">
        <div class="porque-title">Curaduría especializada</div>
        <div class="porque-desc">Seleccionamos personalmente cada objeto con criterio estético y de calidad, construido durante 36 años de trayectoria.</div>
      </div>
      <div class="porque-item">
        <div class="porque-title">Importación directa desde Europa</div>
        <div class="porque-desc">Viajes periódicos a Francia y Europa para traer antigüedades y arte exclusivo que no está disponible en el mercado local.</div>
      </div>
    </div>
    <div class="porque-single">
      <div class="porque-title">Atención personalizada</div>
      <div class="porque-desc">Asesoría según presupuesto, espacio y objetivos del proyecto. Acompañamos cada proceso desde la selección hasta la entrega e instalación en sus instalaciones.</div>
    </div>
  </div>

  <!-- EUROPA -->
  <div class="europa page">
    <div class="europa-content">
      <div class="europa-label">Selección e importación directa</div>
      <div class="europa-line"></div>
      <div class="europa-quote">Viajamos a Europa para traerle lo que no puede encontrar en ningún otro lugar de Chile.</div>
      <div class="europa-line"></div>
      <div class="europa-sub">Nuestros directores recorren personalmente los mercados de antigüedades y galerías de Francia, España e Italia, seleccionando piezas que combinan historia, calidad y exclusividad. Este atributo es imposible de replicar y nos posiciona muy por encima de cualquier tienda de decoración tradicional.</div>
    </div>
  </div>

  <!-- PIEZAS SELECCIONADAS -->
  ${productPages}

  <!-- PROCESO DE TRABAJO -->
  <div class="proceso page">
    <div>
      <div class="s-tag">Proceso de trabajo</div>
      <div class="s-title" style="margin-top:10px">Así trabajamos con cada empresa.</div>
    </div>
    <div class="proceso-steps">
      <div class="proceso-step">
        <div class="paso-num">01</div>
        <div class="paso-content">
          <div class="paso-title">Reunión inicial</div>
          <div class="paso-desc">Conocemos su empresa, sus espacios y sus objetivos. Presencial en nuestras tiendas o por videollamada.</div>
        </div>
      </div>
      <div class="proceso-step">
        <div class="paso-num">02</div>
        <div class="paso-content">
          <div class="paso-title">Identificación de necesidades</div>
          <div class="paso-desc">Definimos el tipo de piezas, ambientes a decorar o regalos requeridos, junto con el presupuesto disponible.</div>
        </div>
      </div>
      <div class="proceso-step">
        <div class="paso-num">03</div>
        <div class="paso-content">
          <div class="paso-title">Selección de propuestas</div>
          <div class="paso-desc">Elaboramos una selección curada especialmente para usted a partir de nuestro catálogo y stock disponible.</div>
        </div>
      </div>
      <div class="proceso-step">
        <div class="paso-num">04</div>
        <div class="paso-content">
          <div class="paso-title">Presentación y cotización</div>
          <div class="paso-desc">Le presentamos las piezas con detalle fotográfico y condiciones comerciales claras, sin compromisos.</div>
        </div>
      </div>
      <div class="proceso-step">
        <div class="paso-num">05</div>
        <div class="paso-content">
          <div class="paso-title">Entrega e instalación</div>
          <div class="paso-desc">Coordinamos la entrega en sus instalaciones con el cuidado y atención que cada pieza merece.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- CONTACTO -->
  <div class="contacto page">
    <div class="contacto-bg"></div>
    <div class="contacto-content">
      <img src="${LOGO}" alt="Bucarest Art &amp; Antiques" class="contacto-logo">
      <div class="contacto-tagline">Transformamos espacios corporativos en experiencias memorables a través de piezas únicas con historia.</div>
      <div class="contacto-line"></div>
      <div class="contacto-data">
        <strong>Bucarest Art &amp; Antiques</strong><br>
        RUT: 76.121.552-3<br>
        ventas@bucarestart.cl · www.bucarestart.cl<br>
        +56 9 3342 3442
      </div>
      ${responsable ? `
      <div class="contacto-resp">
        <div class="contacto-resp-name">${responsable}</div>
        ${cargo ? `<div class="contacto-resp-role">${cargo}</div>` : ''}
        ${(correo || telefono) ? `<div class="contacto-resp-detail">${[correo, telefono].filter(Boolean).join(' · ')}</div>` : ''}
      </div>` : ''}
    </div>
  </div>

</body>
</html>`;
}

module.exports = { brochureHTML };
