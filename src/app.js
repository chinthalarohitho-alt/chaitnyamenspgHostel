/**
 * CHAITANYA MEN'S PG HOSTEL — INTERACTIVE LOGIC & OCCUPANCY ENGINE
 * Features:
 * - Real-Time Bed Occupancy & Capacity Intelligence (Vacant vs House Full)
 * - Interactive Visual Floor & Bed Map Modal
 * - Warden Management Portal (Supabase Auth + authenticator) & Live Steppers
 * - Recent Booking Social Proof Ticker (Toast Notifications)
 * - Mobile Navigation Drawer & Backdrop
 * - AC / Non-AC Pricing Switcher
 * - Interactive Room Booking Selection & Live Price Estimator
 * - Gallery Category Filter & Modal Lightbox
 * - Client-side Form Validation & Direct WhatsApp Alert to Warden
 */

import {
  supabaseReady, fetchSiteConfig, saveSiteConfig,
  submitBooking, sendInvoiceEmail, fetchBookings, clearBookings, onBookingsChange,
  markBookingPaid, acceptBookingWithUtr, rejectBooking, updateLocalBooking, getLocalBookings,
  signIn, verifyMfaCode, signOut, isManager, currentUser,
  enrollAuthenticator, confirmAuthenticator, hasAuthenticator
} from './supabase-client.js';

// Imported so Vite rewrites it to the hashed filename it emits. A bare
// "assets/…" string in JS is NOT rewritten, and 404s in a production build.
import heroExteriorUrl from './assets/hostel-exterior.jpg';

import { mountLottie, destroyLottie } from './lottie-anim.js';
import { buildUpiUri, renderQr, submitUtr, setBookingEmail } from './upi-token.js';
import { downloadInvoicePdf, calculateInvoicePricing, calculateStayPeriod, normalizeBookingDate } from './invoice-pdf.js';
import {
  validateUpiId, validateUtr, validateEmail, validatePhone,
  validateWhatsApp, validateMoney, validatePercent, markField, validatePhotoUrl} from './validate.js';
import emptyInboxAnim from './assets/lottie/empty-inbox.json';
import spinnerAnim from './assets/lottie/spinner.json';
import houseFullAnim from './assets/lottie/house-full.json';

let currentBookingContext = null;

document.addEventListener('DOMContentLoaded', () => {
  initMobileDrawer();
  initHeaderScroll();
  initBedInventory();
  initBedMapModal();
  initWardenPortal();
  initBookingToasts();
  initAppConfirmModal();
  initHeroScrollCue();
  initIslandNav();
  initCalcStepper();
  initPricingToggle();
  initRoomCalculator();
  initGallery();
  initBookingForm();
  initIdProofModal();
  initRoomInspector();
  initMotionReveals();
  initFramerMotionCards();
  initFooterYear();
  initCustomDatePicker();
  initCustomSelects();
  initConfirmSteps();
  initUpiIdField();
  initAmenitiesRulesTabs();
  initCinematicHero();
  initRoutineScrollShowcase();
  initGalleryScrollShowcase();
  initFooterCalcLinks();
  initDirectWhatsAppPopup();
  // Paint from cache immediately, then refresh from Supabase.
  applyHostelConfigToSite(getHostelConfig());
  hydrateConfigFromServer();
});

/* ===================================================================
   CONFIRMATION MODAL — 3 STEPS
   -------------------------------------------------------------------
   1 Received · 2 Pay token · 3 Confirm
   When no UPI id is configured, steps 2 and 3 do not exist for that
   visitor: the bar collapses to a single step and the WhatsApp
   hand-off on step 1 becomes the only action.
   =================================================================== */

let confirmSteps = 3;
/* Which step the visitor is on, and whether the token step is finished.
   The dismissal guard needs both: it only intervenes on the steps that
   cannot be reopened, and only while there is still something to lose. */
let currentConfirmStep = 1;
let tokenStepSettled = false;
let activeUpiUri = '';
let activeAdvanceUpiUri = '';

function gotoConfirmStep(n) {
  const dialog = document.querySelector('#confirmationModal .confirm-dialog');
  if (!dialog) return;
  currentConfirmStep = n;
  dialog.querySelectorAll('.cstep').forEach(sec => {
    sec.classList.toggle('is-active', Number(sec.dataset.step) === n);
  });
  dialog.querySelectorAll('.cstep-dot').forEach(dot => {
    const d = Number(dot.dataset.step);
    dot.classList.toggle('is-current', d === n);
    dot.classList.toggle('is-done', d < n);
  });
  dialog.scrollTop = 0;
  if (n === 2) {
    if (currentBookingContext?.payment_mode === 'advance' && activeAdvanceUpiUri) {
      const qrAdv = document.getElementById('upiQrAdvance');
      if (qrAdv) renderQr(qrAdv, activeAdvanceUpiUri);
    } else if (activeUpiUri) {
      const qrCanvas = document.getElementById('upiQr');
      if (qrCanvas) renderQr(qrCanvas, activeUpiUri);
    }
  }
}

/** Prepare the token steps, or hide them when no UPI id is set. */
function showUpiToken(ref) {
  const bar = document.getElementById('cstepBar');
  const cfg = getHostelConfig();
  const vpa = (cfg?.texts?.upiId || '9949785344@ybl').trim();

  // Total Move-in Amount (Rent + Refundable Deposit): dynamically pull full payable amount to wire via UPI
  let amount = 0;
  if (currentBookingContext && (currentBookingContext.payable_move_in || currentBookingContext.totalPayable || currentBookingContext.total)) {
    amount = parseInt(String(currentBookingContext.payable_move_in || currentBookingContext.totalPayable || currentBookingContext.total).replace(/[^\d]/g, ''), 10) || 0;
  }
  if (!amount) {
    const moveInEl = document.getElementById('dispMoveInTotal');
    if (moveInEl) amount = parseInt(moveInEl.textContent.replace(/[^\d]/g, ''), 10) || 0;
  }
  if (!amount && currentBookingContext && currentBookingContext.security_deposit) {
    const dep = parseInt(String(currentBookingContext.security_deposit).replace(/[^\d]/g, ''), 10) || 0;
    const rent = parseInt(String(currentBookingContext.monthly_rent || '').replace(/[^\d]/g, ''), 10) || 0;
    amount = dep + rent;
  }
  if (!amount) {
    const p = cfg?.pricing || {};
    const base = Number(p.doubleBase) || 8500;
    const dep = (p.securityDeposit !== undefined && p.securityDeposit !== null) ? Number(p.securityDeposit) : 5400;
    amount = base + dep;
  }

  // Advance amount calculations
  const configuredAdvance = Number(cfg?.pricing?.advanceAmount) || 1000;
  const advanceAmt = currentBookingContext?.advance_amount ? Number(currentBookingContext.advance_amount) : Math.min(amount, configuredAdvance);
  const balanceAmt = currentBookingContext?.balance_amount !== undefined && currentBookingContext?.balance_amount !== null
    ? Number(currentBookingContext.balance_amount)
    : Math.max(0, amount - advanceAmt);

  if (currentBookingContext) {
    currentBookingContext.advance_amount = advanceAmt;
    currentBookingContext.balance_amount = balanceAmt;
  }

  const payBtn = document.getElementById('cstepToPay');
  const advanceBtn = document.getElementById('cstepToAdvance');

  currentConfirmStep = 1;
  tokenStepSettled = false;

  if (!vpa || !amount) {
    confirmSteps = 1;
    if (bar) bar.hidden = true;
    if (payBtn) payBtn.hidden = true;
    if (advanceBtn) advanceBtn.hidden = true;
    return;
  }

  confirmSteps = 3;
  if (bar) bar.hidden = false;
  if (payBtn) payBtn.hidden = false;
  if (advanceBtn) advanceBtn.hidden = false;

  const uri = buildUpiUri({
    vpa,
    payeeName: cfg?.texts?.upiName || cfg?.texts?.hostelName,
    amount,
    ref,
    note: `Move-in payment ${ref}`
  });

  const advanceUri = buildUpiUri({
    vpa,
    payeeName: cfg?.texts?.upiName || cfg?.texts?.hostelName,
    amount: advanceAmt,
    ref,
    note: `Advance token ${ref}`
  });

  const money = `₹${amount.toLocaleString('en-IN')}`;
  const advanceMoney = `₹${advanceAmt.toLocaleString('en-IN')}`;
  const balanceMoney = `₹${balanceAmt.toLocaleString('en-IN')}`;

  const amtEl = document.getElementById('upiAmount');
  if (amtEl) amtEl.textContent = money;
  const payAmt = document.getElementById('cstepPayAmt');
  if (payAmt) payAmt.textContent = money;
  const advAmtEl = document.getElementById('cstepAdvanceAmt');
  if (advAmtEl) advAmtEl.textContent = advanceMoney;
  const advTokenDisp = document.getElementById('advanceTokenAmtDisp');
  if (advTokenDisp) advTokenDisp.textContent = advanceMoney;
  const advBalDisp = document.getElementById('advanceBalanceAmtDisp');
  if (advBalDisp) advBalDisp.textContent = balanceMoney;

  const cashAmtDisp = document.getElementById('cashAmountDisp');
  if (cashAmtDisp) cashAmtDisp.textContent = money;
  const cashBtnAmt = document.getElementById('cashBtnAmt');
  if (cashBtnAmt) cashBtnAmt.textContent = money;
  const step3CashAmt = document.getElementById('step3CashAmt');
  if (step3CashAmt) step3CashAmt.textContent = money;

  const vpaEl = document.getElementById('upiVpa');
  if (vpaEl) vpaEl.textContent = vpa;
  const openEl = document.getElementById('upiOpen');
  if (openEl) openEl.href = uri;

  const vpaAdvEl = document.getElementById('upiVpaAdvance');
  if (vpaAdvEl) vpaAdvEl.textContent = vpa;
  const openAdvEl = document.getElementById('upiOpenAdvance');
  if (openAdvEl) openAdvEl.href = advanceUri;

  activeUpiUri = uri;
  activeAdvanceUpiUri = advanceUri;
  renderQr(document.getElementById('upiQr'), uri);
  renderQr(document.getElementById('upiQrAdvance'), advanceUri);

  const input = document.getElementById('upiUtrInput');
  const btn = document.getElementById('upiUtrBtn');
  const msg = document.getElementById('upiMsg');
  const invoiceAction = document.getElementById('cstepInvoiceAction');
  if (invoiceAction) invoiceAction.style.display = 'none';
  if (input) { input.value = ''; input.disabled = false; }
  if (btn) { btn.disabled = false; btn.textContent = 'Submit'; btn.dataset.ref = ref; }
  if (msg) { msg.textContent = ''; msg.className = 'upi-msg'; }

  // Set initial tab based on booking context preference
  const isCash = currentBookingContext?.payment_mode === 'cash';
  const isAdvance = currentBookingContext?.payment_mode === 'advance';
  switchConfirmPayTab(isCash ? 'cash' : (isAdvance ? 'advance' : 'upi'));

  // Ask for an email only if the form didn't collect one. Casual browsers
  // are never nagged; anyone paying a token gets a receipt.
  const ask = document.getElementById('upiEmailAsk');
  const emailInput = document.getElementById('upiEmailInput');
  const emailMsg = document.getElementById('upiEmailMsg');
  const alreadyHave = Boolean((document.getElementById('guestEmail')?.dataset.captured || '').trim());
  if (ask) {
    ask.hidden = alreadyHave;
    ask.dataset.ref = ref;
    if (emailInput) emailInput.value = '';
    if (emailMsg) { emailMsg.textContent = ''; emailMsg.className = 'upi-msg'; }
  }
}

/** Switch between UPI, Advance Token, and Cash on Hand tabs in confirmation Step 2 */
function switchConfirmPayTab(mode) {
  const isCash = mode === 'cash';
  const isAdvance = mode === 'advance';
  const isUpi = !isCash && !isAdvance;

  const tabUpi = document.getElementById('payTabUpi');
  const tabAdvance = document.getElementById('payTabAdvance');
  const tabCash = document.getElementById('payTabCash');
  const panelUpi = document.getElementById('payPanelUpi');
  const panelAdvance = document.getElementById('payPanelAdvance');
  const panelCash = document.getElementById('payPanelCash');
  const headTitle = document.getElementById('step2HeadTitle');
  const headSub = document.getElementById('step2HeadSub');
  const modalPaymentMode = document.getElementById('modalPaymentMode');

  if (tabUpi) {
    tabUpi.classList.toggle('is-active', isUpi);
    tabUpi.setAttribute('aria-selected', isUpi ? 'true' : 'false');
  }
  if (tabAdvance) {
    tabAdvance.classList.toggle('is-active', isAdvance);
    tabAdvance.setAttribute('aria-selected', isAdvance ? 'true' : 'false');
  }
  if (tabCash) {
    tabCash.classList.toggle('is-active', isCash);
    tabCash.setAttribute('aria-selected', isCash ? 'true' : 'false');
  }

  if (panelUpi) panelUpi.style.display = isUpi ? 'block' : 'none';
  if (panelAdvance) panelAdvance.style.display = isAdvance ? 'block' : 'none';
  if (panelCash) panelCash.style.display = isCash ? 'block' : 'none';

  const fullAmt = document.getElementById('upiAmount')?.textContent || '₹13,900';
  const advAmt = document.getElementById('advanceTokenAmtDisp')?.textContent || '₹1,000';
  const balAmt = document.getElementById('advanceBalanceAmtDisp')?.textContent || '₹12,900';

  if (modalPaymentMode) {
    if (isCash) modalPaymentMode.textContent = 'Cash on Hand (Pay at Hostel)';
    else if (isAdvance) modalPaymentMode.textContent = `Advance Token (${advAmt} Now + ${balAmt} on Arrival)`;
    else modalPaymentMode.textContent = 'UPI Instant Transfer';
  }

  if (currentBookingContext) {
    currentBookingContext.payment_mode = isCash ? 'cash' : (isAdvance ? 'advance' : 'upi');
    currentBookingContext.paymentMode = isCash ? 'Cash on Hand' : (isAdvance ? 'Advance Token' : 'UPI Instant Transfer');
  }

  if (headTitle) {
    if (isCash) headTitle.textContent = 'Cash on Hand Payment';
    else if (isAdvance) headTitle.textContent = 'Pay Booking Advance Token';
    else headTitle.textContent = 'Pay via UPI / QR Scan';
  }
  if (headSub) {
    if (isCash) {
      headSub.innerHTML = `Pay <span class="upi-amount">${fullAmt}</span> in cash directly to the hostel manager when moving in.`;
    } else if (isAdvance) {
      headSub.innerHTML = `Scan to pay <span class="upi-amount">${advAmt}</span> advance token via UPI now to reserve your bed. Remaining balance <span class="upi-amount">${balAmt}</span> payable upon arrival.`;
    } else {
      headSub.innerHTML = `Scan to pay <span class="upi-amount">${fullAmt}</span> total move-in amount via UPI to confirm your room.`;
    }
  }

  if (isAdvance && activeAdvanceUpiUri) {
    const qrAdv = document.getElementById('upiQrAdvance');
    if (qrAdv) renderQr(qrAdv, activeAdvanceUpiUri);
  } else if (isUpi && activeUpiUri) {
    const qrCanvas = document.getElementById('upiQr');
    if (qrCanvas) renderQr(qrCanvas, activeUpiUri);
  }
}

/** One-time wiring for the step buttons. */
function initConfirmSteps() {
  const dialog = document.querySelector('#confirmationModal .confirm-dialog');
  if (!dialog || dialog.dataset.stepsBound) return;
  dialog.dataset.stepsBound = '1';

  document.getElementById('cstepToPay')?.addEventListener('click', () => {
    switchConfirmPayTab('upi');
    gotoConfirmStep(2);
  });

  document.getElementById('cstepToAdvance')?.addEventListener('click', () => {
    switchConfirmPayTab('advance');
    gotoConfirmStep(2);
  });

  document.getElementById('cstepToCash')?.addEventListener('click', () => {
    switchConfirmPayTab('cash');
    gotoConfirmStep(2);
  });

  document.getElementById('payTabUpi')?.addEventListener('click', () => switchConfirmPayTab('upi'));
  document.getElementById('payTabAdvance')?.addEventListener('click', () => switchConfirmPayTab('advance'));
  document.getElementById('payTabCash')?.addEventListener('click', () => switchConfirmPayTab('cash'));
  document.getElementById('cstepCashToUpi')?.addEventListener('click', () => switchConfirmPayTab('upi'));
  document.getElementById('cstepAdvanceToCash')?.addEventListener('click', () => switchConfirmPayTab('cash'));

  document.getElementById('cstepAdvanceToUtr')?.addEventListener('click', async () => {
    if (currentBookingContext) {
      currentBookingContext.payment_mode = 'advance';
      currentBookingContext.paymentMode = 'Advance Token';
    }
    const step3Title = document.getElementById('step3HeadTitle');
    const step3Sub = document.getElementById('step3HeadSub');
    const upiArea = document.getElementById('step3UpiArea');
    const cashArea = document.getElementById('step3CashArea');

    const advAmt = document.getElementById('advanceTokenAmtDisp')?.textContent || '₹1,000';
    if (step3Title) step3Title.textContent = 'Confirm Advance Payment';
    if (step3Sub) step3Sub.textContent = `Enter the 12-digit UPI reference for your ${advAmt} advance transfer.`;
    if (upiArea) upiArea.style.display = 'block';
    if (cashArea) cashArea.style.display = 'none';

    const ask = document.getElementById('upiEmailAsk');
    if (!ask || ask.hidden) { gotoConfirmStep(3); return; }

    const field = document.getElementById('upiEmailInput');
    const note = document.getElementById('upiEmailMsg');
    const value = (field?.value || '').trim();
    note.className = 'upi-msg';

    if (!value) {
      note.textContent = 'Add an email so we can send your invoice.';
      note.classList.add('is-err');
      field?.focus();
      return;
    }

    const res = await setBookingEmail(ask.dataset.ref, value);
    if (!res.ok) {
      note.textContent = res.error;
      note.classList.add(/does not look right/.test(res.error) ? 'is-err' : 'is-warn');
      if (/does not look right/.test(res.error)) { field?.focus(); return; }
    }
    ask.hidden = true;
    gotoConfirmStep(3);
  });

  document.getElementById('cstepConfirmCash')?.addEventListener('click', () => {
    if (currentBookingContext) {
      currentBookingContext.payment_mode = 'cash';
      currentBookingContext.paymentMode = 'Cash on Hand';
      currentBookingContext.payment_status = 'unpaid';
    }
    const rref = currentBookingContext?.ref;
    if (rref) {
      updateLocalBooking(rref, { payment_mode: 'cash', paymentMode: 'Cash on Hand' });
    }

    const step3Title = document.getElementById('step3HeadTitle');
    const step3Sub = document.getElementById('step3HeadSub');
    const upiArea = document.getElementById('step3UpiArea');
    const cashArea = document.getElementById('step3CashArea');
    const invoiceAction = document.getElementById('cstepInvoiceAction');

    if (step3Title) step3Title.textContent = 'Cash on Hand Registered';
    if (step3Sub) step3Sub.textContent = 'Your booking is recorded. Settle in cash upon arrival.';
    if (upiArea) upiArea.style.display = 'none';
    if (cashArea) cashArea.style.display = 'block';
    if (invoiceAction) invoiceAction.style.display = 'block';

    tokenStepSettled = true;
    gotoConfirmStep(3);

    showSiteToast('Cash on Hand Selected', 'Booking recorded. You can download your invoice receipt below.', 'fa-solid fa-money-bill-wave');

    if (currentBookingContext?.email) {
      const cfg = getHostelConfig();
      sendInvoiceEmail(currentBookingContext.ref, 'enquiry', {
        email: currentBookingContext.email,
        booking: currentBookingContext,
        hostel: cfg?.texts
      });
    }
  });

  document.getElementById('cstepToUtr')?.addEventListener('click', async () => {
    const step3Title = document.getElementById('step3HeadTitle');
    const step3Sub = document.getElementById('step3HeadSub');
    const upiArea = document.getElementById('step3UpiArea');
    const cashArea = document.getElementById('step3CashArea');

    if (step3Title) step3Title.textContent = 'Confirm your payment';
    if (step3Sub) step3Sub.textContent = 'Enter the 12-digit UPI reference from your payment app.';
    if (upiArea) upiArea.style.display = 'block';
    if (cashArea) cashArea.style.display = 'none';

    const ask = document.getElementById('upiEmailAsk');
    // Nothing asked for -> straight through.
    if (!ask || ask.hidden) { gotoConfirmStep(3); return; }

    const field = document.getElementById('upiEmailInput');
    const note = document.getElementById('upiEmailMsg');
    const value = (field?.value || '').trim();
    note.className = 'upi-msg';

    if (!value) {
      note.textContent = 'Add an email so we can send your invoice.';
      note.classList.add('is-err');
      field?.focus();
      return;
    }

    const res = await setBookingEmail(ask.dataset.ref, value);
    if (!res.ok) {
      note.textContent = res.error;
      // A transport failure is not the guest's fault and must not trap
      // them on this step — they have already paid.
      note.classList.add(/does not look right/.test(res.error) ? 'is-err' : 'is-warn');
      if (/does not look right/.test(res.error)) { field?.focus(); return; }
    }
    ask.hidden = true;
    gotoConfirmStep(3);
  });
  document.getElementById('cstepSkipPay')?.addEventListener('click', () => {
    const step3Title = document.getElementById('step3HeadTitle');
    const step3Sub = document.getElementById('step3HeadSub');
    const upiArea = document.getElementById('step3UpiArea');
    const cashArea = document.getElementById('step3CashArea');
    if (step3Title) step3Title.textContent = 'Confirm your payment';
    if (step3Sub) step3Sub.textContent = 'Enter the 12-digit UPI reference or settle with manager.';
    if (upiArea) upiArea.style.display = 'block';
    if (cashArea) cashArea.style.display = 'none';
    gotoConfirmStep(3);
  });

  // Let a visitor step back by clicking a completed dot.
  dialog.querySelectorAll('.cstep-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      const d = Number(dot.dataset.step);
      if (d <= confirmSteps && dot.classList.contains('is-done')) gotoConfirmStep(d);
    });
  });

  document.getElementById('upiCopy')?.addEventListener('click', async () => {
    const btn = document.getElementById('upiCopy');
    try {
      await navigator.clipboard.writeText(document.getElementById('upiVpa').textContent);
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 1600);
    } catch { /* clipboard blocked — the id is on screen to type */ }
  });

  document.getElementById('upiCopyAdvance')?.addEventListener('click', async () => {
    const btn = document.getElementById('upiCopyAdvance');
    try {
      await navigator.clipboard.writeText(document.getElementById('upiVpaAdvance').textContent);
      btn.innerHTML = '<i class="fa-solid fa-check"></i>';
      setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-copy"></i>'; }, 1600);
    } catch { /* clipboard blocked */ }
  });

  const btn = document.getElementById('upiUtrBtn');
  const input = document.getElementById('upiUtrInput');
  const msg = document.getElementById('upiMsg');
  const invoiceAction = document.getElementById('cstepInvoiceAction');
  const downloadBtn = document.getElementById('downloadInvoiceBtn');

  const step1DownloadBtn = document.getElementById('step1DownloadInvoiceBtn');

  async function handleInvoiceDownload(btnTarget) {
    if (!btnTarget) return;
    const liveUtr = (document.getElementById('upiUtrInput')?.value || '').replace(/\D/g, '').slice(0, 12);
    const guestEmailVal = (document.getElementById('upiEmailInput')?.value || document.getElementById('email')?.value || '').trim();
    const gName = (document.getElementById('fullName')?.value || document.getElementById('modalName')?.textContent || 'Resident').trim();
    const gPhone = (document.getElementById('phone')?.value || document.getElementById('modalPhone')?.textContent || '').trim();

    const cfg = getHostelConfig();
    const p = cfg?.pricing || {};

    if (!currentBookingContext) {
      const calcP = calculateInvoicePricing({
        room: document.getElementById('modalRoom')?.textContent || '2 Sharing',
        climate: document.getElementById('modalClimate')?.textContent || 'Non-AC',
        duration: '1 Month'
      }, p);
      const monthlyTotalStr = document.getElementById('dispMonthlyTotal')?.textContent?.trim() || `₹${calcP.monthlyRent.toLocaleString('en-IN')}`;
      const secDepositStr = document.getElementById('dispSecurityDeposit')?.textContent?.trim() || `₹${calcP.securityDeposit.toLocaleString('en-IN')}`;
      const moveInTotalStr = document.getElementById('dispMoveInTotal')?.textContent?.trim() || `₹${calcP.moveInTotal.toLocaleString('en-IN')}`;
      const moveInTotalNum = parseInt(moveInTotalStr.replace(/[^\d]/g, ''), 10) || calcP.moveInTotal;
      const secDepositNum = parseInt(secDepositStr.replace(/[^\d]/g, ''), 10) || calcP.securityDeposit;

      currentBookingContext = {
        ref: document.getElementById('modalRefCode')?.textContent || '#CMPG-BOOKING',
        name: gName,
        phone: gPhone,
        email: guestEmailVal,
        status: 'pending',
        payment_status: 'unpaid',
        paymentStatus: 'unpaid',
        isVerified: false,
        room: document.getElementById('modalRoom')?.textContent || '2 Sharing',
        climate: document.getElementById('modalClimate')?.textContent || 'Non-AC',
        floor: document.getElementById('preferredFloor')?.value || '1st Floor',
        date: document.getElementById('modalDate')?.textContent || '-',
        duration: '1 Month',
        monthly_rent: monthlyTotalStr,
        term_savings: document.getElementById('dispDiscountVal')?.textContent || '',
        security_deposit: secDepositStr,
        payable_move_in: moveInTotalStr,
        move_in_scope: document.getElementById('dispMoveInScope')?.textContent || "First month's rent + deposit",
        token_amount: moveInTotalNum,
        deposit_amount: secDepositNum,
        payment_amount: moveInTotalNum,
        paymentAmount: moveInTotalNum,
        upi_utr: liveUtr,
        pricing: p,
        dateIssued: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      };
    } else {
      if (liveUtr) currentBookingContext.upi_utr = liveUtr;
      if (guestEmailVal && !currentBookingContext.email) currentBookingContext.email = guestEmailVal;
      if (gName && (!currentBookingContext.name || currentBookingContext.name === 'Resident')) currentBookingContext.name = gName;
      if (gPhone && !currentBookingContext.phone) currentBookingContext.phone = gPhone;
      currentBookingContext.pricing = p;
    }
    const prevHtml = btnTarget.innerHTML;
    btnTarget.disabled = true;
    btnTarget.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>Generating Invoice...</span>';

    const hostelInfo = {
      name: cfg?.texts?.hostelName || 'Chaitanya Mens PG & Hostel',
      phone: cfg?.texts?.phone || '+91 99497 85344',
      email: (cfg?.texts?.email && cfg?.texts?.email !== 'jareenaworks@gmail.com') ? cfg.texts.email : 'chaitnyamenspg@gmail.com',
      address: cfg?.texts?.address || "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001",
      visitingHours: cfg?.texts?.visitingHours || '24 hrs',
      pricing: cfg?.pricing
    };

    const success = await downloadInvoicePdf(currentBookingContext, hostelInfo);
    btnTarget.disabled = false;
    if (success) {
      btnTarget.innerHTML = '<i class="fa-solid fa-circle-check"></i> <span>Downloaded!</span>';
      setTimeout(() => { btnTarget.innerHTML = prevHtml; }, 3500);
      showSiteToast('Invoice Downloaded', 'Official booking receipt PDF saved to Downloads.', 'fa-solid fa-file-arrow-down');
    } else {
      btnTarget.innerHTML = prevHtml;
      showAppAlert({
        title: 'PDF Generation Failed',
        message: 'Could not generate receipt PDF. Please try again.',
        type: 'warning',
        icon: 'fa-solid fa-file-circle-exclamation'
      });
    }
  }

  downloadBtn?.addEventListener('click', () => handleInvoiceDownload(downloadBtn));
  step1DownloadBtn?.addEventListener('click', () => handleInvoiceDownload(step1DownloadBtn));

  // Strip anything that isn't a digit as it is typed or pasted, so the
  // field cannot hold something that will be rejected on submit.
  input?.addEventListener('input', () => {
    const cleaned = input.value.replace(/\D/g, '').slice(0, 12);
    if (cleaned !== input.value) input.value = cleaned;
    if (msg && msg.textContent) { msg.textContent = ''; msg.className = 'upi-msg'; }
    if (currentBookingContext) {
      currentBookingContext.upi_utr = cleaned;
    }
  });

  btn?.addEventListener('click', async () => {
    const check = validateUtr(input.value);
    msg.className = 'upi-msg';
    if (!check.ok) {
      msg.textContent = check.error;
      msg.classList.add('is-err');
      input.focus();
      return;
    }
    btn.disabled = true;
    const res = await submitUtr(btn.dataset.ref, check.value);
    btn.disabled = false;
    updateLocalBooking(btn.dataset.ref, { utr: check.value, upi_utr: check.value });

    if (currentBookingContext) {
      currentBookingContext.upi_utr = check.value;
    }

    if (!res.ok && !res.unreachable) {
      msg.textContent = res.error;
      msg.classList.add('is-err');
      return;
    }

    if (res.unreachable) {
      msg.textContent = res.error;
      msg.classList.add('is-warn');
    } else {
      const isAdvance = currentBookingContext?.payment_mode === 'advance';
      const advMoney = currentBookingContext?.advance_amount
        ? `₹${Number(currentBookingContext.advance_amount).toLocaleString('en-IN')}`
        : (document.getElementById('advanceTokenAmtDisp')?.textContent || '₹1,000');
      const balMoney = (currentBookingContext?.balance_amount !== undefined && currentBookingContext?.balance_amount !== null)
        ? `₹${Number(currentBookingContext.balance_amount).toLocaleString('en-IN')}`
        : (document.getElementById('advanceBalanceAmtDisp')?.textContent || '');

      if (isAdvance) {
        msg.innerHTML = `<span style="display:block;margin-bottom:4px;font-weight:600;">✓ Advance UPI Reference recorded: <strong>${check.value}</strong></span><span style="display:block;color:#f59e0b;font-size:0.83rem;">⚠️ <strong>Advance Token (${advMoney}):</strong> Pending manager verification. Remaining balance ${balMoney ? `<strong>${balMoney}</strong> ` : ''}payable upon arrival.</span>`;
      } else {
        msg.innerHTML = '<span style="display:block;margin-bottom:4px;font-weight:600;">✓ UPI Reference recorded: <strong>' + check.value + '</strong></span><span style="display:block;color:#f59e0b;font-size:0.83rem;">⚠️ <strong>Important:</strong> Until verification from the hostel manager, this is <u>NOT considered as paid</u>.</span>';
      }
      msg.classList.add('is-ok');
    }

    input.disabled = true;
    btn.disabled = true;
    btn.textContent = 'Submitted ✓';
    tokenStepSettled = true;

    // Reveal the download invoice button
    if (invoiceAction) {
      invoiceAction.style.display = 'block';
    }

    // Dispatch invoice email if email is provided or in local dev
    const cfg = getHostelConfig();
    const hostelInfo = {
      name: cfg?.texts?.hostelName || 'Chaitanya Mens PG & Hostel',
      phone: cfg?.texts?.phone || '+91 99497 85344',
      email: (cfg?.texts?.email && cfg?.texts?.email !== 'jareenaworks@gmail.com') ? cfg.texts.email : 'chaitnyamenspg@gmail.com',
      address: cfg?.texts?.address || "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001",
      visitingHours: cfg?.texts?.visitingHours || '24 hrs',
      pricing: cfg?.pricing
    };
    if (currentBookingContext) {
      const guestEmail = currentBookingContext.email || (document.getElementById('upiEmailInput')?.value || '').trim();
      sendInvoiceEmail(currentBookingContext.ref, 'receipt', {
        email: guestEmail,
        booking: currentBookingContext,
        hostel: hostelInfo
      }).then(mailRes => {
        if (mailRes?.ok) {
          showSiteToast('Invoice Dispatched', 'PDF invoice sent to your email. (Note: Not considered paid until verified by manager).', 'fa-solid fa-envelope-circle-check');
        }
      });
    }

    // Update WhatsApp link with UTR
    const waBtn2 = document.getElementById('modalWhatsAppBtn2');
    if (waBtn2 && currentBookingContext) {
      const isAdv = currentBookingContext.payment_mode === 'advance';
      const payDisplay = currentBookingContext.payable_move_in || '13,900';
      const advStr = currentBookingContext.advance_amount
        ? `₹${Number(currentBookingContext.advance_amount).toLocaleString('en-IN')}`
        : '₹1,000';
      const balStr = (currentBookingContext.balance_amount !== undefined && currentBookingContext.balance_amount !== null)
        ? `₹${Number(currentBookingContext.balance_amount).toLocaleString('en-IN')}`
        : '';

      const waText = encodeURIComponent(
        `Hello Manager, I submitted a booking enquiry on the Chaitanya Mens PG & Hostel website!\n\n` +
        `📋 Ref Code: ${currentBookingContext.ref}\n` +
        `👤 Name: ${currentBookingContext.name}\n` +
        `📞 Phone: ${currentBookingContext.phone}\n` +
        `🛏️ Room: ${currentBookingContext.room}\n` +
        `🏢 Preferred Floor: ${currentBookingContext.floor}\n` +
        `📅 Move-in Date: ${currentBookingContext.date}\n` +
        (currentBookingContext.stay_period ? `🗓️ Stay Period: ${currentBookingContext.stay_period}\n` : '') +
        `⏳ Stay Duration: ${currentBookingContext.duration}\n` +
        (isAdv
          ? `💳 Payment Mode: Advance Token\n` +
            `💰 Advance Paid: ${advStr} (Pending manager verification)\n` +
            `💵 Balance Due on Move-In: ${balStr}\n` +
            `🔢 UPI Ref (UTR): ${check.value}\n\n`
          : `💳 Amount Submitted: ${payDisplay} (Pending manager verification — not considered paid until verified)\n` +
            `🔢 UPI Ref (UTR): ${check.value}\n\n`) +
        `Please verify the payment against bank records and confirm bed allocation.`
      );
      const mgrWa = (getHostelConfig()?.texts?.whatsapp || '919949785344').replace(/\D/g, '');
      waBtn2.href = `https://wa.me/${mgrWa}?text=${waText}`;
    }
  });
}

