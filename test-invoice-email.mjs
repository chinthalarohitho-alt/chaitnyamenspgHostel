import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { buildInvoicePdfDoc } from './src/invoice-pdf.js';

// Load .env variables
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = { ...loadEnv(), ...process.env };

const gmailUser = (env.GMAIL_USER || '').trim();
const gmailPass = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '').trim();
const recipient = (env.TEST_RECIPIENT_EMAIL || '').trim() || gmailUser;

console.log('======================================================');
console.log('  Chaitanya PG — Gmail Invoice Test Script');
console.log('======================================================\n');

if (!gmailUser || !gmailPass) {
  console.error('❌ Missing Gmail SMTP credentials in .env!\n');
  console.log('Please open your `.env` file and set:');
  console.log('  GMAIL_USER="your-email@gmail.com"');
  console.log('  GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" (16-character App Password)\n');
  console.log('💡 How to get a Google App Password:');
  console.log('  1. Go to https://myaccount.google.com/security');
  console.log('  2. Enable "2-Step Verification" (if not already enabled)');
  console.log('  3. Search "App Passwords" or visit https://myaccount.google.com/apppasswords');
  console.log('  4. Create an app named "Hostel Invoices" and copy the 16-character code into .env\n');
  process.exit(1);
}

console.log(`📧 Sender:    ${gmailUser}`);
console.log(`📬 Recipient: ${recipient}`);
console.log('⚙️  Generating official PDF invoice...');

// Mock booking data with full breakdown
const sampleBooking = {
  ref: 'CMPG-INV-8492',
  dateIssued: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
  name: 'Rohith Kumar',
  guestName: 'Rohith Kumar',
  phone: '+91 99497 85344',
  email: recipient,
  room: '2 Sharing',
  roomName: '2-Sharing Executive Room',
  climate: 'Non-AC',
  floor: '2nd Floor - East Wing',
  roomNo: 'Room 204',
  checkIn: '01 Oct 2026',
  date: '01 Oct 2026',
  duration: '1 Month',
  stayTotal: 8500,
  monthlyRent: 8500,
  monthly_rent: 8500,
  securityDeposit: 5400,
  security_deposit: 5400,
  payableOnMoveIn: 13900,
  payable_move_in: 13900,
  tokenPaid: 13900,
  token_amount: 13900,
  utrNumber: '526194729103',
  upi_utr: '526194729103',
  paymentMode: 'UPI (PhonePe / GPay)',
  status: 'Paid in Full'
};

const hostelInfo = {
  name: 'Chaitanya Mens PG & Hostel',
  address: '18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar, Hanamkonda',
  phone: '+91 99497 85344',
  email: 'chaitnyamenspg@gmail.com',
  manager: 'Manager Desk',
  upiId: '9949785344@ybl'
};

