import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getLogoPngBytes } from './logo-data.js';

// Premium Midnight Navy + Champagne Gold Theme (#111827 + #C9A45C)
const NAVY       = rgb(0.067, 0.094, 0.153); // #111827 Midnight Navy
const GOLD       = rgb(0.788, 0.643, 0.361); // #C9A45C Champagne Gold
const CHARCOAL   = rgb(0.122, 0.161, 0.216); // #1F2937 Charcoal
const SLATE      = rgb(0.420, 0.447, 0.502); // #6B7280 Slate
const BORDER     = rgb(0.851, 0.871, 0.906); // #D9DEE7 Cool Gray
const IVORY      = rgb(0.980, 0.976, 0.965); // #FAF9F6 Warm Ivory
const DEEP_GREEN = rgb(0.086, 0.502, 0.353); // #16805A Deep Green
const AMBER      = rgb(0.718, 0.475, 0.122); // #B7791F Amber

// Tinted card backgrounds & borders
const GREEN_TINT = rgb(0.941, 0.988, 0.965); // Soft green-ivory tint
const GREEN_BD   = rgb(0.655, 0.867, 0.776); // Soft green border
const AMBER_TINT = rgb(0.996, 0.980, 0.941); // Soft amber-ivory tint
const AMBER_BD   = rgb(0.933, 0.820, 0.651); // Soft amber border
const CRIMSON      = rgb(0.850, 0.200, 0.200); // Alert red
const CRIMSON_TINT = rgb(0.995, 0.960, 0.960); // Soft crimson-ivory tint
const CRIMSON_BD   = rgb(0.920, 0.680, 0.680); // Soft crimson border

const A4 = { w: 595.28, h: 841.89 };
const M = 40; // 40pt margin