/* ===================================================================
   CUSTOM SELECT
   -------------------------------------------------------------------
   The native <select> drop-down is painted by the OS, so on macOS it
   showed a blue system highlight that ignored the site's palette.

   The native element stays in the DOM as the single source of truth —
   it still carries the value, still submits with the form, and the bed
   inventory code keeps toggling option.disabled / option.text on it.
   The panel is rebuilt from those options every time it opens, so
   "(Full)" states appear without any extra wiring.
   =================================================================== */
function initCustomSelects() {
  document.querySelectorAll('select.rsv-select').forEach(select => {
    if (select.dataset.enhanced) return;
    select.dataset.enhanced = 'true';

    const wrap = document.createElement('div');
    wrap.className = 'cs-wrap';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (select.id) trigger.setAttribute('aria-labelledby', `${select.id}-label-proxy`);

    const label = document.createElement('span');
    label.className = 'cs-label';

    const chev = document.createElement('i');
    chev.className = 'fa-solid fa-chevron-down cs-chevron';

    trigger.append(label, chev);

    const panel = document.createElement('div');
    panel.className = 'cs-panel';
    panel.setAttribute('role', 'listbox');
    panel.hidden = true;

    select.parentNode.insertBefore(wrap, select);
    wrap.append(trigger, panel, select);
    select.classList.add('cs-native');

    let activeIdx = -1;

    const syncLabel = () => {
      const opt = select.options[select.selectedIndex];
      label.textContent = opt ? opt.text : '';
    };

    function build() {
      panel.innerHTML = '';
      Array.from(select.options).forEach((opt, i) => {
        const item = document.createElement('div');
        item.className = 'cs-option';
        item.textContent = opt.text;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(i === select.selectedIndex));
        if (opt.disabled) {
          item.classList.add('is-disabled');
          item.setAttribute('aria-disabled', 'true');
        }
        if (i === select.selectedIndex) item.classList.add('is-selected');
        item.addEventListener('click', () => {
          if (opt.disabled) return;
          select.selectedIndex = i;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          close();
          trigger.focus();
        });
        panel.appendChild(item);
      });
    }

    const items = () => Array.from(panel.querySelectorAll('.cs-option'));

    function highlight(i) {
      const all = items();
      if (!all.length) return;
      all.forEach(el => el.classList.remove('is-active'));
      activeIdx = Math.max(0, Math.min(all.length - 1, i));
      const el = all[activeIdx];
      el.classList.add('is-active');
      el.scrollIntoView({ block: 'nearest' });
    }

    function open() {
      build();
      panel.hidden = false;
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      highlight(select.selectedIndex);
      document.addEventListener('click', onOutside, true);
    }

    function close() {
      panel.hidden = true;
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onOutside, true);
    }

    function onOutside(e) { if (!wrap.contains(e.target)) close(); }

    /** Move to the next option that isn't marked full. */
    function step(dir) {
      const all = items();
      let i = activeIdx;
      for (let n = 0; n < all.length; n++) {
        i = (i + dir + all.length) % all.length;
        if (!all[i].classList.contains('is-disabled')) { highlight(i); return; }
      }
    }

    trigger.addEventListener('click', () => (panel.hidden ? open() : close()));

    trigger.addEventListener('keydown', e => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        if (panel.hidden) { open(); return; }
      }
      if (e.key === 'ArrowDown') step(1);
      else if (e.key === 'ArrowUp') step(-1);
      else if (e.key === 'Enter' || e.key === ' ') {
        const el = items()[activeIdx];
        if (el && !el.classList.contains('is-disabled')) el.click();
      } else if (e.key === 'Escape') { close(); }
      else if (e.key === 'Home') { highlight(0); }
      else if (e.key === 'End') { highlight(items().length - 1); }
    });

    // Keeps the trigger in step with programmatic changes (e.g. a floor
    // going full resets the value to "Any Floor").
    select.addEventListener('change', syncLabel);
    syncLabel();
  });
}

/* ===================================================================
   0. CENTRAL HOSTEL CONFIGURATION STORE (MANAGER CONFIGURABLE)
   =================================================================== */
const DEFAULT_HOSTEL_CONFIG = {
  pricing: {
    doubleBase: 8500,
    doubleAcAdd: 1500,
    tripleBase: 6500,
    tripleAcAdd: 1000,
    fourBase: 5500,
    fourAcAdd: 800,
    fiveBase: 4800,
    fiveAcAdd: 600,
    disc3m: 5,
    disc6m: 10,
    disc12m: 15,
    securityDeposit: 5400,
    tokenAmount: 500,
    advanceAmount: 1000,
    dailyRate: 400,
    dailyDiscount: 10,
    dailyAcAdd: 100
  },
  texts: {
    hostelName: "Chaitanya Mens PG & Hostel",
    heroHeadline: "STAY | STUDY | GROW",
    phone: "+91 99497 85344",
    whatsapp: "919949785344",
    email: "jareenaworks@gmail.com",
    address: "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001",
    landmark: "Landmark: Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar",
    visitingHours: "24 hrs",
    openingNotice: "Opening 1st Oct • 2, 3, 4 & 5 Sharing Beds",
    upiId: "9949785344@ybl",
    upiName: "Chaitanya Mens PG & Hostel"
  },
  photos: {
    cinematicImg: "assets/hostel-exterior.jpg",
    doubleImg: "https://images.unsplash.com/photo-1616594039964-ae9021a400a0?auto=format&fit=crop&w=1200&q=80",
    tripleImg: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1200&q=80",
    studyImg: "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=800&q=80",
    terraceImg: "https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?auto=format&fit=crop&w=800&q=80",
    execImg: "https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=800&q=80",
    diningImg: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80",
    kitchenImg: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80",
    laundryImg: "https://images.unsplash.com/photo-1545173168-9f1947eebb7f?auto=format&fit=crop&w=800&q=80",
    securityImg: "https://images.unsplash.com/photo-1557597774-9d273605dfa9?auto=format&fit=crop&w=800&q=80",
    doubleTitle: "Double Sharing Twin Beds",
    tripleTitle: "Triple Sharing Layout",
    execTitle: "Executive Suite Interior",
    studyTitle: "Quiet Study Lounge",
    terraceTitle: "Rooftop Sky Terrace",
    diningTitle: "",
    kitchenTitle: "Homestyle Kitchen Delights",
    laundryTitle: "Smart Laundry Room",
    securityTitle: "24/7 Gated Security & CCTV"
  },
  inventory: {
    double: 2,
    triple: 3,
    four: 4,
    five: 3
  }
};

// Hydrated from Supabase at boot. localStorage is only an offline mirror
// so the page can paint instantly and still work if the network is down.
let _configCache = null;

function normalizeConfig(parsed) {
  if (parsed.texts && (parsed.texts.address?.includes('Kaloji') || parsed.texts.address?.includes('Nakkala Gutta'))) {
    parsed.texts.address = DEFAULT_HOSTEL_CONFIG.texts.address;
    parsed.texts.landmark = DEFAULT_HOSTEL_CONFIG.texts.landmark;
  }
  const pricing = { ...DEFAULT_HOSTEL_CONFIG.pricing, ...(parsed.pricing || {}) };
  if (pricing.securityDeposit === undefined || pricing.securityDeposit === null) {
    pricing.securityDeposit = (parsed.pricing && parsed.pricing.tokenAmount) || 5400;
  }
  return {
    pricing,
    texts:     { ...DEFAULT_HOSTEL_CONFIG.texts,     ...(parsed.texts     || {}) },
    photos:    { ...DEFAULT_HOSTEL_CONFIG.photos,    ...(parsed.photos    || {}) },
    inventory: { ...DEFAULT_HOSTEL_CONFIG.inventory, ...(parsed.inventory || {}) }
  };
}

/** Pull the shared config from Supabase and repaint the site. */
async function hydrateConfigFromServer() {
  if (!supabaseReady) return;
  const remote = await fetchSiteConfig();
  if (!remote) return;
  _configCache = normalizeConfig(remote);
  localStorage.setItem('chaitanya_hostel_config', JSON.stringify(_configCache));
  bedInventory = getStoredBedInventory();
  applyHostelConfigToSite(_configCache);
  updateBedUI();
}

function getHostelConfig() {
  if (_configCache) return _configCache;
  const saved = localStorage.getItem('chaitanya_hostel_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.texts && (parsed.texts.address?.includes('Kaloji') || parsed.texts.address?.includes('Nakkala Gutta'))) {
        parsed.texts.address = DEFAULT_HOSTEL_CONFIG.texts.address;
        parsed.texts.landmark = DEFAULT_HOSTEL_CONFIG.texts.landmark;
      }
      if (parsed.photos && parsed.photos.doubleImg?.includes('1595526114035')) {
        parsed.photos.doubleImg = DEFAULT_HOSTEL_CONFIG.photos.doubleImg;
      }
      if (parsed.photos && parsed.photos.tripleImg?.includes('1582719478250')) {
        parsed.photos.tripleImg = DEFAULT_HOSTEL_CONFIG.photos.tripleImg;
      }
      _configCache = normalizeConfig(parsed);
      return _configCache;
    } catch (e) {
      console.warn("Using default hostel config", e);
    }
  }
  _configCache = JSON.parse(JSON.stringify(DEFAULT_HOSTEL_CONFIG));
  return _configCache;
}

/**
 * Persist config for everyone. Writes to Supabase (RLS requires a signed-in
 * manager) and mirrors locally. Returns {ok, error} so the caller can report.
 */
async function saveHostelConfig(cfg) {
  _configCache = cfg;
  localStorage.setItem('chaitanya_hostel_config', JSON.stringify(cfg));
  if (!supabaseReady) return { ok: false, error: 'Supabase not configured' };
  const res = await saveSiteConfig(cfg);
  if (!res.ok) console.error('[config] save failed:', res.error);
  return res;
}

/**
 * Map a stored photo path to something the browser can actually load.
 *
 * The config keeps the stable token "assets/hostel-exterior.jpg" so it stays
 * valid across builds, but the file Vite emits is content-hashed. Anything
 * else (an http URL a manager pasted) passes through untouched.
 */
function resolvePhotoUrl(url) {
  if (!url) return heroExteriorUrl;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (url.replace(/^\.?\//, '') === 'assets/hostel-exterior.jpg') return heroExteriorUrl;
  return url;
}

function applyHostelConfigToSite(cfg) {
  if (!cfg) cfg = getHostelConfig();

  // 1. Apply Pricing to Estimator Option Cards
  const p = cfg.pricing;
  const optDouble = document.querySelector('#calcRoomOptions button[data-value="double"]');
  if (optDouble) {
    optDouble.dataset.base = p.doubleBase;
    optDouble.dataset.acAdd = p.doubleAcAdd;
    const span = optDouble.querySelector('.opt-content span');
    if (span) span.textContent = `From ₹${Number(p.doubleBase).toLocaleString('en-IN')}/mo`;
  }
  const optTriple = document.querySelector('#calcRoomOptions button[data-value="triple"]');
  if (optTriple) {
    optTriple.dataset.base = p.tripleBase;
    optTriple.dataset.acAdd = p.tripleAcAdd;
    const span = optTriple.querySelector('.opt-content span');
    if (span) span.textContent = `From ₹${Number(p.tripleBase).toLocaleString('en-IN')}/mo`;
  }
  const optFour = document.querySelector('#calcRoomOptions button[data-value="four"]');
  if (optFour) {
    optFour.dataset.base = p.fourBase;
    optFour.dataset.acAdd = p.fourAcAdd;
    const span = optFour.querySelector('.opt-content span');
    if (span) span.textContent = `From ₹${Number(p.fourBase).toLocaleString('en-IN')}/mo`;
  }
  const optFive = document.querySelector('#calcRoomOptions button[data-value="five"]');
  if (optFive) {
    optFive.dataset.base = p.fiveBase;
    optFive.dataset.acAdd = p.fiveAcAdd;
    const span = optFive.querySelector('.opt-content span');
    if (span) span.textContent = `From ₹${Number(p.fiveBase).toLocaleString('en-IN')}/mo`;
  }

  // Duration Discounts
  const durBtn3 = document.querySelector('#calcDurationOptions .duration-btn[data-months="3"]');
  if (durBtn3) {
    durBtn3.dataset.discount = (p.disc3m / 100).toString();
    const tag3 = durBtn3.querySelector('.discount-tag');
    if (tag3) tag3.textContent = `${p.disc3m}% OFF`;
  }
  const durBtn6 = document.querySelector('#calcDurationOptions .duration-btn[data-months="6"]');
  if (durBtn6) {
    durBtn6.dataset.discount = (p.disc6m / 100).toString();
    const tag6 = durBtn6.querySelector('.discount-tag');
    if (tag6) tag6.textContent = `${p.disc6m}% OFF`;
  }
  const durBtn12 = document.querySelector('#calcDurationOptions .duration-btn[data-months="12"]');
  if (durBtn12) {
    durBtn12.dataset.discount = (p.disc12m / 100).toString();
    const tag12 = durBtn12.querySelector('.discount-tag');
    if (tag12) tag12.textContent = `${p.disc12m}% OFF`;
  }

  // Daily stay badge
  const durDailyBadge = document.getElementById('durDailyBadge');
  if (durDailyBadge) {
    const dailyBase = Number(p.dailyRate ?? 400);
    const dailyDiscount = Number(p.dailyDiscount ?? 0);
    if (dailyDiscount > 0) {
      const origDaily = dailyBase + Math.round((dailyBase * dailyDiscount) / 100);
      durDailyBadge.innerHTML = `<span class="dur-del-price">₹${origDaily.toLocaleString('en-IN')}</span> ₹${dailyBase.toLocaleString('en-IN')}/d <span class="discount-tag" style="margin-left:2px;font-size:0.65rem;padding:1px 5px;">${dailyDiscount}% OFF</span>`;
    } else {
      durDailyBadge.textContent = `₹${dailyBase.toLocaleString('en-IN')}/day`;
    }
  }

  // Booking form advance token display
  const dispFormAdvanceVal = document.getElementById('dispFormAdvanceVal');
  if (dispFormAdvanceVal) {
    dispFormAdvanceVal.textContent = Number(p.advanceAmount || 1000).toLocaleString('en-IN');
  }

  // Trigger recalculation if room calculator is initialized
  if (typeof window.updateEstimatorFromActive === 'function') {
    window.updateEstimatorFromActive();
  }

  // 2. Apply Text Configurations
  const t = cfg.texts;
  // Brand name elements
  document.querySelectorAll('.brand-name').forEach(el => {
    el.textContent = t.hostelName;
  });

  // Phone numbers (calls)
  document.querySelectorAll('a[href^="tel:"]').forEach(el => {
    el.href = `tel:${t.phone.replace(/[^\d+]/g, '')}`;
  });
  const directHelp = document.querySelector('.contact-highlight-card a[href^="tel:"] strong');
  if (directHelp) directHelp.textContent = t.phone;

  // WhatsApp links
  const waClean = t.whatsapp.replace(/\D/g, '');
  document.querySelectorAll('a[href*="wa.me"]').forEach(el => {
    try {
      const url = new URL(el.href);
      const textParam = url.searchParams.get('text') || 'Hi Chaitanya Mens PG & Hostel';
      el.href = `https://wa.me/${waClean}?text=${encodeURIComponent(textParam)}`;
    } catch(e) {}
  });

  // Email links & elements
  if (t.email) {
    const cleanEmail = t.email.trim();
    const contactEmailEl = document.getElementById('contactEmailLink');
    if (contactEmailEl) {
      contactEmailEl.href = `mailto:${cleanEmail}`;
      contactEmailEl.innerHTML = `<strong>${cleanEmail}</strong>`;
    }
    const footerEmailSocial = document.getElementById('footerEmailSocial');
    if (footerEmailSocial) {
      footerEmailSocial.href = `mailto:${cleanEmail}`;
    }
    const footerEmailText = document.getElementById('footerEmailText');
    if (footerEmailText) {
      footerEmailText.href = `mailto:${cleanEmail}`;
      footerEmailText.textContent = cleanEmail;
    }
  }

  // Address & Landmark
  const addrEl = document.querySelector('.contact-info-card p strong');
  if (addrEl && addrEl.parentElement) {
    addrEl.parentElement.innerHTML = `<strong>${t.hostelName.toUpperCase()}</strong><br>${t.address}`;
  }

  const lmarkEl = document.querySelector('.landmark-tag');
  if (lmarkEl) lmarkEl.innerHTML = `<i class="fa-solid fa-map-pin"></i> ${t.landmark}`;

  // Map header subtitle and Google Maps buttons
  const mapSub = document.querySelector('.map-header .map-title-wrap span');
  if (mapSub) mapSub.textContent = t.address;
  const mapBtn = document.querySelector('.map-header a.btn');
  if (mapBtn) mapBtn.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.address)}`;
  const footerMapLink = document.querySelector('footer a[aria-label="Google Maps"]');
  if (footerMapLink) footerMapLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t.address)}`;

  // Header status pill
  const pillEl = document.querySelector('.header-center-pill .h-pill-text');
  if (pillEl) pillEl.innerHTML = t.openingNotice;

  const conciergePill = document.querySelector('.concierge-text strong');
  if (conciergePill) conciergePill.textContent = t.phone;

  // Visiting Hours
  const drawerVH = document.getElementById('drawerVisitingHours');
  if (drawerVH && t.visitingHours) drawerVH.textContent = `Everyday: ${t.visitingHours}`;
  
  const footerVH = document.getElementById('footerVisitingHours');
  if (footerVH && t.visitingHours) footerVH.innerHTML = `<i class="fa-solid fa-clock"></i> Visiting: ${t.visitingHours}`;

  // 3. Apply Photos
  const ph = cfg.photos;
  
  const cinematicImg = document.getElementById('cinematicBgImg');
  if (cinematicImg && ph.cinematicImg) cinematicImg.src = resolvePhotoUrl(ph.cinematicImg);

  const updateGal = (imgId, titleId, tagId, url, title, defaultTitle) => {
    const imgEl = document.getElementById(imgId);
    if (imgEl && url) imgEl.src = resolvePhotoUrl(url);

    const titleEl = document.getElementById(titleId);
    const tagEl = document.getElementById(tagId);
    const itemEl = imgEl ? imgEl.closest('.gallery-item') : null;

    const displayTitle = title !== undefined ? title : defaultTitle;
    if (titleEl) {
      if (displayTitle && displayTitle.trim()) {
        titleEl.textContent = displayTitle.trim();
        titleEl.style.display = '';
        if (tagEl) tagEl.style.display = '';
        if (itemEl) itemEl.dataset.caption = displayTitle.trim();
      } else {
        titleEl.textContent = '';
        titleEl.style.display = 'none';
        if (tagEl) tagEl.style.display = 'none';
        if (itemEl) itemEl.dataset.caption = '';
      }
    }
  };
  updateGal('galImgExec', 'galTitleExec', 'galTagExec', ph.execImg || ph.doubleImg, ph.execTitle, DEFAULT_HOSTEL_CONFIG.photos.execTitle);
  updateGal('galImgDouble', 'galTitleDouble', 'galTagDouble', ph.doubleImg, ph.doubleTitle, DEFAULT_HOSTEL_CONFIG.photos.doubleTitle);
  updateGal('galImgTriple', 'galTitleTriple', 'galTagTriple', ph.tripleImg, ph.tripleTitle, DEFAULT_HOSTEL_CONFIG.photos.tripleTitle);
  updateGal('galImgDining', 'galTitleDining', 'galTagDining', ph.diningImg, ph.diningTitle, DEFAULT_HOSTEL_CONFIG.photos.diningTitle);
  updateGal('galImgKitchen', 'galTitleKitchen', 'galTagKitchen', ph.kitchenImg, ph.kitchenTitle, DEFAULT_HOSTEL_CONFIG.photos.kitchenTitle);
  updateGal('galImgLaundry', 'galTitleLaundry', 'galTagLaundry', ph.laundryImg, ph.laundryTitle, DEFAULT_HOSTEL_CONFIG.photos.laundryTitle);
  updateGal('galImgSecurity', 'galTitleSecurity', 'galTagSecurity', ph.securityImg, ph.securityTitle, DEFAULT_HOSTEL_CONFIG.photos.securityTitle);
  updateGal('galImgStudy', 'galTitleStudy', 'galTagStudy', ph.studyImg, ph.studyTitle, DEFAULT_HOSTEL_CONFIG.photos.studyTitle);
  updateGal('galImgTerrace', 'galTitleTerrace', 'galTagTerrace', ph.terraceImg, ph.terraceTitle, DEFAULT_HOSTEL_CONFIG.photos.terraceTitle);
}

/* ===================================================================
   1. LIVE BED INVENTORY SYSTEM (PERSISTENT VIA LOCALSTORAGE)
   =================================================================== */
const TOTAL_CAPACITY = {
  double: 25,
  triple: 35,
  four: 20,
  five: 20,
  hall: 12
};

const DEFAULT_BED_INVENTORY = {
  double: 2,  // 2 sharing beds available
  triple: 3,  // 3 sharing beds available
  four: 4,    // 4 sharing beds available
  five: 3,    // 5 sharing beds available
  hall: 4     // Hall beds available
};

let bedInventory = getStoredBedInventory();

function getStoredBedInventory() {
  const cfg = getHostelConfig();
  if (cfg && cfg.inventory) {
    return {
      double: typeof cfg.inventory.double === 'number' ? cfg.inventory.double : DEFAULT_BED_INVENTORY.double,
      triple: typeof cfg.inventory.triple === 'number' ? cfg.inventory.triple : DEFAULT_BED_INVENTORY.triple,
      four: typeof cfg.inventory.four === 'number' ? cfg.inventory.four : DEFAULT_BED_INVENTORY.four,
      five: typeof cfg.inventory.five === 'number' ? cfg.inventory.five : DEFAULT_BED_INVENTORY.five,
      hall: 4
    };
  }
  return { ...DEFAULT_BED_INVENTORY };
}

function saveBedInventory() {
  const cfg = getHostelConfig();
  cfg.inventory = { ...bedInventory };
  saveHostelConfig(cfg);
}

function initBedInventory() {
  bedInventory = getStoredBedInventory();
  updateBedUI();
}

function updateBedUI() {
  const doubleLeft = bedInventory.double !== undefined ? bedInventory.double : 2;
  const tripleLeft = bedInventory.triple !== undefined ? bedInventory.triple : 3;

  // 1. Triple Sharing Card
  const tripleCard = document.getElementById('roomCardTriple');
  const stockTagTriple = document.getElementById('stockTagTriple');
  const capTextTriple = document.getElementById('capTextTriple');
  const capFillTriple = document.getElementById('capFillTriple');
  const btnTriple = document.getElementById('btnTriple');
  const heroTriple = document.getElementById('heroTripleStatus');

  const tripleOcc = Math.round(((TOTAL_CAPACITY.triple - tripleLeft) / TOTAL_CAPACITY.triple) * 100);

  if (capTextTriple) capTextTriple.textContent = `${tripleOcc}% Full`;
  if (capFillTriple) capFillTriple.style.width = `${tripleOcc}%`;

  if (tripleLeft <= 0) {
    if (tripleCard) tripleCard.classList.add('is-house-full');
    if (stockTagTriple) {
      stockTagTriple.innerHTML = `<span class="stock-dot-anim"></span> <span class="stock-text">HOUSE FULL</span>`;
      // Mounted only when a room is actually full, so the player stays
      // undownloaded for the common "beds available" case.
      mountLottie(stockTagTriple.querySelector('.stock-dot-anim'), houseFullAnim);
    }
    if (btnTriple) {
      btnTriple.innerHTML = `<i class="fa-solid fa-clock"></i> Join Priority Waitlist`;
      btnTriple.classList.add('btn-outline');
    }
    if (heroTriple) {
      heroTriple.textContent = 'House Full';
      heroTriple.className = 'spec-status-pill status-full';
    }
  } else {
    if (tripleCard) tripleCard.classList.remove('is-house-full');
    const dotClass = tripleLeft === 1 ? 'dot-danger' : (tripleLeft <= 2 ? 'dot-warn' : 'dot-avail');
    if (stockTagTriple) stockTagTriple.innerHTML = `<span class="stock-dot ${dotClass}"></span> <span class="stock-text">${tripleLeft} Bed${tripleLeft > 1 ? 's' : ''} Left</span>`;
    if (btnTriple) {
      btnTriple.innerHTML = `<i class="fa-solid fa-calculator"></i> Calculate & Select Triple`;
    }
    if (heroTriple) {
      heroTriple.textContent = `${tripleLeft} Bed${tripleLeft > 1 ? 's' : ''} Left`;
      heroTriple.className = `spec-status-pill ${tripleLeft === 1 ? 'status-low' : 'status-avail'}`;
    }
  }

  // 2. Double Sharing Card
  const doubleCard = document.getElementById('roomCardDouble');
  const stockTagDouble = document.getElementById('stockTagDouble');
  const capTextDouble = document.getElementById('capTextDouble');
  const capFillDouble = document.getElementById('capFillDouble');
  const btnDouble = document.getElementById('btnDouble');
  const heroDouble = document.getElementById('heroDoubleStatus');

  const doubleOcc = Math.round(((TOTAL_CAPACITY.double - doubleLeft) / TOTAL_CAPACITY.double) * 100);

  if (capTextDouble) capTextDouble.textContent = `${doubleOcc}% Full`;
  if (capFillDouble) capFillDouble.style.width = `${doubleOcc}%`;

  if (doubleLeft <= 0) {
    if (doubleCard) doubleCard.classList.add('is-house-full');
    if (stockTagDouble) {
      stockTagDouble.innerHTML = `<span class="stock-dot-anim"></span> <span class="stock-text">HOUSE FULL</span>`;
      // Mounted only when a room is actually full, so the player stays
      // undownloaded for the common "beds available" case.
      mountLottie(stockTagDouble.querySelector('.stock-dot-anim'), houseFullAnim);
    }
    if (btnDouble) {
      btnDouble.innerHTML = `<i class="fa-solid fa-clock"></i> Join Priority Waitlist`;
      btnDouble.className = 'btn btn-outline btn-full select-room-btn';
    }
    if (heroDouble) {
      heroDouble.textContent = 'House Full';
      heroDouble.className = 'spec-status-pill status-full';
    }
  } else {
    if (doubleCard) doubleCard.classList.remove('is-house-full');
    const dotClass = doubleLeft === 1 ? 'dot-danger' : (doubleLeft <= 2 ? 'dot-warn' : 'dot-avail');
    if (stockTagDouble) stockTagDouble.innerHTML = `<span class="stock-dot ${dotClass}"></span> <span class="stock-text">${doubleLeft} Bed${doubleLeft > 1 ? 's' : ''} Left</span>`;
    if (btnDouble) {
      btnDouble.innerHTML = `<i class="fa-solid fa-calculator"></i> Calculate & Select Double`;
      btnDouble.className = 'btn btn-primary btn-full select-room-btn';
    }
    if (heroDouble) {
      heroDouble.textContent = `${doubleLeft} Bed${doubleLeft > 1 ? 's' : ''} Left`;
      heroDouble.className = `spec-status-pill ${doubleLeft === 1 ? 'status-low' : 'status-avail'}`;
    }
  }

  // 3. Overall Capacity
  const totalBeds = TOTAL_CAPACITY.double + TOTAL_CAPACITY.triple;
  const totalLeft = doubleLeft + tripleLeft;
  const totalOcc = Math.round(((totalBeds - totalLeft) / totalBeds) * 100);

  const heroCapPercent = document.getElementById('heroCapPercent');
  const heroCapFill = document.getElementById('heroCapFill');
  const heroLiveStatusBadge = document.getElementById('heroLiveStatusBadge');

  if (heroCapPercent) heroCapPercent.textContent = `${totalOcc}% Full`;
  if (heroCapFill) heroCapFill.style.width = `${totalOcc}%`;
  if (heroLiveStatusBadge) {
    heroLiveStatusBadge.innerHTML = totalLeft <= 3 ? 
      `<i class="fa-solid fa-fire"></i> High Demand • ${totalLeft} Beds Total Left` : 
      `<i class="fa-solid fa-bed"></i> Admissions Open • ${totalLeft} Beds Available`;
  }

  // 4. Update Dropdowns
  const preferredFloorSelect = document.getElementById('preferredFloor');
  if (preferredFloorSelect) {
    const hallLeft = bedInventory.hall !== undefined ? bedInventory.hall : 3;
    const isGroundFull = !(doubleLeft + (tripleLeft > 0 ? 1 : 0) + (hallLeft > 0 ? 1 : 0) > 0);
    const isFirstFull = !(doubleLeft > 0);
    const isSecondFull = !(tripleLeft >= 3 || hallLeft >= 3);

    Array.from(preferredFloorSelect.options).forEach(opt => {
      let isFull = false;
      if (opt.value === 'Ground Floor') isFull = isGroundFull;
      if (opt.value === '1st Floor') isFull = isFirstFull;
      if (opt.value === '2nd Floor') isFull = isSecondFull;
      
      opt.disabled = isFull;
      if (isFull) {
        if (!opt.text.includes('(Full)')) {
          opt.text = opt.value + ' (Full)';
        }
      } else {
        opt.text = opt.value; // Reset text
      }
    });

    // If currently selected option is now disabled, reset to Any Floor
    if (preferredFloorSelect.options[preferredFloorSelect.selectedIndex].disabled) {
      preferredFloorSelect.value = 'Any Floor';
      preferredFloorSelect.dispatchEvent(new Event('change'));
    }
  }

  // 5. Update Manager Portal Inputs if Open
  updateWardenInventoryControls();
}

