-- Soft-delete accounts so order history FKs stay intact.
-- Optional reason is stored on the profile; login is blocked via auth ban.

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists delete_reason text not null default '',
  add column if not exists deleted_by uuid references public.profiles (id);

alter table public.profiles drop constraint if exists profiles_delete_reason_check;
alter table public.profiles add constraint profiles_delete_reason_check check (
  char_length(delete_reason) <= 200
);

grant select (
  id, email, display_name, created_at,
  phone, address,
  offers_meetup, meetup_note, offers_delivery, delivery_fee,
  deleted_at, delete_reason, deleted_by
) on public.profiles to authenticated;

create or replace function public.admin_delete_account(
  target_user uuid,
  reason text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_email text;
  note text := btrim(coalesce(reason, ''));
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
  if target_user = uid then
    raise exception '不能刪除目前登入的帳號';
  end if;
  if char_length(note) > 200 then
    raise exception '刪除原因太長';
  end if;

  select p.email into target_email
  from public.profiles p
  where p.id = target_user;

  if not found then
    raise exception '找不到帳號';
  end if;
  if lower(target_email) = 'tsengpinghsuan@gmail.com' then
    raise exception '不能刪除最高管理員帳號';
  end if;
  if exists (
    select 1 from public.profiles p
    where p.id = target_user and p.deleted_at is not null
  ) then
    raise exception '這個帳號已經刪除';
  end if;

  update public.profiles
  set
    deleted_at = now(),
    delete_reason = note,
    deleted_by = uid
  where id = target_user;

  update public.products
  set listing_status = 'hidden', updated_at = now()
  where seller_id = target_user
    and listing_status = 'active';

  delete from public.cart_items
  where user_id = target_user;

  update auth.users
  set banned_until = 'infinity'::timestamptz
  where id = target_user;
end;
$$;

revoke all on function public.admin_delete_account(uuid, text) from public;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

notify pgrst, 'reload schema';