/** Strip characters not encodable in standard WinAnsi Helvetica and normalize currency */
function cleanStr(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/₹/g, 'Rs. ')
    .replace(/[•●]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[^ -~ -ÿ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format INR number with Rs. prefix
 */
export function formatRs(amount) {
  if (typeof amount === 'string') {
    const num = parseInt(amount.replace(/[^\d]/g, ''), 10);
    if (!isNaN(num)) return 'Rs. ' + num.toLocaleString('en-IN');
    return cleanStr(amount);
  }
  if (typeof amount === 'number' && !isNaN(amount)) {
    return 'Rs. ' + amount.toLocaleString('en-IN');
  }
  return 'Rs. 0';
}

/**
 * Calculate accurate pricing breakdown using manager-configured prices
 */
export function calculateInvoicePricing(b = {}, p = {}) {
  // Option 1: Price Lock-in on Booking
  // If the booking has its own pricing snapshot from when it was booked, prioritize it;
  // otherwise, use the current configured pricing.
  let pricing = (b.pricing && typeof b.pricing === 'object' && Object.keys(b.pricing).length)
    ? b.pricing
    : p;

  if ((!pricing || !Object.keys(pricing).length) && typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem('chaitanya_hostel_config');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.pricing) pricing = parsed.pricing;
      }
    } catch (_) {}
  }
  if (!pricing) pricing = {};

  const roomStr = String(b.room || b.roomName || '2 Sharing').toLowerCase();
  let baseRent = Number(pricing.doubleBase) || 8500;
  let acAdd = Number(pricing.doubleAcAdd) || 1500;

  if (roomStr.includes('5') || roomStr.includes('five')) {
    baseRent = Number(pricing.fiveBase) || 4800;
    acAdd = Number(pricing.fiveAcAdd) || 600;
  } else if (roomStr.includes('4') || roomStr.includes('four')) {
    baseRent = Number(pricing.fourBase) || 5500;
    acAdd = Number(pricing.fourAcAdd) || 800;
  } else if (roomStr.includes('3') || roomStr.includes('triple')) {
    baseRent = Number(pricing.tripleBase) || 6500;
    acAdd = Number(pricing.tripleAcAdd) || 1000;
  } else {
    baseRent = Number(pricing.doubleBase) || 8500;
    acAdd = Number(pricing.doubleAcAdd) || 1500;
  }

  const climateStr = String(b.climate || (roomStr.includes('non-ac') ? 'nonac' : (roomStr.includes('ac') ? 'ac' : 'nonac'))).toLowerCase();
  const isAc = climateStr.includes('ac') && !climateStr.includes('non');
  const acCost = isAc ? acAdd : 0;
  const subtotal = baseRent + acCost;

  const durStr = String(b.duration || '1 Month');
  const isDaily = Boolean(b.is_daily || b.isDaily || durStr.toLowerCase().includes('day'));
  let durDays = 1;
  let durMonths = 1;
  let discountRate = 0;
  let discountAmount = 0;
  let calculatedRent = 0;
  let securityDeposit = 0;
  let dailyRate = 0;

  if (isDaily) {
    durDays = parseInt(durStr.replace(/[^\d]/g, ''), 10) || 1;
    const dailyBase = Number(pricing.dailyRate) || 350;
    const dailyAc = Number(pricing.dailyAcAdd) || 100;
    dailyRate = dailyBase + (isAc ? dailyAc : 0);
    calculatedRent = dailyRate * durDays;
    securityDeposit = 0; // Deposit waived for day-wise stays
  } else {
    durMonths = parseInt(durStr.replace(/[^\d]/g, ''), 10) || 1;
    if (durMonths >= 12) discountRate = (Number(pricing.disc12m) || 15) / 100;
    else if (durMonths >= 6) discountRate = (Number(pricing.disc6m) || 10) / 100;
    else if (durMonths >= 3) discountRate = (Number(pricing.disc3m) || 5) / 100;

    discountAmount = Math.round(subtotal * discountRate);
    calculatedRent = subtotal - discountAmount;
    securityDeposit = (pricing.securityDeposit !== undefined && pricing.securityDeposit !== null)
      ? Number(pricing.securityDeposit)
      : 5400;
  }

  const stayTotal = isDaily ? calculatedRent : calculatedRent * durMonths;
  const moveInTotal = stayTotal + securityDeposit;
  let termSavings = isDaily ? 0 : discountAmount * durMonths;
  if (b.term_savings) {
    const rawS = parseInt(String(b.term_savings).replace(/[^\d]/g, ''), 10);
    if (!isNaN(rawS) && rawS > 0) termSavings = rawS;
  }

  // Preserve locked-in booking price if recorded on the booking record;
  // fall back to configured calculated rate for new bookings.
  let finalMonthly = calculatedRent;
  if (b.monthly_rent || b.monthly) {
    const rawM = parseInt(String(b.monthly_rent || b.monthly).replace(/[^\d]/g, ''), 10);
    if (!isNaN(rawM) && rawM > 0) finalMonthly = rawM;
  }

  let finalDeposit = securityDeposit;
  if (b.security_deposit || b.deposit) {
    const rawD = parseInt(String(b.security_deposit || b.deposit).replace(/[^\d]/g, ''), 10);
    if (!isNaN(rawD) && rawD >= 0) finalDeposit = rawD;
  }

  let finalMoveIn = isDaily ? finalMonthly : (finalMonthly * durMonths) + finalDeposit;
  if (b.payable_move_in || b.payableOnMoveIn) {
    const rawP = parseInt(String(b.payable_move_in || b.payableOnMoveIn).replace(/[^\d]/g, ''), 10);
    if (!isNaN(rawP) && rawP > 0) finalMoveIn = rawP;
  }

  return {
    baseRent,
    acCost,
    isAc,
    isDaily,
    durDays,
    durMonths,
    dailyRate,
    discountRate,
    termSavings: termSavings > 0 ? termSavings : 0,
    monthlyRent: finalMonthly,
    securityDeposit: finalDeposit,
    moveInTotal: finalMoveIn
  };
}

/**
 * Build the full vector PDF invoice bytes
 */
