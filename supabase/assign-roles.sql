-- Optional repair script AFTER schema.sql.
-- Normal membership roles are chosen on the register page.
-- Highest admin is only tsengpinghsuan@gmail.com via the admin register form.
-- Use this file only to repair an existing classroom admin account.

insert into public.user_roles (user_id, role)
select id, role_name
from public.profiles
cross join (values ('buyer'), ('seller'), ('admin')) as extra(role_name)
where lower(email) = 'tsengpinghsuan@gmail.com'
on conflict do nothing;

-- Confirm:
-- select p.email, r.role
-- from public.profiles p
-- join public.user_roles r on r.user_id = p.id
-- order by p.email, r.role;