/* ===================================================================
   2. VISUAL FLOOR & BED OCCUPANCY MAP MODAL (GROUND, 1ST & 2ND FLOORS)
   =================================================================== */
function initBedMapModal() {
  const bedMapModal = document.getElementById('bedMapModal');
  const bedMapClose = document.getElementById('bedMapClose');
  const mapTriggerBtns = document.querySelectorAll('.map-trigger-btn');
  const floorTabs = document.querySelectorAll('#floorTabs .floor-tab-btn');
  const floorsContainer = document.getElementById('floorsContainer');
  const mapBookNowBtn = document.getElementById('mapBookNowBtn');

  let activeFloorFilter = 'all';

  function renderFloorMap() {
    if (!floorsContainer) return;

    // Simulated floor distribution based on real bed inventory
    const doubleLeft = bedInventory.double;
    const tripleLeft = bedInventory.triple;
    const hallLeft = (bedInventory.hall !== undefined) ? bedInventory.hall : 3;

    floorsContainer.innerHTML = `
      <!-- GROUND FLOOR -->
      <div class="floor-block" data-floor="ground" style="${activeFloorFilter === 'all' || activeFloorFilter === 'ground' ? '' : 'display:none;'}">
        <div class="floor-header">
          <h4><i class="fa-solid fa-stairs"></i> Ground Floor — Reception, Dining, 1 AC Suite & Floor Hall</h4>
          <span class="floor-stats-badge">${doubleLeft + (tripleLeft > 0 ? 1 : 0) + (hallLeft > 0 ? 1 : 0) > 0 ? 'Beds Available' : 'House Full'}</span>
        </div>
        <div class="rooms-map-grid">
          <!-- Room G01: Triple Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room G01</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Triple Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${tripleLeft >= 1 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed 1 (${tripleLeft >= 1 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot ${tripleLeft >= 2 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed 2 (${tripleLeft >= 2 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
            </div>
          </div>

          <!-- Room G02: Double AC (SOLE AC ROOM ON GROUND FLOOR) -->
          <div class="map-room-card map-ac-card">
            <div class="map-room-top">
              <span class="map-room-num">Room G02</span>
              <span class="map-ac-badge"><i class="fa-solid fa-snowflake"></i> Double AC • 1 AC Room</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${doubleLeft >= 1 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed A (${doubleLeft >= 1 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot ${doubleLeft >= 2 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed B (${doubleLeft >= 2 ? 'Vacant' : 'Occupied'})
              </div>
            </div>
          </div>

          <!-- Room G03: Double Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room G03</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Double Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed A (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed B (Occupied)
              </div>
            </div>
          </div>

          <!-- Ground Floor Hall: 4 Beds (Non-AC) -->
          <div class="map-room-card map-hall-card">
            <div class="map-room-top">
              <span class="map-room-num"><i class="fa-solid fa-couch"></i> Ground Floor Hall</span>
              <span class="map-hall-badge"><i class="fa-solid fa-fan"></i> Hall Beds (Non-AC)</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${hallLeft >= 1 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed 1 (${hallLeft >= 1 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 2 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 4 (Occupied)
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- FLOOR 1 -->
      <div class="floor-block" data-floor="first" style="${activeFloorFilter === 'all' || activeFloorFilter === 'first' ? '' : 'display:none;'}">
        <div class="floor-header">
          <h4><i class="fa-solid fa-stairs"></i> Floor 1 — Executive Suites, 1 AC Suite & Floor Hall</h4>
          <span class="floor-stats-badge">${doubleLeft > 0 ? `${doubleLeft} Vacant Beds` : 'House Full'}</span>
        </div>
        <div class="rooms-map-grid">
          <!-- Room 101: Double AC (SOLE AC ROOM ON FLOOR 1) -->
          <div class="map-room-card map-ac-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 101</span>
              <span class="map-ac-badge"><i class="fa-solid fa-snowflake"></i> Double AC • 1 AC Room</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${doubleLeft >= 2 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed A (${doubleLeft >= 2 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot ${doubleLeft >= 1 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed B (${doubleLeft >= 1 ? 'Vacant' : 'Occupied'})
              </div>
            </div>
          </div>

          <!-- Room 102: Double Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 102</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Double Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed A (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed B (Occupied)
              </div>
            </div>
          </div>

          <!-- Room 103: Double Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 103</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Double Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed A (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed B (Occupied)
              </div>
            </div>
          </div>

          <!-- Room 104: Triple Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 104</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Triple Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 1 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 2 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
            </div>
          </div>

          <!-- Floor 1 Hall: 4 Beds (Non-AC) -->
          <div class="map-room-card map-hall-card">
            <div class="map-room-top">
              <span class="map-room-num"><i class="fa-solid fa-couch"></i> Floor 1 Hall</span>
              <span class="map-hall-badge"><i class="fa-solid fa-fan"></i> Hall Beds (Non-AC)</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${hallLeft >= 2 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed 1 (${hallLeft >= 2 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 2 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 4 (Occupied)
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- FLOOR 2 -->
      <div class="floor-block" data-floor="second" style="${activeFloorFilter === 'all' || activeFloorFilter === 'second' ? '' : 'display:none;'}">
        <div class="floor-header">
          <h4><i class="fa-solid fa-stairs"></i> Floor 2 — Community Suites, 1 AC Suite & Floor Hall</h4>
          <span class="floor-stats-badge">${tripleLeft >= 3 || hallLeft >= 3 ? 'Beds Available' : 'House Full'}</span>
        </div>
        <div class="rooms-map-grid">
          <!-- Room 201: Triple AC (SOLE AC ROOM ON FLOOR 2) -->
          <div class="map-room-card map-ac-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 201</span>
              <span class="map-ac-badge"><i class="fa-solid fa-snowflake"></i> Triple AC • 1 AC Room</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${tripleLeft >= 3 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed 1 (${tripleLeft >= 3 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 2 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
            </div>
          </div>

          <!-- Room 202: Triple Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 202</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Triple Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 1 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 2 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
            </div>
          </div>

          <!-- Room 203: Double Non-AC -->
          <div class="map-room-card">
            <div class="map-room-top">
              <span class="map-room-num">Room 203</span>
              <span class="map-room-type"><i class="fa-solid fa-fan"></i> Double Non-AC</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed A (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed B (Occupied)
              </div>
            </div>
          </div>

          <!-- Floor 2 Hall: 4 Beds (Non-AC) -->
          <div class="map-room-card map-hall-card">
            <div class="map-room-top">
              <span class="map-room-num"><i class="fa-solid fa-couch"></i> Floor 2 Hall</span>
              <span class="map-hall-badge"><i class="fa-solid fa-fan"></i> Hall Beds (Non-AC)</span>
            </div>
            <div class="bed-slots-wrap">
              <div class="bed-slot ${hallLeft >= 3 ? 'vacant' : 'occupied'}">
                <i class="fa-solid fa-bed"></i> Bed 1 (${hallLeft >= 3 ? 'Vacant' : 'Occupied'})
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 2 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 3 (Occupied)
              </div>
              <div class="bed-slot occupied">
                <i class="fa-solid fa-bed"></i> Bed 4 (Occupied)
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function openBedMap() {
    renderFloorMap();
    bedMapModal.classList.add('active');
    bedMapModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeBedMap() {
    bedMapModal.classList.remove('active');
    bedMapModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  mapTriggerBtns.forEach(btn => btn.addEventListener('click', openBedMap));
  if (bedMapClose) bedMapClose.addEventListener('click', closeBedMap);
  bedMapModal.addEventListener('click', (e) => {
    if (e.target === bedMapModal) closeBedMap();
  });

  floorTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      floorTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFloorFilter = tab.dataset.floor || 'all';
      renderFloorMap();
    });
  });

  if (mapBookNowBtn) {
    mapBookNowBtn.addEventListener('click', () => {
      closeBedMap();
      const bookingSection = document.getElementById('booking');
      if (bookingSection) bookingSection.scrollIntoView({ behavior: 'smooth' });
    });
  }
}

/* ===================================================================
   3. WARDEN & ADMIN MANAGEMENT PORTAL
   =================================================================== */
// Manager access is Supabase Auth (email + password, plus an authenticator
// app when enrolled). Nothing secret lives in this file: every write is
// re-checked server-side by row level security.

// Sample initial bookings seed
const DEFAULT_BOOKINGS = [
  { ref: "#CMPG-8412", name: "Rahul Sharma", phone: "9949785344", floor: "1st Floor", room: "2 Sharing (AC)", date: "2026-09-18", time: "14m ago" },
  { ref: "#CMPG-7291", name: "Suresh Reddy", phone: "9845012345", floor: "Ground Floor", room: "Double Sharing (Non-AC)", date: "2026-09-20", time: "1h ago" },
  { ref: "#CMPG-6104", name: "Karthik R.", phone: "9916023456", floor: "2nd Floor", room: "Triple Sharing (Non-AC)", date: "2026-09-22", time: "3h ago" }
];

// Enquiries live in Supabase. RLS lets anyone INSERT but only a manager
// SELECT, so this returns [] for visitors — by design.
let _bookingsCache = [];

function getStoredBookings() {
  let list = [];
  if (!_bookingsCache || _bookingsCache.length === 0) {
    try {
      const local = getLocalBookings();
      if (local && local.length > 0) list = local;
    } catch (_) {}
  } else {
    list = _bookingsCache;
  }
  return list.map(b => {
    if (b && b.date) {
      b.date = normalizeBookingDate(b.date);
    }
    return b;
  });
}

/** Refresh the enquiry cache from Supabase/local fallback, then repaint the table. */
async function refreshBookings() {
  try {
    _bookingsCache = await fetchBookings();
  } catch (err) {
    console.warn('[bookings] refresh error:', err);
  }
  renderEnquiriesTable();
}

function initWardenPortal() {
  const wardenTriggers = document.querySelectorAll('.warden-portal-trigger');
  const wardenModal = document.getElementById('wardenModal');
  const wardenModalClose = document.getElementById('wardenModalClose');
  const wardenLoginView = document.getElementById('wardenLoginView');
  const wardenDashboardView = document.getElementById('wardenDashboardView');
  // The dialog only takes its fixed height once the dashboard is up; the
  // login card is short and should stay short.
  const wardenDialog = document.querySelector('#wardenModal .mgr-modal-dialog');
  const wardenUnlockBtn = document.getElementById('wardenUnlockBtn');
  const pinError = document.getElementById('pinError');
  const emailInput = document.getElementById('mgrEmailInput');
  const passwordInput = document.getElementById('mgrPasswordInput');
  const passwordStep = document.getElementById('mgrPasswordStep');
  const mfaStep = document.getElementById('mgrMfaStep');
  const mfaInput = document.getElementById('mgrMfaInput');
  const mfaError = document.getElementById('mfaError');
  const mfaVerifyBtn = document.getElementById('mgrMfaVerifyBtn');
  const mfaCancelBtn = document.getElementById('mgrMfaCancelBtn');
  const enrollStep = document.getElementById('mgrEnrollStep');
  const enrollQr = document.getElementById('mgrEnrollQr');
  const enrollSecret = document.getElementById('mgrEnrollSecret');
  const enrollInput = document.getElementById('mgrEnrollInput');
  const enrollError = document.getElementById('enrollError');
  const enrollConfirmBtn = document.getElementById('mgrEnrollConfirmBtn');
  const enrollSkipBtn = document.getElementById('mgrEnrollSkipBtn');
  let pendingFactorId = null;
  let stopBookingFeed = null;
  const mgrLockBtn = document.getElementById('mgrLockBtn');
  const clearBookingsBtn = document.getElementById('clearBookingsBtn');
  const mgrSaveAllBtn = document.getElementById('mgrSaveAllBtn');
  const mgrResetDefaultsBtn = document.getElementById('mgrResetDefaultsBtn');

  function openWardenPortal() {
    wardenModal.classList.add('active');
    wardenModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (wardenLoginView.style.display !== 'none' && emailInput) {
      setTimeout(() => emailInput.focus(), 200);
    }
  }

  function closeWardenPortal() {
    wardenModal.classList.remove('active');
    wardenModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  wardenTriggers.forEach(btn => btn.addEventListener('click', openWardenPortal));
  if (wardenModalClose) wardenModalClose.addEventListener('click', closeWardenPortal);
  wardenModal.addEventListener('click', (e) => {
    if (e.target === wardenModal) closeWardenPortal();
  });

  // ---- Manager sign-in (Supabase Auth) ----

  function showStep(step) {
    if (passwordStep) passwordStep.style.display = step === 'password' ? 'block' : 'none';
    if (mfaStep)      mfaStep.style.display      = step === 'mfa'      ? 'block' : 'none';
    if (enrollStep)   enrollStep.style.display   = step === 'enroll'   ? 'block' : 'none';
  }

  function fail(el, msg) {
    if (!el) return;
    if (msg) el.textContent = msg;
    el.style.display = 'block';
  }

  /** Reveal the dashboard. Only called once the account is a verified manager. */
  async function unlockDashboard() {
    if (pinError) pinError.style.display = 'none';
    wardenLoginView.style.display = 'none';
    wardenDashboardView.classList.add('is-open');
    if (wardenDialog) wardenDialog.classList.add('is-dashboard');
    if (mgrLockBtn) mgrLockBtn.style.display = 'inline-flex';
    populateManagerForm();
    updateWardenInventoryControls();
    await refreshBookings();
    // Live-update the enquiry table while the manager has it open.
    if (stopBookingFeed) stopBookingFeed();
    stopBookingFeed = onBookingsChange(() => refreshBookings());
  }

  async function attemptSignIn() {
    if (!supabaseReady) {
      fail(pinError, 'Supabase is not configured. Check your .env file.');
      return;
    }
    const email = (emailInput?.value || '').trim();
    const password = passwordInput?.value || '';
    if (!email || !password) { fail(pinError, 'Enter your email and password.'); return; }

    wardenUnlockBtn.disabled = true;
    const original = wardenUnlockBtn.innerHTML;
    wardenUnlockBtn.innerHTML = '<span class="btn-lottie" id="signInAnim"></span> Signing in…';
    const signInAnim = await mountLottie(document.getElementById('signInAnim'), spinnerAnim);

    const res = await signIn(email, password);

    destroyLottie(signInAnim);
    wardenUnlockBtn.disabled = false;
    wardenUnlockBtn.innerHTML = original;

    if (!res.ok) {
      fail(pinError, res.error || 'Incorrect email or password.');
      if (passwordInput) passwordInput.value = '';
      return;
    }
    if (pinError) pinError.style.display = 'none';
    if (passwordInput) passwordInput.value = '';

    if (res.mfaRequired) {          // authenticator already enrolled
      showStep('mfa');
      if (mfaInput) { mfaInput.value = ''; setTimeout(() => mfaInput.focus(), 150); }
      return;
    }
    await afterPasswordAccepted();
  }

  /** Signed in and no second factor outstanding — check manager rights. */
  async function afterPasswordAccepted() {
    if (!(await isManager())) {
      await signOut();
      showStep('password');
      fail(pinError, 'This account does not have manager access.');
      return;
    }
    // First sign-in with no authenticator: offer to set one up.
    if (!(await hasAuthenticator())) {
      const enrolled = await enrollAuthenticator();
      if (enrolled.ok) {
        pendingFactorId = enrolled.factorId;
        if (enrollQr) enrollQr.src = enrolled.qr;
        if (enrollSecret) enrollSecret.textContent = enrolled.secret;
        if (enrollError) enrollError.style.display = 'none';
        if (enrollInput) enrollInput.value = '';
        showStep('enroll');
        return;
      }
      // Couldn't offer enrolment — log it rather than failing the sign-in.
      console.warn('[auth] authenticator enrolment unavailable:', enrolled.error);
    }
    await unlockDashboard();
  }

  async function verifyMfa() {
    const code = (mfaInput?.value || '').trim();
    if (code.length !== 6) { fail(mfaError, 'Enter the 6-digit code.'); return; }
    const res = await verifyMfaCode(code);
    if (!res.ok) { fail(mfaError, res.error || 'Invalid code.'); if (mfaInput) mfaInput.value = ''; return; }
    if (mfaError) mfaError.style.display = 'none';
    if (!(await isManager())) {
      await signOut(); showStep('password');
      fail(pinError, 'This account does not have manager access.');
      return;
    }
    await unlockDashboard();
  }

  async function confirmEnroll() {
    const code = (enrollInput?.value || '').trim();
    if (code.length !== 6) { fail(enrollError, 'Enter the 6-digit code.'); return; }
    const res = await confirmAuthenticator(pendingFactorId, code);
    if (!res.ok) { fail(enrollError, res.error || 'Invalid code.'); if (enrollInput) enrollInput.value = ''; return; }
    if (enrollError) enrollError.style.display = 'none';
    await unlockDashboard();
  }

  if (wardenUnlockBtn) wardenUnlockBtn.addEventListener('click', attemptSignIn);
  [emailInput, passwordInput].forEach(el => el && el.addEventListener('keypress', e => {
    if (e.key === 'Enter') attemptSignIn();
  }));
  if (mfaVerifyBtn) mfaVerifyBtn.addEventListener('click', verifyMfa);
  if (mfaInput) mfaInput.addEventListener('keypress', e => { if (e.key === 'Enter') verifyMfa(); });
  if (mfaCancelBtn) mfaCancelBtn.addEventListener('click', async () => {
    await signOut(); showStep('password');
  });
  if (enrollConfirmBtn) enrollConfirmBtn.addEventListener('click', confirmEnroll);
  if (enrollInput) enrollInput.addEventListener('keypress', e => { if (e.key === 'Enter') confirmEnroll(); });
  if (enrollSkipBtn) enrollSkipBtn.addEventListener('click', () => unlockDashboard());

  // Returning manager with a live session: skip the login screen.
  (async () => {
    if (supabaseReady && await currentUser() && await isManager()) {
      await unlockDashboard();
    }
  })();

  // Lock / Logout
  if (mgrLockBtn) {
    mgrLockBtn.addEventListener('click', () => {
      if (stopBookingFeed) { stopBookingFeed(); stopBookingFeed = null; }
      signOut();
      wardenDashboardView.classList.remove('is-open');
      wardenLoginView.style.display = 'block';
      if (wardenDialog) wardenDialog.classList.remove('is-dashboard');
      mgrLockBtn.style.display = 'none';
      showStep('password');
      if (passwordInput) passwordInput.value = '';
      if (emailInput) emailInput.focus();
    });
  }

  // 1. Tab Switching within Manager Hub
  const tabBtns = document.querySelectorAll('#mgrTabsNav .mgr-tab-btn');
  const tabPanes = document.querySelectorAll('.mgr-tab-pane');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.dataset.tab;
      tabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');

      // Visibility is the .active class alone. An inline display here used
      // to win over the stylesheet, which stopped the bookings pane from
      // becoming the flex column its scrolling table needs.
      tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === targetTabId.replace('tab-', 'pane-'));
      });

      // Without this a tall pane leaves the body scrolled down, and the next
      // tab opens somewhere in its middle.
      const body = document.querySelector('#wardenModal .mgr-modal-body');
      if (body) body.scrollTop = 0;
    });
  });

  // 2. Populate form fields from saved config
  function populateManagerForm() {
    const cfg = getHostelConfig();

    // Prices
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && val !== undefined) el.value = val;
    };

    setVal('cfgDoubleBase', cfg.pricing.doubleBase);
    setVal('cfgDoubleAcAdd', cfg.pricing.doubleAcAdd);
    setVal('cfgTripleBase', cfg.pricing.tripleBase);
    setVal('cfgTripleAcAdd', cfg.pricing.tripleAcAdd);
    setVal('cfgFourBase', cfg.pricing.fourBase);
    setVal('cfgFourAcAdd', cfg.pricing.fourAcAdd);
    setVal('cfgFiveBase', cfg.pricing.fiveBase);
    setVal('cfgFiveAcAdd', cfg.pricing.fiveAcAdd);
    setVal('cfgDisc3m', cfg.pricing.disc3m);
    setVal('cfgDisc6m', cfg.pricing.disc6m);
    setVal('cfgDisc12m', cfg.pricing.disc12m);
    setVal('cfgSecurityDeposit', (cfg.pricing.securityDeposit !== undefined && cfg.pricing.securityDeposit !== null) ? cfg.pricing.securityDeposit : 5400);
    setVal('cfgAdvanceAmount', (cfg.pricing.advanceAmount !== undefined && cfg.pricing.advanceAmount !== null) ? cfg.pricing.advanceAmount : 1000);
    setVal('cfgDailyRate', cfg.pricing.dailyRate ?? 400);
    setVal('cfgDailyDiscount', cfg.pricing.dailyDiscount ?? 10);
    setVal('cfgDailyAcAdd', cfg.pricing.dailyAcAdd ?? 100);
    if (document.getElementById('cfgTokenAmount')) setVal('cfgTokenAmount', cfg.pricing.tokenAmount || 500);
    updateManagerDailyPreview();

    // Texts
    setVal('cfgHostelName', cfg.texts.hostelName);
    setVal('cfgHeroHeadline', cfg.texts.heroHeadline);
    setVal('cfgPhone', cfg.texts.phone);
    setVal('cfgWhatsApp', cfg.texts.whatsapp);
    setVal('cfgEmail', cfg.texts.email || 'jareenaworks@gmail.com');
    setVal('cfgUpiId', cfg.texts.upiId || '');
    setVal('cfgAddress', cfg.texts.address);
    setVal('cfgLandmark', cfg.texts.landmark);
    setVal('cfgVisitingHours', cfg.texts.visitingHours);
    setVal('cfgOpeningNotice', cfg.texts.openingNotice);

    // Photos
    setVal('cfgCinematicImg', cfg.photos.cinematicImg || DEFAULT_HOSTEL_CONFIG.photos.cinematicImg);
    setVal('cfgDoubleImg', cfg.photos.doubleImg);
    setVal('cfgTripleImg', cfg.photos.tripleImg);
    setVal('cfgStudyImg', cfg.photos.studyImg);
    setVal('cfgTerraceImg', cfg.photos.terraceImg);
    setVal('cfgExecImg', cfg.photos.execImg || cfg.photos.doubleImg);
    setVal('cfgDiningImg', cfg.photos.diningImg);
    setVal('cfgKitchenImg', cfg.photos.kitchenImg);
    setVal('cfgLaundryImg', cfg.photos.laundryImg);
    setVal('cfgSecurityImg', cfg.photos.securityImg);

    // Photo Display Titles
    setVal('cfgDoubleTitle', cfg.photos.doubleTitle !== undefined ? cfg.photos.doubleTitle : DEFAULT_HOSTEL_CONFIG.photos.doubleTitle);
    setVal('cfgTripleTitle', cfg.photos.tripleTitle !== undefined ? cfg.photos.tripleTitle : DEFAULT_HOSTEL_CONFIG.photos.tripleTitle);
    setVal('cfgExecTitle', cfg.photos.execTitle !== undefined ? cfg.photos.execTitle : DEFAULT_HOSTEL_CONFIG.photos.execTitle);
    setVal('cfgStudyTitle', cfg.photos.studyTitle !== undefined ? cfg.photos.studyTitle : DEFAULT_HOSTEL_CONFIG.photos.studyTitle);
    setVal('cfgTerraceTitle', cfg.photos.terraceTitle !== undefined ? cfg.photos.terraceTitle : DEFAULT_HOSTEL_CONFIG.photos.terraceTitle);
    setVal('cfgDiningTitle', cfg.photos.diningTitle !== undefined ? cfg.photos.diningTitle : (DEFAULT_HOSTEL_CONFIG.photos.diningTitle || ''));
    setVal('cfgKitchenTitle', cfg.photos.kitchenTitle !== undefined ? cfg.photos.kitchenTitle : DEFAULT_HOSTEL_CONFIG.photos.kitchenTitle);
    setVal('cfgLaundryTitle', cfg.photos.laundryTitle !== undefined ? cfg.photos.laundryTitle : DEFAULT_HOSTEL_CONFIG.photos.laundryTitle);
    setVal('cfgSecurityTitle', cfg.photos.securityTitle !== undefined ? cfg.photos.securityTitle : DEFAULT_HOSTEL_CONFIG.photos.securityTitle);

    // Update Photo Previews
    const updatePrev = (prevId, url) => {
      const img = document.getElementById(prevId);
      if (img && url) img.src = url;
    };
    updatePrev('prevCinematicImg', cfg.photos.cinematicImg || DEFAULT_HOSTEL_CONFIG.photos.cinematicImg);
    updatePrev('prevDoubleImg', cfg.photos.doubleImg);
    updatePrev('prevTripleImg', cfg.photos.tripleImg);
    updatePrev('prevStudyImg', cfg.photos.studyImg);
    updatePrev('prevTerraceImg', cfg.photos.terraceImg);
    updatePrev('prevExecImg', cfg.photos.execImg || cfg.photos.doubleImg);
    updatePrev('prevDiningImg', cfg.photos.diningImg);
    updatePrev('prevKitchenImg', cfg.photos.kitchenImg);
    updatePrev('prevLaundryImg', cfg.photos.laundryImg);
    updatePrev('prevSecurityImg', cfg.photos.securityImg);
  }

  function updateManagerDailyPreview() {
    const rateInput = document.getElementById('cfgDailyRate');
    const discInput = document.getElementById('cfgDailyDiscount');
    if (!rateInput || !discInput) return;
    const rate = Math.max(0, parseInt(rateInput.value, 10) || 0);
    const disc = Math.max(0, Math.min(90, parseInt(discInput.value, 10) || 0));
    const orig = disc > 0 ? (rate + Math.round((rate * disc) / 100)) : rate;
    const diff = orig - rate;

    const elOrig = document.getElementById('mgrPrevOriginal');
    const elFormula = document.getElementById('mgrPrevOriginalFormula');
    const elDisc = document.getElementById('mgrPrevDiscount');
    const elFinal = document.getElementById('mgrPrevFinal');

    if (elOrig) elOrig.textContent = `₹${orig.toLocaleString('en-IN')}`;
    if (elFormula) elFormula.textContent = disc > 0 ? `₹${rate} + ${disc}%` : 'No discount';
    if (elDisc) {
      elDisc.textContent = disc > 0 ? `${disc}% OFF (-₹${diff.toLocaleString('en-IN')})` : '0% (No discount)';
    }
    if (elFinal) elFinal.textContent = `₹${rate.toLocaleString('en-IN')} / day`;
  }

  const cfgDailyRateEl = document.getElementById('cfgDailyRate');
  const cfgDailyDiscountEl = document.getElementById('cfgDailyDiscount');
  if (cfgDailyRateEl) cfgDailyRateEl.addEventListener('input', updateManagerDailyPreview);
  if (cfgDailyDiscountEl) cfgDailyDiscountEl.addEventListener('input', updateManagerDailyPreview);

  // 3. Photo URL live typing preview
  const photoInputs = [
    { inputId: 'cfgCinematicImg', prevId: 'prevCinematicImg' },
    { inputId: 'cfgDoubleImg', prevId: 'prevDoubleImg' },
    { inputId: 'cfgTripleImg', prevId: 'prevTripleImg' },
    { inputId: 'cfgStudyImg', prevId: 'prevStudyImg' },
    { inputId: 'cfgTerraceImg', prevId: 'prevTerraceImg' },
    { inputId: 'cfgExecImg', prevId: 'prevExecImg' },
    { inputId: 'cfgDiningImg', prevId: 'prevDiningImg' },
    { inputId: 'cfgKitchenImg', prevId: 'prevKitchenImg' },
    { inputId: 'cfgLaundryImg', prevId: 'prevLaundryImg' },
    { inputId: 'cfgSecurityImg', prevId: 'prevSecurityImg' }
  ];

  photoInputs.forEach(({ inputId, prevId }) => {
    const inputEl = document.getElementById(inputId);
    const prevEl = document.getElementById(prevId);
    if (inputEl && prevEl) {
      inputEl.addEventListener('input', () => {
        if (inputEl.value.trim()) {
          prevEl.src = inputEl.value.trim();
        }
      });
    }
  });

  // 4. Preset Photo Chips
  const presetChipsContainers = document.querySelectorAll('.mgr-preset-chips');
  presetChipsContainers.forEach(container => {
    const targetInputId = container.dataset.target;
    const targetPrevId = container.dataset.prev;
    const btns = container.querySelectorAll('.mgr-preset-btn');

    btns.forEach(btn => {
      btn.addEventListener('click', () => {
        const url = btn.dataset.url;
        const inputEl = document.getElementById(targetInputId);
        const prevEl = document.getElementById(targetPrevId);
        if (inputEl) inputEl.value = url;
        if (prevEl) prevEl.src = url;
      });
    });
  });

  // 4b. Clear / Remove Photo Display Title Buttons
  document.querySelectorAll('.mgr-photo-clear-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.clear;
      const targetInput = document.getElementById(targetId);
      if (targetInput) {
        targetInput.value = '';
        targetInput.dispatchEvent(new Event('input'));
      }
    });
  });

  // 5. Save All Changes Button
  if (mgrSaveAllBtn) {
    mgrSaveAllBtn.addEventListener('click', async () => {
      const getNum = (id, fallback) => {
        const el = document.getElementById(id);
        const val = el ? parseInt(el.value, 10) : fallback;
        return isNaN(val) ? fallback : val;
      };
      const getTxt = (id, fallback) => {
        const el = document.getElementById(id);
        return el && el.value.trim() ? el.value.trim() : fallback;
      };
      const getOptionalTxt = (id, fallback) => {
        const el = document.getElementById(id);
        if (!el) return fallback !== undefined ? fallback : '';
        return el.value.trim();
      };

      const updatedConfig = {
        pricing: {
          doubleBase: getNum('cfgDoubleBase', 8500),
          doubleAcAdd: getNum('cfgDoubleAcAdd', 1500),
          tripleBase: getNum('cfgTripleBase', 6500),
          tripleAcAdd: getNum('cfgTripleAcAdd', 1000),
          fourBase: getNum('cfgFourBase', 5500),
          fourAcAdd: getNum('cfgFourAcAdd', 800),
          fiveBase: getNum('cfgFiveBase', 4800),
          fiveAcAdd: getNum('cfgFiveAcAdd', 600),
          disc3m: getNum('cfgDisc3m', 5),
          disc6m: getNum('cfgDisc6m', 10),
          disc12m: getNum('cfgDisc12m', 15),
          securityDeposit: getNum('cfgSecurityDeposit', 5400),
          advanceAmount: getNum('cfgAdvanceAmount', 1000),
          dailyRate: getNum('cfgDailyRate', 400),
          dailyDiscount: getNum('cfgDailyDiscount', 0),
          dailyAcAdd: getNum('cfgDailyAcAdd', 100)
        },
        texts: {
          hostelName: getTxt('cfgHostelName', 'Chaitanya Mens PG & Hostel'),
          heroHeadline: getTxt('cfgHeroHeadline', 'STAY | STUDY | GROW'),
          phone: getTxt('cfgPhone', '+91 99497 85344'),
          whatsapp: getTxt('cfgWhatsApp', '919949785344'),
          email: getTxt('cfgEmail', 'jareenaworks@gmail.com'),
          address: getTxt('cfgAddress', "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001"),
          landmark: getTxt('cfgLandmark', "Landmark: Beside Siva Kumar Clinic, Venkateshwara Colony, Naimnagar"),
          visitingHours: getTxt('cfgVisitingHours', '24 hrs'),
          openingNotice: getTxt('cfgOpeningNotice', 'Opening 1st Oct • 2, 3, 4 & 5 Sharing Beds'),
          upiId: (document.getElementById('cfgUpiId')?.value || '').trim(),
          upiName: DEFAULT_HOSTEL_CONFIG.texts.upiName
        },
        photos: {
          cinematicImg: getTxt('cfgCinematicImg', DEFAULT_HOSTEL_CONFIG.photos.cinematicImg),
          doubleImg: getTxt('cfgDoubleImg', DEFAULT_HOSTEL_CONFIG.photos.doubleImg),
          tripleImg: getTxt('cfgTripleImg', DEFAULT_HOSTEL_CONFIG.photos.tripleImg),
          studyImg: getTxt('cfgStudyImg', DEFAULT_HOSTEL_CONFIG.photos.studyImg),
          terraceImg: getTxt('cfgTerraceImg', DEFAULT_HOSTEL_CONFIG.photos.terraceImg),
          execImg: getTxt('cfgExecImg', DEFAULT_HOSTEL_CONFIG.photos.execImg),
          diningImg: getTxt('cfgDiningImg', DEFAULT_HOSTEL_CONFIG.photos.diningImg),
          kitchenImg: getTxt('cfgKitchenImg', DEFAULT_HOSTEL_CONFIG.photos.kitchenImg),
          laundryImg: getTxt('cfgLaundryImg', DEFAULT_HOSTEL_CONFIG.photos.laundryImg),
          securityImg: getTxt('cfgSecurityImg', DEFAULT_HOSTEL_CONFIG.photos.securityImg),

          doubleTitle: getOptionalTxt('cfgDoubleTitle', DEFAULT_HOSTEL_CONFIG.photos.doubleTitle),
          tripleTitle: getOptionalTxt('cfgTripleTitle', DEFAULT_HOSTEL_CONFIG.photos.tripleTitle),
          execTitle: getOptionalTxt('cfgExecTitle', DEFAULT_HOSTEL_CONFIG.photos.execTitle),
          studyTitle: getOptionalTxt('cfgStudyTitle', DEFAULT_HOSTEL_CONFIG.photos.studyTitle),
          terraceTitle: getOptionalTxt('cfgTerraceTitle', DEFAULT_HOSTEL_CONFIG.photos.terraceTitle),
          diningTitle: getOptionalTxt('cfgDiningTitle', ''),
          kitchenTitle: getOptionalTxt('cfgKitchenTitle', DEFAULT_HOSTEL_CONFIG.photos.kitchenTitle),
          laundryTitle: getOptionalTxt('cfgLaundryTitle', DEFAULT_HOSTEL_CONFIG.photos.laundryTitle),
          securityTitle: getOptionalTxt('cfgSecurityTitle', DEFAULT_HOSTEL_CONFIG.photos.securityTitle)
        },
        inventory: { ...bedInventory }
      };

      // Validate before anything is written. A bad UPI id or a nonsense
      // price goes live to every visitor the moment this saves, so the
      // check belongs here rather than after the fact.
      const problems = [];
      const upiEl = document.getElementById('cfgUpiId');
      const upiCheck = markField(upiEl, validateUpiId(upiEl?.value), document.getElementById('cfgUpiIdMsg'));
      if (!upiCheck.ok) problems.push(upiCheck.error);

      const phoneEl = document.getElementById('cfgPhone');
      if (phoneEl && phoneEl.value.trim()) {
        const c = markField(phoneEl, validatePhone(phoneEl.value.replace(/^\+?91/, '')));
        if (!c.ok) problems.push('Phone: ' + c.error);
      }

      const waEl = document.getElementById('cfgWhatsApp');
      if (waEl) {
        const c = markField(waEl, validateWhatsApp(waEl.value));
        if (!c.ok) problems.push('WhatsApp: ' + c.error);
      }

      const mailEl = document.getElementById('cfgEmail');
      if (mailEl) {
        const c = markField(mailEl, validateEmail(mailEl.value));
        if (!c.ok) problems.push('Contact email: ' + c.error);
      }

      for (const [id, label] of [
        ['cfgDoubleBase', '2 sharing rent'], ['cfgTripleBase', '3 sharing rent'],
        ['cfgFourBase', '4 sharing rent'],   ['cfgFiveBase', '5 sharing rent'],
        ['cfgSecurityDeposit', 'Security deposit'],
        ['cfgAdvanceAmount', 'Booking advance token'],
        ['cfgDailyRate', 'Daily stay base rent'], ['cfgDailyAcAdd', 'Daily stay AC charge'],
      ]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const c = markField(el, validateMoney(el.value, { min: 0, max: 200000, label }));
        if (!c.ok) problems.push(c.error);
      }

      for (const [id, label] of [
        ['cfgDisc3m', '3 month discount'], ['cfgDisc6m', '6 month discount'],
        ['cfgDisc12m', '12 month discount'], ['cfgDailyDiscount', 'Daily stay discount'],
      ]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const c = markField(el, validatePercent(el.value, label));
        if (!c.ok) problems.push(c.error);
      }

      // Photo fields: an https link, a data: URI, or a relative asset path.
      for (const [id, label] of [
        ['cfgCinematicImg', 'Hero background'], ['cfgDoubleImg', '2 sharing photo'],
        ['cfgTripleImg', '3 sharing photo'],    ['cfgExecImg', 'Executive photo'],
        ['cfgStudyImg', 'Study area photo'],    ['cfgTerraceImg', 'Terrace photo'],
        ['cfgDiningImg', 'Dining photo'],       ['cfgKitchenImg', 'Kitchen photo'],
        ['cfgLaundryImg', 'Laundry photo'],     ['cfgSecurityImg', 'Security photo'],
      ]) {
        const el = document.getElementById(id);
        if (!el) continue;
        const c = markField(el, validatePhotoUrl(el.value, label));
        if (!c.ok) problems.push(c.error);
      }

      if (problems.length) {
        await showAppAlert({
          title: 'Resolve Details Before Saving',
          message: 'Fix these fields before saving:\n\n• ' + problems.join('\n• '),
          buttonText: 'Understood',
          type: 'danger',
          badge: 'Validation',
          icon: 'fa-solid fa-circle-exclamation'
        });
        return;
      }

      // An unrecognised UPI handle is a warning, not a block — new PSPs
      // appear all the time — but it must be acknowledged, because a typo
      // here silently sends every guest's money to the wrong place.
      if (upiCheck.warn) {
        const confirmed = await showAppConfirm({
          title: 'Unrecognised UPI Handle',
          message: `${upiCheck.warn}\n\nSave anyway?`,
          confirmText: 'Save Anyway',
          cancelText: 'Cancel',
          type: 'warning',
          badge: 'UPI Check',
          icon: 'fa-solid fa-triangle-exclamation'
        });
        if (!confirmed) {
          upiEl?.focus();
          return;
        }
      }

      const originalHtml = mgrSaveAllBtn.innerHTML;
      mgrSaveAllBtn.disabled = true;
      mgrSaveAllBtn.innerHTML = `<span class="btn-lottie" id="saveAnim"></span> Saving…`;
      const saveAnim = await mountLottie(document.getElementById('saveAnim'), spinnerAnim);

      const res = await saveHostelConfig(updatedConfig);
      destroyLottie(saveAnim);
      applyHostelConfigToSite(updatedConfig);

      // Only claim "Live" if it actually reached the server.
      mgrSaveAllBtn.disabled = false;
      if (res.ok) {
        mgrSaveAllBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Saved &amp; Live!`;
        mgrSaveAllBtn.classList.remove('btn-primary');
        mgrSaveAllBtn.classList.add('btn-success');
        showSiteToast('Configuration saved', 'Prices, text, photos and inventory are live on the site.',
                      'fa-solid fa-cloud-arrow-up');
      } else {
        mgrSaveAllBtn.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Save failed`;
        mgrSaveAllBtn.classList.remove('btn-primary');
        mgrSaveAllBtn.classList.add('btn-danger');
        await showAppAlert({
          title: 'Server Sync Notice',
          message: 'Could not save to the server: ' + res.error + '\n\nYour changes are visible on this device only.',
          buttonText: 'OK',
          type: 'warning',
          badge: 'Offline Mode',
          icon: 'fa-solid fa-cloud-arrow-down'
        });
      }
      setTimeout(() => {
        mgrSaveAllBtn.innerHTML = originalHtml;
        mgrSaveAllBtn.classList.add('btn-primary');
        mgrSaveAllBtn.classList.remove('btn-success', 'btn-danger');
      }, 2600);
    });
  }

  // 6. Reset to Factory Defaults
  if (mgrResetDefaultsBtn) {
    mgrResetDefaultsBtn.addEventListener('click', async () => {
      const confirmed = await showAppConfirm({
        title: 'Reset to Factory Defaults?',
        message: 'Reset all pricing, text, photos, and inventory to factory defaults?',
        confirmText: 'Reset Defaults',
        cancelText: 'Cancel',
        type: 'danger',
        badge: 'Reset Action',
        icon: 'fa-solid fa-rotate-left'
      });
      if (confirmed) {
        saveHostelConfig(DEFAULT_HOSTEL_CONFIG);
        bedInventory = { ...DEFAULT_HOSTEL_CONFIG.inventory };
        saveBedInventory();
        applyHostelConfigToSite(DEFAULT_HOSTEL_CONFIG);
        populateManagerForm();
        updateBedUI();
        showSiteToast('Reset to factory defaults', 'Pricing, text, photos and inventory are back to their original values.',
                      'fa-solid fa-rotate-left');
      }
    });
  }

  // 7. Inventory Steppers logic
  const stepperBtns = document.querySelectorAll('.stepper-btn');
  stepperBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const room = btn.dataset.room;
      const delta = parseInt(btn.dataset.delta, 10);
      const cap = TOTAL_CAPACITY[room] || 25;
      const cur = bedInventory[room] !== undefined ? bedInventory[room] : 2;
      const newCount = Math.max(0, Math.min(cap, cur + delta));
      bedInventory[room] = newCount;
      saveBedInventory();
      updateBedUI();
    });
  });

  // 8. Mark Full / Reset buttons
  ['double', 'triple', 'four', 'five'].forEach(room => {
    const toggleBtn = document.getElementById(`toggleFull${room.charAt(0).toUpperCase() + room.slice(1)}`);
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        if (bedInventory[room] > 0) {
          bedInventory[room] = 0;
        } else {
          bedInventory[room] = room === 'double' ? 2 : (room === 'triple' ? 3 : (room === 'four' ? 4 : 3));
        }
        saveBedInventory();
        updateBedUI();
      });
    }
  });

  // 9. Clear Bookings
  if (clearBookingsBtn) {
    clearBookingsBtn.addEventListener('click', async () => {
      const confirmed = await showAppConfirm({
        title: 'Permanently Delete Enquiries?',
        message: 'Permanently delete all booking enquiries? This cannot be undone.',
        confirmText: 'Permanently Delete',
        cancelText: 'Cancel',
        type: 'danger',
        badge: 'Danger',
        icon: 'fa-solid fa-trash-can'
      });
      if (confirmed) {
        const res = await clearBookings();
        if (!res.ok) {
          await showAppAlert({
            title: 'Delete Failed',
            message: 'Could not clear enquiries: ' + res.error,
            type: 'danger',
            icon: 'fa-solid fa-circle-exclamation'
          });
          return;
        }
        refreshBookings();
      }
    });
  }
}

function updateWardenInventoryControls() {
  ['double', 'triple', 'four', 'five'].forEach(room => {
    const countEl = document.getElementById(`inv${room.charAt(0).toUpperCase() + room.slice(1)}Count`);
    const labelEl = document.getElementById(`inv${room.charAt(0).toUpperCase() + room.slice(1)}Label`);
    const toggleBtn = document.getElementById(`toggleFull${room.charAt(0).toUpperCase() + room.slice(1)}`);

    const count = bedInventory[room] !== undefined ? bedInventory[room] : 0;
    if (countEl) countEl.textContent = count;
    if (labelEl) {
      labelEl.textContent = count === 0 ? 'HOUSE FULL' : `${count} Bed${count > 1 ? 's' : ''} Left`;
      labelEl.style.color = count === 0 ? 'var(--danger)' : 'var(--primary)';
    }

    if (toggleBtn) {
      toggleBtn.innerHTML = count === 0 
        ? `<i class="fa-solid fa-rotate-left"></i> Restore Vacancy` 
        : `<i class="fa-solid fa-ban"></i> Mark Full`;
      toggleBtn.className = count === 0 ? 'btn btn-outline btn-sm' : 'btn btn-outline btn-sm';
    }
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Status chip beside the reference.
 */
function tokenCell(b) {
  if (b.status === 'accepted' || b.paymentStatus === 'paid') {
    return `<span class="pay-chip is-paid"><i class="fa-solid fa-circle-check"></i> Accepted</span>`;
  }
  if (b.status === 'rejected') {
    return `<span class="pay-chip is-rejected"><i class="fa-solid fa-circle-xmark"></i> Rejected</span>`;
  }
  return `<span class="pay-chip is-pending"><i class="fa-solid fa-hourglass-half"></i> Request</span>`;
}

/**
 * Which enquiries the manager is currently looking at.
 * Defaults to "action" — requests pending manager acceptance.
 */
let enquiryFilter = 'action';

function bucketOf(b) {
  if (b.status === 'rejected') return 'rejected';
  if (b.status === 'accepted' || b.paymentStatus === 'paid') return 'verified';
  return 'action';
}

/** Live UPI id feedback in the manager portal. */
function initUpiIdField() {
  const el = document.getElementById('cfgUpiId');
  const msg = document.getElementById('cfgUpiIdMsg');
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  const check = () => markField(el, validateUpiId(el.value), msg);
  el.addEventListener('blur', check);
  el.addEventListener('input', () => {
    if (el.classList.contains('is-invalid') || el.classList.contains('is-warned')) check();
  });
}

/* Window the enquiry list by arrival date. 'all' means no windowing. */
let enquiryDateFilter = 'all';
let enquirySearchQuery = '';

/** True when the booking arrived inside the selected window. */
function withinDateFilter(b) {
  if (enquiryDateFilter === 'all') return true;
  if (!b.createdAt) return false;      // nothing to judge it by — exclude
  const made = new Date(b.createdAt);
  if (Number.isNaN(made.getTime())) return false;

  if (enquiryDateFilter === 'today') {
    const now = new Date();
    return made.getFullYear() === now.getFullYear()
        && made.getMonth() === now.getMonth()
        && made.getDate() === now.getDate();
  }
  const days = Number(enquiryDateFilter);
  if (!Number.isFinite(days)) return true;
  // Count back from the start of today so "last 7 days" means 7 calendar
  // days, not 168 hours — a manager reads it the first way.
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  return made >= from;
}

function initEnquiryFilters() {
  const bar = document.getElementById('enqFilters');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';

  const dateSel = document.getElementById('enqDateFilter');
  const dateDropdown = document.getElementById('enqDateDropdown');
  const dateBtn = document.getElementById('enqDateBtn');
  const dateMenu = document.getElementById('enqDateMenu');
  const dateCurrent = document.getElementById('enqDateCurrent');
  const dateOpts = dateMenu ? dateMenu.querySelectorAll('.enq-date-opt') : [];

  if (dateBtn && dateMenu) {
    const toggleMenu = (open) => {
      const isCurrentlyOpen = !dateMenu.hidden && dateMenu.classList.contains('is-open');
      const shouldOpen = (open !== undefined) ? Boolean(open) : !isCurrentlyOpen;
      dateMenu.hidden = !shouldOpen;
      dateMenu.classList.toggle('is-open', shouldOpen);
      dateBtn.setAttribute('aria-expanded', String(shouldOpen));
      dateBtn.classList.toggle('is-active', shouldOpen);
    };

    dateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    dateOpts.forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.dataset.value;
        const text = opt.querySelector('span')?.textContent || opt.textContent.trim();

        dateOpts.forEach(o => {
          const isMatch = (o === opt);
          o.classList.toggle('is-selected', isMatch);
          o.setAttribute('aria-selected', String(isMatch));
        });

        if (dateCurrent) dateCurrent.textContent = text;
        toggleMenu(false);

        enquiryDateFilter = val;
        if (dateSel) dateSel.value = val;
        renderEnquiriesTable();
      });
    });

    document.addEventListener('click', (e) => {
      if (dateDropdown && !dateDropdown.contains(e.target)) {
        toggleMenu(false);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        toggleMenu(false);
      }
    });
  }

  if (dateSel) {
    dateSel.addEventListener('change', () => {
      enquiryDateFilter = dateSel.value;
      renderEnquiriesTable();
    });
  }
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('.enq-filter');
    if (!btn) return;
    enquiryFilter = btn.dataset.filter;
    bar.querySelectorAll('.enq-filter').forEach(x => x.classList.toggle('is-active', x === btn));
    renderEnquiriesTable();
  });

  const searchInput = document.getElementById('enqSearchInput');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', (e) => {
      enquirySearchQuery = (e.target.value || '').trim().toLowerCase();
      renderEnquiriesTable();
    });
  }
}

let activeInlineAction = null; // { ref: string, type: 'accept' | 'reject' } | null
const activeUtrValues = {}; // map of ref -> typed UTR string

function openIdProofModal(b) {
  const modal = document.getElementById('idProofModal');
  if (!modal || !b) return;

  const idModalName = document.getElementById('idModalName');
  const idModalRef = document.getElementById('idModalRef');
  const idModalType = document.getElementById('idModalType');
  const idModalNumber = document.getElementById('idModalNumber');
  const idModalImg = document.getElementById('idModalImg');
  const idModalPdfBox = document.getElementById('idModalPdfBox');
  const idModalPdfName = document.getElementById('idModalPdfName');
  const idModalPdfLink = document.getElementById('idModalPdfLink');
  const idModalNoDoc = document.getElementById('idModalNoDoc');

  if (idModalName) idModalName.textContent = b.name || 'Resident';
  if (idModalRef) idModalRef.textContent = b.ref || '-';
  if (idModalType) idModalType.textContent = b.id_type || 'Government ID';
  if (idModalNumber) idModalNumber.textContent = b.id_number || 'Document Uploaded';

  const proofUrl = b.id_proof_url || '';
  if (proofUrl) {
    if (proofUrl.startsWith('data:application/pdf') || proofUrl.toLowerCase().endsWith('.pdf')) {
      if (idModalImg) idModalImg.style.display = 'none';
      if (idModalNoDoc) idModalNoDoc.style.display = 'none';
      if (idModalPdfBox) {
        idModalPdfBox.style.display = 'block';
        const docName = `${(b.name || 'Resident').replace(/\s+/g, '_')}_${(b.id_type || 'ID').replace(/\s+/g, '_')}.pdf`;
        if (idModalPdfName) idModalPdfName.textContent = docName;
        if (idModalPdfLink) {
          idModalPdfLink.href = proofUrl;
          idModalPdfLink.download = docName;
        }
      }
    } else {
      if (idModalPdfBox) idModalPdfBox.style.display = 'none';
      if (idModalNoDoc) idModalNoDoc.style.display = 'none';
      if (idModalImg) {
        idModalImg.src = proofUrl;
        idModalImg.style.display = 'block';
      }
    }
  } else {
    if (idModalImg) idModalImg.style.display = 'none';
    if (idModalPdfBox) idModalPdfBox.style.display = 'none';
    if (idModalNoDoc) idModalNoDoc.style.display = 'block';
  }

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function initIdProofModal() {
  const modal = document.getElementById('idProofModal');
  const closeBtn = document.getElementById('idProofModalClose');
  if (!modal) return;

  const closeModal = () => {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    const wardenModal = document.getElementById('wardenModal');
    if (!wardenModal || !wardenModal.classList.contains('active')) {
      document.body.style.overflow = '';
    }
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      closeModal();
    }
  });
}

function renderEnquiriesTable() {
  const tbody = document.getElementById('wardenEnquiriesBody');
  const countEl = document.getElementById('enquiryCount');
  initEnquiryFilters();

  /* The date window applies first, so the status chips count what is
     actually in view. */
  const all = getStoredBookings().filter(withinDateFilter);

  // keep every chip's count live, not just the active one
  const counts = { action: 0, verified: 0, rejected: 0, all: all.length };
  all.forEach(b => {
    const bucket = bucketOf(b);
    if (counts[bucket] !== undefined) counts[bucket]++;
  });
  document.querySelectorAll('.enq-count').forEach(el => {
    el.textContent = counts[el.dataset.count] ?? 0;
  });

  let bookings = enquiryFilter === 'all'
    ? all
    : all.filter(b => bucketOf(b) === enquiryFilter);

  if (enquirySearchQuery) {
    bookings = bookings.filter(b => {
      const q = enquirySearchQuery;
      return (b.ref && b.ref.toLowerCase().includes(q))
        || (b.name && b.name.toLowerCase().includes(q))
        || (b.phone && b.phone.includes(q))
        || (b.email && b.email.toLowerCase().includes(q))
        || (b.room && b.room.toLowerCase().includes(q))
        || (b.utr && b.utr.toLowerCase().includes(q))
        || (b.upi_utr && b.upi_utr.toLowerCase().includes(q));
    });
  }

  if (countEl) countEl.textContent = all.length;
  if (!tbody) return;

  if (bookings.length === 0) {
    const blank = {
      action:   ['No pending requests', 'New resident booking enquiries will appear here for review and acceptance.'],
      verified: ['No accepted bookings yet', 'Once you accept a booking and verify the bank UTR, it moves here and an invoice is emailed.'],
      rejected: ['No rejected requests', 'Enquiries that you rejected will be listed here.'],
      all:      ['No enquiries yet', 'New booking requests from the website land here automatically.']
    }[enquiryFilter] || ['No enquiries', 'No bookings found.'];

    if (enquirySearchQuery) {
      blank[0] = 'No matching bookings';
      blank[1] = `No enquiries match "${enquirySearchQuery}". Try a different name, phone, or ref number.`;
    } else if (enquiryDateFilter !== 'all') {
      const windowName = { today: 'today', '7': 'the last 7 days', '30': 'the last 30 days' }[enquiryDateFilter];
      blank[1] = `Nothing arrived in ${windowName}. Widen the date filter to see older enquiries.`;
    }
    tbody.innerHTML = `<tr><td colspan="6">
        <div class="enquiry-empty">
          <div class="enquiry-empty-anim" id="enquiryEmptyAnim"></div>
          <p class="enquiry-empty-title">${blank[0]}</p>
          <p class="enquiry-empty-sub">${blank[1]}</p>
        </div>
      </td></tr>`;
    mountLottie(document.getElementById('enquiryEmptyAnim'), emptyInboxAnim);
    return;
  }

  if (!tbody.dataset.verifyBound) {
    tbody.dataset.verifyBound = '1';

    tbody.addEventListener('click', async (e) => {
      // 1. Accept button -> toggle inline accept row
      const acceptBtn = e.target.closest('[data-accept]');
      if (acceptBtn) {
        const ref = acceptBtn.dataset.accept;
        if (activeInlineAction && activeInlineAction.ref === ref && activeInlineAction.type === 'accept') {
          activeInlineAction = null;
        } else {
          activeInlineAction = { ref, type: 'accept' };
          const b = getStoredBookings().find(x => x.ref === ref);
          const repUtr = (b?.utr || b?.upi_utr || '').replace(/\D/g, '').slice(0, 12);
          if (activeUtrValues[ref] === undefined && repUtr) {
            activeUtrValues[ref] = repUtr;
          }
        }
        renderEnquiriesTable();
        if (activeInlineAction && activeInlineAction.type === 'accept') {
          setTimeout(() => {
            const inp = document.getElementById(`inlineUtr-${ref}`);
            if (inp) {
              inp.focus();
              inp.select?.();
            }
          }, 60);
        }
        return;
      }

      // 2. Reject button -> toggle inline reject row
      const rejectBtn = e.target.closest('[data-reject]');
      if (rejectBtn) {
        const ref = rejectBtn.dataset.reject;
        if (activeInlineAction && activeInlineAction.ref === ref && activeInlineAction.type === 'reject') {
          activeInlineAction = null;
        } else {
          activeInlineAction = { ref, type: 'reject' };
        }
        renderEnquiriesTable();
        return;
      }

      // 3. Cancel inline action
      const cancelBtn = e.target.closest('[data-inline-cancel]');
      if (cancelBtn) {
        activeInlineAction = null;
        renderEnquiriesTable();
        return;
      }

      // 4. Quick fill resident's reported UTR
      const quickBtn = e.target.closest('[data-inline-quick-utr]');
      if (quickBtn) {
        const ref = quickBtn.dataset.ref;
        const quickVal = (quickBtn.dataset.inlineQuickUtr || '').replace(/\D/g, '').slice(0, 12);
        if (ref && quickVal) {
          activeUtrValues[ref] = quickVal;
          const inp = document.getElementById(`inlineUtr-${ref}`);
          const counter = document.getElementById(`inlineCounter-${ref}`);
          const confirmBtn = document.querySelector(`[data-confirm-accept="${ref}"]`);
          const errEl = document.getElementById(`inlineError-${ref}`);
          if (inp) inp.value = quickVal;
          if (counter) {
            counter.textContent = `${quickVal.length} / 12`;
            counter.classList.toggle('is-valid', quickVal.length === 12);
          }
          if (confirmBtn) {
            confirmBtn.disabled = quickVal.length !== 12;
          }
          if (errEl) errEl.textContent = '';
          if (inp) inp.focus();
        }
        return;
      }

      // 5. Confirm Accept Click
      const confirmAcceptBtn = e.target.closest('[data-confirm-accept]');
      if (confirmAcceptBtn) {
        const ref = confirmAcceptBtn.dataset.confirmAccept;
        const b = getStoredBookings().find(x => x.ref === ref);
        if (!b) return;

        const isCash = b.payment_mode === 'cash' ||
                       b.paymentMode === 'cash' ||
                       b.paymentMode === 'Cash on Hand' ||
                       String(b.payment_mode || b.paymentMode || '').toLowerCase().includes('cash');

        const inp = document.getElementById(`inlineUtr-${ref}`);
        const errEl = document.getElementById(`inlineError-${ref}`);
        const utr = (inp?.value || activeUtrValues[ref] || '').replace(/\D/g, '').slice(0, 12);

        if (!isCash && utr.length !== 12) {
          if (errEl) errEl.textContent = 'Please enter a valid 12-digit UPI transaction reference.';
          inp?.focus();
          return;
        }

        confirmAcceptBtn.disabled = true;
        confirmAcceptBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Confirming &amp; Sending Invoice...';

        const cfg = getHostelConfig();
        const hostelInfo = {
          name: cfg?.texts?.hostelName || 'Chaitanya Mens PG & Hostel',
          phone: cfg?.texts?.phone || '+91 99497 85344',
          email: (cfg?.texts?.email && cfg?.texts?.email !== 'jareenaworks@gmail.com') ? cfg.texts.email : 'chaitnyamenspg@gmail.com',
          address: cfg?.texts?.address || "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001",
          visitingHours: cfg?.texts?.visitingHours || '24 hrs',
          pricing: cfg?.pricing
        };

        const calc = calculateInvoicePricing(b, cfg?.pricing);
        const moveInTotalVal = `₹${calc.moveInTotal.toLocaleString('en-IN')}`;
        const moveInNum = calc.moveInTotal;
        const depositVal = `₹${calc.securityDeposit.toLocaleString('en-IN')}`;
        const monthlyVal = `₹${calc.monthlyRent.toLocaleString('en-IN')}`;

        const isAdvance = b.payment_mode === 'advance' ||
                          b.paymentMode === 'advance' ||
                          b.paymentMode === 'Advance Token' ||
                          String(b.payment_mode || b.paymentMode || '').toLowerCase().includes('advance');
        const advanceAmt = isAdvance ? (b.advance_amount || calc.advanceAmount) : null;
        const balanceAmt = isAdvance ? (b.balance_amount !== undefined && b.balance_amount !== null ? b.balance_amount : calc.balanceDue) : null;

        try {
          await acceptBookingWithUtr(b.ref, isCash ? null : utr, {
            email: b.email,
            booking: {
              ...b,
              status: 'accepted',
              paymentStatus: 'paid',
              payment_status: 'paid',
              payment_mode: isCash ? 'cash' : (isAdvance ? 'advance' : (b.payment_mode || 'upi')),
              paymentMode: isCash ? 'Cash on Hand' : (isAdvance ? 'Advance Token' : (b.paymentMode || 'UPI Instant Transfer')),
              advance_amount: advanceAmt,
              balance_amount: balanceAmt,
              isVerified: true,
              upi_utr: isCash ? null : utr,
              utr: isCash ? null : utr,
              paidAt: new Date().toISOString(),
              monthly_rent: monthlyVal,
              payable_move_in: moveInTotalVal,
              security_deposit: depositVal,
              payment_amount: moveInNum,
              paymentAmount: moveInNum,
              pricing: cfg?.pricing
            },
            hostel: hostelInfo
          });

          activeInlineAction = null;
          delete activeUtrValues[ref];
          showSiteToast(
            'Booking Accepted & Verified',
            `Booking ${b.ref} confirmed (${isCash ? 'Cash on Hand' : (isAdvance ? 'Advance Token' : 'UPI')}). Official invoice emailed to ${b.email || 'resident'}.`,
            'fa-solid fa-circle-check'
          );
          await refreshBookings();
        } catch (err) {
          console.error('[acceptBooking] error:', err);
          if (errEl) errEl.textContent = 'Failed to accept booking: ' + (err.message || err);
          confirmAcceptBtn.disabled = false;
          confirmAcceptBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm &amp; Accept Booking';
        }
        return;
      }

      // 6. Confirm Reject Click
      const confirmRejectBtn = e.target.closest('[data-confirm-reject]');
      if (confirmRejectBtn) {
        const ref = confirmRejectBtn.dataset.confirmReject;
        const b = getStoredBookings().find(x => x.ref === ref);
        if (!b) return;

        confirmRejectBtn.disabled = true;
        const prevText = confirmRejectBtn.innerHTML;
        confirmRejectBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Rejecting...';

        try {
          await rejectBooking(b.ref);
          activeInlineAction = null;
          showSiteToast('Booking Rejected', `Enquiry ${b.ref} marked as rejected.`, 'fa-solid fa-circle-xmark');
          await refreshBookings();
        } catch (err) {
          await showAppAlert({
            title: 'Rejection Failed',
            message: 'Could not reject booking: ' + (err.message || err),
            type: 'danger',
            icon: 'fa-solid fa-circle-exclamation'
          });
          confirmRejectBtn.disabled = false;
          confirmRejectBtn.innerHTML = prevText;
        }
        return;
      }

      // 7. Resend invoice button
      const resendBtn = e.target.closest('[data-resend]');
      if (resendBtn) {
        const rref = resendBtn.dataset.resend;
        const b = getStoredBookings().find(x => x.ref === rref);
        resendBtn.disabled = true;
        const prevText = resendBtn.innerHTML;
        resendBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending…';
        const cfg = getHostelConfig();
        const hostelInfo = {
          name: cfg?.texts?.hostelName || 'Chaitanya Mens PG & Hostel',
          phone: cfg?.texts?.phone || '+91 99497 85344',
          email: (cfg?.texts?.email && cfg?.texts?.email !== 'jareenaworks@gmail.com') ? cfg.texts.email : 'chaitnyamenspg@gmail.com',
          address: cfg?.texts?.address || "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001",
          visitingHours: cfg?.texts?.visitingHours || '24 hrs',
          pricing: cfg?.pricing
        };
        const r = await sendInvoiceEmail(rref, 'receipt', {
          email: b?.email,
          booking: {
            ...b,
            status: 'accepted',
            paymentStatus: 'paid',
            payment_status: 'paid',
            isVerified: true,
            pricing: cfg?.pricing
          },
          hostel: hostelInfo
        });
        resendBtn.disabled = false;
        resendBtn.innerHTML = prevText;
        if (!r.ok) {
          await showAppAlert({
            title: 'Could Not Send Invoice',
            message: 'Could not send the invoice: ' + (r.error || 'unknown error'),
            type: 'danger',
            icon: 'fa-solid fa-envelope-circle-check'
          });
          return;
        }
        showSiteToast('Invoice Sent', `Validated invoice PDF emailed to ${b?.email || 'resident'}.`, 'fa-solid fa-paper-plane');
        await refreshBookings();
        return;
      }

      // 8. Direct Download PDF Invoice button
      const pdfBtn = e.target.closest('[data-download-pdf]');
      if (pdfBtn) {
        const rref = pdfBtn.dataset.downloadPdf;
        const b = getStoredBookings().find(x => x.ref === rref);
        if (!b) return;
        pdfBtn.disabled = true;
        const prevText = pdfBtn.innerHTML;
        pdfBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> PDF';
        const cfg = getHostelConfig();
        const hostelInfo = {
          name: cfg?.texts?.hostelName || 'Chaitanya Mens PG & Hostel',
          phone: cfg?.texts?.phone || '+91 99497 85344',
          email: (cfg?.texts?.email && cfg?.texts?.email !== 'jareenaworks@gmail.com') ? cfg.texts.email : 'chaitnyamenspg@gmail.com',
          address: cfg?.texts?.address || "18-5-38/1, Beside Siva Kumar Clinic, Venkateshwara Colony, NGO's Colony, Naimnagar, Hanamkonda, Telangana – 506001",
          visitingHours: cfg?.texts?.visitingHours || '24 hrs',
          pricing: cfg?.pricing
        };
        try {
          const calc = calculateInvoicePricing(b, cfg?.pricing);
          await downloadInvoicePdf({
            ...b,
            status: 'accepted',
            paymentStatus: 'paid',
            payment_status: 'paid',
            isVerified: true,
            upi_utr: b.utr || b.upi_utr,
            monthly_rent: `₹${calc.monthlyRent.toLocaleString('en-IN')}`,
            security_deposit: `₹${calc.securityDeposit.toLocaleString('en-IN')}`,
            payable_move_in: `₹${calc.moveInTotal.toLocaleString('en-IN')}`,
            payment_amount: calc.moveInTotal,
            paymentAmount: calc.moveInTotal,
            pricing: cfg?.pricing
          }, hostelInfo);
        } catch (err) {
          console.error('[pdf] direct download error:', err);
        }
        pdfBtn.disabled = false;
        pdfBtn.innerHTML = prevText;
        return;
      }

      // 9. View Government ID Proof modal button
      const viewIdBtn = e.target.closest('[data-view-id]');
      if (viewIdBtn) {
        const vref = viewIdBtn.dataset.viewId;
        const b = getStoredBookings().find(x => x.ref === vref);
        if (b) openIdProofModal(b);
        return;
      }
    });

    // UTR typing validation & live digit counter
    tbody.addEventListener('input', (e) => {
      if (e.target.matches('.enq-inline-utr-input')) {
        const inp = e.target;
        const ref = inp.dataset.utrRef;
        const clean = inp.value.replace(/\D/g, '').slice(0, 12);
        if (clean !== inp.value) inp.value = clean;
        activeUtrValues[ref] = clean;

        const counter = document.getElementById(`inlineCounter-${ref}`);
        if (counter) {
          counter.textContent = `${clean.length} / 12`;
          counter.classList.toggle('is-valid', clean.length === 12);
        }
        const errEl = document.getElementById(`inlineError-${ref}`);
        if (errEl) errEl.textContent = '';

        const confirmBtn = document.querySelector(`[data-confirm-accept="${ref}"]`);
        if (confirmBtn) {
          confirmBtn.disabled = clean.length !== 12;
        }
      }
    });

    // Enter key submits when 12 digits, Escape cancels
    tbody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('.enq-inline-utr-input')) {
        e.preventDefault();
        const ref = e.target.dataset.utrRef;
        const confirmBtn = document.querySelector(`[data-confirm-accept="${ref}"]`);
        if (confirmBtn && !confirmBtn.disabled) {
          confirmBtn.click();
        }
      } else if (e.key === 'Escape' && activeInlineAction) {
        activeInlineAction = null;
        renderEnquiriesTable();
      }
    });
  }

  tbody.innerHTML = bookings.map(b => {
    const isAccepted = b.status === 'accepted' || b.paymentStatus === 'paid';
    const isRejected = b.status === 'rejected';
    const isCash = b.payment_mode === 'cash' ||
                   b.paymentMode === 'cash' ||
                   b.paymentMode === 'Cash on Hand' ||
                   String(b.payment_mode || b.paymentMode || '').toLowerCase().includes('cash');
    const isAdvance = b.payment_mode === 'advance' ||
                      b.paymentMode === 'advance' ||
                      b.paymentMode === 'Advance Token' ||
                      String(b.payment_mode || b.paymentMode || '').toLowerCase().includes('advance');
    const advVal = b.advance_amount
      ? `₹${Number(b.advance_amount).toLocaleString('en-IN')}`
      : `₹${(Number(getHostelConfig()?.pricing?.advanceAmount) || 1000).toLocaleString('en-IN')}`;
    const balVal = (b.balance_amount !== undefined && b.balance_amount !== null)
      ? `₹${Number(b.balance_amount).toLocaleString('en-IN')}`
      : '';
    const utrStr = (b.utr || b.upi_utr || '').trim();
    const cleanPhone = (b.phone || '').replace(/\D/g, '');
    const payableAmt = b.payable_move_in || (b.paymentAmount ? `₹${Number(b.paymentAmount).toLocaleString('en-IN')}` : '₹13,900');
    const depositVal = b.security_deposit || (b.paymentAmount ? `₹${Number(b.paymentAmount).toLocaleString('en-IN')}` : '₹5,400');

    const isThisActing = activeInlineAction && activeInlineAction.ref === b.ref;
    const rowActingClass = isThisActing ? (activeInlineAction.type === 'accept' ? 'is-acting-accept' : 'is-acting-reject') : '';

    let actionsHtml = '';
    if (isAccepted) {
      actionsHtml = `
        <div class="table-action-btns">
          <button type="button" class="table-act-btn act-resend" data-resend="${b.ref}" title="Send / Resend Invoice Email">
            <i class="fa-solid fa-paper-plane"></i> Invoice
          </button>
          <button type="button" class="table-act-btn act-download-pdf" data-download-pdf="${b.ref}" title="Download Official Invoice PDF">
            <i class="fa-solid fa-file-arrow-down"></i> PDF
          </button>
        </div>
      `;
    } else if (isRejected) {
      actionsHtml = `
        <div class="table-action-btns">
          <button type="button" class="table-act-btn act-accept ${isThisActing && activeInlineAction.type === 'accept' ? 'is-active' : ''}" data-accept="${b.ref}" title="Re-open and Accept Booking">
            <i class="fa-solid fa-rotate-left"></i> Accept
          </button>
        </div>
      `;
    } else {
      actionsHtml = `
        <div class="table-action-btns">
          <button type="button" class="table-act-btn act-accept ${isThisActing && activeInlineAction.type === 'accept' ? 'is-active' : ''}" data-accept="${b.ref}" title="Verify payment and accept booking">
            <i class="fa-solid fa-check"></i> Accept
          </button>
          <button type="button" class="table-act-btn act-reject ${isThisActing && activeInlineAction.type === 'reject' ? 'is-active' : ''}" data-reject="${b.ref}" title="Reject booking request">
            <i class="fa-solid fa-xmark"></i> Reject
          </button>
        </div>
      `;
    }

    let inlineSubRowHtml = '';
    if (isThisActing) {
      if (activeInlineAction.type === 'accept') {
        const curUtr = activeUtrValues[b.ref] !== undefined ? activeUtrValues[b.ref] : (utrStr ? utrStr.replace(/\D/g, '').slice(0, 12) : '');
        const isUtrReady = curUtr.length === 12;
        const repCleanUtr = utrStr.replace(/\D/g, '').slice(0, 12);
        inlineSubRowHtml = `
          <tr class="enq-inline-row is-acting-accept" id="inlineRow-${b.ref}">
            <td colspan="6">
              <div class="enq-inline-card enq-inline-accept-card">
                <div class="enq-inline-head">
                  <div class="enq-inline-title">
                    <i class="fa-solid fa-circle-check"></i>
                    <span>Verify &amp; Accept Booking</span>
                    <span class="enq-inline-resident">${escapeHtml(b.name || 'Resident')} • ${b.ref}</span>
                  </div>
                  <button type="button" class="enq-inline-close-btn" data-inline-cancel="${b.ref}" title="Close">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>

                <div class="enq-inline-pills">
                  <div class="enq-pill">
                    <span class="enq-pill-lbl">Stay Duration:</span>
                    <span class="enq-pill-val">${escapeHtml(b.duration || '1 Month')}</span>
                  </div>
                  <div class="enq-pill">
                    <span class="enq-pill-lbl">Security Deposit:</span>
                    <span class="enq-pill-val">${depositVal}</span>
                  </div>
                  <div class="enq-pill">
                    <span class="enq-pill-lbl">Total Move-In (Rent + Deposit):</span>
                    <span class="enq-pill-val highlight">${payableAmt}</span>
                  </div>
                  <div class="enq-pill">
                    <span class="enq-pill-lbl">Room:</span>
                    <span class="enq-pill-val">${escapeHtml(b.room || 'Room')} (${escapeHtml(b.floor || '1st Floor')})</span>
                  </div>
                  ${isCash ? `
                    <div class="enq-pill">
                      <span class="enq-pill-lbl">Payment Mode:</span>
                      <span class="enq-pill-val highlight"><i class="fa-solid fa-money-bill-wave"></i> Cash on Hand</span>
                    </div>
                  ` : isAdvance ? `
                    <div class="enq-pill">
                      <span class="enq-pill-lbl">Payment Mode:</span>
                      <span class="enq-pill-val highlight"><i class="fa-solid fa-hand-holding-dollar"></i> Advance Token (${advVal})</span>
                    </div>
                    ${balVal ? `
                      <div class="enq-pill">
                        <span class="enq-pill-lbl">Balance on Move-In:</span>
                        <span class="enq-pill-val highlight" style="color:#f59e0b;">${balVal}</span>
                      </div>
                    ` : ''}
                    <div class="enq-pill">
                      <span class="enq-pill-lbl">Advance UTR:</span>
                      ${repCleanUtr ? `<span class="enq-pill-val text-green"><i class="fa-solid fa-check"></i> ${escapeHtml(repCleanUtr)}</span>` : `<span class="enq-pill-val" style="color:#94a3b8;font-style:italic;">Not reported</span>`}
                    </div>
                  ` : `
                    <div class="enq-pill">
                      <span class="enq-pill-lbl">Applicant UTR:</span>
                      ${repCleanUtr ? `<span class="enq-pill-val text-green"><i class="fa-solid fa-check"></i> ${escapeHtml(repCleanUtr)}</span>` : `<span class="enq-pill-val" style="color:#94a3b8;font-style:italic;">Not reported</span>`}
                    </div>
                  `}
                </div>

                ${isCash ? `
                  <div class="cash-confirmed-box" style="margin-top:12px; margin-bottom:12px;">
                    <div style="display:flex; align-items:center; gap:8px; font-weight:700; color:#38bdf8;">
                      <i class="fa-solid fa-hand-holding-dollar"></i> Cash on Hand Verification
                    </div>
                    <p style="margin:6px 0 0; font-size:0.83rem; color:var(--text-muted); line-height:1.5;">
                      Guest will pay <strong>${payableAmt}</strong> in cash directly to the manager upon arrival. Confirm to verify reservation and generate the official Cash on Hand invoice.
                    </p>
                  </div>
                ` : `
                  <div class="enq-inline-input-area">
                    <label class="enq-inline-label" for="inlineUtr-${b.ref}">
                      <strong>${isAdvance ? `Bank Transaction Reference (UTR) for ${advVal} Advance Token` : 'Bank Transaction Reference (UTR)'}</strong>
                      <span>${isAdvance ? 'Match with bank credit alert for the advance token before accepting' : 'Match with bank credit alert before accepting'}</span>
                    </label>
                    <div class="enq-inline-input-row">
                      <input
                        type="text"
                        id="inlineUtr-${b.ref}"
                        class="enq-inline-utr-input"
                        inputmode="numeric"
                        maxlength="12"
                        placeholder="e.g. 523418902412"
                        autocomplete="off"
                        spellcheck="false"
                        data-utr-ref="${b.ref}"
                        value="${escapeHtml(curUtr)}"
                      />
                      <span class="enq-inline-counter ${isUtrReady ? 'is-valid' : ''}" id="inlineCounter-${b.ref}">
                        ${curUtr.length} / 12
                      </span>
                    </div>

                    ${repCleanUtr ? `
                      <button type="button" class="enq-inline-quick-btn" data-inline-quick-utr="${escapeHtml(repCleanUtr)}" data-ref="${b.ref}">
                        <i class="fa-solid fa-paste"></i> Use applicant-reported UTR (<strong>${escapeHtml(repCleanUtr)}</strong>)
                      </button>
                    ` : ''}

                    <div class="enq-inline-error" id="inlineError-${b.ref}"></div>
                  </div>
                `}

                <div class="enq-inline-actions">
                  <button
                    type="button"
                    class="enq-inline-btn enq-inline-btn-confirm"
                    data-confirm-accept="${b.ref}"
                    ${isCash || isUtrReady ? '' : 'disabled'}
                  >
                    <i class="fa-solid fa-check"></i> Confirm &amp; Accept Booking
                  </button>
                  <button type="button" class="enq-inline-btn enq-inline-btn-cancel" data-inline-cancel="${b.ref}">
                    Cancel
                  </button>
                </div>

                <div class="enq-inline-hint">
                  <i class="fa-solid fa-circle-info"></i>
                  <span>Once confirmed, this enquiry is verified and an official validated invoice PDF will be emailed to <strong>${escapeHtml(b.email || 'the resident')}</strong>.</span>
                </div>
              </div>
            </td>
          </tr>
        `;
      } else if (activeInlineAction.type === 'reject') {
        inlineSubRowHtml = `
          <tr class="enq-inline-row is-acting-reject" id="inlineRow-${b.ref}">
            <td colspan="6">
              <div class="enq-inline-card enq-inline-reject-card">
                <div class="enq-inline-head">
                  <div class="enq-inline-title is-reject">
                    <i class="fa-solid fa-circle-xmark"></i>
                    <span>Decline Booking Enquiry</span>
                    <span class="enq-inline-resident">${escapeHtml(b.name || 'Resident')} • ${b.ref}</span>
                  </div>
                  <button type="button" class="enq-inline-close-btn" data-inline-cancel="${b.ref}" title="Close">
                    <i class="fa-solid fa-xmark"></i>
                  </button>
                </div>

                <p class="enq-inline-reject-msg">
                  Are you sure you want to decline this booking enquiry from <strong>${escapeHtml(b.name || 'Resident')}</strong> (${escapeHtml(b.phone || '-')}) for <strong>${escapeHtml(b.room || 'Room')}</strong>?
                  This will move the enquiry to the Rejected archive.
                </p>

                <div class="enq-inline-actions">
                  <button type="button" class="enq-inline-btn enq-inline-btn-danger" data-confirm-reject="${b.ref}">
                    <i class="fa-solid fa-trash-can"></i> Confirm Rejection
                  </button>
                  <button type="button" class="enq-inline-btn enq-inline-btn-cancel" data-inline-cancel="${b.ref}">
                    Cancel
                  </button>
                </div>
              </div>
            </td>
          </tr>
        `;
      }
    }

    return `
      <tr class="${rowActingClass}">
        <td class="table-ref-code">
          <div>${b.ref}</div>
          <div style="margin-top:4px;">${tokenCell(b)}</div>
        </td>
        <td>
          <strong>${escapeHtml(b.name || 'Resident')}</strong><br>
          <small style="color:var(--text-muted);">${escapeHtml(b.email || 'No email')}</small><br>
          <small style="color:var(--text-muted); opacity:0.75;">${escapeHtml(b.time || 'Recent')}</small>
          ${(b.id_type || b.id_proof_url) ? `
            <div style="margin-top:6px; display:flex; flex-direction:column; gap:4px; align-items:flex-start;">
              ${b.id_type ? `
                <span class="table-id-badge" title="${escapeHtml(b.id_type)}">
                  <i class="fa-solid fa-id-card"></i> ${escapeHtml(b.id_type)}${b.id_number ? ` • ${escapeHtml(b.id_number)}` : ''}
                </span>
              ` : ''}
              ${b.id_proof_url ? `
                <button type="button" class="table-act-btn act-view-id" data-view-id="${b.ref}" title="View Uploaded Government ID Proof">
                  <i class="fa-solid fa-file-image"></i> View ID
                </button>
              ` : ''}
            </div>
          ` : ''}
        </td>
        <td>
          <div>${escapeHtml(b.phone || '-')}</div>
          ${cleanPhone ? `
            <div class="table-action-btns" style="margin-top:5px;">
              <a href="https://wa.me/91${cleanPhone}?text=Hi%20${encodeURIComponent(b.name || 'Resident')}%2C%20regarding%20your%20Chaitanya%20Mens%20PG%20enquiry%20${b.ref}" target="_blank" rel="noopener" class="table-act-btn act-wa" title="WhatsApp Applicant">
                <i class="fa-brands fa-whatsapp"></i> Chat
              </a>
              <a href="tel:+91${cleanPhone}" class="table-act-btn" title="Call">
                <i class="fa-solid fa-phone"></i>
              </a>
            </div>
          ` : ''}
        </td>
        <td>
          <strong>${escapeHtml(b.room || 'Room')}</strong><br>
          <small style="color:var(--text-muted);">${escapeHtml(b.floor || '1st Floor')}</small><br>
          <small style="color:var(--primary); font-weight:600;"><i class="fa-regular fa-calendar"></i> ${escapeHtml(normalizeBookingDate(b.date) || '-')}</small><br>
          <span style="display:inline-block; margin-top:4px; padding:2px 7px; background:rgba(201,164,92,0.15); border:1px solid rgba(201,164,92,0.3); border-radius:6px; font-size:0.75rem; color:#f8fafc; font-weight:600;">
            <i class="fa-solid fa-clock"></i> ${escapeHtml(b.duration || '1 Month')}
          </span>
          ${b.stay_period ? `<br><small style="color:#c9a45c; font-size:0.72rem; display:block; margin-top:2px;">${escapeHtml(normalizeBookingDate(b.stay_period))}</small>` : ''}
        </td>
        <td>
          <div style="font-weight:700; color:var(--text-main); font-size:0.92rem;">Deposit: ${depositVal}</div>
          <small style="color:var(--text-muted); font-size:0.75rem;">Move-in: ${payableAmt}</small>
          ${isCash ? `
            <div style="margin-top:4px;">
              <span class="table-cash-badge"><i class="fa-solid fa-money-bill-wave"></i> Cash on Hand</span>
            </div>
          ` : isAdvance ? `
            <div style="margin-top:4px;">
              <span class="table-advance-badge"><i class="fa-solid fa-hand-holding-dollar"></i> Advance: ${advVal}</span>
              ${balVal ? `<br><small style="color:#f59e0b; font-size:0.72rem; font-weight:600;">Bal Due: ${balVal}</small>` : ''}
              ${utrStr ? `<br><small style="color:#10b981; font-family:var(--font-mono, monospace); font-weight:700;"><i class="fa-solid fa-receipt"></i> ${escapeHtml(utrStr)}</small>` : `<br><small style="color:var(--text-muted); font-style:italic;">UTR: Pending</small>`}
            </div>
          ` : (utrStr ? `
            <div style="margin-top:2px;">
              <small style="color:#10b981; font-family:var(--font-mono, monospace); font-weight:700;"><i class="fa-solid fa-receipt"></i> ${escapeHtml(utrStr)}</small>
            </div>
          ` : `
            <div style="margin-top:2px;">
              <small style="color:var(--text-muted); font-style:italic;">UTR: Pending</small>
            </div>
          `)}
        </td>
        <td>
          ${actionsHtml}
        </td>
      </tr>
      ${inlineSubRowHtml}
    `;
  }).join('');
}

/* ===================================================================
   3.5 HERO SCROLL CUE
   =================================================================== */
function initHeroScrollCue() {
  const cue = document.getElementById('heroScrollCue');
  if (!cue) return;

  // A short scroll is enough to prove the point; hide it and stop listening.
  const retire = () => {
    cue.classList.add('is-done');
    window.removeEventListener('scroll', onScroll);
  };
  const onScroll = () => { if (window.scrollY > 60) retire(); };

  // Clicking it scrolls on, which would trigger the same retirement anyway.
  cue.addEventListener('click', retire);
  window.addEventListener('scroll', onScroll, { passive: true });
  // Reloading mid-page must not show a cue for a screen already passed.
  onScroll();
}

/* ===================================================================
   3.6 DYNAMIC ISLAND SECTION NAV (phones)
   -------------------------------------------------------------------
   Only one item carries a label at a time — the section you are in — so
   this has to know which that is. IntersectionObserver rather than a
   scroll handler: the hero and routine are sticky scroll tracks several
   screens tall, and offset arithmetic against those is fragile, whereas
   "which section occupies the middle band of the screen" stays true for
   both a normal section and a pinned one.
   =================================================================== */
function initIslandNav() {
  const nav = document.getElementById('islandNav');
  if (!nav) return;

  const items = [...nav.querySelectorAll('.island-item')];
  const sections = items
    .map(a => ({ item: a, el: document.getElementById(a.dataset.target) }))
    .filter(s => s.el);
  if (!sections.length) return;

  function setActive(item) {
    if (item.classList.contains('is-active')) return;
    items.forEach(i => {
      i.classList.toggle('is-active', i === item);
      i.setAttribute('aria-current', i === item ? 'true' : 'false');
    });
  }

  // A band across the middle of the viewport: whatever sits in it wins.
  const observer = new IntersectionObserver((entries) => {
    let best = null;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
    }
    if (!best) return;
    const hit = sections.find(s => s.el === best.target);
    if (hit) setActive(hit.item);
  }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });

  sections.forEach(s => observer.observe(s.el));

  /* At the very top nothing has crossed the band yet, and on the Pixel 8
     the pill came up showing the last section instead of the first. Pin
     it to the first item whenever the page is scrolled to the top. */
  const syncTop = () => { if (window.scrollY < 40) setActive(items[0]); };
  window.addEventListener('scroll', syncTop, { passive: true });
  syncTop();

  // Tapping should feel immediate rather than waiting for the observer.
  items.forEach(a => a.addEventListener('click', () => setActive(a)));
}

/* ===================================================================
   3.7 PRICE ESTIMATOR STEPPER (phones)
   -------------------------------------------------------------------
   On a phone the estimator is 2200px: four choice groups and a 546px
   receipt, all stacked. Shown one step at a time it is about a screen
   each, and the visitor always knows how much is left.

   Steps are the four .calc-group blocks plus the summary as a final
   review. Desktop keeps every step visible at once, so none of this
   applies above 768px and the controls stay hidden.
   =================================================================== */
function initCalcStepper() {
  const wrap = document.getElementById('calcSteps');
  const nav = document.getElementById('calcStepsNav');
  const backBtn = document.getElementById('calcStepBack');
  const nextBtn = document.getElementById('calcStepNext');
  const summary = document.getElementById('calcSummaryContainer');
  const groups = [...document.querySelectorAll('#bookingForm .calc-group')];
  if (!wrap || !nav || !groups.length || !summary) return;

  const steps = [...groups, summary];
  const names = ['Room sharing', 'Climate', 'Stay duration', 'Your details', 'Review & book'];
  const dots = [...wrap.querySelectorAll('.calc-step-dot')];
  const nowEl = document.getElementById('calcStepNow');
  const nameEl = document.getElementById('calcStepName');
  const mq = window.matchMedia('(max-width: 768px)');
  let index = 0;

  /* The running bill fills the space the short steps leave above the
     buttons, and gives the choices immediate consequence. It mirrors the
     receipt rather than recomputing anything — a second implementation of
     the pricing would be a second thing to get wrong. */
  const bill = document.getElementById('calcLiveBill');
  const liveMonthly = document.getElementById('liveMonthly');
  const liveTotal = document.getElementById('liveTotal');
  const liveDeposit = document.getElementById('liveDeposit');
  const liveScope = document.getElementById('liveMoveInScope');
  const srcMonthly = document.getElementById('dispMonthlyTotal');
  const srcTotal = document.getElementById('dispMoveInTotal');
  const srcDeposit = document.getElementById('dispSecurityDeposit');
  const srcScope = document.getElementById('dispMoveInScope');

  function syncBill() {
    if (liveMonthly && srcMonthly) liveMonthly.textContent = srcMonthly.textContent;
    if (liveTotal && srcTotal) liveTotal.textContent = srcTotal.textContent;
    if (liveDeposit && srcDeposit) liveDeposit.textContent = srcDeposit.textContent;
    if (liveScope && srcScope) liveScope.textContent = srcScope.textContent;
  }

  const sources = [srcMonthly, srcTotal, srcDeposit, srcScope].filter(Boolean);
  if (sources.length) {
    const obs = new MutationObserver(syncBill);
    sources.forEach(el => obs.observe(el, { childList: true, characterData: true, subtree: true }));
    syncBill();
  }

  function render() {
    const on = mq.matches;
    wrap.hidden = !on;
    nav.hidden = !on;

    // Desktop: clear everything this function set and show the lot.
    if (!on) {
      steps.forEach(el => el.classList.remove('is-step-hidden'));
      if (bill) bill.hidden = true;
      return;
    }

    steps.forEach((el, i) => el.classList.toggle('is-step-hidden', i !== index));
    dots.forEach((d, i) => {
      d.classList.toggle('is-current', i === index);
      d.classList.toggle('is-done', i < index);
    });
    if (nowEl) nowEl.textContent = String(index + 1);
    if (nameEl) nameEl.textContent = names[index];
    // Steps 1-3 are the choices that move the price; step 4 is contact
    // details and step 5 is the receipt itself.
    if (bill) bill.hidden = index > 2;
    backBtn.disabled = index === 0;
    nextBtn.hidden = index === steps.length - 1;   // the CTA takes over on review
  }

  /* Don't let someone reach the review with required fields blank — the
     submit would just bounce them back with an alert. Only checks the
     step being left, so it stays generic. */
  function stepIsValid() {
    const required = steps[index].querySelectorAll('input[required], select[required]');
    for (const field of required) {
      if (field.value && field.value.trim()) continue;
      field.classList.add('is-invalid');
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return false;
    }
    return true;
  }

  function go(to) {
    index = Math.max(0, Math.min(steps.length - 1, to));
    render();
    // Put the top of the new step in view rather than leaving the reader
    // wherever the previous, longer step had them.
    document.getElementById('calcSteps')
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  nextBtn.addEventListener('click', () => { if (stepIsValid()) go(index + 1); });
  backBtn.addEventListener('click', () => go(index - 1));
  dots.forEach((d, i) => d.addEventListener('click', () => {
    if (i < index || stepIsValid()) go(i);      // going back is always allowed
  }));
  mq.addEventListener('change', () => { index = 0; render(); });

  render();
}

/* ===================================================================
   4. SITE TOAST
   -------------------------------------------------------------------
   This was a "social proof" ticker: five invented residents ("Rohit K.
   booked a Double Bed") cycling every 22 seconds for every visitor,
   with no booking behind any of them. It is gone. The toast now fires
   only on something that actually happened, to the person it happened
   to — their own booking, or their own manager action.

   It deliberately does NOT broadcast other people's bookings. Those
   rows carry names, phone numbers and emails, and visitors have no
   SELECT policy on the bookings table, which is the correct design.
   =================================================================== */
let toastHideTimer = null;

/**
 * Show the site toast.
 * @param {string} title  what happened
 * @param {string} detail supporting line
 * @param {string} [icon] Font Awesome class; defaults to a check
 */
function showSiteToast(title, detail, icon = 'fa-solid fa-circle-check') {
  const toast = document.getElementById('bookingToast');
  const toastTitle = document.getElementById('toastTitle');
  const toastTime = document.getElementById('toastTime');
  const avatar = document.querySelector('#bookingToast .toast-avatar i');
  if (!toast || !toastTitle || !toastTime) return;

  toastTitle.textContent = title;
  toastTime.textContent = detail;
  if (avatar) avatar.className = icon;

  toast.classList.add('show');
  toast.setAttribute('aria-hidden', 'false');

  // Re-showing while one is up restarts the clock rather than stacking.
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(hideSiteToast, 5500);
}

function hideSiteToast() {
  const toast = document.getElementById('bookingToast');
  if (!toast) return;
  clearTimeout(toastHideTimer);
  toast.classList.remove('show');
  toast.setAttribute('aria-hidden', 'true');
}

function initBookingToasts() {
  const toastClose = document.getElementById('toastClose');
  if (toastClose) toastClose.addEventListener('click', hideSiteToast);
}

/* ===================================================================
   4.5 CUSTOM IN-APP CONFIRMATION & ALERT DIALOGS
   =================================================================== */
let _appConfirmResolver = null;

function formatDialogMessage(msg) {
  if (!msg) return '';
  const lines = String(msg).split('\n');
  let html = '';
  let inList = false;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }
    if (line.startsWith('• ') || line.startsWith('- ')) {
      if (!inList) { html += '<ul class="app-confirm-list">'; inList = true; }
      html += `<li>${escapeHtml(line.slice(2))}</li>`;
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p class="app-confirm-p">${escapeHtml(line)}</p>`;
    }
  }
  if (inList) { html += '</ul>'; }
  return html;
}

