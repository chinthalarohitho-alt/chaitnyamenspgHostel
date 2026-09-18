import { defineConfig, loadEnv } from 'vite';
import nodemailer from 'nodemailer';
import { buildInvoicePdfDoc } from './src/invoice-pdf.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    root: 'src',
    envDir: '../',
    build: {
      outDir: '../dist',
      emptyOutDir: true,
    },
    server: {
      port: 3000
    },
    plugins: [
      {
        name: 'dev-email-relay',
        configureServer(server) {
          server.middlewares.use('/api/send-invoice', (req, res) => {
            if (req.method !== 'POST') {
              res.statusCode = 405;
              res.end('Method Not Allowed');
              return;
            }

            let raw = '';
            req.on('data', chunk => { raw += chunk; });
            req.on('end', async () => {
              try {
                const data = JSON.parse(raw || '{}');
                const user = (env.GMAIL_USER || process.env.GMAIL_USER || '').trim();
                const pass = (env.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();

                if (!user || !pass) {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ ok: false, error: 'Gmail credentials not configured in .env' }));
                  return;
                }

                const targetEmail = (data.email || env.TEST_RECIPIENT_EMAIL || user).trim();
                const booking = data.booking || { ref: data.ref || 'CMPG-ENQ' };
                if (data.type === 'receipt' || data.type === 'accepted' || booking.status === 'accepted') {
                  booking.status = 'accepted';
                  booking.paymentStatus = 'paid';
                  booking.payment_status = 'paid';
                  booking.isVerified = true;
                }
                const hostel = data.hostel || {
                  name: 'Chaitanya Mens PG & Hostel',
                  phone: '+91 99497 85344',
                  address: "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar, Hanamkonda"
                };

                const pdfBytes = await buildInvoicePdfDoc(booking, hostel);
                const pdfBuffer = Buffer.from(pdfBytes);

                const transporter = nodemailer.createTransport({
                  service: 'gmail',
                  auth: { user, pass }
                });

                const plainText = `
Chaitanya Mens PG & Hostel
Booking Reference: ${booking.ref || 'CMPG-BOOKING'}

Hello ${booking.guestName || booking.name || 'Resident'},

Thank you for choosing Chaitanya Mens PG. Your booking has been verified and confirmed.

- Room: ${booking.roomName || booking.room || 'Executive Room'}
- Total Move-In Amount Paid: Rs. ${booking.payableOnMoveIn || booking.payable_move_in || '13,900'} (First month rent + deposit)
- Balance Due on Move-In: Rs. 0 (Fully Paid)
- Verified UPI UTR: ${booking.upi_utr || booking.utr || 'Verified'}
- Move-In Date: ${booking.date || booking.move_in_date || 'Upcoming'}

Please find your official tax-inclusive invoice attached as a PDF.

Hostel Desk: +91 99497 85344
                `.trim();

                const info = await transporter.sendMail({
                  from: `"Chaitanya Mens PG" <${user}>`,
                  to: targetEmail,
                  replyTo: user,
                  subject: `Booking Confirmed & Verified - ${booking.ref || 'CMPG'} | Chaitanya Mens PG`,
                  text: plainText,
                  html: `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                      <div style="background: #ca4e00; padding: 20px; color: #ffffff;">
                        <h2 style="margin: 0;">Chaitanya Mens PG & Hostel</h2>
                        <p style="margin: 4px 0 0; font-size: 13px; color: #fed7aa;">Executive Living & Student PG — Hanamkonda</p>
                      </div>
                      <div style="padding: 24px; font-size: 14px; line-height: 1.6; color: #1f2937;">
                        <p>Hello <strong>${booking.guestName || booking.name || 'Resident'}</strong>,</p>
                        <p>Thank you for choosing Chaitanya Mens PG. Your booking has been verified and confirmed by the hostel manager.</p>
                        <div style="background: #f0fdf4; border: 1px solid #86efac; padding: 14px; border-radius: 8px; margin: 16px 0;">
                          <p style="margin: 0 0 6px 0;"><strong>Booking Reference:</strong> ${booking.ref || 'CMPG-BOOKING'}</p>
                          <p style="margin: 0 0 6px 0;"><strong>Room:</strong> ${booking.roomName || booking.room || 'Executive Room'}</p>
                          <p style="margin: 0 0 6px 0;"><strong>Total Move-In Paid:</strong> Rs. ${booking.payableOnMoveIn || booking.payable_move_in || '13,900'} <span style="color:#15803d;font-weight:600;">(Rent + Deposit)</span></p>
                          <p style="margin: 0 0 6px 0;"><strong>Balance Due on Move-In:</strong> <span style="color:#15803d;font-weight:700;">Rs. 0 (Fully Paid)</span></p>
                          <p style="margin: 0 0 6px 0;"><strong>Verified Bank UTR:</strong> ${booking.upi_utr || booking.utr || 'Verified'}</p>
                          <p style="margin: 0; color: #15803d; font-weight: 700;"><strong>Status:</strong> ✓ Accepted &amp; Verified</p>
                        </div>
                        <p>📎 <strong>Booking Invoice Attached</strong><br/>
                        Please find your full tax-inclusive invoice attached as a PDF.</p>
                        <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">Hostel Desk: +91 99497 85344</p>
                      </div>
                    </div>
                  `,
                  attachments: [
                    {
                      filename: `Booking-Confirmation-${(booking.ref || 'CMPG').replace(/[^a-zA-Z0-9_-]/g, '')}.pdf`,
                      content: pdfBuffer,
                      contentType: 'application/pdf'
                    }
                  ]
                });

                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, messageId: info.messageId }));
              } catch (err) {
                console.error('[dev-email-relay] send failed:', err);
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: err.message }));
              }
            });
          });
        }
      }
    ]
  };
});
