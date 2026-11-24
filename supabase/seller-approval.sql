-- Seller signup requires admin approval before seller role is granted.
-- Applied on project qdknbmwtltuhmbvxlvmq; keep in sync with handle_new_user.

alter table public.profiles
  add column if not exists seller_status text not null default 'none',
  add column if not exists seller_reviewed_at timestamptz,
  add column if not exists seller_reject_reason text not null default '';

alter table public.profiles
  drop constraint if exists profiles_seller_status_check;

alter table public.profiles
  add constraint profiles_seller_status_check
  check (seller_status in ('none', 'pending', 'approved', 'rejected'));

alter table public.profiles
  drop constraint if exists profiles_seller_reject_reason_len;

alter table public.profiles
  add constraint profiles_seller_reject_reason_len
  check (char_length(seller_reject_reason) <= 200);

update public.profiles p
set seller_status = 'approved',
    seller_reviewed_at = coalesce(p.seller_reviewed_at, now()),
    seller_reject_reason = ''
where exists (
  select 1 from public.user_roles r
  where r.user_id = p.id and r.role = 'seller'
)
and p.seller_status = 'none';

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  picked_name text;
  signup_kind text := lower(coalesce(new.raw_user_meta_data ->> 'signup_kind', 'buyer'));
  want_buyer boolean := false;
  want_seller boolean := false;
  seller_status text := 'none';
  admin_email text := 'tsengpinghsuan@gmail.com';
  user_email text := lower(coalesce(new.email, ''));
begin
  picked_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if picked_name is null then
    picked_name := nullif(split_part(coalesce(new.email, ''), '@', 1), '');
  end if;
  if picked_name is null then
    picked_name := 'user';
  end if;
  picked_name := left(picked_name, 40);

  if signup_kind = 'admin' then
    if user_email <> admin_email then
      raise exception '最高管理員只能使用指定信箱註冊';
    end if;
    want_buyer := true;
    want_seller := true;
    seller_status := 'approved';
  elsif signup_kind = 'seller' then
    if user_email = admin_email then
      raise exception '此信箱保留給最高管理員註冊';
    end if;
    want_seller := false;
    seller_status := 'pending';
  else
    if user_email = admin_email then
      raise exception '此信箱保留給最高管理員註冊';
    end if;
    want_buyer := true;
    signup_kind := 'buyer';
    seller_status := 'none';
  end if;

  insert into public.profiles (id, email, display_name, seller_status, seller_reviewed_at, seller_reject_reason)
  values (
    new.id,
    coalesce(new.email, ''),
    picked_name,
    seller_status,
    case when seller_status = 'approved' then now() else null end,
    ''
  );

  if want_buyer then
    insert into public.user_roles (user_id, role) values (new.id, 'buyer');
  end if;
  if want_seller then
    insert into public.user_roles (user_id, role) values (new.id, 'seller');
  end if;
  if signup_kind = 'admin' and user_email = admin_email then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;

  return new;
end;
$$;

create or replace function public.admin_review_seller(
  target_user uuid,
  approve boolean,
  reason text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  note text := left(btrim(coalesce(reason, '')), 200);
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
  if not exists (select 1 from public.profiles p where p.id = target_user) then
    raise exception '找不到帳號';
  end if;
  if exists (select 1 from public.profiles p where p.id = target_user and p.deleted_at is not null) then
    raise exception '這個帳號已經刪除';
  end if;

  if approve then
    update public.profiles
    set seller_status = 'approved',
        seller_reviewed_at = now(),
        seller_reject_reason = ''
    where id = target_user;

    insert into public.user_roles (user_id, role)
    values (target_user, 'seller')
    on conflict do nothing;
  else
    update public.profiles
    set seller_status = 'rejected',
        seller_reviewed_at = now(),
        seller_reject_reason = note
    where id = target_user;

    delete from public.user_roles
    where user_id = target_user
      and role = 'seller';
  end if;
end;
$$;

revoke all on function public.admin_review_seller(uuid, boolean, text) from public;
grant execute on function public.admin_review_seller(uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
