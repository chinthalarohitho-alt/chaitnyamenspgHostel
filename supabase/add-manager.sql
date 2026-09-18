-- Grant manager access to an existing Supabase Auth user.
--
-- 1. Create the account first: Supabase dashboard -> Authentication -> Users
--    -> "Add user" -> tick "Auto Confirm User".
-- 2. Replace the email below and run this in the SQL Editor.
--
-- Being signed in is NOT enough to edit the site; only rows in this table
-- grant write access, and every policy re-checks it server-side.

insert into public.managers (user_id, email)
select id, email from auth.users
where email = 'REPLACE_WITH_MANAGER_EMAIL'
on conflict (user_id) do nothing;

-- Confirm it worked:
select m.email, m.created_at from public.managers m;

-- To revoke access later:
-- delete from public.managers where email = 'REPLACE_WITH_MANAGER_EMAIL';