function showAppConfirm({
  title = 'Please Confirm',
  message = '',
  confirmText = 'Continue',
  cancelText = 'Cancel',
  type = 'warning',
  badge = 'Confirm',
  icon = ''
} = {}) {
  initAppConfirmModal();
  return new Promise((resolve) => {
    const modal = document.getElementById('appConfirmModal');
    if (!modal) {
      resolve(false);
      return;
    }

    if (_appConfirmResolver) {
      _appConfirmResolver(false);
    }
    _appConfirmResolver = resolve;

    const iconWrap = document.getElementById('appConfirmIconWrap');
    const iconEl = document.getElementById('appConfirmIcon');
    const titleEl = document.getElementById('appConfirmTitle');
    const badgeEl = document.getElementById('appConfirmBadge');
    const msgEl = document.getElementById('appConfirmMsg');
    const cancelBtn = document.getElementById('appConfirmCancelBtn');
    const okBtn = document.getElementById('appConfirmOkBtn');

    const defaultIcon = {
      warning: 'fa-solid fa-triangle-exclamation',
      danger: 'fa-solid fa-trash-can',
      info: 'fa-solid fa-circle-info',
      success: 'fa-solid fa-circle-check'
    }[type] || 'fa-solid fa-triangle-exclamation';

    if (iconWrap) iconWrap.className = `app-confirm-icon-wrap type-${type}`;
    if (iconEl) iconEl.className = icon || defaultIcon;
    if (titleEl) titleEl.textContent = title;
    if (badgeEl) {
      badgeEl.textContent = badge || type.toUpperCase();
      badgeEl.className = `app-confirm-badge type-${type}`;
    }
    if (msgEl) msgEl.innerHTML = formatDialogMessage(message);

    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
      cancelBtn.textContent = cancelText;
    }
    if (okBtn) {
      okBtn.textContent = confirmText;
      okBtn.className = `app-confirm-btn app-confirm-btn-primary ${type === 'danger' ? 'type-danger' : ''}`;
    }

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      okBtn?.focus();
    });
  });
}

