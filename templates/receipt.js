function receiptHTML(order) {
  const date = new Date(order.created_at);
  const dateStr = date.toLocaleDateString('es-CL', { year: 'numeric', month: 'short', day: 'numeric' });

  function money(amount) {
    const num = parseFloat(amount || 0);
    const currency = order.currency || 'CLP';
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(num);
  }

  const billing = order.billing_address || order.shipping_address || {};
  const shipping = order.shipping_address || billing;
  const customer = order.customer || {};
  const shippingLine = (order.shipping_lines || [])[0];
  const shippingAmount = parseFloat(order.total_shipping_price_set?.presentment_money?.amount || shippingLine?.price || 0);
  const totalTax = parseFloat(order.total_tax || 0);
  const totalDiscounts = parseFloat(order.total_discounts || 0);

  const itemRows = (order.line_items || []).map(item => {
    const itemTotal = (parseFloat(item.price) * item.quantity - parseFloat(item.total_discount || 0));
    const variantTitle = item.variant_title && item.variant_title !== 'Default Title' ? ` — ${item.variant_title}` : '';
    const img = item.image?.src ? `<img src="${item.image.src}" alt="${item.title}" width="60">` : '';
    const sku = item.sku ? `<p class="product-sku">SKU: ${item.sku}</p>` : '';
    const discount = parseFloat(item.total_discount || 0);
    const discountCell = `<td>${discount > 0 ? money(discount) : money(0)}</td>`;

    return `<tr>
      <td class="product-image">${img}</td>
      <td class="product-details">
        <p class="product-name">${item.title}${variantTitle}</p>
        ${sku}
      </td>
      <td>${item.quantity}</td>
      <td>${money(item.price)}</td>
      ${discountCell}
      <td>${money(itemTotal)}</td>
    </tr>`;
  }).join('');

  const logo = 'https://cdn.shopify.com/s/files/1/0814/7671/4798/files/logo_web.png?v=1765624776';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;600;700&display=swap" rel="stylesheet">
</head>
<body>
<main>
<div class="container">

  <section class="header">
    <div class="logo-container">
      <img alt="Logo" width="160" src="${logo}">
    </div>
    <div class="invoice-info">
      <div class="invoice-qr-wrapper">
        <table>
          <thead>
            <th class="header__table-heading" colspan="2" align="left">Comprobante de Venta</th>
          </thead>
          <tbody>
            <tr class="data-size">
              <td></td>
              <td class="header__table-content" align="right">
                <p class="data-size">${order.name || '#' + order.order_number}</p>
              </td>
            </tr>
            <tr class="data-size">
              <td class="header__table-content" align="left">Fecha</td>
              <td align="right">${dateStr}</td>
            </tr>
            ${order.payment_gateway ? `<tr class="data-size">
              <td class="header__table-content" align="left">Pago</td>
              <td align="right">${order.payment_gateway}</td>
            </tr>` : ''}
            ${shippingLine ? `<tr class="data-size">
              <td class="header__table-content" align="left">Envío</td>
              <td align="right">${shippingLine.title}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="address-section">
    <div class="address-container">
      <div class="address-block">
        <h2 class="heading-size">De</h2>
        <p class="data-size"><strong>Bucarest Art &amp; Antiques</strong></p>
        <p class="data-size">RUT: 76.121.552-3</p>
        <p class="data-size">Tel: +569 33423442</p>
        <p class="data-size">ventas@bucarestart.cl</p>
      </div>

      ${billing.first_name || billing.address1 ? `<div class="address-block">
        <h2 class="heading-size">Facturar a</h2>
        ${billing.first_name ? `<p class="data-size">${billing.first_name} ${billing.last_name || ''}</p>` : ''}
        ${billing.address1 ? `<p class="data-size">${billing.address1}</p>` : ''}
        ${billing.city ? `<p class="data-size">${billing.city}${billing.province ? `, ${billing.province}` : ''}${billing.country_code ? `, ${billing.country_code}` : ''} ${billing.zip || ''}</p>` : ''}
        ${billing.phone ? `<p class="data-size">${billing.phone}</p>` : ''}
      </div>` : ''}

      ${shipping.address1 ? `<div class="address-block">
        <h2 class="heading-size">Enviar a</h2>
        ${shipping.first_name ? `<p class="data-size">${shipping.first_name} ${shipping.last_name || ''}</p>` : ''}
        ${shipping.address1 ? `<p class="data-size">${shipping.address1}</p>` : ''}
        ${shipping.city ? `<p class="data-size">${shipping.city}${shipping.province ? `, ${shipping.province}` : ''}${shipping.country_code ? `, ${shipping.country_code}` : ''} ${shipping.zip || ''}</p>` : ''}
        ${shipping.phone ? `<p class="data-size">${shipping.phone}</p>` : ''}
      </div>` : ''}
    </div>
  </section>

  <section class="product-section">
    <table class="product-table">
      <thead>
        <tr>
          <th class="heading-size" align="left" colspan="2">Descripción</th>
          <th class="heading-size" align="right">Cant.</th>
          <th class="heading-size" align="right">Precio</th>
          <th class="heading-size" align="right">Descuento</th>
          <th class="heading-size" align="right">Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  </section>

  <section class="total-section">
    <div class="total-container">
      <div class="total-row">
        <span>Subtotal</span>
        <span>${money(parseFloat(order.subtotal_price || 0) + totalDiscounts)}</span>
      </div>
      ${totalDiscounts > 0 ? `<div class="total-row">
        <span>Descuentos</span>
        <span>-${money(totalDiscounts)}</span>
      </div>` : ''}
      ${shippingAmount > 0 ? `<div class="total-row">
        <span>Envío</span>
        <span>${money(shippingAmount)}</span>
      </div>` : ''}
      ${totalTax > 0 ? `<div class="total-row">
        <span>IVA</span>
        <span>${money(totalTax)}</span>
      </div>` : ''}
      <div class="total-row grand-total">
        <span>Total</span>
        <span>${money(order.total_price)}</span>
      </div>
    </div>
  </section>

  ${order.note ? `<section class="extra-info">
    <table class="extra-info__table">
      <tbody>
        <tr>
          <td class="extra-info__table-heading heading-size">
            <table><tr><th>Notas</th></tr><tr><td class="data-size">${order.note}</td></tr></table>
          </td>
        </tr>
      </tbody>
    </table>
  </section>` : ''}

  <footer class="invoice__footer">
    <div class="invoice__footer-contacts">
      <div>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 13 13" fill="none">
          <g clip-path="url(#clip0)">
          <path d="M6.5 11.2715C9.26142 11.2715 11.5 9.03291 11.5 6.27148C11.5 3.51006 9.26142 1.27148 6.5 1.27148C3.73858 1.27148 1.5 3.51006 1.5 6.27148C1.5 9.03291 3.73858 11.2715 6.5 11.2715Z" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M1.5 6.27148H11.5" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6.5 1.27148C7.75064 2.64066 8.46138 4.4175 8.5 6.27148C8.46138 8.12547 7.75064 9.90231 6.5 11.2715C5.24936 9.90231 4.53862 8.12547 4.5 6.27148C4.53862 4.4175 5.24936 2.64066 6.5 1.27148Z" stroke="black" stroke-linecap="round" stroke-linejoin="round"/>
          </g>
          <defs><clipPath id="clip0"><rect width="12" height="12" fill="white" transform="translate(0.5 0.271484)"/></clipPath></defs>
        </svg>
        <a class="data-size" target="_blank" href="https://www.bucarestart.cl">/bucarestart.cl</a>
      </div>
      <div>
        <svg width="20" height="20" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg">
          <g clip-path="url(#clip1)">
          <path d="M6.5 1.35195C8.10313 1.35195 8.29297 1.35898 8.92344 1.38711C9.50938 1.41289 9.82578 1.51133 10.0367 1.59336C10.3156 1.70117 10.5172 1.83242 10.7258 2.04102C10.9367 2.25195 11.0656 2.45117 11.1734 2.73008C11.2555 2.94102 11.3539 3.25977 11.3797 3.84336C11.4078 4.47617 11.4148 4.66602 11.4148 6.2668C11.4148 7.86992 11.4078 8.05977 11.3797 8.69024C11.3539 9.27617 11.2555 9.59258 11.1734 9.80352C11.0656 10.0824 10.9344 10.284 10.7258 10.4926C10.5148 10.7035 10.3156 10.8324 10.0367 10.9402C9.82578 11.0223 9.50703 11.1207 8.92344 11.1465C8.29063 11.1746 8.10078 11.1816 6.5 11.1816C4.89688 11.1816 4.70703 11.1746 4.07656 11.1465C3.49063 11.1207 3.17422 11.0223 2.96328 10.9402C2.68438 10.8324 2.48281 10.7012 2.27422 10.4926C2.06328 10.2816 1.93438 10.0824 1.82656 9.80352C1.74453 9.59258 1.64609 9.27383 1.62031 8.69024C1.59219 8.05742 1.58516 7.86758 1.58516 6.2668C1.58516 4.66367 1.59219 4.47383 1.62031 3.84336C1.64609 3.25742 1.74453 2.94102 1.82656 2.73008C1.93438 2.45117 2.06563 2.24961 2.27422 2.04102C2.48516 1.83008 2.68438 1.70117 2.96328 1.59336C3.17422 1.51133 3.49297 1.41289 4.07656 1.38711C4.70703 1.35898 4.89688 1.35195 6.5 1.35195ZM6.5 0.271484C4.87109 0.271484 4.66719 0.278516 4.02734 0.306641C3.38984 0.334766 2.95156 0.437891 2.57188 0.585547C2.17578 0.740234 1.84063 0.944141 1.50781 1.2793C1.17266 1.61211 0.96875 1.94727 0.814063 2.34102C0.666406 2.72305 0.563281 3.15898 0.535156 3.79648C0.507031 4.43867 0.5 4.64258 0.5 6.27148C0.5 7.90039 0.507031 8.1043 0.535156 8.74414C0.563281 9.38164 0.666406 9.81992 0.814063 10.1996C0.96875 10.5957 1.17266 10.9309 1.50781 11.2637C1.84063 11.5965 2.17578 11.8027 2.56953 11.9551C2.95156 12.1027 3.3875 12.2059 4.025 12.234C4.66484 12.2621 4.86875 12.2691 6.49766 12.2691C8.12656 12.2691 8.33047 12.2621 8.97031 12.234C9.60781 12.2059 10.0461 12.1027 10.4258 11.9551C10.8195 11.8027 11.1547 11.5965 11.4875 11.2637C11.8203 10.9309 12.0266 10.5957 12.1789 10.202C12.3266 9.81992 12.4297 9.38398 12.4578 8.74648C12.4859 8.10664 12.493 7.90273 12.493 6.27383C12.493 4.64492 12.4859 4.44102 12.4578 3.80117C12.4297 3.16367 12.3266 2.72539 12.1789 2.3457C12.0312 1.94727 11.8273 1.61211 11.4922 1.2793C11.1594 0.946484 10.8242 0.740234 10.4305 0.587891C10.0484 0.440234 9.6125 0.337109 8.975 0.308984C8.33281 0.278516 8.12891 0.271484 6.5 0.271484Z" fill="black"/>
          <path d="M6.5 3.18945C4.79844 3.18945 3.41797 4.56992 3.41797 6.27148C3.41797 7.97305 4.79844 9.35352 6.5 9.35352C8.20156 9.35352 9.58203 7.97305 9.58203 6.27148C9.58203 4.56992 8.20156 3.18945 6.5 3.18945ZM6.5 8.2707C5.39609 8.2707 4.50078 7.37539 4.50078 6.27148C4.50078 5.16758 5.39609 4.27227 6.5 4.27227C7.60391 4.27227 8.49922 5.16758 8.49922 6.27148C8.49922 7.37539 7.60391 8.2707 6.5 8.2707Z" fill="black"/>
          <path d="M10.4234 3.06755C10.4234 3.46599 10.1 3.78709 9.70391 3.78709C9.30547 3.78709 8.98438 3.46365 8.98438 3.06755C8.98438 2.66912 9.30781 2.34802 9.70391 2.34802C10.1 2.34802 10.4234 2.67146 10.4234 3.06755Z" fill="black"/>
          </g>
          <defs><clipPath id="clip1"><rect width="12" height="12" fill="white" transform="translate(0.5 0.271484)"/></clipPath></defs>
        </svg>
        <a class="data-size" target="_blank" href="https://www.instagram.com/bucarestart">/@bucarestart</a>
      </div>
    </div>
  </footer>

</div>
</main>
<style>
  :root {
    --heading-size: 11px;
    --data-size: 12px;
    --primary-color: #333333;
    --secondary-color: #f5f5f5;
    --text-color: #1a1a1a;
    --background-color: #ffffff;
    --accent-color: #4a4a4a;
    --border-color: #e0e0e0;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'Poppins', sans-serif; }
  body { background-color: var(--background-color); color: var(--text-color); line-height: 1.6; }
  .container { max-width: 800px; padding: 28px; border-radius: 8px; }
  .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid var(--border-color); }
  .invoice-info { display: flex; align-items: flex-start; gap: 20px; }
  th.header__table-heading { font-size: calc(var(--heading-size) + 11px); color: var(--primary-color); margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }
  .address-section { margin-bottom: 15px; }
  .address-container { display: flex; gap: 20px; justify-content: space-between; }
  .address-block { flex-basis: calc(33.333% - 20px); background-color: var(--secondary-color); padding: 20px; border-radius: 8px; }
  .address-block h2 { color: var(--primary-color); margin-bottom: 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 5px; text-transform: uppercase; letter-spacing: 1px; }
  .address-block p { margin-bottom: 5px; }
  .product-section { margin-bottom: 15px; }
  .product-table { width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
  .product-table th { background-color: var(--secondary-color); color: var(--primary-color); text-align: left; padding: 8px; font-size: var(--heading-size); text-transform: uppercase; letter-spacing: 1px; }
  .product-table td { padding: 5px 8px; border-top: 1px solid var(--border-color); font-size: var(--data-size); }
  .product-image img { border-radius: 4px; }
  .product-name { font-weight: 600; margin-bottom: 5px; }
  .product-sku { font-size: calc(var(--data-size) - 2px); color: var(--accent-color); }
  .total-section { margin-bottom: 15px; }
  .total-container { background-color: var(--secondary-color); padding: 20px; border-radius: 8px; }
  .total-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: var(--data-size); padding: 5px 0; border-bottom: 1px solid var(--border-color); }
  .grand-total { font-size: var(--data-size); font-weight: 700; color: var(--primary-color); border-top: 2px solid var(--primary-color); padding-top: 10px; margin-top: 10px; }
  .extra-info { padding: 10px 0; }
  .extra-info__table { width: 100%; }
  .extra-info__table-heading { width: 35%; text-align: left; }
  .invoice__footer { text-align: center; padding-top: 15px; border-top: 1px solid var(--border-color); }
  .invoice__footer-contacts { padding: 28px; display: flex; flex-wrap: wrap; justify-content: center; gap: 20px; padding-top: 12px; }
  .invoice__footer-contacts > div { display: flex; align-items: center; gap: 4px; }
  footer a { color: var(--primary-color); text-decoration: none; }
  .heading-size { font-size: var(--heading-size); }
  .data-size { font-size: var(--data-size); }
</style>
</body>
</html>`;
}

module.exports = { receiptHTML };
