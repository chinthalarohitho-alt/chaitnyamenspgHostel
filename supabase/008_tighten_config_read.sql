-- ===================================================================
-- Stop exposing who last edited the config.
--
-- RLS gates rows, not columns, so the public read policy was handing out
-- updated_by — a manager's auth user id. Not a credential, but no reason
-- for it to be public. Column-level grants fix it: the site only ever
-- selects the four content columns.
-- ===================================================================

revoke select on public.site_config from anon;
grant  select (id, pricing, texts, photos, inventory) on public.site_config to anon;

-- Managers keep full visibility, including the audit fields.
grant select on public.site_config to authenticated;
