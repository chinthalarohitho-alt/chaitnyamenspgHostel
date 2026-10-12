/**
 * Booking invoice as a PDF.
 *
 * Built with pdf-lib (pure JS, no headless browser — Edge Functions have
 * no Chrome). Laid out by hand in points: 1pt = 1/72 inch, origin is the
 * BOTTOM-left of the page, so y decreases as you move down.
 *
 * Deliberately uses only the standard Helvetica faces. Embedding a font
 * would add ~300 KB to every email for no real gain.
 */
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import type { Booking, Hostel } from "./template.ts";
import { getLogoPngBytes } from "./logo-data.ts";

const NAVY       = rgb(0.067, 0.094, 0.153); // #111827 Midnight Navy
const GOLD       = rgb(0.788, 0.643, 0.361); // #C9A45C Champagne Gold
const CHARCOAL   = rgb(0.122, 0.161, 0.216); // #1F2937 Charcoal
const SLATE      = rgb(0.420, 0.447, 0.502); // #6B7280 Slate
const BORDER     = rgb(0.851, 0.871, 0.906); // #D9DEE7 Cool Gray
const IVORY      = rgb(0.980, 0.976, 0.965); // #FAF9F6 Warm Ivory
const DEEP_GREEN = rgb(0.086, 0.502, 0.353); // #16805A Deep Green
const AMBER      = rgb(0.718, 0.475, 0.122); // #B7791F Amber

const A4 = { w: 595.28, h: 841.89 };
const M = 48;                              // page margin

export interface InvoiceOpts {
  paid?: boolean;
  tokenAmount?: number;                    // rupees
  utr?: string | null;
  pricing?: Record<string, unknown>;
}

function getOrdinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function calculateStayPeriod(
  startDateStr: string | null | undefined,
  durationStr: string | null | undefined,
): string | null {
  if (!startDateStr || startDateStr === "-") return null;
  let d: Date | null = null;
  const isoM = String(startDateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoM) {
    d = new Date(parseInt(isoM[1], 10), parseInt(isoM[2], 10) - 1, parseInt(isoM[3], 10));
  } else {
    const m = String(startDateStr).match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
    if (m) {
      const day = parseInt(m[1], 10);
      const monthStr = m[2].toLowerCase().substring(0, 3);
      const year = parseInt(m[3], 10);
      const months: Record<string, number> = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      };
      const month = months[monthStr] !== undefined ? months[monthStr] : 0;
      d = new Date(year, month, day);
    } else {
      const parsed = new Date(startDateStr);
      if (!isNaN(parsed.getTime())) {
        d = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      }
    }
  }
  if (!d) return null;

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmt = (dt: Date) => `${dt.getDate()} ${monthNames[dt.getMonth()]}, ${dt.getFullYear()}`;
  const durStr = String(durationStr ?? "1 Month");
  const isDaily = durStr.toLowerCase().includes("day");

  if (isDaily) {
    const rawDays = parseInt(durStr.replace(/[^\d]/g, ""), 10);
    const days = (!isNaN(rawDays) && rawDays > 0) ? rawDays : 1;
    const startFmt = fmt(d);
    if (days <= 1) {
      return `${startFmt} (1 Day - starts ${getOrdinal(d.getDate())})`;
    }
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (days - 1));
    return `${startFmt} to ${fmt(end)} (${days} Days - starts ${getOrdinal(d.getDate())})`;
  } else {
    const rawMonths = parseInt(durStr.replace(/[^\d]/g, ""), 10);
    const months = (!isNaN(rawMonths) && rawMonths > 0) ? rawMonths : 1;
    const startFmt = fmt(d);
    const maxDayInTargetMonth = new Date(d.getFullYear(), d.getMonth() + months + 1, 0).getDate();
    const desiredDay = Math.min(d.getDate() - 1, maxDayInTargetMonth);
    const end = desiredDay <= 0
      ? new Date(d.getFullYear(), d.getMonth() + months, 0)
      : new Date(d.getFullYear(), d.getMonth() + months, desiredDay);

    return `${startFmt} to ${fmt(end)} (${months} Month${months > 1 ? "s" : ""} - starts ${getOrdinal(d.getDate())})`;
  }
}