function showAppAlert(options) {
  initAppConfirmModal();
  const opts = typeof options === 'string' ? { message: options } : (options || {});
  return new Promise((resolve) => {
    const modal = document.getElementById('appConfirmModal');
    if (!modal) {
      resolve();
      return;
    }

    if (_appConfirmResolver) {
      _appConfirmResolver(false);
    }
    _appConfirmResolver = () => resolve();

    const iconWrap = document.getElementById('appConfirmIconWrap');
    const iconEl = document.getElementById('appConfirmIcon');
    const titleEl = document.getElementById('appConfirmTitle');
    const badgeEl = document.getElementById('appConfirmBadge');
    const msgEl = document.getElementById('appConfirmMsg');
    const cancelBtn = document.getElementById('appConfirmCancelBtn');
    const okBtn = document.getElementById('appConfirmOkBtn');

    const type = opts.type || 'info';
    const defaultIcon = {
      warning: 'fa-solid fa-triangle-exclamation',
      danger: 'fa-solid fa-circle-exclamation',
      info: 'fa-solid fa-circle-info',
      success: 'fa-solid fa-circle-check'
    }[type] || 'fa-solid fa-circle-info';

    if (iconWrap) iconWrap.className = `app-confirm-icon-wrap type-${type}`;
    if (iconEl) iconEl.className = opts.icon || defaultIcon;
    if (titleEl) titleEl.textContent = opts.title || 'Notice';
    if (badgeEl) {
      badgeEl.textContent = opts.badge || 'Notice';
      badgeEl.className = `app-confirm-badge type-${type}`;
    }
    if (msgEl) msgEl.innerHTML = formatDialogMessage(opts.message || '');

    if (cancelBtn) cancelBtn.style.display = 'none';
    if (okBtn) {
      okBtn.textContent = opts.buttonText || 'Understood';
      okBtn.className = `app-confirm-btn app-confirm-btn-primary ${type === 'danger' ? 'type-danger' : ''}`;
    }

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      okBtn?.focus();
    });
  });
}

