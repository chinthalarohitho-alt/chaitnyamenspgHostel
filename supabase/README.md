# Supabase setup

The hostel site talks to Supabase directly from the browser. There is no
backend server to run or deploy — `server.js` and `models/` are leftovers
from an unrelated "Drafts" project and are no longer used by this site.

## Files

| File | Purpose |
|---|---|
| `schema.sql` | Tables, row level security policies, realtime. Already applied. |
| `seed.sql` | Inserts the single `site_config` row. Already applied. |
| `add-manager.sql` | Grants manager access to an existing auth user. |

## How access works

| Who | Read config | Edit config | Submit enquiry | Read enquiries |
|---|---|---|---|---|
| Visitor (anon) | yes | **no** | yes | **no** |
| Signed in, not a manager | yes | **no** | yes | **no** |
| Signed in + row in `managers` | yes | yes | yes | yes |

Enforcement is in Postgres, not in JavaScript. Editing `app.js` in devtools
or calling the REST API by hand cannot get around it — the anon key is
public by design and carries no privileges of its own.

## Adding a manager

1. Supabase dashboard → Authentication → Users → **Add user**, tick
   *Auto Confirm User*.
2. Edit the email in `add-manager.sql` and run it in the SQL Editor.

On first sign-in the portal offers to set up an authenticator app
(Google Authenticator, Authy). Once enrolled, the 6-digit code is required
on every later sign-in.

## Two settings worth changing

- **Authentication → Providers → Email → disable "Allow new users to sign
  up".** Signup is currently open. RLS means a stray signup still cannot
  edit anything, but there is no reason to allow it.
- **Rotate the `service_role` key and database password** (Settings → API).
  They were shared in a chat transcript. Nothing in this app uses them —
  the site only needs `VITE_SUPABASE_ANON_KEY`.

## Deploying

Set these in Vercel → Project → Settings → Environment Variables:

```
VITE_SUPABASE_URL=https://tymigiyvevbxrjdalbls.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon key from .env>
```

Never add a `service_role` key with a `VITE_` prefix — Vite inlines every
`VITE_*` variable into the JavaScript bundle it ships to visitors.
