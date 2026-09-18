# UPI booking token — free, no gateway

Filters out non-serious enquiries by asking for a small token. The guest pays
**straight into your UPI id**, so no gateway sits in the middle and nothing is
deducted. Razorpay would have taken 2% + GST (₹11.80 on a ₹500 token); this
takes ₹0.

## Turning it on

Manager portal → **Content & Text** → *UPI ID for booking tokens*
→ enter your real UPI id (e.g. `yourname@okhdfcbank`) → **Save & Apply Live**.

Amount: **Room Pricing** → *Booking Token (₹)*, default ₹500.

Leaving the UPI id **blank keeps the whole block hidden** — the site never
shows a payment box you can't receive money into. It ships blank on purpose.

Then deploy the one function that records references:

```bash
supabase functions deploy submit-utr
```

## How it works

1. Guest submits the enquiry — **saved immediately**, before any payment
2. The confirmation modal shows the amount, a UPI QR, your UPI id, and on
   phones an "Open a UPI app" button (`upi://pay?...` intent)
3. Guest pays and types the 12-digit UTR their app shows
4. `submit-utr` stores it and marks the booking **pending**
5. You match that UTR against your own UPI notification and press
   **Verify** in the portal, which sets it to **paid**

## What this is, and isn't

It is a **commitment filter**. Someone idly filling in the form will not
transfer ₹500, which is the whole point.

It is **not proof of payment**. Nothing in this flow talks to a bank, so a
UTR is only a *claim* until you check it. That is why the portal says
"Claimed 4321…" with a Verify button rather than "Paid", and why the guest is
told the manager confirms before the bed is held. Do not treat a claimed UTR
as money received.

If you later want automatic verification, that needs a gateway — see the note
on Cashfree's 0% window in the chat history.

## Safeguards

- Visitors cannot mark anything paid: row level security rejects an insert
  claiming a paid status, and visitors have no UPDATE rights at all
  (verified: `42501` on both attempts)
- `submit-utr` only attaches a UTR to a booking that has none, so a guessed
  reference can't overwrite someone's confirmed payment
- Only accounts in the `managers` table can press Verify
- The UTR format is checked in the browser, in the function, and by a
  database constraint (`^[0-9]{12}$`)

## Payment never blocks the enquiry

The booking row is written first. If the guest closes the modal, ignores the
QR, or has no UPI app, you still get the enquiry and can follow up on
WhatsApp — it just shows **No token**.
