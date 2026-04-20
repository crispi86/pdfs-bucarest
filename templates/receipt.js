function receiptHTML(order) {
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const date = new Date(order.created_at);
  const dateStr = `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;

  function formatPrice(amount, currency = 'CLP') {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(parseFloat(amount));
  }

  const currency = order.currency || 'CLP';
  const customer = order.customer || {};
  const billing = order.billing_address || order.shipping_address || {};
  const customerName = customer.first_name
    ? `${customer.first_name} ${customer.last_name || ''}`.trim()
    : billing.name || 'Cliente';

  const itemRows = (order.line_items || []).map(item => `
    <tr>
      <td class="r-td">${item.title}${item.variant_title && item.variant_title !== 'Default Title' ? ` — ${item.variant_title}` : ''}</td>
      <td class="r-td r-td--center">${item.quantity}</td>
      <td class="r-td r-td--right">${formatPrice(item.price, currency)}</td>
      <td class="r-td r-td--right">${formatPrice(parseFloat(item.price) * item.quantity, currency)}</td>
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
    .r-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; border-bottom: 1px solid #e8e2d9; padding-bottom: 28px; }
    .r-logo { max-width: 180px; }
    .r-meta { text-align: right; }
    .r-meta h1 { font-size: 22px; font-weight: 400; color: #1a1a1a; margin: 0 0 6px; letter-spacing: 0.08em; text-transform: uppercase; }
    .r-meta-detail { font-size: 12px; color: #888; line-height: 1.8; }
    .r-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px; }
    .r-label { font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; color: #9a7f5a; margin-bottom: 8px; }
    .r-info { font-size: 13px; line-height: 1.8; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .r-th { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: #9a7f5a; padding: 10px 12px; border-bottom: 2px solid #e8e2d9; text-align: left; }
    .r-th--right { text-align: right; }
    .r-th--center { text-align: center; }
    .r-td { padding: 14px 12px; border-bottom: 1px solid #f0ece6; vertical-align: top; }
    .r-td--right { text-align: right; }
    .r-td--center { text-align: center; }
    .r-totals { display: flex; justify-content: flex-end; margin-bottom: 32px; }
    .r-totals-box { min-width: 240px; }
    .r-totals-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #666; border-bottom: 1px solid #f0ece6; }
    .r-totals-row--total { font-size: 16px; font-weight: 600; color: #1a1a1a; border-bottom: none; padding-top: 12px; }
    .r-footer { text-align: center; font-size: 11px; color: #bbb; border-top: 1px solid #e8e2d9; padding-top: 20px; letter-spacing: 0.04em; }
  </style>
</head>
<body>
  <div class="r-header">
    <img class="r-logo" src="https://cdn.shopify.com/s/files/1/0814/7671/4798/files/Captura_de_pantalla_2025-09-07_a_la_s_22.05.33.png?v=1757293894" alt="Bucarest Art & Antiques">
    <div class="r-meta">
      <h1>Comprobante de Venta</h1>
      <div class="r-meta-detail">
        Orden N° ${order.order_number || order.name || order.id}<br>
        Fecha: ${dateStr}<br>
        Estado: ${order.financial_status === 'paid' ? 'Pagado' : order.financial_status}
      </div>
    </div>
  </div>

  <div class="r-parties">
    <div>
      <div class="r-label">De</div>
      <div class="r-info">
        <strong>Bucarest Art &amp; Antiques</strong><br>
        RUT: 76.121.552-3<br>
        Tel: +569 33423442<br>
        ventas@bucarestart.cl
      </div>
    </div>
    <div>
      <div class="r-label">Para</div>
      <div class="r-info">
        <strong>${customerName}</strong><br>
        ${customer.email || ''}<br>
        ${billing.address1 ? `${billing.address1}<br>` : ''}
        ${billing.city ? `${billing.city}${billing.province ? `, ${billing.province}` : ''}` : ''}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="r-th">Descripción</th>
        <th class="r-th r-th--center">Cant.</th>
        <th class="r-th r-th--right">Precio unit.</th>
        <th class="r-th r-th--right">Total</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="r-totals">
    <div class="r-totals-box">
      ${order.subtotal_price ? `<div class="r-totals-row"><span>Subtotal</span><span>${formatPrice(order.subtotal_price, currency)}</span></div>` : ''}
      ${parseFloat(order.total_discounts) > 0 ? `<div class="r-totals-row"><span>Descuentos</span><span>-${formatPrice(order.total_discounts, currency)}</span></div>` : ''}
      ${parseFloat(order.total_shipping_price_set?.presentment_money?.amount || 0) > 0
        ? `<div class="r-totals-row"><span>Envío</span><span>${formatPrice(order.total_shipping_price_set.presentment_money.amount, currency)}</span></div>` : ''}
      <div class="r-totals-row r-totals-row--total"><span>Total</span><span>${formatPrice(order.total_price, currency)}</span></div>
    </div>
  </div>

  <div class="r-footer">
    Bucarest Art &amp; Antiques — RUT: 76.121.552-3 — Tel: +569 33423442 — ventas@bucarestart.cl — www.bucarestart.cl
  </div>
</body>
</html>`;
}

module.exports = { receiptHTML };
