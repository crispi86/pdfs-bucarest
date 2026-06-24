function formatPrice(amount, currency = 'CLP') {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(parseFloat(amount));
}

function paragraphs(text) {
  return (text || '').split(/\n\n+/).filter(Boolean).map(p => `<p>${p.trim()}</p>`).join('\n');
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
    contextoImage = '',       // backward compat — se usa como fallback si no hay ctx por sección
    contextoImages = {},       // { quienes, servicios, porque, europa, proceso, contacto }
    staticImages = {},
    proyecto = '',
    productsPerPage = 1,
  } = options;

  const LOGO    = staticImages.logo || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';
  const TEXTURA = texturaImage || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura21.jpg?v=1772584942';
  const FALLBACK = contextoImage || '';

  const CTX = {
    quienes:   contextoImages.quienes   || FALLBACK,
    servicios: contextoImages.servicios || FALLBACK,
    porque:    contextoImages.porque    || FALLBACK,
    europa:    contextoImages.europa    || FALLBACK,
    proceso:   contextoImages.proceso   || FALLBACK,
    contacto:  contextoImages.contacto  || FALLBACK,
  };

  // Franja de imagen lateral reutilizable (inline style para URL dinámica)
  function sideImg(url, { width = '34%', overlay = 'rgba(15,10,8,0.52)' } = {}) {
    if (!url) return '';
    return `<div style="width:${width};flex-shrink:0;position:relative;overflow:hidden;background-image:url('${url}');background-size:cover;background-position:center"><div style="position:absolute;inset:0;background:${overlay}"></div></div>`;
  }

  // Página "El Proyecto" — solo si el usuario escribió algo
  const proyectoPage = proyecto.trim() ? `
  <div class="project-page page">
    <div class="project-left">
      <div class="project-label">El Proyecto</div>
      <div class="project-line"></div>
      ${companyName ? `<div class="project-company">${companyName}</div>` : ''}
    </div>
    <div class="project-right">
      <div class="project-body">${paragraphs(proyecto)}</div>
    </div>
  </div>` : '';

  // ── Páginas de producto ────────────────────────────────────────────────────
  function renderProdFull(p, i) {
    const image = p.images?.[0]?.src || null;
    const price = p.variants?.[0]?.price || null;
    const desc = p.body_html ? p.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const meta = p._metafields || {};
    const metaRows = [
      meta.origen     && `<div class="prod-meta-row"><strong>Origen:</strong> ${meta.origen}</div>`,
      meta.epocas     && `<div class="prod-meta-row"><strong>Época:</strong> ${meta.epocas}</div>`,
      (meta.alto || meta.ancho) && `<div class="prod-meta-row"><strong>Dimensiones:</strong> ${[meta.alto && `Alto ${meta.alto}`, meta.ancho && `Ancho ${meta.ancho}`].filter(Boolean).join(' · ')}</div>`,
      meta.materiales && `<div class="prod-meta-row"><strong>Materiales:</strong> ${meta.materiales}</div>`,
    ].filter(Boolean).join('');
    return `
    <div class="prod-page page">
      <div class="prod-img">
        ${image ? `<img src="${image}" alt="${p.title}">` : '<div class="prod-img-empty"></div>'}
      </div>
      <div class="prod-text">
        <div class="prod-num">${String(i + 1).padStart(2, '0')} — Pieza seleccionada</div>
        <h2 class="prod-name">${p.title}</h2>
        <div class="prod-divider"></div>
        ${showPrices && price ? `<div class="prod-price">${formatPrice(price)}</div>` : ''}
        ${desc ? `<p class="prod-desc">${desc.length > 380 ? desc.substring(0, 380) + '…' : desc}</p>` : ''}
        ${metaRows ? `<div class="prod-meta">${metaRows}</div>` : ''}
      </div>
    </div>`;
  }

  function renderProdCompact(p, i) {
    const image = p.images?.[0]?.src || null;
    const price = p.variants?.[0]?.price || null;
    const desc = p.body_html ? p.body_html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    const meta = p._metafields || {};
    const metaRows = [
      meta.origen && `<div class="prod-meta-row-s"><strong>Origen:</strong> ${meta.origen}</div>`,
      meta.epocas && `<div class="prod-meta-row-s"><strong>Época:</strong> ${meta.epocas}</div>`,
      (meta.alto || meta.ancho) && `<div class="prod-meta-row-s"><strong>Dim:</strong> ${[meta.alto && `Alto ${meta.alto}`, meta.ancho && `Ancho ${meta.ancho}`].filter(Boolean).join(' · ')}</div>`,
    ].filter(Boolean).join('');
    return `<div class="prod-row-2up">
      <div class="prod-img-s">
        ${image ? `<img src="${image}" alt="${p.title}">` : '<div style="width:100%;height:100%;background:#ddd8d2"></div>'}
      </div>
      <div class="prod-text-s">
        <div class="prod-num-s">${String(i + 1).padStart(2, '0')} — Pieza seleccionada</div>
        <div class="prod-name-s">${p.title}</div>
        <div class="prod-divider-s"></div>
        ${showPrices && price ? `<div class="prod-price-s">${formatPrice(price)}</div>` : ''}
        ${desc ? `<div class="prod-desc-s">${desc.length > 180 ? desc.substring(0, 180) + '…' : desc}</div>` : ''}
        ${metaRows ? `<div class="prod-meta-s">${metaRows}</div>` : ''}
      </div>
    </div>`;
  }

  let productPages = '';
  const ppp = parseInt(productsPerPage) || 1;
  if (ppp >= 2) {
    const pairs = [];
    for (let i = 0; i < products.length; i += 2) pairs.push(products.slice(i, i + 2));
    productPages = pairs.map((pair, pairIdx) =>
      `<div class="prod-page-2up page">${pair.map((p, j) => renderProdCompact(p, pairIdx * 2 + j)).join('')}</div>`
    ).join('');
  } else {
    productPages = products.map((p, i) => renderProdFull(p, i)).join('');
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: "Hanken Grotesk", sans-serif !important; }
    body { background: #1a1a1a; color: #1a1a1a; }

    /* Landscape A4: 297mm × 210mm */
    .page { page-break-after: always; width: 100%; min-height: 100vh; }
    .page:last-child { page-break-after: avoid; }

    /* ── PORTADA ── */
    .cover { min-height: 100vh; position: relative; display: flex; flex-direction: row; align-items: stretch; background: #1a1a1a; }
    .cover-bg-half { width: 48%; flex-shrink: 0; position: relative; overflow: hidden; }
    .cover-bg-img { position: absolute; inset: 0; background-image: url('${TEXTURA}'); background-size: cover; background-position: center; opacity: 0.35; }
    .cover-text-half { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 60px 72px 60px 64px; background: #1a1a1a; }
    .cover-logo { max-width: 180px; filter: brightness(0) invert(1); opacity: 0.88; margin-bottom: 36px; }
    .cover-line { width: 44px; height: 1px; background: #9a7f5a; margin-bottom: 28px; }
    .cover-tag { font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 16px; }
    .cover-title { font-size: 34px; font-weight: 300; letter-spacing: 0.03em; text-transform: uppercase; line-height: 1.2; color: #fff; margin-bottom: 20px; }
    .cover-sub { font-size: 13px; color: rgba(255,255,255,0.45); line-height: 1.85; font-weight: 300; max-width: 360px; }
    .cover-company { margin-top: 36px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 22px; font-size: 11px; color: rgba(255,255,255,0.35); letter-spacing: 0.14em; text-transform: uppercase; }
    .cover-company-name { font-size: 16px; color: rgba(255,255,255,0.82); font-weight: 300; letter-spacing: 0.05em; margin-top: 5px; }

    /* ── EL PROYECTO ── */
    .project-page { min-height: 100vh; display: flex; background: #f5f3f0; }
    .project-left { width: 34%; flex-shrink: 0; background: #1a1a1a; padding: 60px 52px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
    .project-label { font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: #9a7f5a; }
    .project-line { width: 36px; height: 1px; background: #9a7f5a; }
    .project-company { font-size: 22px; font-weight: 300; color: #fff; line-height: 1.35; margin-top: 8px; }
    .project-right { flex: 1; padding: 60px 72px 60px 60px; display: flex; flex-direction: column; justify-content: center; }
    .project-body { font-size: 14px; line-height: 2; color: #444; }
    .project-body p + p { margin-top: 18px; }

    /* ── QUIÉNES SOMOS ── */
    .quienes { min-height: 100vh; display: flex; background: #f5f3f0; }
    .quienes-img { width: 48%; flex-shrink: 0; background-size: cover; background-position: center; }
    .quienes-text { flex: 1; padding: 60px 72px 60px 60px; display: flex; flex-direction: column; justify-content: center; gap: 20px; }
    .s-tag { font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: #9a7f5a; font-weight: 500; }
    .s-title { font-size: 24px; font-weight: 300; line-height: 1.35; color: #1a1a1a; }
    .s-body { font-size: 12px; line-height: 1.9; color: #666; }
    .s-body p + p { margin-top: 12px; }
    .s-line { width: 36px; height: 1px; background: #9a7f5a; }
    .s-stats { display: flex; gap: 28px; margin-top: 4px; }
    .s-stat-num { font-size: 26px; font-weight: 300; color: #1a1a1a; display: block; line-height: 1; }
    .s-stat-label { font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: #9a7f5a; margin-top: 4px; display: block; }

    /* ── SERVICIOS ── */
    .servicios { min-height: 100vh; display: flex; flex-direction: row; align-items: stretch; }
    .servicios-content { flex: 1; background: #1a1a1a; color: #fff; padding: 52px 60px; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
    .svc-header { display: flex; flex-direction: column; gap: 10px; }
    .svc-intro { font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.85; max-width: 680px; }
    .svc-title { font-size: 26px; font-weight: 300; color: #fff; line-height: 1.25; }
    .svc-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; }
    .svc-block { padding: 24px 28px 24px 0; border-right: 1px solid rgba(154,127,90,0.2); }
    .svc-block:last-child { border-right: none; padding-right: 0; }
    .svc-block:not(:first-child) { padding-left: 28px; }
    .svc-num { font-size: 10px; letter-spacing: 0.2em; color: #9a7f5a; margin-bottom: 10px; display: block; }
    .svc-name { font-size: 13px; font-weight: 300; color: #fff; margin-bottom: 12px; line-height: 1.35; }
    .svc-list { list-style: none; font-size: 11px; color: rgba(255,255,255,0.4); line-height: 2.1; }

    /* ── POR QUÉ ELEGIRNOS ── */
    .porque { min-height: 100vh; display: flex; flex-direction: row; align-items: stretch; }
    .porque-content { flex: 1; background: #fff; padding: 52px 60px; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
    .porque-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px 60px; }
    .porque-item { border-left: 2px solid #9a7f5a; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
    .porque-title { font-size: 13px; font-weight: 500; color: #1a1a1a; }
    .porque-desc { font-size: 11px; color: #777; line-height: 1.8; }
    .porque-single { border-left: 2px solid #9a7f5a; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }

    /* ── EUROPA ── */
    .europa { min-height: 100vh; display: flex; flex-direction: row; align-items: stretch; }
    .europa-content { flex: 1; background: #1a1a1a; display: flex; align-items: center; justify-content: center; padding: 60px 80px; }
    .europa-inner { display: flex; flex-direction: column; gap: 24px; max-width: 520px; }
    .europa-label { font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: #9a7f5a; }
    .europa-quote { font-size: 24px; font-weight: 300; color: #fff; line-height: 1.55; }
    .europa-line { width: 40px; height: 1px; background: #9a7f5a; }
    .europa-sub { font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.85; }

    /* ── PÁGINAS DE PRODUCTO (1 por página) ── */
    .prod-page { min-height: 100vh; display: flex; background: #f5f3f0; }
    .prod-img { width: 52%; flex-shrink: 0; background: #e8e4df; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    .prod-img img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .prod-img-empty { width: 100%; min-height: 100%; background: #ddd8d2; }
    .prod-text { flex: 1; padding: 60px 72px 60px 60px; display: flex; flex-direction: column; justify-content: center; gap: 16px; border-left: 1px solid #ddd8d2; }
    .prod-num { font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a7f5a; }
    .prod-name { font-size: 20px; font-weight: 300; color: #1a1a1a; line-height: 1.35; }
    .prod-divider { width: 36px; height: 1px; background: #9a7f5a; }
    .prod-price { font-size: 15px; color: #9a7f5a; font-weight: 400; }
    .prod-desc { font-size: 12px; color: #777; line-height: 1.85; }
    .prod-meta { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid #e8e2d9; padding-top: 14px; margin-top: 2px; }
    .prod-meta-row { font-size: 11px; color: #999; }
    .prod-meta-row strong { color: #555; font-weight: 500; margin-right: 5px; }

    /* ── PÁGINAS DE PRODUCTO (2 por página) ── */
    .prod-page-2up { min-height: 100vh; display: flex; flex-direction: column; background: #f5f3f0; }
    .prod-row-2up { flex: 1; display: flex; align-items: stretch; border-bottom: 1px solid #ddd8d2; }
    .prod-row-2up:last-child { border-bottom: none; }
    .prod-img-s { width: 48%; flex-shrink: 0; background: #e8e4df; overflow: hidden; display: flex; align-items: center; justify-content: center; }
    .prod-img-s img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .prod-text-s { flex: 1; padding: 24px 44px; display: flex; flex-direction: column; justify-content: center; gap: 10px; border-left: 1px solid #ddd8d2; }
    .prod-num-s { font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a7f5a; }
    .prod-name-s { font-size: 16px; font-weight: 300; color: #1a1a1a; line-height: 1.3; }
    .prod-divider-s { width: 28px; height: 1px; background: #9a7f5a; }
    .prod-price-s { font-size: 13px; color: #9a7f5a; font-weight: 400; }
    .prod-desc-s { font-size: 11px; color: #777; line-height: 1.75; }
    .prod-meta-s { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid #e8e2d9; padding-top: 8px; }
    .prod-meta-row-s { font-size: 10px; color: #999; }
    .prod-meta-row-s strong { color: #555; font-weight: 500; margin-right: 4px; }

    /* ── PROCESO ── */
    .proceso { min-height: 100vh; display: flex; flex-direction: row; align-items: stretch; }
    .proceso-content { flex: 1; background: #fff; padding: 52px 60px; display: flex; flex-direction: column; justify-content: center; gap: 36px; }
    .proceso-steps { display: flex; flex-direction: column; }
    .proceso-step { display: flex; align-items: flex-start; gap: 28px; padding: 18px 0; border-bottom: 1px solid #e8e2d9; }
    .proceso-step:first-child { border-top: 1px solid #e8e2d9; }
    .paso-num { font-size: 11px; letter-spacing: 0.18em; color: #9a7f5a; min-width: 28px; padding-top: 2px; flex-shrink: 0; }
    .paso-content { display: flex; flex-direction: column; gap: 3px; }
    .paso-title { font-size: 14px; font-weight: 400; color: #1a1a1a; }
    .paso-desc { font-size: 11px; color: #888; line-height: 1.7; }

    /* ── CONTACTO ── */
    .contacto { min-height: 100vh; background: #1a1a1a; display: flex; flex-direction: row; align-items: stretch; }
    .contacto-deco { width: 42%; flex-shrink: 0; position: relative; overflow: hidden; background-size: cover; background-position: center; }
    .contacto-deco::after { content: ''; position: absolute; inset: 0; background: rgba(20,16,12,0.62); }
    .contacto-content { flex: 1; position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding: 60px 80px 60px 64px; gap: 26px; }
    .contacto-logo { max-width: 150px; filter: brightness(0) invert(1); opacity: 0.85; }
    .contacto-line { width: 40px; height: 1px; background: #9a7f5a; }
    .contacto-tagline { font-size: 15px; font-weight: 300; color: rgba(255,255,255,0.68); line-height: 1.75; max-width: 400px; }
    .contacto-data { font-size: 12px; color: rgba(255,255,255,0.38); line-height: 2.4; }
    .contacto-data strong { color: rgba(255,255,255,0.75); font-weight: 400; }
    .contacto-data a { color: rgba(255,255,255,0.75); font-size: 14px; font-weight: 400; letter-spacing: 0.04em; text-decoration: none; border-bottom: 1px solid rgba(154,127,90,0.6); padding-bottom: 1px; }
    .contacto-resp { border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; display: flex; flex-direction: column; gap: 3px; }
    .contacto-resp-name { font-size: 13px; color: #fff; font-weight: 300; }
    .contacto-resp-role { font-size: 10px; color: #9a7f5a; letter-spacing: 0.16em; text-transform: uppercase; margin-top: 1px; }
    .contacto-resp-detail { font-size: 11px; color: rgba(255,255,255,0.32); margin-top: 2px; }
  </style>
</head>
<body>

  <!-- PORTADA -->
  <div class="cover page">
    <div class="cover-bg-half">
      <div class="cover-bg-img"></div>
    </div>
    <div class="cover-text-half">
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

  ${proyectoPage}

  <!-- QUIÉNES SOMOS -->
  <div class="quienes page">
    ${CTX.quienes ? `<div class="quienes-img" style="background-image:url('${CTX.quienes}')"></div>` : ''}
    <div class="quienes-text">
      <div class="s-tag">Quiénes somos</div>
      <div class="s-title">38 años seleccionando piezas únicas con historia</div>
      <div class="s-line"></div>
      <div class="s-body">
        <p>Bucarest Art &amp; Antiques es una empresa familiar con más de 38 años de experiencia en el comercio de las antigüedades en Chile. Somos referentes en el mercado gracias al trabajo, esfuerzo y pasión de su fundador, Ricardo Pizarro Pacheco.</p>
        <p>Con una profunda pasión por el arte y la historia, Ricardo ha convertido Bucarest Art &amp; Antiques en un destino de confianza para los amantes de las antigüedades. Importamos piezas únicas desde Francia, trabajando con destacadas casas de remate como Drouot, Millon &amp; Associes y Thierry de Maigret.</p>
      </div>
      <div class="s-stats">
        <div><span class="s-stat-num">38</span><span class="s-stat-label">años de experiencia</span></div>
        <div><span class="s-stat-num">4</span><span class="s-stat-label">locales en Santiago</span></div>
        <div><span class="s-stat-num">16</span><span class="s-stat-label">años importando desde Francia</span></div>
      </div>
    </div>
  </div>

  <!-- SERVICIOS PARA EMPRESAS -->
  <div class="servicios page">
    ${sideImg(CTX.servicios, { overlay: 'rgba(15,10,8,0.52)' })}
    <div class="servicios-content">
      <div class="svc-header">
        <div class="s-tag">Servicios para empresas</div>
        <div class="svc-title">Decora con Historia. Impresiona con Distinción.</div>
        <div class="svc-intro">En Bucarest Art &amp; Antiques entendemos que los espacios corporativos comunican valores antes de que se pronuncie una sola palabra. Por eso, ofrecemos a empresas e instituciones una selección incomparable de antigüedades francesas, pinturas chilenas, alfombras persas y objetos de época — piezas únicas capaces de transformar una sala de directorio, un salón de recepciones o un espacio institucional en un entorno de verdadero prestigio.</div>
      </div>
      <div class="svc-grid">
        <div class="svc-block">
          <span class="svc-num">01</span>
          <div class="svc-name">Decoración y mobiliario</div>
          <ul class="svc-list">
            <li>Mobiliario europeo (escritorios, cajoneras, sillones)</li>
            <li>Pintura (marinas, paisajes, retratos)</li>
            <li>Esculturas (bronces, mármoles)</li>
            <li>Alfombras persas</li>
            <li>Objetos decorativos de época</li>
          </ul>
        </div>
        <div class="svc-block">
          <span class="svc-num">02</span>
          <div class="svc-name">Proyectos corporativos</div>
          <ul class="svc-list">
            <li>Oficinas ejecutivas</li>
            <li>Salas de directorio</li>
            <li>Recepciones y lobbies</li>
            <li>Hoteles y restaurantes premium</li>
            <li>Embajadas y organismos públicos</li>
          </ul>
        </div>
        <div class="svc-block">
          <span class="svc-num">03</span>
          <div class="svc-name">Regalos corporativos premium</div>
          <ul class="svc-list">
            <li>Reconocimientos a ejecutivos</li>
            <li>Obsequios para clientes VIP</li>
            <li>Celebraciones institucionales</li>
            <li>Aniversarios empresariales</li>
            <li>Hitos y eventos especiales</li>
          </ul>
        </div>
      </div>
    </div>
  </div>

  <!-- POR QUÉ ELEGIRNOS -->
  <div class="porque page">
    <div class="porque-content">
      <div>
        <div class="s-tag">Por qué elegirnos</div>
        <div class="s-title" style="margin-top:10px">Lo que nos diferencia de cualquier proveedor de decoración.</div>
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
          <div class="porque-desc">Seleccionamos personalmente cada objeto con criterio estético y de calidad, construido durante 38 años de trayectoria.</div>
        </div>
        <div class="porque-item">
          <div class="porque-title">Importación directa desde Francia</div>
          <div class="porque-desc">Más de 16 años de viajes para adquirir piezas en Drouot, Millon &amp; Associes y Thierry de Maigret — lo que ningún otro proveedor chileno puede ofrecer.</div>
        </div>
      </div>
      <div class="porque-single">
        <div class="porque-title">Atención personalizada</div>
        <div class="porque-desc">Asesoría según presupuesto, espacio y objetivos del proyecto. Acompañamos cada proceso desde la selección hasta la entrega e instalación en sus instalaciones.</div>
      </div>
    </div>
    ${sideImg(CTX.porque, { overlay: 'rgba(245,243,240,0.18)' })}
  </div>

  <!-- IMPORTACIÓN DESDE EUROPA -->
  <div class="europa page">
    ${sideImg(CTX.europa, { width: '42%', overlay: 'rgba(15,10,8,0.48)' })}
    <div class="europa-content">
      <div class="europa-inner">
        <div class="europa-label">Selección e importación directa</div>
        <div class="europa-line"></div>
        <div class="europa-quote">Viajamos a Francia para traerle lo que no puede encontrar en ningún otro lugar de Chile.</div>
        <div class="europa-line"></div>
        <div class="europa-sub">Durante más de 16 años, Ricardo Pizarro y su equipo han viajado periódicamente a Francia para adquirir piezas en las grandes casas de remate: Drouot, Millon &amp; Associes y Thierry de Maigret. Cada viaje es una búsqueda entre bodegas y mercados de anticuarios, para traer a Chile aquellos objetos únicos que deleitarán los espacios de sus clientes. Este atributo es imposible de replicar y nos posiciona muy por encima de cualquier tienda de decoración tradicional.</div>
      </div>
    </div>
  </div>

  <!-- PIEZAS SELECCIONADAS -->
  ${productPages}

  <!-- PROCESO DE TRABAJO -->
  <div class="proceso page">
    <div class="proceso-content">
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
    ${sideImg(CTX.proceso, { overlay: 'rgba(245,243,240,0.18)' })}
  </div>

  <!-- CONTACTO -->
  <div class="contacto page">
    ${CTX.contacto ? `<div class="contacto-deco" style="background-image:url('${CTX.contacto}')"></div>` : ''}
    <div class="contacto-content">
      <img src="${LOGO}" alt="Bucarest Art &amp; Antiques" class="contacto-logo">
      <div class="contacto-tagline">Transformamos espacios corporativos en experiencias memorables a través de piezas únicas con historia.</div>
      <div class="contacto-line"></div>
      <div class="contacto-data">
        <strong>Bucarest Art &amp; Antiques</strong><br>
        RUT: 76.121.552-3<br>
        ventas@bucarestart.cl<br>
        <a href="https://www.bucarestart.cl">www.bucarestart.cl</a><br>
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