function closeAppConfirm(result) {
  const modal = document.getElementById('appConfirmModal');
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
  setTimeout(() => {
    modal.hidden = true;
  }, 220);

  if (_appConfirmResolver) {
    const cb = _appConfirmResolver;
    _appConfirmResolver = null;
    cb(result);
  }
}

function initAppConfirmModal() {
  const modal = document.getElementById('appConfirmModal');
  if (!modal || modal.dataset.bound) return;
  modal.dataset.bound = '1';

  const okBtn = document.getElementById('appConfirmOkBtn');
  const cancelBtn = document.getElementById('appConfirmCancelBtn');
  const closeBtn = document.getElementById('appConfirmCloseBtn');

  okBtn?.addEventListener('click', () => closeAppConfirm(true));
  cancelBtn?.addEventListener('click', () => closeAppConfirm(false));
  closeBtn?.addEventListener('click', () => closeAppConfirm(false));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAppConfirm(false);
  });

  document.addEventListener('keydown', (e) => {
    if (modal && !modal.hidden) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeAppConfirm(false);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        closeAppConfirm(true);
      }
    }
  });
}

// In-app fallback for any global alert() calls
if (typeof window !== 'undefined') {
  window.alert = function (message) {
    showAppAlert(message);
  };
}

/* ===================================================================
   5. MOBILE DRAWER NAVIGATION
   =================================================================== */
function initMobileDrawer() {
  const menuToggle = document.getElementById('menuToggle');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');
  const drawerClose = document.getElementById('drawerClose');
  const drawerLinks = document.querySelectorAll('.drawer-link');

  if (!menuToggle || !mobileDrawer || !drawerOverlay) return;

  function openDrawer() {
    mobileDrawer.classList.add('active');
    drawerOverlay.classList.add('active');
    menuToggle.setAttribute('aria-expanded', 'true');
    mobileDrawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    mobileDrawer.classList.remove('active');
    drawerOverlay.classList.remove('active');
    menuToggle.setAttribute('aria-expanded', 'false');
    mobileDrawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  menuToggle.addEventListener('click', () => {
    const isOpen = mobileDrawer.classList.contains('active');
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  drawerOverlay.addEventListener('click', closeDrawer);

  drawerLinks.forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mobileDrawer.classList.contains('active')) {
      closeDrawer();
    }
  });
}

/* ===================================================================
   6. HEADER SCROLL & SCROLLSPY
   =================================================================== */
function initHeaderScroll() {
  const header = document.getElementById('header');
  const allNavLinks = document.querySelectorAll('.nav-link, .mobile-nav-link');
  const sections = document.querySelectorAll('section[id]');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      header.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.08)';
    } else {
      header.style.boxShadow = 'none';
    }

    let currentSectionId = '';
    const scrollPosition = window.scrollY + 140;

    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
        currentSectionId = section.getAttribute('id');
      }
    });

    if (currentSectionId) {
      allNavLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSectionId}`) {
          link.classList.add('active');
        }
      });
    }
  }, { passive: true });
}

/* ===================================================================
   7. AC / NON-AC PRICING SWITCHER
   =================================================================== */
function initPricingToggle() {
  const pricingToggle = document.getElementById('pricingToggle');
  const labelNonAC = document.getElementById('labelNonAC');
  const labelAC = document.getElementById('labelAC');
  const priceVals = document.querySelectorAll('.price-val');
  const selectRoomBtns = document.querySelectorAll('.select-room-btn');

  if (!pricingToggle) return;

  let isAC = false;

  function updatePricing(acEnabled) {
    isAC = acEnabled;
    pricingToggle.setAttribute('aria-checked', isAC.toString());

    if (isAC) {
      labelAC.style.color = 'var(--primary)';
      labelNonAC.style.color = 'var(--text-muted)';
    } else {
      labelNonAC.style.color = 'var(--primary)';
      labelAC.style.color = 'var(--text-muted)';
    }

    priceVals.forEach(elem => {
      const newPrice = isAC ? elem.dataset.priceAc : elem.dataset.priceNonac;
      elem.style.transform = 'scale(0.85)';
      elem.style.opacity = '0.4';
      setTimeout(() => {
        elem.textContent = newPrice;
        elem.style.transform = 'scale(1)';
        elem.style.opacity = '1';
      }, 150);
    });

    selectRoomBtns.forEach(btn => {
      btn.dataset.ac = isAC ? 'true' : 'false';
    });
  }

  pricingToggle.addEventListener('click', () => updatePricing(!isAC));
  if (labelNonAC) labelNonAC.addEventListener('click', () => updatePricing(false));
  if (labelAC) labelAC.addEventListener('click', () => updatePricing(true));

  // Handle Room Card Select Buttons
  selectRoomBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetRoom = btn.dataset.room;
      let roomVal = 'double';
      if (targetRoom.includes('Triple')) roomVal = 'triple';

      const roomOptBtn = document.querySelector(`#calcRoomOptions button[data-value="${roomVal}"]`);
      if (roomOptBtn) roomOptBtn.click();

      const climateRadio = document.querySelector(`input[name="calcClimate"][value="${isAC ? 'ac' : 'nonac'}"]`);
      if (climateRadio) {
        climateRadio.checked = true;
        climateRadio.dispatchEvent(new Event('change'));
      }

      const calcSection = document.getElementById('calculator');
      if (calcSection) calcSection.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

/* ===================================================================
   8. SMART PRICE ESTIMATOR & ROOM CALCULATOR
   =================================================================== */
function initRoomCalculator() {
  const roomButtons = document.querySelectorAll('#calcRoomOptions .option-card');
  const climateRadios = document.querySelectorAll('input[name="calcClimate"]');
  const durationButtons = document.querySelectorAll('#calcDurationOptions .duration-btn[data-months]');
  const durBtnDaily = document.getElementById('durBtnDaily');
  const dailyStayPicker = document.getElementById('dailyStayPicker');
  const dailyDaysInput = document.getElementById('dailyDaysInput');
  const dailyDaysLabel = document.getElementById('dailyDaysLabel');
  const preferredFloorSelect = document.getElementById('preferredFloor');
  const acPillLabel = document.getElementById('acPillLabel');

  const summaryRoomBadge = document.getElementById('summaryRoomBadge');
  const dispBaseRent = document.getElementById('dispBaseRent');
  const dispAcCost = document.getElementById('dispAcCost');
  const dispDiscountRow = document.getElementById('dispDiscountRow');
  const dispDiscountVal = document.getElementById('dispDiscountVal');
  const dispSubtotalLabel = document.getElementById('dispSubtotalLabel');
  const dispMonthlyTotal = document.getElementById('dispMonthlyTotal');
  const dispSecurityDeposit = document.getElementById('dispSecurityDeposit');
  const dispMoveInTotal = document.getElementById('dispMoveInTotal');

  const rsvSumRoom = document.getElementById('rsvSumRoom');
  const rsvSumClimate = document.getElementById('rsvSumClimate');
  const dispStayTotalRow = document.getElementById('dispStayTotalRow');
  const dispStayTotal = document.getElementById('dispStayTotal');
  const dispStayMonths = document.getElementById('dispStayMonths');
  const dispMoveInScope = document.getElementById('dispMoveInScope');
  const rsvSumDuration = document.getElementById('rsvSumDuration');
  const rsvSumFloor = document.getElementById('rsvSumFloor');

  let currentRoom = 'double';
  let currentBase = 8500;
  let currentAcAdd = 1500;
  let currentClimate = 'nonac';
  let currentDiscountRate = 0;
  let currentDurationMonths = 1;
  let isDailyStay = false;
  let currentDailyDays = 1;

  const roomNames = {
    double: '2 Sharing',
    triple: '3 Sharing',
    four: '4 Sharing',
    five: '5 Sharing'
  };

  const durationNames = {
    1: '1 Month',
    3: '3 Months (5% off)',
    6: '6 Months (10% off)',
    12: '12 Months (15% off)'
  };

  function recalculate() {
    const isAc = (currentClimate === 'ac' && currentRoom !== 'hall');
    const cfg = getHostelConfig();
    const formatInr = (n) => '₹' + n.toLocaleString('en-IN');

    // === Day-Wise Stay Calculation ===
    const moveInInput = (document.getElementById('moveInDateDisplay')?.value || document.getElementById('moveInDate')?.value || '').trim();

    if (isDailyStay) {
      const dailyBase = Number(cfg?.pricing?.dailyRate) || 400;
      const dailyDiscountPct = Number(cfg?.pricing?.dailyDiscount) || 0;
      const dailyAc = Number(cfg?.pricing?.dailyAcAdd) || 100;
      const acCost = isAc ? dailyAc : 0;
      const dailyPerDay = dailyBase + acCost;
      const stayTotal = dailyPerDay * currentDailyDays;
      const securityDeposit = 0; // Deposit is completely waived for day-wise stay!
      const initialMoveIn = stayTotal;

      const hasDailyDiscount = dailyDiscountPct > 0;
      const origDailyBase = hasDailyDiscount
        ? (dailyBase + Math.round((dailyBase * dailyDiscountPct) / 100))
        : dailyBase;
      const origDailyPerDay = origDailyBase + acCost;
      const dailySavingsPerDay = origDailyBase - dailyBase;
      const totalDailySavings = dailySavingsPerDay * currentDailyDays;

      const dispDailyRateTag = document.getElementById('dispDailyRateTag');
      if (dispDailyRateTag) {
        if (hasDailyDiscount) {
          dispDailyRateTag.innerHTML = `<del class="daily-strike-tag">${formatInr(origDailyPerDay)}</del> <span class="daily-final-rate">${formatInr(dailyPerDay)}</span> / day <span class="daily-badge-pill">${dailyDiscountPct}% OFF</span>`;
        } else {
          dispDailyRateTag.textContent = `${formatInr(dailyPerDay)} / day`;
        }
      }

      const stayPeriodInfo = moveInInput
        ? calculateStayPeriod(moveInInput, `${currentDailyDays} Days`, true, currentDailyDays)
        : null;

      const dailyHintEl = document.getElementById('dailyStayRangeHint');
      if (dailyHintEl) {
        if (stayPeriodInfo) {
          dailyHintEl.innerHTML = `<i class="fa-solid fa-calendar-check" style="color:#c9a45c;"></i> Stay Dates: <strong>${stayPeriodInfo.displayText}</strong>`;
        } else {
          dailyHintEl.innerHTML = `<i class="fa-solid fa-circle-info"></i> Stay count starts directly from your move-in date (Day 1).`;
        }
      }

      if (dispBaseRent) {
        if (hasDailyDiscount) {
          dispBaseRent.innerHTML = `<del class="price-strikethrough">${formatInr(origDailyBase)}</del> ${formatInr(dailyBase)} / day`;
        } else {
          dispBaseRent.textContent = `${formatInr(dailyBase)} / day`;
        }
      }
      if (dispAcCost) dispAcCost.textContent = acCost > 0 ? `+ ${formatInr(acCost)} / day` : '+ ₹0';
      if (dispSubtotalLabel) dispSubtotalLabel.textContent = `Stay Tariff (${currentDailyDays}d)`;
      if (dispMonthlyTotal) dispMonthlyTotal.textContent = formatInr(stayTotal);
      
      if (dispDiscountRow && dispDiscountVal) {
        if (hasDailyDiscount) {
          dispDiscountRow.style.display = 'flex';
          const discLabelEl = dispDiscountRow.querySelector('.sub-label');
          if (discLabelEl) discLabelEl.textContent = `Promo Savings (${dailyDiscountPct}% OFF)`;
          dispDiscountVal.textContent = currentDailyDays > 1
            ? `- ${formatInr(totalDailySavings)} over ${currentDailyDays} days`
            : `- ${formatInr(totalDailySavings)} (${dailyDiscountPct}% OFF)`;
        } else {
          dispDiscountRow.style.display = 'none';
        }
      }

      if (dispStayTotalRow) dispStayTotalRow.style.display = 'none';
      if (dispSecurityDeposit) dispSecurityDeposit.textContent = '₹0 (Waived)';
      if (dispMoveInTotal) dispMoveInTotal.textContent = formatInr(initialMoveIn);
      if (dispMoveInScope) {
        dispMoveInScope.textContent = stayPeriodInfo
          ? `${currentDailyDays} day${currentDailyDays > 1 ? 's' : ''} stay (${stayPeriodInfo.displayText})${hasDailyDiscount ? ` • ${dailyDiscountPct}% promo discount included` : ''}`
          : `${currentDailyDays} day${currentDailyDays > 1 ? 's' : ''} stay (count starts on move-in day, no deposit)${hasDailyDiscount ? ` • ${dailyDiscountPct}% promo discount included` : ''}`;
      }

      const activeRoomName = roomNames[currentRoom] || '2 Sharing';
      const climateText = isAc ? 'AC' : 'Non-AC';

      if (summaryRoomBadge) {
        summaryRoomBadge.innerHTML = `<span class="summary-live-dot"></span> ${activeRoomName} • ${climateText} • Daily Stay`;
      }

      if (rsvSumRoom) rsvSumRoom.textContent = activeRoomName;
      if (rsvSumClimate) rsvSumClimate.textContent = climateText;
      if (rsvSumDuration) rsvSumDuration.textContent = `${currentDailyDays} Day${currentDailyDays > 1 ? 's' : ''} (Daily Stay)`;
      if (rsvSumFloor && preferredFloorSelect) rsvSumFloor.textContent = preferredFloorSelect.value || 'Any Floor';
      if (typeof window.updateChatQuote === 'function') {
        window.updateChatQuote();
      }
      return;
    }

    // === Monthly Stay Calculation ===
    const acCost = isAc ? currentAcAdd : 0;
    const subtotal = currentBase + acCost;
    const discountAmount = Math.round(subtotal * currentDiscountRate);
    const effectiveMonthly = subtotal - discountAmount;
    const securityDeposit = (cfg && cfg.pricing && cfg.pricing.securityDeposit !== undefined && cfg.pricing.securityDeposit !== null)
      ? Number(cfg.pricing.securityDeposit)
      : 5400;
    const stayTotal = effectiveMonthly * currentDurationMonths;
    const initialMoveIn = stayTotal + securityDeposit;

    const monthStayPeriodInfo = moveInInput
      ? calculateStayPeriod(moveInInput, `${currentDurationMonths} Months`, false, currentDurationMonths)
      : null;

    if (dispBaseRent) dispBaseRent.textContent = formatInr(currentBase);
    if (dispAcCost) dispAcCost.textContent = acCost > 0 ? `+ ${formatInr(acCost)}` : '+ ₹0';
    if (dispSubtotalLabel) dispSubtotalLabel.textContent = 'Monthly Subtotal';
    
    if (dispStayTotalRow) dispStayTotalRow.style.display = 'none';
    if (dispMoveInScope) {
      if (monthStayPeriodInfo) {
        dispMoveInScope.textContent = currentDurationMonths > 1
          ? `${currentDurationMonths} months' stay (${monthStayPeriodInfo.displayText})`
          : `First month's stay (${monthStayPeriodInfo.displayText})`;
      } else {
        dispMoveInScope.textContent = currentDurationMonths > 1
          ? `${currentDurationMonths} months' rent + deposit, paid up front`
          : "First month's rent + deposit (starts on move-in day)";
      }
    }

    if (dispDiscountRow && dispDiscountVal) {
      if (discountAmount > 0) {
        dispDiscountRow.style.display = 'flex';
        const discLabelEl = dispDiscountRow.querySelector('.sub-label');
        if (discLabelEl) discLabelEl.textContent = 'Term Savings';
        const termSaving = discountAmount * currentDurationMonths;
        dispDiscountVal.textContent = currentDurationMonths > 1
          ? `- ${formatInr(termSaving)} over ${currentDurationMonths} months (${Math.round(currentDiscountRate * 100)}%)`
          : `- ${formatInr(discountAmount)} (${Math.round(currentDiscountRate * 100)}%)`;
      } else {
        dispDiscountRow.style.display = 'none';
      }
    }

    if (dispMonthlyTotal) dispMonthlyTotal.textContent = formatInr(effectiveMonthly);
    if (dispSecurityDeposit) dispSecurityDeposit.textContent = formatInr(securityDeposit);
    if (dispMoveInTotal) dispMoveInTotal.textContent = formatInr(initialMoveIn);

    const activeRoomName = roomNames[currentRoom] || '2 Sharing';
    const climateText = isAc ? 'AC' : 'Non-AC';

    if (summaryRoomBadge) {
      summaryRoomBadge.innerHTML = `<span class="summary-live-dot"></span> ${activeRoomName} • ${climateText}`;
    }

    // Update live booking summary pills
    if (rsvSumRoom) rsvSumRoom.textContent = activeRoomName;
    if (rsvSumClimate) rsvSumClimate.textContent = climateText;
    if (rsvSumDuration) rsvSumDuration.textContent = durationNames[currentDurationMonths] || '1 Month';
    if (rsvSumFloor && preferredFloorSelect) rsvSumFloor.textContent = preferredFloorSelect.value || 'Any Floor';
    if (typeof window.updateChatQuote === 'function') {
      window.updateChatQuote();
    }
  }

  roomButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      roomButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      currentRoom = btn.dataset.value;
      currentBase = parseInt(btn.dataset.base, 10) || 8500;
      currentAcAdd = parseInt(btn.dataset.acAdd, 10) || 0;

      recalculate();
    });
  });

  climateRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const parentPills = document.querySelectorAll('#calcClimateOptions .pill-radio');
      parentPills.forEach(p => p.classList.remove('active'));
      radio.closest('.pill-radio')?.classList.add('active');

      currentClimate = radio.value;
      recalculate();
    });
  });

  // Helper to show/hide Daily Stay picker cleanly
  function setDailyStayVisibility(show) {
    if (dailyStayPicker) {
      dailyStayPicker.hidden = !show;
      dailyStayPicker.style.display = show ? 'block' : 'none';
    }
  }

  // Monthly duration button clicks
  durationButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      durationButtons.forEach(b => b.classList.remove('active'));
      if (durBtnDaily) durBtnDaily.classList.remove('active');
      btn.classList.add('active');

      isDailyStay = false;
      setDailyStayVisibility(false);

      currentDurationMonths = parseInt(btn.dataset.months, 10) || 1;
      currentDiscountRate = parseFloat(btn.dataset.discount) || 0;

      recalculate();
    });
  });

  // Daily Stay duration button click
  if (durBtnDaily) {
    durBtnDaily.addEventListener('click', () => {
      durationButtons.forEach(b => b.classList.remove('active'));
      durBtnDaily.classList.add('active');

      isDailyStay = true;
      setDailyStayVisibility(true);

      recalculate();
      if (dailyDaysInput) {
        dailyDaysInput.focus();
        dailyDaysInput.select?.();
      }
    });
  }

  // Direct Number of Days input handler
  if (dailyDaysInput) {
    const handleDaysInput = () => {
      let val = parseInt(dailyDaysInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 180) val = 180;
      currentDailyDays = val;
      if (dailyDaysLabel) {
        dailyDaysLabel.textContent = val === 1 ? 'Day' : 'Days';
      }
      recalculate();
    };

    dailyDaysInput.addEventListener('input', handleDaysInput);
    dailyDaysInput.addEventListener('change', () => {
      dailyDaysInput.value = currentDailyDays;
      handleDaysInput();
    });
  }

  if (preferredFloorSelect) {
    preferredFloorSelect.addEventListener('change', () => {
      if (rsvSumFloor) rsvSumFloor.textContent = preferredFloorSelect.value || 'Any Floor';
    });
  }

  // Expose current selection getters for booking submission
  window.getCalculatorSelection = function() {
    const moveInInput = (document.getElementById('moveInDateDisplay')?.value || document.getElementById('moveInDate')?.value || '').trim();
    const stayPeriodInfo = moveInInput
      ? calculateStayPeriod(moveInInput, isDailyStay ? `${currentDailyDays} Days` : (durationNames[currentDurationMonths] || '1 Month'), isDailyStay, isDailyStay ? currentDailyDays : currentDurationMonths)
      : null;

    return {
      roomKey: currentRoom,
      roomName: roomNames[currentRoom] || 'Double Sharing',
      climate: (currentClimate === 'ac' && currentRoom !== 'hall') ? 'AC' : 'Non-AC',
      duration: isDailyStay
        ? `${currentDailyDays} Day${currentDailyDays > 1 ? 's' : ''} (Daily Stay)`
        : (durationNames[currentDurationMonths] || '1 Month'),
      isDaily: isDailyStay,
      dailyDays: isDailyStay ? currentDailyDays : null,
      stayPeriod: stayPeriodInfo ? stayPeriodInfo.displayText : '',
      effectiveMonthly: dispMonthlyTotal ? dispMonthlyTotal.textContent : '₹8,500'
    };
  };

  window.updateEstimatorFromActive = function() {
    const activeBtn = document.querySelector('#calcRoomOptions .option-card.active');
    if (activeBtn) {
      currentRoom = activeBtn.dataset.value;
      currentBase = parseInt(activeBtn.dataset.base, 10) || 8500;
      currentAcAdd = parseInt(activeBtn.dataset.acAdd, 10) || 0;
    }
    if (durBtnDaily && durBtnDaily.classList.contains('active')) {
      isDailyStay = true;
      setDailyStayVisibility(true);
    } else {
      const activeDur = document.querySelector('#calcDurationOptions .duration-btn[data-months].active');
      if (activeDur) {
        isDailyStay = false;
        setDailyStayVisibility(false);
        currentDurationMonths = parseInt(activeDur.dataset.months, 10) || 1;
        currentDiscountRate = parseFloat(activeDur.dataset.discount) || 0;
      }
    }
    recalculate();
  };

  recalculate();
}

/* ===================================================================
   9. GALLERY CATEGORY FILTER & LIGHTBOX MODAL
   =================================================================== */
