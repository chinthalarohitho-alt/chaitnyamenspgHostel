# send-invoice

Emails a booking invoice to the guest and the manager, from
**jareenaworks@gmail.com**, over Gmail SMTP.

Runs as a Supabase Edge Function so the App Password stays server-side.
A `VITE_`-prefixed secret would be inlined into the public JS bundle.

## Why it can't be an open relay

The request body carries only `{ "ref": "#CMPG-1234" }`. The function reads
the name, phone, room and **recipient address** from the `bookings` table using
the service role key. A caller cannot choose who gets mailed or what the mail
says. Bookings already marked `invoice_sent_at` are skipped, so retries and
double submits never send twice.

## One-time setup

**1. Create the Gmail App Password** (regular account password will not work —
Google blocks it for SMTP):

- Google Account → Security → turn on **2-Step Verification**
- Security → **App passwords** → app "Mail", device "Other" → name it *Hostel site*
- Copy the 16-character password (shown once, spaces don't matter)

**2. Set the secrets:**

```bash
supabase secrets set \
  GMAIL_USER=jareenaworks@gmail.com \
  GMAIL_APP_PASSWORD='xxxx xxxx xxxx xxxx' \
  ALLOWED_ORIGIN=https://chaitanya-mens-pg-hostel.vercel.app
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

**3. Deploy:**

```bash
supabase functions deploy send-invoice
```

## Test it

```bash
curl -X POST \
  https://tymigiyvevbxrjdalbls.supabase.co/functions/v1/send-invoice \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"ref":"#CMPG-3452"}'
```

Expect `{"ok":true,"sent":["…"],"failed":[]}`. To re-send during testing,
clear the flag first:

```sql
update public.bookings set invoice_sent_at = null where ref = '#CMPG-3452';
```

## Limits and behaviour

- Gmail allows roughly **500 messages/day** on a free account. Each booking
  sends up to 2 (guest + manager). Past that, move to a provider on a domain
  you own and keep `Reply-To: jareenaworks@gmail.com`.
- The guest email field is **optional**. No address given → only the manager
  is emailed, and the booking still succeeds.
- Sending is best-effort and never blocks the confirmation modal or the
  WhatsApp hand-off; a failure is logged and the enquiry is already saved.
- Hostel name, phone and address come from `site_config`, so the manager
  editing them updates the emails with no redeploy.

## Files

| File | |
|---|---|
| `index.ts` | handler: lookup, send, mark sent |
| `template.ts` | HTML + plain-text invoice (table layout, inline styles) |