try {
  // 1. Build PDF in memory
  const pdfBytes = await buildInvoicePdfDoc(sampleBooking, hostelInfo);
  const pdfBuffer = Buffer.from(pdfBytes);
  console.log(`✅ PDF invoice generated successfully (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

  // 2. Set up Nodemailer transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPass
    }
  });

  console.log('🔌 Verifying SMTP transport connection with Google...');
  await transporter.verify();
  console.log('✅ Google SMTP authentication successful!');

  // 3. Compose rich HTML email with attached PDF
  const htmlContent = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
    <div style="background: #ca4e00; padding: 24px; text-align: left; color: #ffffff;">
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em;">Chaitanya Mens PG & Hostel</h1>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #fed7aa;">Executive Living & Student PG — Naimnagar, Hanamkonda</p>
    </div>
    <div style="padding: 24px; color: #1f2937; font-size: 14px; line-height: 1.6;">
      <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
        <p style="margin: 0; color: #ca4e00; font-weight: 600;">✓ Payment Submitted — Pending Move-In Validation</p>
        <p style="margin: 2px 0 0; color: #9a3412; font-size: 13px;">Reference ID: <strong>${sampleBooking.ref}</strong> | UPI UTR: <strong>${sampleBooking.utrNumber}</strong></p>
      </div>

      <p>Hello <strong>${sampleBooking.guestName}</strong>,</p>
      <p>Thank you for choosing Chaitanya Mens PG. Your room reservation has been submitted. <em>Please note that your payment is not yet validated; it will be validated by the manager before you move in.</em></p>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 13px;">
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Room Details</td>
          <td style="padding: 8px 0; font-weight: 600; text-align: right;">${sampleBooking.roomName} (${sampleBooking.roomNo})</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Check-in Date</td>
          <td style="padding: 8px 0; font-weight: 600; text-align: right;">${sampleBooking.checkIn}</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Monthly Rent</td>
          <td style="padding: 8px 0; font-weight: 600; text-align: right;">Rs. 8,500</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #6b7280;">Security Deposit (Refundable)</td>
          <td style="padding: 8px 0; font-weight: 600; text-align: right;">Rs. 5,400</td>
        </tr>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <td style="padding: 8px 0; color: #ea580c;">Payment Submitted Online via UPI</td>
          <td style="padding: 8px 0; font-weight: 700; color: #ea580c; text-align: right;">- Rs. 13,900</td>
        </tr>
        <tr style="background: #fff7ed; font-size: 14px;">
          <td style="padding: 12px 8px; font-weight: 700; color: #ca4e00;">Payment Status</td>
          <td style="padding: 12px 8px; font-weight: 700; color: #ca4e00; text-align: right;">To Be Validated on Move-In</td>
        </tr>
      </table>

      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; margin-top: 16px;">
        <p style="margin: 0; font-size: 13px; color: #374151;">
          📎 <strong>Official Booking Invoice PDF Attached</strong><br/>
          An official invoice containing complete reservation details, zero-balance breakdown, and hostel terms is attached to this email.
        </p>
      </div>

      <p style="margin-top: 24px; font-size: 12px; color: #6b7280; text-align: center;">
        Need help? Call Manager: <strong>+91 99497 85344</strong><br/>
        18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar, Hanamkonda
      </p>
    </div>
  </div>
  `;

  console.log(`📤 Sending invoice email with PDF attachment to ${recipient}...`);

  const plainTextContent = `
Chaitanya Mens PG & Hostel
Executive Living & Student PG — Naimnagar, Hanamkonda

Hello ${sampleBooking.guestName},

Thank you for choosing Chaitanya Mens PG. Your room reservation has been recorded.

IMPORTANT: Please note that your payment is not yet validated. It will be validated by the manager before you move in.

Reservation Details:
- Booking Reference: ${sampleBooking.ref}
- Room: ${sampleBooking.roomName} (${sampleBooking.roomNo})
- Check-in Date: ${sampleBooking.checkIn}
- Monthly Rent: Rs. 8,500
- Refundable Security Deposit: Rs. 5,400
- Payment Submitted via UPI: Rs. 13,900 (UPI UTR: ${sampleBooking.utrNumber})
- Status: To be validated before move-in

Your official booking receipt and room details are attached as a PDF: Booking-Confirmation-${sampleBooking.ref}.pdf.

Hostel Contact:
Manager Desk: +91 99497 85344
Address: 18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar, Hanamkonda
  `.trim();

  const info = await transporter.sendMail({
    from: `"Chaitanya Mens PG" <${gmailUser}>`,
    to: recipient,
    replyTo: gmailUser,
    subject: `Reservation Confirmed - ${sampleBooking.ref} | Chaitanya Mens PG`,
    text: plainTextContent,
    html: htmlContent,
    attachments: [
      {
        filename: `Booking-Confirmation-${sampleBooking.ref}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });

  console.log('\n======================================================');
  console.log('🎉 INVOICE EMAIL SENT SUCCESSFULLY!');
  console.log(`📬 Message ID: ${info.messageId}`);
  console.log(`📎 Attachment: Booking-Confirmation-${sampleBooking.ref}.pdf`);
  console.log(`📨 Delivered to: ${recipient}`);
  console.log('======================================================\n');
} catch (err) {
  console.error('\n❌ Failed to send email:', err.message);
  if (err.code === 'EAUTH') {
    console.error('👉 Tip: Google rejected the authentication.');
    console.error('   Ensure 2-Step Verification is active on the Google Account and use a 16-character App Password (not your standard Gmail login password).');
  }
  process.exit(1);
}