function initGallery() {
  const filterBtns = document.querySelectorAll('#galleryFilters .filter-btn');
  const galleryItems = document.querySelectorAll('.gallery-item');
  const lightboxModal = document.getElementById('lightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxClose = document.getElementById('lightboxClose');
  const lightboxPrev = document.getElementById('lightboxPrev');
  const lightboxNext = document.getElementById('lightboxNext');

  if (!galleryItems.length) return;

  let visibleItems = Array.from(galleryItems);
  let currentIndex = 0;

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.dataset.filter;

      galleryItems.forEach(item => {
        const itemCategory = item.dataset.category;
        item.style.display = (filter === 'all' || itemCategory === filter) ? 'block' : 'none';
      });

      visibleItems = Array.from(galleryItems).filter(item => item.style.display !== 'none');
      
      // Dispatch a resize event so the scroll-driven track dynamically updates its height
      window.dispatchEvent(new Event('resize'));
    });
  });

  function openLightbox(index) {
    if (!visibleItems[index]) return;
    currentIndex = index;
    const item = visibleItems[currentIndex];
    const img = item.querySelector('img');
    const caption = item.dataset.caption || item.querySelector('.gallery-item-title')?.textContent || '';

    lightboxImg.src = img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = caption;
    lightboxCaption.style.display = (caption && caption.trim()) ? '' : 'none';

    lightboxModal.classList.add('active');
    lightboxModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() {
    lightboxModal.classList.remove('active');
    lightboxModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  galleryItems.forEach(item => {
    item.addEventListener('click', () => {
      const idx = visibleItems.indexOf(item);
      if (idx !== -1) openLightbox(idx);
    });
  });

  if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
  if (lightboxNext) lightboxNext.addEventListener('click', (e) => { e.stopPropagation(); openLightbox((currentIndex + 1) % visibleItems.length); });
  if (lightboxPrev) lightboxPrev.addEventListener('click', (e) => { e.stopPropagation(); openLightbox((currentIndex - 1 + visibleItems.length) % visibleItems.length); });

  lightboxModal.addEventListener('click', (e) => {
    if (e.target === lightboxModal) closeLightbox();
  });

  document.addEventListener('keydown', (e) => {
    if (!lightboxModal.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') openLightbox((currentIndex + 1) % visibleItems.length);
    else if (e.key === 'ArrowLeft') openLightbox((currentIndex - 1 + visibleItems.length) % visibleItems.length);
  });
}

/* ===================================================================
   10. BOOKING FORM & AUTOMATIC BED DECREMENT
   =================================================================== */

function initBookingForm() {
  const bookingForm = document.getElementById('bookingForm');
  const confirmationModal = document.getElementById('confirmationModal');
  const modalClose = document.getElementById('modalClose');
  const modalDoneBtn = document.getElementById('modalDoneBtn');
  const modalWhatsAppBtn = document.getElementById('modalWhatsAppBtn');

  const modalRefCode = document.getElementById('modalRefCode');
  const modalName = document.getElementById('modalName');
  const modalPhone = document.getElementById('modalPhone');
  const modalRoom = document.getElementById('modalRoom');
  const modalClimate = document.getElementById('modalClimate');
  const modalDate = document.getElementById('modalDate');

  if (!bookingForm) return;

  const cstepGuard = document.getElementById('cstepGuard');

  function closeModal() {
    if (confirmationModal) {
      confirmationModal.classList.remove('active');
      confirmationModal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    if (cstepGuard) cstepGuard.hidden = true;
  }

  /* Steps 2 and 3 are one-way: the QR, the amount and the reference field
     are rebuilt from a booking ref that is gone once the modal closes, and
     nothing reopens them. So a dismissal from those steps asks first —
     unless the reference has already been accepted, at which point there
     is nothing left to lose. Step 1 just restates a saved booking, so it
     closes freely, as does the single-step flow when no UPI id is set. */
  function needsGuard() {
    return Boolean(cstepGuard) && confirmSteps === 3 &&
           currentConfirmStep >= 2 && !tokenStepSettled;
  }

  function requestClose() {
    if (!needsGuard()) { closeModal(); return; }
    const ref = document.getElementById('modalRefCode');
    const slot = document.getElementById('cstepGuardRef');
    if (slot) slot.textContent = (ref?.textContent || '').trim() || 'your booking';
    cstepGuard.hidden = false;
    document.getElementById('cstepGuardStay')?.focus();
  }

  document.getElementById('cstepGuardStay')?.addEventListener('click', () => {
    cstepGuard.hidden = true;
  });
  document.getElementById('cstepGuardLeave')?.addEventListener('click', closeModal);
  // A click on the guard's own backdrop is the cautious choice, not the
  // destructive one — treat it as "stay".
  cstepGuard?.addEventListener('click', (e) => {
    if (e.target === cstepGuard) cstepGuard.hidden = true;
  });

  if (modalClose) modalClose.addEventListener('click', requestClose);
  // "Done" is the intended way out of the last step, so it never asks.
  if (modalDoneBtn) modalDoneBtn.addEventListener('click', closeModal);
  if (confirmationModal) {
    confirmationModal.addEventListener('click', (e) => {
      if (e.target === confirmationModal) requestClose();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !confirmationModal?.classList.contains('active')) return;
    if (cstepGuard && !cstepGuard.hidden) { cstepGuard.hidden = true; return; }
    requestClose();
  });

  // ── Government ID Proof Handling ──
  const guestIdType = document.getElementById('guestIdType');
  const guestIdNumber = document.getElementById('guestIdNumber');
  const idNumberError = document.getElementById('idNumberError');
  const guestIdFile = document.getElementById('guestIdFile');
  const idUploadDropzone = document.getElementById('idUploadDropzone');
  const idUploadPrompt = document.getElementById('idUploadPrompt');
  const idFilePreview = document.getElementById('idFilePreview');
  const idPreviewImg = document.getElementById('idPreviewImg');
  const idPreviewPdfIcon = document.getElementById('idPreviewPdfIcon');
  const idFileName = document.getElementById('idFileName');
  const idFileSize = document.getElementById('idFileSize');
  const idVerifiedPill = document.getElementById('idVerifiedPill');
  const removeIdFileBtn = document.getElementById('removeIdFileBtn');
  const idFileError = document.getElementById('idFileError');

  let currentIdProof = null; // { dataUrl: string, name: string, sizeStr: string, isPdf: boolean, verified: boolean }

  // Official UIDAI Verhoeff Checksum Tables
  const verhoeffD = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];
  const verhoeffP = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];

  function checkVerhoeff(str) {
    let c = 0;
    const rev = String(str).replace(/\D/g, '').split('').reverse().map(Number);
    for (let i = 0; i < rev.length; i++) {
      c = verhoeffD[c][verhoeffP[i % 8][rev[i]]];
    }
    return c === 0;
  }

  const updateIdPlaceholder = () => {
    if (!guestIdType || !guestIdNumber) return;
    const type = guestIdType.value;
    if (type === 'Aadhaar Card') {
      guestIdNumber.placeholder = '12-digit Aadhaar number';
      guestIdNumber.setAttribute('maxlength', '14'); // allows "XXXX XXXX XXXX"
    } else if (type === 'PAN Card') {
      guestIdNumber.placeholder = '10-character PAN number';
      guestIdNumber.setAttribute('maxlength', '10');
    } else if (type === 'Driving License') {
      guestIdNumber.placeholder = 'Driving License number';
      guestIdNumber.removeAttribute('maxlength');
    } else if (type === 'Voter ID') {
      guestIdNumber.placeholder = 'Voter ID (EPIC) number';
      guestIdNumber.removeAttribute('maxlength');
    } else if (type === 'Passport') {
      guestIdNumber.placeholder = 'Passport (e.g. A1234567)';
      guestIdNumber.setAttribute('maxlength', '8');
    }
    guestIdNumber.classList.remove('is-invalid');
    if (idNumberError) idNumberError.style.display = 'none';
  };

  if (guestIdType) {
    guestIdType.addEventListener('change', updateIdPlaceholder);
  }

  if (guestIdNumber) {
    guestIdNumber.addEventListener('input', () => {
      const type = guestIdType ? guestIdType.value : 'Aadhaar Card';
      if (type === 'Aadhaar Card') {
        const rawDigits = guestIdNumber.value.replace(/\D/g, '').slice(0, 12);
        const formatted = rawDigits.match(/.{1,4}/g)?.join(' ') || rawDigits;
        guestIdNumber.value = formatted;
      } else if (type === 'PAN Card') {
        guestIdNumber.value = guestIdNumber.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      } else if (type === 'Passport') {
        guestIdNumber.value = guestIdNumber.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      }
      if (guestIdNumber.value.trim().length > 0) {
        guestIdNumber.classList.remove('is-invalid');
        if (idNumberError) idNumberError.style.display = 'none';
      }
    });
  }

  function validateIdNumber(type, val) {
    const raw = (val || '').trim();
    if (!raw) {
      return { ok: false, error: `Please enter your ${type} number.` };
    }
    if (type === 'Aadhaar Card') {
      const digits = raw.replace(/\D/g, '');
      if (digits.length !== 12) {
        return { ok: false, error: 'Aadhaar number must be exactly 12 digits.' };
      }
      if (/^([0-9])\1{11}$/.test(digits) || digits === '123456789012' || digits === '987654321098') {
        return { ok: false, error: 'Please enter an authentic 12-digit Aadhaar number.' };
      }
      if (digits[0] === '0' || digits[0] === '1') {
        return { ok: false, error: 'Aadhaar number cannot start with 0 or 1 per UIDAI rules.' };
      }
      if (!checkVerhoeff(digits)) {
        return { ok: false, error: 'Invalid Aadhaar number (checksum validation failed).' };
      }
      return { ok: true, value: digits, formatted: digits.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3') };
    }
    if (type === 'PAN Card') {
      const clean = raw.toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/.test(clean)) {
        return { ok: false, error: 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F).' };
      }
      return { ok: true, value: clean, formatted: clean };
    }
    if (type === 'Passport') {
      const clean = raw.toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z][0-9]{7}$/.test(clean)) {
        return { ok: false, error: 'Passport must be 1 letter followed by 7 digits (e.g. A1234567).' };
      }
      return { ok: true, value: clean, formatted: clean };
    }
    if (type === 'Voter ID') {
      const clean = raw.toUpperCase().replace(/\s+/g, '');
      if (clean.length < 10) {
        return { ok: false, error: 'Voter ID (EPIC) must have at least 10 characters.' };
      }
      return { ok: true, value: clean, formatted: clean };
    }
    if (type === 'Driving License') {
      const clean = raw.toUpperCase().replace(/\s+/g, '');
      if (clean.length < 10) {
        return { ok: false, error: 'Driving License must have at least 10 characters.' };
      }
      return { ok: true, value: clean, formatted: clean };
    }
    if (raw.length < 4) {
      return { ok: false, error: 'Please enter a valid government ID number.' };
    }
    return { ok: true, value: raw, formatted: raw };
  }

  function compressImageToDataUrl(file, maxWidth = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxWidth || height > maxWidth) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxWidth) / height);
              height = maxWidth;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function handleFileSelected(file) {
    if (!file) return;

    // 1. Format check: Only images or PDF
    const validImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const isImage = validImageTypes.includes(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

    if (!isImage && !isPdf) {
      if (idFileError) {
        idFileError.textContent = 'Invalid file format. Please upload a clear photo (JPG, PNG) or PDF of your Government ID.';
        idFileError.style.display = 'flex';
      }
      if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
      if (guestIdFile) guestIdFile.value = '';
      return;
    }

    // 2. Minimum size check (must be at least 15KB to avoid blank or corrupted files)
    if (file.size < 15 * 1024) {
      if (idFileError) {
        idFileError.textContent = 'Uploaded file is too small or blank (under 15KB). Please upload a clear photo of your ID.';
        idFileError.style.display = 'flex';
      }
      if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
      if (guestIdFile) guestIdFile.value = '';
      return;
    }

    // 3. Maximum size check (5MB)
    if (file.size > 5 * 1024 * 1024) {
      if (idFileError) {
        idFileError.textContent = 'File exceeds 5MB size limit. Please upload a smaller photo or PDF.';
        idFileError.style.display = 'flex';
      }
      if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
      if (guestIdFile) guestIdFile.value = '';
      return;
    }

    // 4. Resolution and Document Shape Checks for Images
    if (isImage) {
      const dimensions = await new Promise((resolve) => {
        const tempReader = new FileReader();
        tempReader.onload = (e) => {
          const img = new Image();
          img.onload = () => resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, src: e.target.result });
          img.onerror = () => resolve(null);
          img.src = e.target.result;
        };
        tempReader.onerror = () => resolve(null);
        tempReader.readAsDataURL(file);
      });

      if (!dimensions) {
        if (idFileError) {
          idFileError.textContent = 'Unable to decode image. Please upload a valid JPG or PNG photo.';
          idFileError.style.display = 'flex';
        }
        if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
        if (guestIdFile) guestIdFile.value = '';
        return;
      }

      const { width, height } = dimensions;
      if (width < 280 || height < 180) {
        if (idFileError) {
          idFileError.textContent = `Photo resolution is too low (${width}x${height}px). Please upload a clear photo of at least 300x200 pixels.`;
          idFileError.style.display = 'flex';
        }
        if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
        if (guestIdFile) guestIdFile.value = '';
        return;
      }

      // Check portrait orientation: Physical ID cards are horizontal landscape (Aadhaar, PAN, DL, Voter ID, Passport).
      // If height > width * 1.35, it's a vertical room/selfie/wall photo (like the bathroom image).
      if (height > width * 1.35) {
        if (idFileError) {
          idFileError.textContent = 'Please upload a horizontal (landscape) photo of your ID card. Vertical room or scenery photos cannot be verified.';
          idFileError.style.display = 'flex';
        }
        if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
        if (guestIdFile) guestIdFile.value = '';
        return;
      }

      const ratio = Math.max(width, height) / Math.min(width, height);
      if (ratio > 4.5) {
        if (idFileError) {
          idFileError.textContent = 'The uploaded image aspect ratio is irregular. Please upload a clear photo of your ID card.';
          idFileError.style.display = 'flex';
        }
        if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
        if (guestIdFile) guestIdFile.value = '';
        return;
      }

      // Document Contrast & Content Check using Canvas
      const hasContent = await new Promise((resolve) => {
        try {
          const testCanvas = document.createElement('canvas');
          testCanvas.width = 160;
          testCanvas.height = 100;
          const tCtx = testCanvas.getContext('2d');
          const tImg = new Image();
          tImg.onload = () => {
            tCtx.drawImage(tImg, 0, 0, 160, 100);
            const data = tCtx.getImageData(0, 0, 160, 100).data;
            let minLuma = 255;
            let maxLuma = 0;
            for (let i = 0; i < data.length; i += 4) {
              const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              if (luma < minLuma) minLuma = luma;
              if (luma > maxLuma) maxLuma = luma;
            }
            const contrast = maxLuma - minLuma;
            // Legitimate documents have contrast between dark text and light paper/card
            resolve(contrast >= 35);
          };
          tImg.onerror = () => resolve(true);
          tImg.src = dimensions.src;
        } catch (_) {
          resolve(true);
        }
      });

      if (!hasContent) {
        if (idFileError) {
          idFileError.textContent = 'Image has insufficient contrast or appears blank. Please upload a clear photo of your physical ID card.';
          idFileError.style.display = 'flex';
        }
        if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
        if (guestIdFile) guestIdFile.value = '';
        return;
      }
    }

    try {
      let dataUrl = '';
      if (isPdf) {
        dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } else {
        dataUrl = await compressImageToDataUrl(file);
      }

      currentIdProof = {
        dataUrl,
        name: file.name,
        sizeStr: formatFileSize(file.size),
        isPdf,
        verified: true
      };

      if (idFileName) idFileName.textContent = file.name;
      if (idFileSize) idFileSize.textContent = formatFileSize(file.size);
      if (idVerifiedPill) idVerifiedPill.style.display = 'inline-flex';

      if (isPdf) {
        if (idPreviewImg) idPreviewImg.style.display = 'none';
        if (idPreviewPdfIcon) idPreviewPdfIcon.style.display = 'block';
      } else {
        if (idPreviewPdfIcon) idPreviewPdfIcon.style.display = 'none';
        if (idPreviewImg) {
          idPreviewImg.src = dataUrl;
          idPreviewImg.style.display = 'block';
        }
      }

      if (idUploadPrompt) idUploadPrompt.style.display = 'none';
      if (idFilePreview) idFilePreview.style.display = 'flex';
      if (idUploadDropzone) idUploadDropzone.classList.remove('is-invalid');
      if (idFileError) idFileError.style.display = 'none';
    } catch (err) {
      console.error('[id-proof] file processing failed:', err);
      if (idFileError) {
        idFileError.textContent = 'Failed to process document file. Please try another image or PDF.';
        idFileError.style.display = 'flex';
      }
    }
  }

  if (guestIdFile) {
    guestIdFile.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFileSelected(file);
    });
  }

  if (idUploadDropzone) {
    ['dragenter', 'dragover'].forEach(evt => {
      idUploadDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        idUploadDropzone.classList.add('is-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      idUploadDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        idUploadDropzone.classList.remove('is-dragover');
      });
    });
    idUploadDropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files[0]) {
        handleFileSelected(files[0]);
      }
    });
  }

  if (removeIdFileBtn) {
    removeIdFileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentIdProof = null;
      if (guestIdFile) guestIdFile.value = '';
      if (idFilePreview) idFilePreview.style.display = 'none';
      if (idVerifiedPill) idVerifiedPill.style.display = 'none';
      if (idUploadPrompt) idUploadPrompt.style.display = 'flex';
      if (idPreviewImg) {
        idPreviewImg.src = '';
        idPreviewImg.style.display = 'none';
      }
      if (idPreviewPdfIcon) idPreviewPdfIcon.style.display = 'none';
    });
  }

  // Payment Option preference selection in reservation form
  const payRadios = document.querySelectorAll('input[name="bookingPaymentMode"]');
  payRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.pay-method-card').forEach(card => card.classList.remove('is-selected'));
      const parentCard = radio.closest('.pay-method-card');
      if (parentCard) parentCard.classList.add('is-selected');
    });
  });

  // ── Form Submit ──
  bookingForm.addEventListener('submit', (e) => {
    e.preventDefault();

    let isValid = true;

    const fullName = document.getElementById('fullName');
    const phoneNumber = document.getElementById('phoneNumber');
    const preferredFloor = document.getElementById('preferredFloor');
    const moveInDate = document.getElementById('moveInDate');
    const moveInDateDisplay = document.getElementById('moveInDateDisplay');
    const workplace = document.getElementById('workplace');
    const guestEmail = document.getElementById('guestEmail');

    // 1. Email check
    const emailError = document.getElementById('emailError');
    const emailCheck = validateEmail(guestEmail?.value);
    const cleanEmail = emailCheck.value || '';
    if (!emailCheck.ok) {
      if (guestEmail) guestEmail.classList.add('is-invalid');
      if (emailError) {
        emailError.textContent = emailCheck.error;
        emailError.style.display = 'flex';
      }
      isValid = false;
    } else {
      if (guestEmail) guestEmail.classList.remove('is-invalid');
      if (emailError) emailError.style.display = 'none';
    }

    // 2. Full Name check
    const fullNameError = document.getElementById('fullNameError');
    if (!fullName || !fullName.value.trim() || fullName.value.trim().length < 2) {
      if (fullName) fullName.classList.add('is-invalid');
      if (fullNameError) {
        fullNameError.textContent = !fullName?.value.trim() ? 'Full name is required.' : 'Enter your full name (at least 2 characters).';
        fullNameError.style.display = 'flex';
      }
      isValid = false;
    } else {
      if (fullName) fullName.classList.remove('is-invalid');
      if (fullNameError) fullNameError.style.display = 'none';
    }

    // 3. Phone check
    const phoneError = document.getElementById('phoneError');
    const phoneCheck = validatePhone(phoneNumber?.value);
    const cleanPhone = phoneCheck.value || '';
    if (!phoneCheck.ok) {
      if (phoneNumber) phoneNumber.classList.add('is-invalid');
      if (phoneError) {
        phoneError.textContent = phoneCheck.error;
        phoneError.style.display = 'flex';
      }
      isValid = false;
    } else {
      if (phoneNumber) phoneNumber.classList.remove('is-invalid');
      if (phoneError) phoneError.style.display = 'none';
    }

    // Ensure hidden and display date inputs are synced
    if (moveInDate && !moveInDate.value && moveInDateDisplay && moveInDateDisplay.value) {
      moveInDate.value = moveInDateDisplay.value;
    }
    if (moveInDateDisplay && !moveInDateDisplay.value && moveInDate && moveInDate.value) {
      moveInDateDisplay.value = moveInDate.value;
    }

    const hasDate = Boolean((moveInDate && moveInDate.value.trim()) || (moveInDateDisplay && moveInDateDisplay.value.trim()));
    if (!hasDate) {
      if (moveInDateDisplay) moveInDateDisplay.classList.add('is-invalid');
      const dateError = document.getElementById('dateError');
      if (dateError) dateError.style.display = 'block';
      isValid = false;
    } else {
      if (moveInDateDisplay) moveInDateDisplay.classList.remove('is-invalid');
      const dateError = document.getElementById('dateError');
      if (dateError) dateError.style.display = 'none';
      if (moveInDate && !moveInDate.value && moveInDateDisplay) {
        moveInDate.value = moveInDateDisplay.value;
      }
    }

    // 4. Government ID Number check
    const idTypeVal = guestIdType ? guestIdType.value : 'Aadhaar Card';
    const idCheck = validateIdNumber(idTypeVal, guestIdNumber?.value);
    if (!idCheck.ok) {
      if (guestIdNumber) guestIdNumber.classList.add('is-invalid');
      if (idNumberError) {
        idNumberError.textContent = idCheck.error;
        idNumberError.style.display = 'flex';
      }
      isValid = false;
    } else {
      if (guestIdNumber) guestIdNumber.classList.remove('is-invalid');
      if (idNumberError) idNumberError.style.display = 'none';
    }

    // 5. Government ID proof document check
    if (!currentIdProof || !currentIdProof.dataUrl) {
      if (idUploadDropzone) idUploadDropzone.classList.add('is-invalid');
      if (idFileError) {
        idFileError.textContent = 'Please upload a clear, legible photo or PDF of your government ID.';
        idFileError.style.display = 'flex';
      }
      isValid = false;
    } else {
      if (idUploadDropzone) idUploadDropzone.classList.remove('is-invalid');
      if (idFileError) idFileError.style.display = 'none';
    }

    if (!isValid) {
      const firstInvalid = bookingForm.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const sel = typeof window.getCalculatorSelection === 'function' 
      ? window.getCalculatorSelection() 
      : { roomKey: 'double', roomName: 'Double Sharing', climate: 'Non-AC', duration: '1 Month' };

    // 1. Generate Unique Booking Reference
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const refId = `#CMPG-${randomNum}`;

    // Record whether the form itself captured an email, so the payment
    // step knows whether to ask.
    const guestEmailEl = document.getElementById('guestEmail');
    if (guestEmailEl) guestEmailEl.dataset.captured = (guestEmailEl.value || '').trim();

    // 2. Inventory is deliberately NOT touched here.
    //
    // Submitting this form is an *enquiry*, not a confirmed booking — anyone
    // can fill it in. Decrementing on submit let a single idle visitor mark a
    // bed as gone, and when a signed-in manager submitted, that write actually
    // persisted for everyone. Beds now only change when the manager adjusts
    // them in the portal after confirming the resident.

    // 3. Save booking to local DB for Warden Portal
    const chosenFloor = preferredFloor ? preferredFloor.value : "Any Floor";
    const cfg = getHostelConfig();
    const pricing = cfg?.pricing || {};
    const bookingPricing = calculateInvoicePricing({
      room: `${sel.roomName} (${sel.climate})`,
      climate: sel.climate,
      duration: sel.duration,
      is_daily: sel.isDaily,
      daily_days: sel.dailyDays
    }, pricing);

    const monthlyTotalStr = document.getElementById('dispMonthlyTotal')?.textContent?.trim() || `₹${bookingPricing.monthlyRent.toLocaleString('en-IN')}`;
    const secDepositStr = document.getElementById('dispSecurityDeposit')?.textContent?.trim() || `₹${bookingPricing.securityDeposit.toLocaleString('en-IN')}`;
    const moveInTotalStr = document.getElementById('dispMoveInTotal')?.textContent?.trim() || `₹${bookingPricing.moveInTotal.toLocaleString('en-IN')}`;
    const moveInTotalNum = parseInt(moveInTotalStr.replace(/[^\d]/g, ''), 10) || bookingPricing.moveInTotal;
    const secDepositNum = parseInt(secDepositStr.replace(/[^\d]/g, ''), 10) || bookingPricing.securityDeposit;

    const chosenMoveInDate = normalizeBookingDate((moveInDateDisplay ? moveInDateDisplay.value : moveInDate.value) || '');
    const stayPeriodObj = calculateStayPeriod(chosenMoveInDate, sel.duration, sel.isDaily, sel.dailyDays);
    const stayPeriodDisplay = stayPeriodObj ? stayPeriodObj.displayText : sel.duration;

    const chosenPayMode = document.querySelector('input[name="bookingPaymentMode"]:checked')?.value || 'upi';
    const isCashSelected = chosenPayMode === 'cash';
    const isAdvanceSelected = chosenPayMode === 'advance';

    const cfgAdvanceVal = cfg?.pricing?.advanceAmount ? Number(cfg.pricing.advanceAmount) : (cfg?.pricing?.tokenAmount ? Number(cfg.pricing.tokenAmount) : 1000);
    const calcAdvanceAmt = Math.min(moveInTotalNum, cfgAdvanceVal || 1000);
    const calcBalanceAmt = Math.max(0, moveInTotalNum - calcAdvanceAmt);

    const newBooking = {
      ref: refId,
      name: fullName.value.trim(),
      phone: cleanPhone,
      floor: chosenFloor,
      room: `${sel.roomName} (${sel.climate})`,
      climate: sel.climate,
      date: chosenMoveInDate,
      duration: sel.duration,
      stay_period: stayPeriodDisplay,
      is_daily: !!sel.isDaily,
      daily_days: sel.dailyDays || null,
      workplace: workplace ? workplace.value.trim() : '',
      email: cleanEmail.toLowerCase(),
      id_type: idTypeVal,
      id_number: idCheck.value || guestIdNumber?.value?.trim() || '',
      id_proof_url: currentIdProof?.dataUrl || '',
      payment_mode: chosenPayMode,
      paymentMode: isCashSelected ? 'Cash on Hand' : (isAdvanceSelected ? 'Advance Token' : 'UPI Instant Transfer'),
      advance_amount: isAdvanceSelected ? calcAdvanceAmt : null,
      balance_amount: isAdvanceSelected ? calcBalanceAmt : null,
      monthly_rent: monthlyTotalStr,
      term_savings: document.getElementById('dispDiscountVal')?.textContent || '',
      security_deposit: secDepositStr,
      payable_move_in: moveInTotalStr,
      move_in_scope: document.getElementById('dispMoveInScope')?.textContent || "First month's rent + deposit",
      payment_amount: moveInTotalNum,
      paymentAmount: moveInTotalNum,
      pricing: pricing,
      time: "Just now"
    };

    currentBookingContext = {
      ...newBooking,
      token_amount: isAdvanceSelected ? calcAdvanceAmt : moveInTotalNum,
      deposit_amount: secDepositNum,
      advance_amount: isAdvanceSelected ? calcAdvanceAmt : null,
      balance_amount: isAdvanceSelected ? calcBalanceAmt : null,
      payment_mode: chosenPayMode,
      paymentMode: isCashSelected ? 'Cash on Hand' : (isAdvanceSelected ? 'Advance Token' : 'UPI Instant Transfer'),
      upi_utr: '',
      dateIssued: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    };

    // Prepare token step
    showUpiToken(newBooking.ref);

    // Send the enquiry to Supabase so the manager actually receives it.
    submitBooking(newBooking).then(res => {
      if (!res.ok) {
        console.error('[booking] submit failed:', res.error);
        return;
      }

      // Acknowledgement only. The invoice comes later, after the manager
      // verifies the token — see markBookingPaid().
      sendInvoiceEmail(newBooking.ref, 'enquiry', {
        email: cleanEmail,
        booking: currentBookingContext,
        hostel: cfg.texts
      }).then(mail => {
        if (!mail.ok) console.warn('[booking] enquiry email not sent:', mail.error);
      });
    });

    // 4. Populate Modal
    if (modalRefCode) modalRefCode.textContent = refId;
    if (modalName) modalName.textContent = fullName.value.trim();
    if (modalPhone) modalPhone.textContent = cleanPhone;
    if (modalRoom) modalRoom.textContent = `${sel.roomName} (${chosenFloor})`;
    if (modalClimate) modalClimate.textContent = sel.climate;
    if (modalDate) modalDate.textContent = chosenMoveInDate;
    const modalStayPeriod = document.getElementById('modalStayPeriod');
    if (modalStayPeriod) modalStayPeriod.textContent = stayPeriodDisplay;
    const modalPaymentMode = document.getElementById('modalPaymentMode');
    if (modalPaymentMode) {
      if (isCashSelected) {
        modalPaymentMode.textContent = 'Cash on Hand (Pay at Hostel)';
      } else if (isAdvanceSelected) {
        modalPaymentMode.textContent = `Advance Token (₹${calcAdvanceAmt.toLocaleString('en-IN')} Now + Balance ₹${calcBalanceAmt.toLocaleString('en-IN')})`;
      } else {
        modalPaymentMode.textContent = 'UPI Instant Transfer';
      }
    }
    const modalIdProof = document.getElementById('modalIdProof');
    if (modalIdProof) {
      const displayNum = idTypeVal === 'Aadhaar Card' && newBooking.id_number.length === 12
        ? `•••• •••• ${newBooking.id_number.slice(-4)}`
        : newBooking.id_number;
      modalIdProof.textContent = `${newBooking.id_type} (${displayNum}) • Attached`;
    }
    const modalMoveInTotal = document.getElementById('modalMoveInTotal');
    if (modalMoveInTotal) modalMoveInTotal.textContent = moveInTotalStr;

    // 5. Generate WhatsApp Link for Manager
    let payMethodText = 'UPI / Online Transfer (Full Move-in)';
    if (isCashSelected) payMethodText = 'Cash on Hand (Pay upon arrival)';
    else if (isAdvanceSelected) payMethodText = `Advance Token (₹${calcAdvanceAmt.toLocaleString('en-IN')} UPI Advance + Balance ₹${calcBalanceAmt.toLocaleString('en-IN')} on Move-in)`;

    const waText = encodeURIComponent(
      `Hello Manager, I submitted a booking enquiry on the Chaitanya Mens PG & Hostel website!\n\n` +
      `📋 Ref Code: ${refId}\n` +
      `👤 Name: ${fullName.value.trim()}\n` +
      `📞 Phone: ${cleanPhone}\n` +
      `🪪 Govt ID: ${newBooking.id_type} (${newBooking.id_number}) [Doc Attached]\n` +
      `🛏️ Room: ${sel.roomName} (${sel.climate})\n` +
      `🏢 Preferred Floor: ${chosenFloor}\n` +
      `📅 Move-in Date: ${chosenMoveInDate}\n` +
      `🗓️ Stay Period: ${stayPeriodDisplay}\n` +
      `⏳ Stay Duration: ${sel.duration}\n` +
      `💵 Payment Option: ${payMethodText}\n\n` +
      `Please confirm bed availability and share room photos.`
    );
    const mgrWa = (cfg?.texts?.whatsapp || '919949785344').replace(/\D/g, '');
    const waHref = `https://wa.me/${mgrWa}?text=${waText}`;
    if (modalWhatsAppBtn) modalWhatsAppBtn.href = waHref;
    const waBtn2 = document.getElementById('modalWhatsAppBtn2');
    if (waBtn2) waBtn2.href = waHref;

    // 6. Open the confirmation dialog and replay the tick
    if (confirmationModal) {
      gotoConfirmStep(1);
      confirmationModal.classList.add('active');
      confirmationModal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      // Restart the CSS tick animation by re-adding the class.
      const check = confirmationModal.querySelector('.confirm-check');
      if (check) {
        check.classList.remove('is-drawing');
        void check.offsetWidth;          // force reflow so the animation replays
        check.classList.add('is-drawing');
      }
    }

    // 6b. Confirm to the visitor that their own booking landed — a real
    //     event, with their own reference, shown only to them.
    showSiteToast(
      `Booking ${refId} submitted`,
      `${sel.roomName} · ${chosenFloor} · move-in ${moveInDateDisplay ? moveInDateDisplay.value : moveInDate.value}`,
      'fa-solid fa-circle-check'
    );

    // 7. Reset Personal Info Fields
    if (fullName) fullName.value = '';
    if (phoneNumber) phoneNumber.value = '';
    if (moveInDate) moveInDate.value = '';
    if (moveInDateDisplay) moveInDateDisplay.value = '';
    if (workplace) workplace.value = '';
    if (removeIdFileBtn) removeIdFileBtn.click();
  });

  // Live validation & instant error messages
  const fullNameInput = document.getElementById('fullName');
  const fullNameErrorEl = document.getElementById('fullNameError');
  if (fullNameInput) {
    fullNameInput.addEventListener('input', () => {
      if (fullNameInput.value.trim().length >= 2) {
        fullNameInput.classList.remove('is-invalid');
        if (fullNameErrorEl) fullNameErrorEl.style.display = 'none';
      }
    });
    fullNameInput.addEventListener('blur', () => {
      if (fullNameInput.value.trim().length > 0 && fullNameInput.value.trim().length < 2) {
        fullNameInput.classList.add('is-invalid');
        if (fullNameErrorEl) {
          fullNameErrorEl.textContent = 'Enter your full name (at least 2 characters).';
          fullNameErrorEl.style.display = 'flex';
        }
      }
    });
  }

  const phoneInput = document.getElementById('phoneNumber');
  const phoneErrorEl = document.getElementById('phoneError');
  if (phoneInput) {
    const handlePhoneInput = () => {
      let val = phoneInput.value.replace(/\D/g, '').slice(0, 10);
      phoneInput.value = val;

      if (!val) {
        phoneInput.classList.remove('is-invalid');
        if (phoneErrorEl) phoneErrorEl.style.display = 'none';
        return;
      }

      // If user starts with 0-5, immediately explain why
      if (val.length > 0 && !/^[6-9]/.test(val)) {
        phoneInput.classList.add('is-invalid');
        if (phoneErrorEl) {
          phoneErrorEl.textContent = 'An Indian mobile number starts with 6, 7, 8 or 9.';
          phoneErrorEl.style.display = 'flex';
        }
      } else if (val.length === 10) {
        phoneInput.classList.remove('is-invalid');
        if (phoneErrorEl) phoneErrorEl.style.display = 'none';
      } else {
        phoneInput.classList.remove('is-invalid');
        if (phoneErrorEl) phoneErrorEl.style.display = 'none';
      }
    };

    phoneInput.addEventListener('input', handlePhoneInput);
    phoneInput.addEventListener('paste', () => setTimeout(handlePhoneInput, 0));
    phoneInput.addEventListener('blur', () => {
      if (phoneInput.value) {
        const check = validatePhone(phoneInput.value);
        if (!check.ok) {
          phoneInput.classList.add('is-invalid');
          if (phoneErrorEl) {
            phoneErrorEl.textContent = check.error;
            phoneErrorEl.style.display = 'flex';
          }
        } else {
          phoneInput.classList.remove('is-invalid');
          if (phoneErrorEl) phoneErrorEl.style.display = 'none';
        }
      }
    });
  }

  const guestEmailInput = document.getElementById('guestEmail');
  const emailErrorEl = document.getElementById('emailError');
  if (guestEmailInput) {
    guestEmailInput.addEventListener('input', () => {
      guestEmailInput.classList.remove('is-invalid');
      if (emailErrorEl) emailErrorEl.style.display = 'none';
    });
    guestEmailInput.addEventListener('blur', () => {
      if (guestEmailInput.value) {
        const check = validateEmail(guestEmailInput.value);
        if (!check.ok) {
          guestEmailInput.classList.add('is-invalid');
          if (emailErrorEl) {
            emailErrorEl.textContent = check.error;
            emailErrorEl.style.display = 'flex';
          }
        } else {
          guestEmailInput.classList.remove('is-invalid');
          if (emailErrorEl) emailErrorEl.style.display = 'none';
        }
      }
    });
  }
}

/* ===================================================================
   11. BESPOKE CUSTOM CALENDAR & DATE PICKER ENGINE
   =================================================================== */
function initFooterYear() {
  const currentYearSpan = document.getElementById('currentYear');
  if (currentYearSpan) currentYearSpan.textContent = new Date().getFullYear();
}

function initCustomDatePicker() {
  const trigger = document.getElementById('datePickerTrigger');
  const popover = document.getElementById('customCalendarPopover');
  const displayInput = document.getElementById('moveInDateDisplay');
  const hiddenInput = document.getElementById('moveInDate');
  const monthYearSpan = document.getElementById('calMonthYear');
  const daysGrid = document.getElementById('calDaysGrid');
  const prevBtn = document.getElementById('calPrevMonth');
  const nextBtn = document.getElementById('calNextMonth');
  const clearBtn = document.getElementById('calClearBtn');
  const todayBtn = document.getElementById('calTodayBtn');
  const quickPills = document.querySelectorAll('.cal-quick-pill');

  if (!trigger || !popover || !daysGrid) return;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const realToday = new Date();
  let viewYear = realToday.getFullYear();
  let viewMonth = realToday.getMonth();
  let selectedDate = null;

  // Minimum selectable date allows the opening month (Oct 1st, 2026 onwards)
  const minDate = new Date(2026, 9, 1);

  function formatDateValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatDisplayValue(date) {
    const d = date.getDate();
    const m = monthNames[date.getMonth()].substring(0, 3);
    const y = date.getFullYear();
    return `${d} ${m}, ${y}`;
  }

  function selectDate(date) {
    selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const val = formatDateValue(selectedDate);
    const disp = formatDisplayValue(selectedDate);

    if (hiddenInput) {
      hiddenInput.value = val;
      hiddenInput.classList.remove('is-invalid');
      hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (displayInput) {
      displayInput.value = disp;
      displayInput.classList.remove('is-invalid');
      displayInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const dateError = document.getElementById('dateError');
    if (dateError) dateError.style.display = 'none';

    if (typeof window.updateEstimatorFromActive === 'function') {
      window.updateEstimatorFromActive();
    }

    renderCalendar();
    closePopover();
  }

  function renderCalendar() {
    monthYearSpan.textContent = `${monthNames[viewMonth]} ${viewYear}`;

    // Disable prev month navigation if viewing current month/year
    const isMinMonth = (viewYear === minDate.getFullYear() && viewMonth === minDate.getMonth());
    if (prevBtn) prevBtn.disabled = isMinMonth;

    daysGrid.innerHTML = '';

    const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay(); // 0 is Sunday
    const daysInCurrentMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate();

    // 1. Previous month padding cells
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day-cell other-month disabled';
      cell.textContent = prevMonthDays - i;
      daysGrid.appendChild(cell);
    }

    // 2. Current month day cells
    for (let day = 1; day <= daysInCurrentMonth; day++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day-cell';
      cell.textContent = day;

      const currentCellDate = new Date(viewYear, viewMonth, day);

      if (currentCellDate < minDate) {
        cell.classList.add('disabled');
      } else {
        if (
          currentCellDate.getFullYear() === minDate.getFullYear() &&
          currentCellDate.getMonth() === minDate.getMonth() &&
          currentCellDate.getDate() === minDate.getDate()
        ) {
          cell.classList.add('today');
        }

        if (
          selectedDate &&
          currentCellDate.getFullYear() === selectedDate.getFullYear() &&
          currentCellDate.getMonth() === selectedDate.getMonth() &&
          currentCellDate.getDate() === selectedDate.getDate()
        ) {
          cell.classList.add('selected');
        }

        cell.addEventListener('click', (e) => {
          e.stopPropagation();
          selectDate(currentCellDate);
        });
      }

      daysGrid.appendChild(cell);
    }

    // 3. Next month trailing padding cells
    const totalCells = daysGrid.children.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let j = 1; j <= remainingCells; j++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cal-day-cell other-month disabled';
      cell.textContent = j;
      daysGrid.appendChild(cell);
    }
  }

  /**
   * Open above the field when there isn't room below.
   *
   * The date row sits near the bottom of the booking card, so a calendar
   * that always drops downward opened entirely below the fold and looked
   * like nothing had happened. Measured each time, because the available
   * space depends on scroll position and viewport height.
   */
  function placePopover() {
    popover.classList.remove('drop-up');
    const t = trigger.getBoundingClientRect();
    // Height is only measurable once it is laid out; .active is already on.
    const h = popover.offsetHeight || 320;
    const spaceBelow = window.innerHeight - t.bottom;
    const spaceAbove = t.top;
    if (spaceBelow < h + 12 && spaceAbove > spaceBelow) {
      popover.classList.add('drop-up');
    }
  }

  function openPopover() {
    popover.classList.add('active');
    trigger.classList.add('active');
    popover.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
    if (selectedDate) {
      viewYear = selectedDate.getFullYear();
      viewMonth = selectedDate.getMonth();
    } else {
      viewYear = realToday.getFullYear();
      viewMonth = realToday.getMonth();
    }
    renderCalendar();
    placePopover();
    // Re-evaluate if the page moves or resizes while it is open.
    window.addEventListener('scroll', placePopover, { passive: true });
    window.addEventListener('resize', placePopover);
  }

  function closePopover() {
    popover.classList.remove('active', 'drop-up');
    trigger.classList.remove('active');
    popover.setAttribute('aria-hidden', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    window.removeEventListener('scroll', placePopover);
    window.removeEventListener('resize', placePopover);
  }

  // Toggle on trigger click / enter key
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover.classList.contains('active')) {
      closePopover();
    } else {
      openPopover();
    }
  });

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (popover.classList.contains('active')) {
        closePopover();
      } else {
        openPopover();
      }
    }
  });

  // Month navigation
  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth--;
      if (viewMonth < 0) {
        viewMonth = 11;
        viewYear--;
      }
      renderCalendar();
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      viewMonth++;
      if (viewMonth > 11) {
        viewMonth = 0;
        viewYear++;
      }
      renderCalendar();
    });
  }

  // Quick selection pills
  quickPills.forEach(pill => {
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = pill.dataset.quick;
      let target;

      if (type === 'today') {
        target = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate());
      } else if (type === 'tomorrow') {
        target = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate() + 1);
      } else if (type === 'opening') {
        target = new Date(2026, 9, 1); // 1st Oct, 2026 Opening
      } else {
        target = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate());
      }

      viewYear = target.getFullYear();
      viewMonth = target.getMonth();
      selectDate(target);
    });
  });

  // Clear button
  if (clearBtn) {
    clearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectedDate = null;
      if (hiddenInput) {
        hiddenInput.value = '';
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (displayInput) {
        displayInput.value = '';
        displayInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof window.updateEstimatorFromActive === 'function') {
        window.updateEstimatorFromActive();
      }
      renderCalendar();
    });
  }

  // Today button
  if (todayBtn) {
    todayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const todayDate = new Date(realToday.getFullYear(), realToday.getMonth(), realToday.getDate());
      viewYear = todayDate.getFullYear();
      viewMonth = todayDate.getMonth();
      selectDate(todayDate);
    });
  }

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && !trigger.contains(e.target)) {
      closePopover();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && popover.classList.contains('active')) {
      closePopover();
    }
  });

  // Default to today so stay count starts directly on move-in day
  if (hiddenInput && !hiddenInput.value && displayInput && !displayInput.value) {
    selectDate(minDate);
  } else {
    renderCalendar();
  }
}

