function spanishDate() {
  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const now = new Date();
  return {
    dayName: days[now.getDay()],
    dayNumber: now.getDate(),
    monthName: months[now.getMonth()],
    year: now.getFullYear(),
  };
}

function formatPrice(amount, currency = 'CLP') {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(amount);
}

function certificateHTML(lineItems) {
  const { dayName, dayNumber, monthName, year } = spanishDate();

  const pages = lineItems.map(item => `
    <div class="certificate-page">

      <div class="header">
        <img src="https://cdn.shopify.com/s/files/1/0814/7671/4798/files/encabezado_certificado.jpg?v=1776881313" alt="Encabezado Bucarest" class="header-img">
      </div>

      <p class="a-quien">A quien corresponda,</p>

      <div class="spacer"></div>

      <div class="body-text">
        <p>
          Este documento se extiende con fecha de
          <strong>${dayName} ${dayNumber} de ${monthName} de ${year}</strong>, para certificar que la pieza
          <strong>${item.title || 'Título no disponible'}</strong>, es auténtica, como lo ha expertizado y confirmado Bucarest Art &amp; Antiques.
        </p>
      </div>

      <div class="product-details">
        <h2>${item.title || 'Título no disponible'}</h2>
        <div class="product-info">
          <div class="product-image">
            ${item.image
              ? `<img class="product-photo" src="${item.image}" alt="${item.title}">`
              : '<p>No hay imagen disponible para esta pieza.</p>'
            }
          </div>
          <div class="product-description">
            ${item.price ? `<p><strong>Precio:</strong> ${formatPrice(item.price, item.currency || 'CLP')}</p>` : ''}
            ${item.description ? `<p><strong>Descripción:</strong> ${item.description}</p>` : ''}
          </div>
        </div>
      </div>

      <div class="footer">
        <p>
          Este certificado es emitido por <strong>Bucarest Art &amp; Antiques</strong>, con 36 años de experiencia
          en el rubro de la pintura y las antigüedades. Garantizamos la autenticidad de todas nuestras piezas.
        </p>
        <div class="signature-area">
          <img src="https://cdn.shopify.com/s/files/1/0814/7671/4798/files/Timbre_Bucarest.png?v=1737570205" alt="Timbre Bucarest Art">
          <p>Certifica<br><strong>Ricardo Pizarro y Expertos</strong></p>
          <p>
            <strong>Bucarest Art &amp; Antiques — RUT: 76.121.552-3</strong> |
            Tel: +569 33423442 |
            <a href="mailto:ventas@bucarestart.cl">ventas@bucarestart.cl</a> |
            <a href="https://www.bucarestart.cl">www.bucarestart.cl</a>
          </p>
        </div>
      </div>

    </div>
    <div style="page-break-after: always;"></div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; font-family: "Hanken Grotesk", sans-serif !important; margin: 0; padding: 0; }
    body { background: #fff; color: #333; font-size: 13px; line-height: 1.6; }

    .certificate-page { width: 100%; }

    .header { text-align: center; margin-bottom: 32px; }
    .header-img { width: calc(100% + 20px); height: auto; display: inline-block; margin: 0 -10px; border: none; box-shadow: none; }

    .a-quien { text-align: left; font-size: 13px; margin-bottom: 0; }

    .spacer { height: 80px; }

    .body-text { font-size: 13px; line-height: 1.8; margin-bottom: 28px; text-align: justify; }

    .product-details { margin-bottom: 24px; }
    h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .product-info { display: flex; align-items: flex-start; gap: 20px; }
    .product-photo { max-width: 180px; height: auto; border: 1px solid #ddd; padding: 4px; }

    .footer { margin-top: 24px; font-size: 11px; line-height: 1.5; text-align: center; }
    .signature-area { margin-top: 24px; text-align: center; }
    .signature-area img { max-width: 120px; height: auto; margin-bottom: 8px; }
    a { color: #333; text-decoration: none; }
  </style>
</head>
<body>${pages}</body>
</html>`;
}

module.exports = { certificateHTML };
