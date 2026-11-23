-- Admin account management: read all roles, toggle buyer/seller only.
-- Highest admin role stays locked to the reserved signup flow.

drop policy if exists user_roles_select_admin on public.user_roles;
create policy user_roles_select_admin on public.user_roles
  for select
  to authenticated
  using ((select private.has_role('admin')));

create or replace function public.admin_set_role(
  target_user uuid,
  target_role text,
  enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception '請先登入';
  end if;
  if not private.has_role('admin') then
    raise exception '需要管理員角色';
  end if;
  if target_user is null then
    raise exception '找不到帳號';
  end if;
  if target_role is null or target_role not in ('buyer', 'seller') then
    raise exception '只能調整買家或賣家角色';
  end if;
  if not exists (select 1 from public.profiles p where p.id = target_user) then
    raise exception '找不到帳號';
  end if;
  if exists (select 1 from public.profiles p where p.id = target_user and p.deleted_at is not null) then
    raise exception '這個帳號已經刪除';
  end if;

  if enabled then
    insert into public.user_roles (user_id, role)
    values (target_user, target_role)
    on conflict do nothing;
  else
    delete from public.user_roles
    where user_id = target_user
      and role = target_role;
  end if;
end;
$$;

revoke all on function public.admin_set_role(uuid, text, boolean) from public;
grant execute on function public.admin_set_role(uuid, text, boolean) to authenticated;

notify pgrst, 'reload schema';
