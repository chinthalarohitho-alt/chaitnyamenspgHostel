# Chaitanya Mens PG & Hostel

Public marketing site with a manager portal. Static front end + Supabase;
there is no application server to run or deploy.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # -> dist/
npm run preview  # serve the built site
```

Requires `.env` in the project root (already present):

```
VITE_SUPABASE_URL=…
VITE_SUPABASE_ANON_KEY=…
```

Only `VITE_*` variables reach the browser — and every `VITE_*` variable is
inlined into the public bundle. Never give a `service_role` key that prefix.

## Layout

```
src/                  the site (Vite root)
  index.html
  app.js              UI logic; talks to Supabase via supabase-client.js
  supabase-client.js  data + auth layer
  styles.css
  assets/             images imported by JS/CSS — Vite hashes these
  public/             copied verbatim to the site root (success-check.json)
supabase/             schema, seed, manager grant, setup notes
dist/                 build output (generated; not in source control)
```

### assets/ vs public/

Vite content-hashes anything in `src/assets/` referenced from HTML, CSS, or an
`import`. A bare `"assets/foo.jpg"` string sitting in JavaScript is **not**
rewritten and will 404 in a production build — import the file and use the
imported value instead. Files that must keep an exact URL (the Lottie JSON,
loaded by a web component) live in `src/public/` and are copied untouched.

## Manager portal

Reachable from the footer / drawer "Manager Portal" link. Sign in with Supabase
Auth; an authenticator app can be enrolled on first sign-in. Pricing, texts,
photos, bed inventory and booking enquiries are stored in Supabase, so a change
made by the manager is seen by every visitor.

See `supabase/README.md` for the access model and how to add a manager.