export async function buildInvoicePdfDoc(b, h = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${cleanStr(b.ref || 'CMPG')}`);
  doc.setSubject(`Booking Invoice - ${cleanStr(h.name || 'Chaitanya Mens PG & Hostel')}`);
  doc.setProducer(cleanStr(h.name || 'Chaitanya Mens PG & Hostel'));

  const page = doc.addPage([A4.w, A4.h]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const obliq = await doc.embedFont(StandardFonts.HelveticaOblique);

  const text = (s, x, y, size = 9.5, font = reg, color = CHARCOAL) => {
    page.drawText(cleanStr(s), { x, y, size, font, color });
  };

  const textR = (s, xRight, y, size = 9.5, font = reg, color = CHARCOAL) => {
    const str = cleanStr(s);
    const w = font.widthOfTextAtSize(str, size);
    page.drawText(str, { x: xRight - w, y, size, font, color });
  };

  const rule = (y, x1 = M, x2 = A4.w - M, color = BORDER, thickness = 0.75) => {
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  };

  // 1. TOP HEADER BRAND BANNER WITH OFFICIAL LOGO
  const headerH = 96;
  page.drawRectangle({
    x: 0,
    y: A4.h - headerH,
    width: A4.w,
    height: headerH,
    color: NAVY,
  });
  // Champagne Gold brand accent bar
  page.drawRectangle({
    x: 0,
    y: A4.h - headerH,
    width: A4.w,
    height: 2.5,
    color: GOLD,
  });

  let logoImage = null;
  try {
    const logoBytes = getLogoPngBytes();
    if (logoBytes && logoBytes.length > 0) {
      logoImage = await doc.embedPng(logoBytes);
    }
  } catch (err) {
    console.warn('[invoice-pdf] Logo embed failed, falling back to text:', err);
  }

  const hostelName = h.name || 'Chaitanya Mens PG & Hostel';
  if (logoImage) {
    const logoH = 58;
    const logoW = Math.round(logoH * (922 / 380)); // 141
    const logoY = A4.h - headerH + Math.round((headerH - logoH) / 2) + 1;
    page.drawImage(logoImage, {
      x: M,
      y: logoY,
      width: logoW,
      height: logoH,
    });
    text('Executive Living & Student PG', M + logoW + 16, A4.h - 44, 9.5, bold, rgb(0.96, 0.97, 0.98));
    text('Naimnagar, Hanamkonda · Telangana', M + logoW + 16, A4.h - 59, 8.5, reg, rgb(0.75, 0.78, 0.82));
    text('STAY  |  STUDY  |  GROW', M + logoW + 16, A4.h - 73, 8, bold, GOLD);
  } else {
    text(hostelName, M, A4.h - 44, 18, bold, rgb(1, 1, 1));
    text('Executive Living & Student PG - Naimnagar, Hanamkonda', M, A4.h - 64, 9.5, reg, rgb(0.75, 0.78, 0.82));
    text('STAY | STUDY | GROW', M, A4.h - 78, 8, bold, GOLD);
  }

  const isAccepted = b.status === 'accepted' ||
                     b.paymentStatus === 'paid' ||
                     b.payment_status === 'paid' ||
                     b.isVerified === true ||
                     b.verified === true ||
                     !!b.paidAt ||
                     !!b.paid_at;

  textR('OFFICIAL INVOICE', A4.w - M, A4.h - 42, 15, bold, rgb(1, 1, 1));
  textR(b.ref || '#CMPG-BOOKING', A4.w - M, A4.h - 59, 11, bold, GOLD);
  if (isAccepted) {
    textR('VERIFIED & CONFIRMED', A4.w - M, A4.h - 73, 8, bold, rgb(0.45, 0.88, 0.65));
  } else {
    textR('PENDING MANAGER VERIFICATION', A4.w - M, A4.h - 73, 7.5, bold, rgb(0.96, 0.72, 0.3));
  }

  let curY = A4.h - headerH - 24;

  // 2. METADATA SUMMARY BAR
  const pricing = h.pricing || b.pricing || {};
  const calc = calculateInvoicePricing(b, pricing);

  const issueDate = b.dateIssued || new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  });

  const totalPayableVal = calc.moveInTotal;
  const totalPayableStr = 'Rs. ' + totalPayableVal.toLocaleString('en-IN');
  const depositVal = calc.securityDeposit;
  const depositStr = 'Rs. ' + depositVal.toLocaleString('en-IN');
  const rawUtr = (b.upi_utr || b.utr || '').trim();

  // If not verified/accepted by manager, payment is strictly NOT considered paid
  const amountPaidVal = isAccepted ? totalPayableVal : 0;
  const amountPaidStr = isAccepted ? totalPayableStr : 'Rs. 0';
  const balanceDueVal = isAccepted ? 0 : totalPayableVal;
  const balanceDueStr = isAccepted ? 'Rs. 0 (Fully Paid)' : totalPayableStr;

  page.drawRectangle({
    x: M,
    y: curY - 34,
    width: A4.w - M * 2,
    height: 42,
    color: IVORY,
    borderColor: BORDER,
    borderWidth: 0.8,
  });

  const colW = (A4.w - M * 2) / 4;
  text('INVOICE DATE', M + 14, curY - 6, 7.5, bold, SLATE);
  text(issueDate, M + 14, curY - 22, 10, bold, CHARCOAL);

  text('PAYMENT STATUS', M + colW + 10, curY - 6, 7.5, bold, SLATE);
  if (isAccepted) {
    text('Verified & Confirmed', M + colW + 10, curY - 22, 9.5, bold, DEEP_GREEN);
  } else {
    text('PENDING VERIFICATION', M + colW + 10, curY - 18, 8, bold, AMBER);
    text('Not considered paid', M + colW + 10, curY - 28, 7.5, bold, CRIMSON);
  }

  text('PAYMENT MODE', M + colW * 2 + 10, curY - 6, 7.5, bold, SLATE);
  text('UPI Instant Transfer', M + colW * 2 + 10, curY - 22, 10, bold, CHARCOAL);

  text('TOTAL AMOUNT', M + colW * 3 + 10, curY - 6, 7.5, bold, SLATE);
  text(totalPayableStr, M + colW * 3 + 10, curY - 22, 11, bold, NAVY);

  curY -= 54;

  // 3. TWO-COLUMN: BILLED TO vs HOSTEL CONTACT
  const midX = M + (A4.w - M * 2) * 0.50;

  text('BILLED TO (RESIDENT)', M, curY, 8.5, bold, NAVY);
  text('HOSTEL DETAILS', midX, curY, 8.5, bold, NAVY);
  curY -= 8;
  rule(curY, M, midX - 16, BORDER, 0.6);
  rule(curY, midX, A4.w - M, BORDER, 0.6);

  curY -= 15;
  text(b.name || 'Resident Name', M, curY, 11, bold, CHARCOAL);
  text(hostelName, midX, curY, 10.5, bold, CHARCOAL);

  curY -= 14;
  text(`Phone: ${b.phone || '-'}`, M, curY, 8.5, reg, CHARCOAL);
  text('18-5-38/1, Beside Siva Kumar Clinic,', midX, curY, 8.5, reg, SLATE);

  curY -= 12;
  if (b.email) text(`Email: ${b.email}`, M, curY, 8.5, reg, SLATE);
  text('Venkateshwara Colony, Naimnagar,', midX, curY, 8.5, reg, SLATE);

  curY -= 12;
  const residentIdLine = (b.id_type || b.id_number)
    ? `Govt ID: ${b.id_type || 'ID'}${b.id_number ? ` (${b.id_number})` : ''}`
    : (b.workplace ? `College/Org: ${b.workplace}` : '');
  if (residentIdLine) text(residentIdLine, M, curY, 8.5, reg, SLATE);
  text('Hanamkonda, Telangana - 506001', midX, curY, 8.5, reg, SLATE);

  curY -= 12;
  const hostelEmail = (h.email && h.email !== 'jareenaworks@gmail.com') ? h.email : 'chaitnyamenspg@gmail.com';
  text(`Phone: ${h.phone || '+91 99497 85344'} | ${hostelEmail}`, midX, curY, 8, reg, SLATE);

  curY -= 20;

  // 4. BOOKING PARTICULARS & PRICING BREAKDOWN TABLE
  text('BOOKING & ACCOMMODATION CHARGES', M, curY, 8.5, bold, NAVY);
  textR('DETAILS / AMOUNT', A4.w - M, curY, 8.5, bold, NAVY);
  curY -= 6;
  // Thin champagne-gold line underneath
  rule(curY, M, A4.w - M, GOLD, 1.0);
  curY -= 16;

  const tableRows = [
    { label: 'Room Sharing Accommodation', val: b.room || '2 Sharing' },
    { label: 'Climate / Ventilation Plan', val: b.climate || (calc.isAc ? 'AC' : 'Non-AC') },
    { label: 'Preferred Floor', val: b.floor || 'Any Floor' },
    { label: 'Scheduled Move-In Date', val: b.date || b.move_in_date || '-' },
  ];

  if (calc.isDaily) {
    tableRows.push({
      label: 'Intended Stay Duration',
      val: b.duration || `${calc.durDays} Day${calc.durDays > 1 ? 's' : ''} (Daily Stay)`
    });
    tableRows.push({
      label: 'Daily Tariff Rate',
      val: 'Rs. ' + calc.dailyRate.toLocaleString('en-IN') + ' / day'
    });
    tableRows.push({
      label: 'Stay Rent Subtotal',
      val: 'Rs. ' + calc.monthlyRent.toLocaleString('en-IN')
    });
    tableRows.push({
      label: 'Security Deposit (Waived)',
      val: 'Rs. 0 (Not applicable)',
      note: 'No security deposit required for day-wise stay'
    });
  } else {
    tableRows.push({
      label: 'Intended Stay Duration',
      val: b.duration || (calc.durMonths + ' Month' + (calc.durMonths > 1 ? 's' : ''))
    });
    tableRows.push({
      label: 'Monthly Subtotal (Rent)',
      val: 'Rs. ' + calc.monthlyRent.toLocaleString('en-IN') + ' / mo'
    });
    const termSavingsVal = (b.term_savings ? parseInt(String(b.term_savings).replace(/[^\d]/g, ''), 10) : 0) || calc.termSavings;
    if (termSavingsVal > 0) {
      tableRows.push({
        label: 'Long-term Savings / Discount',
        val: b.term_savings ? cleanStr(b.term_savings) : `- Rs. ${termSavingsVal.toLocaleString('en-IN')}`,
        highlight: DEEP_GREEN,
      });
    }
    tableRows.push({
      label: 'Security Deposit (100% Refundable)',
      val: depositStr,
      note: 'Refunded upon move-out',
    });
  }

  if (b.id_type || b.id_number) {
    tableRows.push({
      label: 'Resident ID Verification',
      val: `${b.id_type || 'Govt ID'}${b.id_number ? ` (${b.id_number})` : ''}`,
      note: 'Verified Resident ID'
    });
  }

  tableRows.push({
    label: calc.isDaily ? 'Total Move-In Tariff' : 'Total Move-In Charges',
    val: totalPayableStr,
    sub: b.move_in_scope || (calc.isDaily ? `${calc.durDays} days stay tariff (no deposit)` : (calc.durMonths > 1 ? `${calc.durMonths} months' rent + deposit` : "First month's rent + deposit")),
  });

  if (isAccepted) {
    tableRows.push({
      label: 'Total Move-In Paid via UPI',
      val: `- ${totalPayableStr}`,
      highlight: DEEP_GREEN,
      note: rawUtr ? `UTR: ${rawUtr} (Verified & Approved)` : 'Verified & Approved',
    });
    tableRows.push({
      label: 'Remaining Balance Due on Move-In',
      val: 'Rs. 0 — Fully Paid',
      isTotal: true,
      sub: 'All move-in charges fully settled (Rent + Security Deposit)',
    });
  } else {
    if (rawUtr) {
      tableRows.push({
        label: 'Submitted Payment Reference (UPI)',
        val: `UTR: ${rawUtr}`,
        note: 'Pending manager verification',
      });
    }
    tableRows.push({
      label: 'Verified Amount Paid / Credited',
      val: 'Rs. 0 (Pending Verification)',
      highlight: CRIMSON,
      note: 'Not considered paid until verified',
    });
    tableRows.push({
      label: 'Total Balance Due on Move-In',
      val: totalPayableStr,
      isTotal: true,
      sub: 'Until verification from manager, this is NOT considered as paid',
    });
  }

  for (const r of tableRows) {
    if (r.isTotal) {
      curY -= 4;
      rule(curY, M, A4.w - M, GOLD, 1.0);
      curY -= 18;

      page.drawRectangle({
        x: M,
        y: curY - 14,
        width: A4.w - M * 2,
        height: 32,
        color: IVORY,
        borderColor: BORDER,
        borderWidth: 0.8,
      });

      text(r.label, M + 12, curY + 2, 10.5, bold, NAVY);
      if (r.sub) text(r.sub, M + 12, curY - 9, 7.5, reg, SLATE);
      textR(r.val, A4.w - M - 12, curY - 2, 12, bold, isAccepted ? DEEP_GREEN : CRIMSON);

      curY -= 26;
    } else {
      text(r.label, M + 8, curY, 9, reg, CHARCOAL);
      if (r.note) {
        text(`(${r.note})`, M + 8 + bold.widthOfTextAtSize(r.label, 9) + 6, curY, 7.5, obliq, SLATE);
      }
      textR(r.val, A4.w - M - 8, curY, 9.5, bold, r.highlight || CHARCOAL);
      curY -= 10;
      rule(curY, M, A4.w - M, BORDER, 0.5);
      curY -= 14;
    }
  }

  curY -= 6;

  // 5. PAYMENT STATUS CARD (Highlighted)
  page.drawRectangle({
    x: M,
    y: curY - 60,
    width: A4.w - M * 2,
    height: 68,
    color: isAccepted ? GREEN_TINT : CRIMSON_TINT,
    borderColor: isAccepted ? GREEN_BD : CRIMSON_BD,
    borderWidth: 1.0,
  });

  if (isAccepted) {
    text('TOTAL MOVE-IN PAYMENT VERIFIED & CONFIRMED', M + 16, curY - 12, 8.5, bold, DEEP_GREEN);
    text('Note: Full move-in payment (Rent + Refundable Deposit) verified against bank records. Bed confirmed.', M + 16, curY - 26, 8, obliq, SLATE);
    const utrDisplay = rawUtr ? `Verified Bank UTR: ${rawUtr}` : 'Verified by Hostel Management';
    text(utrDisplay, M + 16, curY - 44, 9.5, bold, CHARCOAL);
    textR(totalPayableStr, A4.w - M - 18, curY - 20, 18, bold, NAVY);
    textR(`${totalPayableStr} — FULL PAYMENT`, A4.w - M - 18, curY - 40, 8.5, bold, DEEP_GREEN);
  } else {
    text('PAYMENT STATUS: PENDING MANAGER VERIFICATION', M + 16, curY - 12, 8.5, bold, CRIMSON);
    text('IMPORTANT: Until verification from the manager, this is NOT considered as paid.', M + 16, curY - 26, 8, bold, CHARCOAL);
    const utrDisplay = rawUtr ? `Submitted UPI Ref (UTR): ${rawUtr}` : 'UPI Ref (UTR): Pending Submission';
    text(utrDisplay, M + 16, curY - 44, 9.5, bold, CHARCOAL);
    textR('STATUS: UNVERIFIED', A4.w - M - 18, curY - 20, 13, bold, CRIMSON);
    textR('NOT CONSIDERED AS PAID', A4.w - M - 18, curY - 38, 7.5, bold, CRIMSON);
  }

  curY -= 80;

  // 6. TERMS & POLICIES SUMMARY
  text('HOSTEL POLICIES & IMPORTANT INFORMATION', M, curY, 8, bold, NAVY);
  curY -= 6;
  rule(curY, M, A4.w - M, BORDER, 0.75);
  curY -= 14;

  const validationNote = isAccepted
    ? '- Payment Validation: Verified and officially accepted by hostel management against bank credit records.'
    : '- STRICT PAYMENT POLICY: Until verification from the hostel manager against bank records, this is NOT considered as paid. Bed allocation is finalized only upon manager approval.';

  const notes = [
    validationNote,
    '- 100% Refundable Deposit: The security deposit is refunded within 3 days of vacating with 30 days notice.',
    '- Inclusions: 3 daily hygienic homely meals, high-speed Wi-Fi, 24/7 CCTV, RO purified water, biometric access.',
    '- Visiting Hours: 24/7 access with biometric security for enrolled hostel residents.',
  ];

  for (const n of notes) {
    text(n, M + 4, curY, 8, reg, SLATE);
    curY -= 12;
  }

  // 7. FOOTER
  rule(M + 36, M, A4.w - M, BORDER, 0.8);
  text(`${hostelName} - Official Booking Receipt`, M, M + 22, 8.5, bold, CHARCOAL);
  text('18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar, Hanamkonda | +91 99497 85344', M, M + 10, 7.5, reg, SLATE);
  textR('Computer generated - valid without physical signature', A4.w - M, M + 22, 7.5, obliq, SLATE);

  return await doc.save();
}

/**
 * Trigger immediate browser download of the PDF
 */
export async function downloadInvoicePdf(booking, hostel) {
  try {
    const pdfBytes = await buildInvoicePdfDoc(booking, hostel);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeRef = (booking.ref || 'Booking').replace(/[^a-zA-Z0-9_-]/g, '');
    link.href = url;
    link.download = `Invoice-${safeRef}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch (err) {
    console.error('[invoice] download failed:', err);
    return false;
  }
}
