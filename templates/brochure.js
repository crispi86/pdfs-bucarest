function formatPrice(amount, currency = 'CLP') {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(parseFloat(amount));
}

function paragraphs(text) {
  return (text || '').split(/\n\n+/).filter(Boolean).map(p => `<p>${p.trim()}</p>`).join('\n');
}

function brochureHTML(products, options = {}) {
  const {
    folio = '',
    companyName = '',
    responsable = '',
    cargo = '',
    correo = '',
    telefono = '',
    showPrices = false,
    showMetaFields = null,    // null = todos; array de keys = filtrar
    texturaImage = '',
    contextoImage = '',       // backward compat — se usa como fallback si no hay ctx por sección
    contextoImages = {},       // { quienes, rescate, servicios, regalos, porque, europa, proceso, contacto }
    staticImages = {},
    proyecto = '',
    productsPerPage = 1,
    collections = [],
    coverTag   = 'Propuesta Corporativa',
    coverTitle = 'Soluciones Corporativas en Arte & Antigüedades',
    coverSub   = 'Mobiliario, decoración exclusiva y regalos corporativos para empresas que buscan diferenciarse.',
    pages = null,  // null = todas; array de keys = solo esas páginas
  } = options;

  const showPage = key => !pages || pages.includes(key);

  const allMeta = !Array.isArray(showMetaFields);
  const showMf  = key => allMeta || showMetaFields.includes(key);

  const LOGO    = staticImages.logo || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';
  const TEXTURA = texturaImage || 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/textura21.jpg?v=1772584942';
  const FALLBACK = contextoImage || '';

  const CTX = {
    quienes:   contextoImages.quienes   || FALLBACK,
    rescate:   contextoImages.rescate   || FALLBACK,
    servicios: contextoImages.servicios || FALLBACK,
    regalos:   contextoImages.regalos   || FALLBACK,
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
      showMf('origen')     && meta.origen     && `<div class="prod-meta-row"><strong>Origen:</strong> ${meta.origen}</div>`,
      showMf('epocas')     && meta.epocas     && `<div class="prod-meta-row"><strong>Época:</strong> ${meta.epocas}</div>`,
      showMf('medidas')    && (meta.alto || meta.ancho) && `<div class="prod-meta-row"><strong>Dimensiones:</strong> ${[meta.alto && `Alto ${meta.alto}`, meta.ancho && `Ancho ${meta.ancho}`].filter(Boolean).join(' · ')}</div>`,
      showMf('materiales') && meta.materiales && `<div class="prod-meta-row"><strong>Materiales:</strong> ${meta.materiales}</div>`,
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
      showMf('origen')  && meta.origen && `<div class="prod-meta-row-s"><strong>Origen:</strong> ${meta.origen}</div>`,
      showMf('epocas')  && meta.epocas && `<div class="prod-meta-row-s"><strong>Época:</strong> ${meta.epocas}</div>`,
      showMf('medidas') && (meta.alto || meta.ancho) && `<div class="prod-meta-row-s"><strong>Dim:</strong> ${[meta.alto && `Alto ${meta.alto}`, meta.ancho && `Ancho ${meta.ancho}`].filter(Boolean).join(' · ')}</div>`,
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

  const collectionPages = collections.map(col => {
    const prods = col.products || [];
    const photos = prods.map(p => `
    <div class="col-item">
      ${p.image ? `<img src="${p.image}" alt="${p.title || ''}">` : '<div class="col-item-empty"></div>'}
      ${col.showPrices && p.price ? `<div class="col-item-price">${formatPrice(p.price)}</div>` : ''}
    </div>`).join('');
    return `<div class="collection-page page">
    <div class="col-left">
      <div class="col-tag">Colección</div>
      <div class="col-title">${col.title || ''}</div>
      <div class="col-line"></div>
      <div>
        <div class="col-count-num">${prods.length}</div>
        <div class="col-count-label">piezas seleccionadas</div>
      </div>
    </div>
    <div class="col-right">
      <div class="col-grid">${photos}</div>
    </div>
  </div>`;
  }).join('');

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

    /* ── RESCATE PATRIMONIAL ── */
    .rescate { min-height: 100vh; display: flex; background: #f5f3f0; }
    .rescate-img { width: 44%; flex-shrink: 0; background-size: cover; background-position: center; }
    .rescate-text { flex: 1; padding: 56px 72px 56px 60px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }

    /* ── REGALOS CORPORATIVOS ── */
    .regalos { min-height: 100vh; display: flex; flex-direction: row; align-items: stretch; }
    .regalos-content { flex: 1; background: #1a1a1a; color: #fff; padding: 52px 68px; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
    .regalos-title { font-size: 26px; font-weight: 300; color: #fff; line-height: 1.25; max-width: 480px; }
    .regalos-body { font-size: 12px; color: rgba(255,255,255,0.44); line-height: 1.95; max-width: 520px; }
    .regalos-body p + p { margin-top: 14px; }
    .regalos-list { display: flex; flex-direction: column; gap: 0; border-top: 1px solid rgba(154,127,90,0.25); padding-top: 20px; margin-top: 4px; }
    .regalos-list-item { display: flex; align-items: flex-start; gap: 14px; padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: rgba(255,255,255,0.5); line-height: 1.5; }
    .regalos-list-item::before { content: '—'; color: #9a7f5a; flex-shrink: 0; }

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

    /* ── COLECCIONES ── */
    .collection-page { min-height: 100vh; display: flex; flex-direction: row; align-items: stretch; }
    .col-left { width: 32%; flex-shrink: 0; background: #1a1a1a; padding: 60px 52px; display: flex; flex-direction: column; justify-content: center; gap: 20px; }
    .col-tag { font-size: 10px; letter-spacing: 0.24em; text-transform: uppercase; color: #9a7f5a; }
    .col-title { font-size: 26px; font-weight: 300; color: #fff; line-height: 1.3; }
    .col-line { width: 36px; height: 1px; background: #9a7f5a; }
    .col-count-num { font-size: 42px; font-weight: 200; color: #9a7f5a; line-height: 1; }
    .col-count-label { font-size: 9px; color: rgba(255,255,255,0.4); letter-spacing: 0.14em; text-transform: uppercase; margin-top: 4px; }
    .col-right { flex: 1; background: #f5f3f0; padding: 36px 40px; display: flex; align-items: center; }
    .col-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; width: 100%; align-content: start; }
    .col-item { display: flex; flex-direction: column; background: #e8e4df; overflow: hidden; }
    .col-item img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .col-item-empty { aspect-ratio: 1; background: #ddd8d2; }
    .col-item-price { font-size: 10px; color: #9a7f5a; text-align: center; padding: 4px 6px; background: #fff; flex-shrink: 0; }

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
    .contacto-folio { margin-top: auto; padding-top: 24px; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(255,255,255,0.2); }
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
      <div class="cover-tag">${coverTag}</div>
      <div class="cover-title">${coverTitle.replace(/\n/g, '<br>')}</div>
      <div class="cover-sub">${coverSub}</div>
      ${companyName ? `
      <div class="cover-company">
        Propuesta para<br>
        <div class="cover-company-name">${companyName}</div>
      </div>` : ''}
    </div>
  </div>

  ${proyectoPage}

  <!-- QUIÉNES SOMOS -->
  ${showPage('quienes') ? `
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
  </div>` : ''}

  <!-- RESCATE PATRIMONIAL -->
  ${showPage('rescate') ? `
  <div class="rescate page">
    ${CTX.rescate ? `<div class="rescate-img" style="background-image:url('${CTX.rescate}')"></div>` : ''}
    <div class="rescate-text">
      <div class="s-tag">Rescate patrimonial</div>
      <div class="s-title">Preservando la pintura chilena para las generaciones que vienen</div>
      <div class="s-line"></div>
      <div class="s-body">
        <p>Con la fundación de la Escuela de Bellas Artes en 1849, Chile comenzó a construir su propio lenguaje visual. Generaciones de pintores nacionales desarrollaron una tradición pictórica arraigada en la tierra, el paisaje y la gente de este país: retratos de vida cotidiana, rincones de ciudad, campos del sur, faenas y costumbres que hoy conforman un patrimonio visual único de nuestra historia colectiva.</p>
        <p>Bucarest Art se ha comprometido con la búsqueda, restauración y difusión de estas piezas: adquiriendo obras que han permanecido en manos privadas por décadas, restaurándolas con criterio técnico y poniéndolas nuevamente en circulación para que puedan ser apreciadas, coleccionadas y conservadas.</p>
        <p>Al adquirir una pintura chilena del siglo XIX o XX en Bucarest Art, no solo decora un espacio: contribuye activamente al rescate y valorización del patrimonio cultural de nuestro país.</p>
      </div>
    </div>
  </div>` : ''}

  <!-- SERVICIOS PARA EMPRESAS -->
  ${showPage('servicios') ? `
  <div class="servicios page">
    ${sideImg(CTX.servicios, { overlay: 'rgba(15,10,8,0.52)' })}
    <div class="servicios-content">
      <div class="svc-header">
        <div class="s-tag">Servicios para empresas e instituciones</div>
        <div class="svc-title">Arte y Antigüedades para sus Espacios.</div>
        <div class="svc-intro">Los espacios en los que trabajamos, recibimos y nos reunimos dicen mucho sobre quiénes somos y lo que valoramos. En Bucarest Art &amp; Antiques ayudamos a empresas, instituciones públicas, hoteles, embajadas y organismos a transformar sus entornos con piezas únicas de arte y antigüedad — objetos capaces de conferir distinción, historia e identidad a cualquier espacio corporativo o institucional.</div>
      </div>
      <div class="svc-grid">
        <div class="svc-block">
          <span class="svc-num">01</span>
          <div class="svc-name">Decoración de espacios</div>
          <ul class="svc-list">
            <li>Salas de directorio y oficinas ejecutivas</li>
            <li>Recepciones y lobbies corporativos</li>
            <li>Hoteles y restaurantes premium</li>
            <li>Embajadas y organismos diplomáticos</li>
            <li>Universidades y centros culturales</li>
          </ul>
        </div>
        <div class="svc-block">
          <span class="svc-num">02</span>
          <div class="svc-name">Proyectos institucionales</div>
          <ul class="svc-list">
            <li>Asesoría de selección y curaduría</li>
            <li>Propuestas adaptadas al espacio</li>
            <li>Coordinación de entrega e instalación</li>
            <li>Documentación de cada pieza</li>
            <li>Seguimiento post-proyecto</li>
          </ul>
        </div>
        <div class="svc-block">
          <span class="svc-num">03</span>
          <div class="svc-name">Tipos de piezas</div>
          <ul class="svc-list">
            <li>Pintura chilena siglos XIX–XX</li>
            <li>Mobiliario europeo de época</li>
            <li>Esculturas (bronces y mármoles)</li>
            <li>Alfombras persas</li>
            <li>Antigüedades y objetos de colección</li>
          </ul>
        </div>
      </div>
    </div>
  </div>` : ''}

  <!-- REGALOS CORPORATIVOS -->
  ${showPage('regalos') ? `
  <div class="regalos page">
    <div class="regalos-content">
      <div class="s-tag">Regalo corporativo premium</div>
      <div class="regalos-title">El regalo más original que su organización puede entregar</div>
      <div class="s-line"></div>
      <div class="regalos-body">
        <p>Cuando un regalo debe estar a la altura de quien lo recibe, las piezas de Bucarest Art &amp; Antiques hablan por sí solas. Ofrecemos una curaduría exclusiva de obsequios premium para empresas, instituciones públicas, organismos gubernamentales y entidades educacionales que valoran el detalle, la rareza y la permanencia.</p>
        <p>Desde una obra de arte chilena del siglo XIX hasta un objeto de colección francés, cada pieza es en sí misma una historia — y el regalo más original que su organización puede entregar. Asesoramos en la selección, embalaje y presentación de cada obsequio, con discreción y criterio curatorial.</p>
      </div>
      <div class="regalos-list">
        <div class="regalos-list-item">Reconocimientos a ejecutivos y altos directivos</div>
        <div class="regalos-list-item">Obsequios para clientes y socios VIP</div>
        <div class="regalos-list-item">Celebraciones institucionales y aniversarios empresariales</div>
        <div class="regalos-list-item">Hitos universitarios, gubernamentales o diplomáticos</div>
        <div class="regalos-list-item">Regalos de Estado y protocolo oficial</div>
      </div>
    </div>
    ${sideImg(CTX.regalos, { width: '38%', overlay: 'rgba(15,10,8,0.45)' })}
  </div>` : ''}

  <!-- POR QUÉ ELEGIRNOS -->
  ${showPage('porque') ? `
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
  </div>` : ''}

  <!-- IMPORTACIÓN DESDE EUROPA -->
  ${showPage('europa') ? `
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
  </div>` : ''}

  <!-- PIEZAS SELECCIONADAS -->
  ${productPages}

  <!-- COLECCIONES -->
  ${collectionPages}

  <!-- PROCESO DE TRABAJO -->
  ${showPage('proceso') ? `
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
  </div>` : ''}

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
      ${folio ? `<div class="contacto-folio">${folio}</div>` : ''}
    </div>
  </div>

</body>
</html>`;
}

module.exports = { brochureHTML };