/* ===================================================================
   12. "STEP INSIDE YOUR ROOM" INTERACTIVE HOTSPOT INSPECTOR
   =================================================================== */
function initRoomInspector() {
  const tabs = document.querySelectorAll('#inspectorTabs .inspector-tab-btn');
  const img = document.getElementById('inspectorImg');
  const roomName = document.getElementById('inspectorRoomName');
  const pins = document.querySelectorAll('.hotspot-pin');
  const badge = document.getElementById('spotBadge');
  const title = document.getElementById('spotTitle');
  const desc = document.getElementById('spotDesc');
  const specs = document.getElementById('spotSpecs');
  const card = document.getElementById('inspectorCard');

  if (!img || !pins.length) return;

  // Preset Room Data for Switcher
  const getRoomData = () => {
    const cfg = getHostelConfig();
    return {
      double: {
        name: 'Double Sharing Room',
        img: cfg.photos.doubleImg || DEFAULT_HOSTEL_CONFIG.photos.doubleImg
      },
      triple: {
        name: 'Triple Sharing Room',
        img: cfg.photos.tripleImg || DEFAULT_HOSTEL_CONFIG.photos.tripleImg
      }
    };
  };

  // Hotspot details data
  const HOTSPOT_DATA = {
    bed: {
      badge: '<i class="fa-solid fa-star"></i> Featured Amenity',
      title: 'Orthopaedic Spring Bed & Fresh Linen',
      desc: '8-inch thick orthopaedic mattress designed for optimal spinal support after long study or work hours. Fitted with 100% breathable cotton sheets, plush pillow, and dual USB charging sockets right by your pillow.',
      specs: [
        '8-inch Orthopaedic Spring Mattress',
        'Dual High-Speed USB Charging Ports',
        'Personal Night Reading Spotlight',
        'Fresh Washed Linen Bi-weekly'
      ]
    },
    desk: {
      badge: '<i class="fa-solid fa-laptop-code"></i> Focus & Productivity',
      title: 'Ergonomic Study Desk & High-Speed LAN',
      desc: 'Custom timber study workstation featuring an anti-glare task lamp, ergonomic mesh back chair for all-night coding or study sessions, and direct 300 Mbps low-latency Gigabit Ethernet LAN port.',
      specs: [
        'Direct Cat6 Gigabit LAN Port (300 Mbps)',
        'Ergonomic Breathable Mesh Chair',
        'Anti-Glare Warm LED Task Lamp',
        'Spacious 4ft Scratch-Resistant Surface'
      ]
    },
    wardrobe: {
      badge: '<i class="fa-solid fa-shield-halved"></i> Secure Storage',
      title: 'Personal Steel Wardrobe with Godrej Lock',
      desc: 'Spacious individual 3-tier powder-coated steel wardrobe equipped with dedicated hanger rod, internal concealed locker box with individual Godrej key lock, and footwear compartment.',
      specs: [
        'Independent Heavy-Duty Godrej Lock',
        'Concealed Valuables Vault Inside',
        'Full-Length Dress Mirror on Inner Door',
        'Deep Shoe & Luggage Compartment'
      ]
    },
    bath: {
      badge: '<i class="fa-solid fa-droplet"></i> Hygiene & Comfort',
      title: 'En-suite Attached Washroom & Geyser',
      desc: 'Spotless private attached bathroom with anti-skid ceramic tiles, instant 25L hot water geyser, premium chrome fixtures, and daily deep sanitation and fragrance maintenance.',
      specs: [
        '24/7 Hot Water Instant Geyser',
        'Western Commode with Jet Spray',
        'Daily Disinfection & Cleaning Service',
        'Anti-Skid Matte Floor Tiles'
      ]
    },
    balcony: {
      badge: '<i class="fa-solid fa-wind"></i> Natural Airflow',
      title: 'Private Ventilated Balcony & City View',
      desc: 'Wide airy sliding balcony with safety grill overlooking lush Hanamkonda greenery. Perfect for morning tea, refreshing fresh breeze, and personal clothes-drying rack.',
      specs: [
        'Unobstructed Natural Sunlight & Cross-Ventilation',
        'Dedicated Stainless Steel Clothes Drying Rack',
        'Heavy-Duty Powder Coated Safety Grill',
        'Peaceful Greenery & Sunset View'
      ]
    }
  };

  // Tab switching with smooth fade
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const rKey = tab.dataset.room;
      const roomData = getRoomData();
      if (roomData[rKey]) {
        img.style.opacity = '0.35';
        setTimeout(() => {
          img.src = roomData[rKey].img;
          if (roomName) roomName.textContent = roomData[rKey].name;
          img.style.opacity = '1';
        }, 180);
      }
    });
  });

  // Hotspot pin click
  pins.forEach(pin => {
    pin.addEventListener('click', () => {
      pins.forEach(p => p.classList.remove('active'));
      pin.classList.add('active');
      const spotKey = pin.dataset.spot;
      const data = HOTSPOT_DATA[spotKey];
      if (!data) return;

      if (card) {
        card.style.transform = 'translateY(-6px)';
        setTimeout(() => { card.style.transform = ''; }, 220);
      }

      if (badge) badge.innerHTML = data.badge;
      if (title) title.textContent = data.title;
      if (desc) desc.textContent = data.desc;
      if (specs) {
        specs.innerHTML = data.specs
          .map(s => `<div class="spec-item"><i class="fa-solid fa-check"></i> ${s}</div>`)
          .join('');
      }
    });
  });
}


/* ===================================================================
   14. FRAMER MOTION PHYSICS SCROLL OBSERVER (STAGGERED CHILDREN)
   =================================================================== */
function initMotionReveals() {
  // Stagger grid containers automatically
  const gridContainers = document.querySelectorAll(
    '.transit-grid-cards, .facilities-grid, .gallery-grid, .rules-grid, .contact-grid, .calc-grid, .rooms-grid'
  );
  gridContainers.forEach(grid => {
    const children = Array.from(grid.children);
    children.forEach((child, idx) => {
      child.classList.add('motion-reveal');
      const delayIdx = (idx % 8) + 1;
      child.classList.add(`delay-${delayIdx}`);
    });
  });

  const elements = document.querySelectorAll(
    '.motion-reveal, .motion-reveal-scale, .routine-card, .room-card, .facility-card-compact, .stat-card, .section-header, .rule-item, .gallery-item, .contact-info-card, .map-card, .transit-stat-card, .option-card, .calc-summary-card'
  );
  if (!elements.length) return;

  elements.forEach((el, index) => {
    if (!el.classList.contains('motion-reveal') && !el.classList.contains('motion-reveal-scale')) {
      el.classList.add('motion-reveal');
      const delayIdx = (index % 6) + 1;
      el.classList.add(`delay-${delayIdx}`);
    }
  });

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.08,
    rootMargin: '0px 0px -40px 0px'
  });

  elements.forEach(el => observer.observe(el));
}

/* ===================================================================
   15. FRAMER MOTION INTERACTIVE 3D TILT & SPOTLIGHT CONTROLLER
   =================================================================== */
function initFramerMotionCards() {
  const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const cards = document.querySelectorAll(
    '.transit-stat-card, .facility-card-compact, .gallery-item, .contact-info-card, .map-card, .option-card, .room-card, .inspector-frame-card, .rule-item'
  );

  cards.forEach(card => {
    card.classList.add('spotlight-card');

    if (!isTouchDevice) {
      let isHovered = false;

      card.addEventListener('pointerenter', () => {
        isHovered = true;
      });

      card.addEventListener('pointermove', (e) => {
        if (!isHovered) return;
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Set spotlight CSS coordinates
        card.style.setProperty('--mouse-x', `${x}px`);
        card.style.setProperty('--mouse-y', `${y}px`);
      });

      card.addEventListener('pointerleave', () => {
        isHovered = false;
      });
    }
  });

  // Remove border-beam code entirely
}


/* ===================================================================
   16. GALLERY HORIZONTAL SCROLL-DRIVEN SHOWCASE
   =================================================================== */
function initGalleryScrollShowcase() {
  const track = document.getElementById('galleryScrollTrack');
  const grid = document.getElementById('galleryGrid');
  if (!track || !grid) return;

  /* On a phone this section is a native swipe carousel, not a scroll-jack.
     Panning the gallery sideways by stealing ~4.4 screens of vertical
     scroll is a desktop conceit: on touch you simply swipe the strip, and
     hijacking the scroll only makes the page feel stuck. The CSS turns the
     grid into a scroll-snap row at this width; all this has to do is keep
     JS from fighting it — no forced track height, no transform. */
  const mobileQuery = window.matchMedia('(max-width: 768px)');

  function releaseForTouch() {
    track.style.height = '';
    grid.style.transform = '';
  }

  let ticking = false;

  function updateGalleryScroll() {
    if (mobileQuery.matches) { releaseForTouch(); return; }
    const maxTranslate = Math.max(0, grid.scrollWidth - window.innerWidth + 80);
    const requiredHeight = window.innerHeight + maxTranslate;
    
    if (Math.abs(track.offsetHeight - requiredHeight) > 5) {
      track.style.height = `${requiredHeight}px`;
    }

    const rect = track.getBoundingClientRect();
    const scrollableDistance = Math.max(1, track.offsetHeight - window.innerHeight);
    
    if (rect.top > 0) {
      grid.style.transform = `translate3d(0, 0, 0)`;
      return;
    }
    
    if (rect.bottom < window.innerHeight) {
      grid.style.transform = `translate3d(-${maxTranslate}px, 0, 0)`;
      return;
    }

    let progress = -rect.top / scrollableDistance;
    progress = Math.max(0, Math.min(1, progress));
    
    const translateX = progress * maxTranslate;
    grid.style.transform = `translate3d(-${translateX}px, 0, 0)`;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        updateGalleryScroll();
        ticking = false;
      });
      ticking = true;
    }
  });

  // Rotating a phone or resizing across the breakpoint must hand control
  // back to whichever mode now applies.
  mobileQuery.addEventListener('change', () => {
    releaseForTouch();
    updateGalleryScroll();
  });

  // Re-calculate on resize
  window.addEventListener('resize', updateGalleryScroll);
  
  // Initial calculation
  updateGalleryScroll();
}/* ===================================================================
   14. AMENITIES & CODE OF CONDUCT UNIFIED TABS CONTROLLER
   =================================================================== */
function initAmenitiesRulesTabs() {
  const tabBtns = document.querySelectorAll('#amenitiesRulesTabs .tab-pill-btn');
  const panes = document.querySelectorAll('.tab-content-pane');

  if (!tabBtns.length || !panes.length) return;

  function switchTab(targetId) {
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === targetId);
    });

    panes.forEach(pane => {
      if (pane.id === targetId) {
        pane.style.display = 'block';
        pane.classList.add('active');
      } else {
        pane.style.display = 'none';
        pane.classList.remove('active');
      }
    });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // Support direct hash navigation for #rules or #facilities
  function handleHash() {
    const hash = window.location.hash;
    if (hash === '#rules' || hash === '#conduct') {
      switchTab('tab-conduct');
      const sec = document.getElementById('facilities');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    } else if (hash === '#facilities' || hash === '#amenities') {
      switchTab('tab-amenities');
    }
  }

  window.addEventListener('hashchange', handleHash);
  if (window.location.hash) {
    setTimeout(handleHash, 100);
  }

  // Intercept any internal links targeting #rules or #facilities
  document.querySelectorAll('a[href="#rules"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('tab-conduct');
      const sec = document.getElementById('facilities');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.querySelectorAll('a[href="#facilities"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab('tab-amenities');
      const sec = document.getElementById('facilities');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    });
  });
}

/* ===================================================================
   15. SCROLL-DRIVEN ANIMATED ROUTINE SHOWCASE CONTROLLER (PHYSICAL CONTINUOUS INTERPOLATION)
   =================================================================== */
function initRoutineScrollShowcase() {
  const container = document.getElementById('routineScrollContainer');
  const cards = document.querySelectorAll('.routine-story-card');
  const navPills = document.querySelectorAll('.routine-nav-pill');
  const stepDots = document.querySelectorAll('.r-step-dot');
  const progressBar = document.getElementById('routineProgressBar');
  const prevBtn = document.getElementById('rPrevBtn');
  const nextBtn = document.getElementById('rNextBtn');

  if (!container || !cards.length) return;

  const totalCards = cards.length;
  let activeIndex = 0;
  let ticking = false;

  /* On a phone this is a swipe carousel, not a scroll-jacked stack. The
     cards are absolutely stacked and cross-faded by scroll position,
     which needs ~2 screens of scroll to step through six of them. The
     CSS lays them out as a snap-scrolling row at this width; this stops
     the JS writing the stacking transforms and opacities over it, and
     keeps the nav pills in sync with whichever card is swiped into view. */
  const routineMobileQuery = window.matchMedia('(max-width: 768px)');

  function clearRoutineInlineStyles() {
    cards.forEach(c => {
      c.style.transform = '';
      c.style.opacity = '';
      c.style.zIndex = '';
      c.style.pointerEvents = '';
    });
  }

  function syncPillsToScroll() {
    const stage = document.querySelector('.routine-card-stage');
    if (!stage) return;
    const idx = Math.round(stage.scrollLeft / Math.max(1, stage.clientWidth * 0.86));
    const clamped = Math.max(0, Math.min(totalCards - 1, idx));
    if (clamped === activeIndex) return;
    activeIndex = clamped;
    navPills.forEach((pill, i) => pill.classList.toggle('active', i === activeIndex));
    stepDots.forEach((dot, i) => dot.classList.toggle('active', i === activeIndex));
    if (progressBar && totalCards > 1) {
      progressBar.style.width = `${(activeIndex / (totalCards - 1)) * 100}%`;
    }
  }

  // Render cards at continuous floating progress p in [0, totalCards - 1]
  function renderContinuousProgress(p) {
    if (routineMobileQuery.matches) { clearRoutineInlineStyles(); return; }
    p = Math.max(0, Math.min(totalCards - 1, p));
    const closestIdx = Math.round(p);

    if (closestIdx !== activeIndex) {
      activeIndex = closestIdx;
      navPills.forEach((pill, idx) => pill.classList.toggle('active', idx === activeIndex));
      stepDots.forEach((dot, idx) => dot.classList.toggle('active', idx === activeIndex));
    }

    if (progressBar) {
      const pct = totalCards > 1 ? (p / (totalCards - 1)) * 100 : 0;
      progressBar.style.width = `${pct}%`;
    }

    cards.forEach((card, i) => {
      const diff = i - p; // distance from current scroll position

      if (Math.abs(diff) < 1.05) {
        // Card is active or transitioning
        card.classList.add('active');
        let translateY = 0;
        let scale = 1;
        let opacity = 1;
        let zIndex = 10;

        if (diff > 0) {
          // Incoming card from bottom
          translateY = diff * 100; // moves from 100% down to 0%
          scale = 0.94 + 0.06 * (1 - diff);
          opacity = Math.min(1, Math.max(0, 1 - (diff - 0.2) * 1.5));
          zIndex = 10 + i;
        } else if (diff < 0) {
          // Outgoing card sliding up
          const absDiff = Math.abs(diff);
          translateY = -absDiff * 45; // slightly slides up
          scale = 1 - absDiff * 0.08;
          opacity = Math.max(0, 1 - absDiff * 1.6);
          zIndex = 10 - Math.round(absDiff * 5);
        } else {
          translateY = 0;
          scale = 1;
          opacity = 1;
          zIndex = 20;
        }

        card.style.transform = `translate3d(0, ${translateY.toFixed(2)}%, 0) scale(${scale.toFixed(4)})`;
        card.style.opacity = opacity.toFixed(3);
        card.style.zIndex = zIndex;
        card.style.visibility = opacity > 0.01 ? 'visible' : 'hidden';
        card.style.pointerEvents = Math.abs(diff) < 0.4 ? 'auto' : 'none';
      } else if (diff >= 1.05) {
        // Future card waiting below
        card.classList.remove('active');
        card.style.transform = 'translate3d(0, 110%, 0) scale(0.92)';
        card.style.opacity = '0';
        card.style.visibility = 'hidden';
        card.style.pointerEvents = 'none';
        card.style.zIndex = '1';
      } else {
        // Past card scrolled up
        card.classList.remove('active');
        card.style.transform = 'translate3d(0, -60%, 0) scale(0.88)';
        card.style.opacity = '0';
        card.style.visibility = 'hidden';
        card.style.pointerEvents = 'none';
        card.style.zIndex = '1';
      }
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      ticking = false;
      const rect = container.getBoundingClientRect();
      const windowH = window.innerHeight;
      const totalScrollable = container.offsetHeight - windowH;

      if (totalScrollable <= 0) {
        renderContinuousProgress(0);

  // Swipe drives the pills on mobile; the scroll handler does on desktop.
  const routineStage = document.querySelector('.routine-card-stage');
  if (routineStage) {
    routineStage.addEventListener('scroll', () => {
      if (routineMobileQuery.matches) syncPillsToScroll();
    }, { passive: true });
  }

  routineMobileQuery.addEventListener('change', () => {
    clearRoutineInlineStyles();
    if (!routineMobileQuery.matches) window.dispatchEvent(new Event('scroll'));
  });
        return;
      }

      // Compute exact continuous scroll progress
      const scrollProgress = -rect.top / totalScrollable;
      const clampedProgress = Math.max(0, Math.min(1, scrollProgress));
      const continuousIndex = clampedProgress * (totalCards - 1);

      renderContinuousProgress(continuousIndex);
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });

  function jumpToStep(targetIdx) {
    if (targetIdx < 0 || targetIdx >= totalCards) return;
    const containerTop = container.getBoundingClientRect().top + window.scrollY;
    const totalScrollable = container.offsetHeight - window.innerHeight;
    const targetScroll = containerTop + (targetIdx / (totalCards - 1)) * totalScrollable;

    window.scrollTo({
      top: targetScroll,
      behavior: 'smooth'
    });
  }

  navPills.forEach((pill, idx) => {
    pill.addEventListener('click', () => jumpToStep(idx));
  });

  stepDots.forEach((dot, idx) => {
    dot.addEventListener('click', () => jumpToStep(idx));
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      const prevIdx = Math.max(0, activeIndex - 1);
      jumpToStep(prevIdx);
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const nextIdx = Math.min(totalCards - 1, activeIndex + 1);
      jumpToStep(nextIdx);
    });
  }

  // Initial render on boot
  onScroll();
}

/* ===================================================================
   17. CINEMATIC HERO SCROLL ANIMATION
   =================================================================== */
/* The stem of the "o" is roughly 12px wide on a 1280px screen, so it only
   fills the viewport once it is scaled past about 110x — below that its
   edge is still crossing the screen when the mask fades, which is what
   read as a stray dark curve at the end of the hero. 60 was chosen when a
   larger value blanked the compositor; that no longer reproduces (verified
   at 100 and 160 in current Chrome), so this is sized to the viewport with
   a ceiling rather than a flat cap. */
const MAX_TEXT_ZOOM = 170;

function initCinematicHero() {
  const track = document.getElementById('cinematicScrollTrack');
  const stickyStage = document.getElementById('cinematicStickyStage');
  const bgImg = document.getElementById('cinematicBgImg');
  const maskLayer = document.getElementById('cinematicMaskLayer');
  const textEl = document.getElementById('cinematicText');
  const zoomTarget = document.getElementById('zoomTarget');

  if (!track || !stickyStage || !bgImg || !maskLayer || !textEl || !zoomTarget) return;

  /* On a phone the hero is a plain picture with the title on it — no
     scroll-driven zoom. The effect needs a tall scroll track to play out,
     and spending two screens of a phone's scroll on an intro before any
     content appears is the wrong trade. The CSS lays out the static
     version at this width; this keeps the scroll handler from writing
     inline transforms and opacities over it. */
  const heroMobileQuery = window.matchMedia('(max-width: 768px)');

  function clearHeroInlineStyles() {
    for (const el of [bgImg, textEl, maskLayer, stickyStage]) {
      el.style.transform = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    }
    textEl.style.transformOrigin = '';
  }

  function calculateZoomOrigin() {
    if (heroMobileQuery.matches) return;
    const prevTransform = textEl.style.transform;
    textEl.style.transform = 'none';
    
    const targetRect = zoomTarget.getBoundingClientRect();
    const textRect = textEl.getBoundingClientRect();
    
    /* The mask blends with mix-blend-mode: multiply, so WHITE text is the
       hole the photo shows through and the dark counter of the "o" is
       opaque. The origin therefore belongs on the letter's stroke, not in
       the middle of its bowl — 18%/52% puts it on the left stem. */
    const targetCenterX = targetRect.left + (targetRect.width * 0.18);
    const targetCenterY = targetRect.top + (targetRect.height * 0.52);
    
    // Percentage relative to textEl's own dimensions (guaranteed exact sub-pixel scaling)
    const originXPercent = ((targetCenterX - textRect.left) / textRect.width) * 100;
    const originYPercent = ((targetCenterY - textRect.top) / textRect.height) * 100;
    
    // Set transform-origin on textEl directly to this entrance area
    textEl.style.transformOrigin = `${originXPercent.toFixed(3)}% ${originYPercent.toFixed(3)}%`;
    
    if (prevTransform && prevTransform !== 'none') {
      textEl.style.transform = prevTransform;
    }
  }

  // Pre-calculate on load, when fonts finish rendering, and on resize
  calculateZoomOrigin();
  if (document.fonts) {
    document.fonts.ready.then(calculateZoomOrigin);
  }
  window.addEventListener('resize', calculateZoomOrigin);

  let ticking = false;

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (heroMobileQuery.matches) { clearHeroInlineStyles(); ticking = false; return; }
        const rect = track.getBoundingClientRect();
        
        // If we are past the track
        if (rect.bottom < window.innerHeight) {
          bgImg.style.opacity = '1';
          bgImg.style.transform = 'scale(1.2)';
          textEl.style.transform = `scale(${MAX_TEXT_ZOOM})`;
          maskLayer.style.opacity = '0';
          maskLayer.style.pointerEvents = 'none';
          stickyStage.style.opacity = '0';
          stickyStage.style.pointerEvents = 'none';
          ticking = false;
          return;
        }

        // If we are before the track
        if (rect.top > 0) {
          bgImg.style.opacity = '0';
          bgImg.style.transform = 'scale(1.05)';
          textEl.style.transform = 'scale(1)';
          maskLayer.style.opacity = '1';
          maskLayer.style.pointerEvents = 'auto';
          stickyStage.style.opacity = '1';
          stickyStage.style.pointerEvents = 'auto';
          ticking = false;
          return;
        }

        // Inside the track!
        const scrollDistance = track.offsetHeight - window.innerHeight;
        let p = -rect.top / scrollDistance; // 0 to 1
        p = Math.max(0, Math.min(1, p));

        // Ensure stage is visible
        stickyStage.style.pointerEvents = 'auto';

        /* === STAGE 1: TEXT MASK ZOOM (0.0 to 0.5) === */
        if (p < 0.5) {
          // Fade in image (0.0 to 0.08)
          let imgOpacity = Math.min(1, p * 12.5); 
          bgImg.style.opacity = imgOpacity.toFixed(2);
          
          // Zoom text mask (0.05 to 0.45) directly through the "o"
          let txtProgress = Math.max(0, Math.min(1, (p - 0.05) / 0.4));
          // Capped at 60x: past this the layer exceeds the GPU's max texture
          // size, the compositor drops it, and the whole page stops painting
          // (blank hero, missing header, unpainted modals). The mask fades to
          // 0 at p=0.48 regardless, so a bigger number bought nothing.
          const scale = 1 + Math.pow(txtProgress, 4) * (MAX_TEXT_ZOOM - 1);
          textEl.style.transform = `scale(${scale.toFixed(2)})`;
          
          /* Fade the mask only AFTER the zoom has finished (txtProgress
             hits 1 at p=0.45). Fading from 0.40 meant the mask started
             going transparent at ~35x, while the rim of the "o" was still
             crossing the screen — you watched a letter dissolve instead of
             a window opening. Now it holds opaque until the hole is at
             full size, then clears over the last 5% of the stage. */
          let maskOpacity = p > 0.45 ? Math.max(0, 1 - ((p - 0.45) / 0.05)) : 1;
          maskLayer.style.opacity = maskOpacity.toFixed(2);
          maskLayer.style.pointerEvents = maskOpacity === 0 ? 'none' : 'auto';
          
          stickyStage.style.opacity = '1';
          bgImg.style.transform = `scale(1.05)`;
        } 
        /* === STAGE 2: EXTERIOR REVEAL & TRANSITION (0.5 to 1.0) === */
        else {
          maskLayer.style.opacity = '0';
          maskLayer.style.pointerEvents = 'none';
          
          // Subtle zoom on exterior image
          let zoomProgress = (p - 0.5) / 0.5;
          bgImg.style.transform = `scale(${(1.05 + zoomProgress * 0.15).toFixed(2)})`;
          
          // Fade out the entire hero stage (0.85 to 1.0) for smooth transition into gallery
          let fadeOut = Math.max(0, Math.min(1, (p - 0.85) / 0.15));
          stickyStage.style.opacity = (1 - fadeOut).toFixed(2);
        }

        ticking = false;
      });
      ticking = true;
    }
  });
  
  heroMobileQuery.addEventListener('change', () => {
    clearHeroInlineStyles();
    calculateZoomOrigin();
    window.dispatchEvent(new Event('scroll'));
  });

  // Trigger initial calculation
  window.dispatchEvent(new Event('scroll'));
}


/* ===================================================================
   32. FOOTER QUICK LINKS CALCULATOR AUTO-SELECT
   =================================================================== */
function initFooterCalcLinks() {
  const footerLinks = document.querySelectorAll('.footer-calc-link');
  footerLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      // The browser natively handles scrolling to #calculator because of the href.
      // We just need to intercept and trigger the button clicks.
      const roomVal = link.getAttribute('data-room');
      const climateVal = link.getAttribute('data-climate');

      if (roomVal) {
        const roomBtn = document.querySelector(`#calcRoomOptions .option-card[data-value="${roomVal}"]`);
        if (roomBtn) roomBtn.click();
      }

      if (climateVal) {
        const climateRadio = document.querySelector(`input[name="calcClimate"][value="${climateVal}"]`);
        if (climateRadio) {
          climateRadio.checked = true;
          // Dispatch change event so the listener in initRoomCalculator runs
          climateRadio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  });
}

/* ===================================================================
   33. DIRECT WHATSAPP MINI POPUP WINDOW
   =================================================================== */
function openDirectWhatsAppPopup() {
  const sel = typeof window.getCalculatorSelection === 'function'
    ? window.getCalculatorSelection()
    : { roomName: '2 Sharing', climate: 'Non-AC', duration: '1 Month', effectiveMonthly: '₹8,500' };

  const dispDeposit = document.getElementById('dispSecurityDeposit');
  const depositText = dispDeposit ? dispDeposit.textContent.trim() : '₹1,000';
  const monthlyText = sel.effectiveMonthly || '₹8,500';

  const message = sel.isDaily
    ? `Hi Chaitanya Mens PG & Hostel Manager, I'm interested in reserving a bed for ${sel.roomName} (${sel.climate}), duration: ${sel.duration} (Tariff: ${monthlyText}, Deposit: ${depositText}). Are beds available?`
    : `Hi Chaitanya Mens PG & Hostel Manager, I'm interested in reserving a bed for ${sel.roomName} (${sel.climate}), duration: ${sel.duration} (Rent: ${monthlyText}/mo, Deposit: ${depositText}). Are beds available?`;

  const waUrl = `https://api.whatsapp.com/send?phone=919949785344&text=${encodeURIComponent(message)}`;

  const width = 500;
  const height = 720;
  const left = Math.max(0, Math.round((window.screen.width - width) / 2));
  const top = Math.max(0, Math.round((window.screen.height - height) / 2));

  // Open WhatsApp directly in a dedicated floating mini window
  const popup = window.open(
    waUrl,
    'WhatsAppManagerChat',
    `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,resizable=yes,status=no,toolbar=no,menubar=no,location=no`
  );

  if (popup && popup.focus) {
    popup.focus();
  }
}

function initDirectWhatsAppPopup() {
  const triggers = document.querySelectorAll('#chatWithManagerBtn, .header-concierge-btn, [data-open-manager-chat]');
  triggers.forEach(trig => {
    trig.addEventListener('click', (e) => {
      e.preventDefault();
      openDirectWhatsAppPopup();
    });
  });
}


