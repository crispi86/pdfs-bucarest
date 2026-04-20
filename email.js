const { Resend } = require('resend');

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendCertificate(toEmail, toName, pdfBuffer, productName) {
  const resend = getResend();
  const internalEmails = process.env.INTERNAL_EMAILS.split(',').map(e => e.trim());
  const filename = `Certificado_${productName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const subject = `Certificado de Autenticidad — ${productName}`;
  const from = process.env.FROM_EMAIL || 'Bucarest Art & Antiques <onboarding@resend.dev>';

  const result = await resend.emails.send({
    from,
    to: [toEmail, ...internalEmails],
    subject,
    html: `
      <p>Estimado/a ${toName},</p>
      <p>Adjunto encontrará el certificado de autenticidad de su pieza <strong>${productName}</strong>.</p>
      <p>Gracias por su confianza en Bucarest Art &amp; Antiques.</p>
      <br>
      <p>Bucarest Art &amp; Antiques<br>
      Tel: +569 33423442<br>
      <a href="https://www.bucarestart.cl">www.bucarestart.cl</a></p>
    `,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  });
  console.log('Resend result:', JSON.stringify(result));
}

async function sendPDFToInternal(pdfBuffer, filename, subject, bodyHtml, extraTo = null) {
  const resend = getResend();
  const internalEmails = process.env.INTERNAL_EMAILS.split(',').map(e => e.trim());
  const to = extraTo ? [extraTo, ...internalEmails] : internalEmails;
  const from = process.env.FROM_EMAIL || 'Bucarest Art & Antiques <onboarding@resend.dev>';

  await resend.emails.send({
    from,
    to,
    subject,
    html: bodyHtml,
    attachments: [{ filename, content: pdfBuffer.toString('base64') }],
  });
}

module.exports = { sendCertificate, sendPDFToInternal };