export async function buildInvoicePdf(
  b: Booking,
  h: Hostel,
  opts: InvoiceOpts = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${b.ref}`);
  doc.setSubject(`Booking enquiry — ${h.name}`);
  doc.setProducer(h.name);

  const page = doc.addPage([A4.w, A4.h]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const reg = await doc.embedFont(StandardFonts.Helvetica);

  const text = (
    s: string,
    x: number,
    y: number,
    size = 10,
    font = reg,
    color = CHARCOAL,
  ) => page.drawText(s ?? "", { x, y, size, font, color });

  /** Right-aligned text, for the value column. */
  const textR = (s: string, xRight: number, y: number, size = 10, font = reg, color = CHARCOAL) => {
    const w = font.widthOfTextAtSize(s ?? "", size);
    page.drawText(s ?? "", { x: xRight - w, y, size, font, color });
  };

  const rule = (y: number, x1 = M, x2 = A4.w - M, color = BORDER, thickness = 0.75) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });

  // ---------- header band ----------
  const headerH = 100;
  page.drawRectangle({ x: 0, y: A4.h - headerH, width: A4.w, height: headerH, color: NAVY });
  page.drawRectangle({ x: 0, y: A4.h - headerH, width: A4.w, height: 2.5, color: GOLD });

  let logoImage = null;
  try {
    const logoBytes = getLogoPngBytes();
    if (logoBytes && logoBytes.length > 0) {
      logoImage = await doc.embedPng(logoBytes);
    }
  } catch (err) {
    console.warn("Logo embed failed:", err);
  }

  if (logoImage) {
    const logoH = 58;
    const logoW = Math.round(logoH * (922 / 380));
    const logoY = A4.h - headerH + Math.round((headerH - logoH) / 2) + 1;
    page.drawImage(logoImage, { x: M, y: logoY, width: logoW, height: logoH });
    text("Executive Living & Student PG", M + logoW + 16, A4.h - 44, 9.5, bold, rgb(0.96, 0.97, 0.98));
    text("Naimnagar, Hanamkonda · Telangana", M + logoW + 16, A4.h - 59, 8.5, reg, rgb(0.75, 0.78, 0.82));
    text("STAY  |  STUDY  |  GROW", M + logoW + 16, A4.h - 73, 8, bold, GOLD);
  } else {
    text(h.name, M, A4.h - 52, 17, bold, rgb(1, 1, 1));
    text("Mens PG & Hostel  ·  Hanamkonda", M, A4.h - 72, 9.5, reg, rgb(0.75, 0.78, 0.82));
  }

  textR("INVOICE", A4.w - M, A4.h - 44, 16, bold, rgb(1, 1, 1));
  textR(b.ref, A4.w - M, A4.h - 60, 11, bold, GOLD);
  const statusBadge = opts.paid ? "TOKEN RECEIVED" : "AWAITING TOKEN";
  textR(statusBadge, A4.w - M, A4.h - 74, 8, bold, opts.paid ? rgb(0.45, 0.88, 0.65) : rgb(0.92, 0.78, 0.52));

  let y = A4.h - headerH - 36;

  // ---------- meta ----------
  const issued = new Date(b.created_at ?? Date.now()).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
  text("Issued", M, y, 8.5, bold, SLATE);
  text(issued, M, y - 15, 10.5, bold, CHARCOAL);
  text("Status", A4.w / 2, y, 8.5, bold, SLATE);
  const status = opts.paid ? "Token received" : "Awaiting token";
  text(status, A4.w / 2, y - 15, 10.5, bold, opts.paid ? DEEP_GREEN : AMBER);

  y -= 46;
  rule(y);
  y -= 26;

  // ---------- billed to ----------
  text("BILLED TO", M, y, 8.5, bold, NAVY);
  y -= 17;
  text(b.name, M, y, 11.5, bold, CHARCOAL);
  y -= 15;
  text(b.phone, M, y, 10, reg, SLATE);
  if (b.email) { y -= 14; text(b.email, M, y, 10, reg, SLATE); }
  if (b.workplace) { y -= 14; text(b.workplace, M, y, 10, reg, SLATE); }

  y -= 32;
  rule(y);
  y -= 24;

  // ---------- dynamic pricing calculation ----------
  const p = opts.pricing ?? {};
  const roomStr = String(b.room ?? "").toLowerCase();
  let baseRent = Number(p.doubleBase) || 8500;
  let acAdd = Number(p.doubleAcAdd) || 1500;
  if (roomStr.includes("5") || roomStr.includes("five")) {
    baseRent = Number(p.fiveBase) || 4800;
    acAdd = Number(p.fiveAcAdd) || 600;
  } else if (roomStr.includes("4") || roomStr.includes("four")) {
    baseRent = Number(p.fourBase) || 5500;
    acAdd = Number(p.fourAcAdd) || 800;
  } else if (roomStr.includes("3") || roomStr.includes("triple")) {
    baseRent = Number(p.tripleBase) || 6500;
    acAdd = Number(p.tripleAcAdd) || 1000;
  }
  const isAc = roomStr.includes("ac") && !roomStr.includes("non");
  const monthlyRent = baseRent + (isAc ? acAdd : 0);
  const durStr = String(b.duration ?? "1 Month");
  const isDaily = durStr.toLowerCase().includes("day");
  let moveInTotal = 0;
  let rentLabel = "Monthly Rent";
  let rentValue = "";
  let depositValue = "";

  if (isDaily) {
    const durDays = parseInt(durStr.replace(/[^\d]/g, ""), 10) || 1;
    const dailyBase = Number(p.dailyRate) || 350;
    const dailyAc = Number(p.dailyAcAdd) || 100;
    const dailyRate = dailyBase + (isAc ? dailyAc : 0);
    const stayTariff = dailyRate * durDays;
    moveInTotal = stayTariff;
    rentLabel = "Daily Tariff Rate";
    rentValue = `Rs. ${dailyRate.toLocaleString("en-IN")} / day`;
    depositValue = "Rs. 0 (Waived for daily stay)";
  } else {
    const durMonths = parseInt(durStr.replace(/[^\d]/g, ""), 10) || 1;
    const secDeposit = (p.securityDeposit !== undefined && p.securityDeposit !== null)
      ? Number(p.securityDeposit)
      : 5400;
    moveInTotal = (monthlyRent * durMonths) + secDeposit;
    rentLabel = "Monthly Rent";
    rentValue = `Rs. ${monthlyRent.toLocaleString("en-IN")} / mo`;
    depositValue = `Rs. ${secDeposit.toLocaleString("en-IN")}`;
  }

  // ---------- booking table ----------
  text("DETAILS", M, y, 8.5, bold, NAVY);
  textR("VALUE", A4.w - M, y, 8.5, bold, NAVY);
  y -= 8;
  rule(y, M, A4.w - M, GOLD, 1.0);
  y -= 20;

  const rows: Array<[string, string]> = [
    ["Room", b.room ?? "-"],
    ["Preferred floor", b.floor ?? "Any Floor"],
    ["Move-in date", b.move_in_date ?? "-"],
  ];
  const computedStayPeriod = b.stay_period || calculateStayPeriod(b.move_in_date, b.duration);
  if (computedStayPeriod) {
    rows.push(["Stay period covered", computedStayPeriod]);
  }
  rows.push(["Stay duration", b.duration ?? "-"]);
  rows.push([rentLabel, rentValue]);
  rows.push(["Security Deposit", depositValue]);
  rows.push(["Total Move-In Charges", `Rs. ${moveInTotal.toLocaleString("en-IN")}`]);
  for (const [k, v] of rows) {
    text(k, M, y, 10, reg, CHARCOAL);
    textR(v, A4.w - M, y, 10, bold, CHARCOAL);
    y -= 13;
    rule(y + 4, M, A4.w - M, BORDER, 0.5);
    y -= 9;
  }

  // ---------- token / payment box ----------
  y -= 12;
  const amt = opts.tokenAmount && opts.tokenAmount > 0 ? opts.tokenAmount : moveInTotal;
  if (amt > 0) {
    page.drawRectangle({
      x: M, y: y - 52, width: A4.w - M * 2, height: 58,
      color: IVORY,
      borderColor: BORDER, borderWidth: 1,
    });
    text(opts.paid ? "MOVE-IN PAYMENT CONFIRMED" : "BOOKING CHARGES", M + 16, y - 12, 8.5, bold, GOLD);
    text(
      opts.paid ? "Received & verified — thank you" : "Payable to confirm your room",
      M + 16, y - 28, 9.5, reg, SLATE,
    );
    textR(`Rs. ${amt.toLocaleString("en-IN")}`, A4.w - M - 16, y - 24, 19, bold, NAVY);
    y -= 74;

    if (opts.utr) {
      text(`UPI reference: ${opts.utr}`, M, y, 9, reg, SLATE);
      y -= 18;
    }
  }

  // ---------- note ----------
  y -= 6;
  const note = opts.paid
    ? "Token received. Your bed is held pending the manager's final confirmation."
    : "This is an enquiry, not a confirmed booking. The manager will contact you to confirm bed availability.";
  for (const line of wrap(note, reg, 9.5, A4.w - M * 2)) {
    text(line, M, y, 9.5, reg, SLATE);
    y -= 13;
  }

  // ---------- footer ----------
  rule(M + 64, M, A4.w - M, BORDER, 0.8);
  text(h.name, M, M + 48, 9.5, bold, CHARCOAL);
  let fy = M + 35;
  for (const line of wrap(h.address, reg, 8.5, A4.w - M * 2)) {
    text(line, M, fy, 8.5, reg, SLATE);
    fy -= 11;
  }
  text(`Phone: ${h.phone}`, M, fy - 2, 8.5, reg, SLATE);
  textR("Computer generated — no signature required.", A4.w - M, M + 48, 8, reg, SLATE);

  return await doc.save();
}

/** Greedy word wrap against the real measured glyph widths. */
function wrap(s: string, font: { widthOfTextAtSize(t: string, n: number): number }, size: number, maxW: number): string[] {
  const words = (s ?? "").split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > maxW && line) {
      out.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}
