-- Role-based C2C marketplace schema.
-- Run once in the Supabase SQL Editor of a NEW project.
-- Do not point this at the imMBA project: that profiles.role column is a single admin role.
--
-- Status values stored on orders.status:
--   pending_payment     awaiting seller confirmation
--   ready_to_ship       ready to ship
--   shipped             shipped
--   completed           buyer marked complete
--   canceled_by_buyer   buyer canceled while pending (stock restored once)
--   rejected_by_seller  seller rejected while pending (stock restored once)
--
-- Fees (Taiwan classroom demo):
--   shipping_fee  cvs=60 (pick chain + store); home=80; no meetup
--   platform_fee  fixed NT$4 per seller order (private.platform_fee_amount)
--
-- Apply later deltas from shipping-fees-cancel.sql / cvs-home fee migrations on existing projects.

create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  display_name text not null check (char_length(btrim(display_name)) between 1 and 40),
  seller_status text not null default 'none'
    check (seller_status in ('none', 'pending', 'approved', 'rejected')),
  seller_reviewed_at timestamptz,
  seller_reject_reason text not null default '' check (char_length(seller_reject_reason) <= 200),
  created_at timestamptz not null default now()
);

create index profiles_email_idx on public.profiles (email);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('buyer', 'seller', 'admin')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index user_roles_role_idx on public.user_roles (role);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null default '' check (char_length(category) <= 60),
  description text not null default '' check (char_length(description) <= 4000),
  price numeric(12, 2) not null check (price >= 0 and price <= 10000000),
  quantity integer not null check (quantity >= 0 and quantity <= 100000),
  image_url text not null default '' check (char_length(image_url) <= 2000),
  listing_status text not null default 'active' check (listing_status in ('active', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_seller_id_fkey foreign key (seller_id) references public.profiles (id)
);

create index products_seller_idx on public.products (seller_id);
create index products_active_idx on public.products (created_at desc) where listing_status = 'active';

create table public.cart_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  quantity integer not null check (quantity > 0 and quantity <= 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create sequence public.order_no_seq as integer start with 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  buyer_id uuid not null,
  seller_id uuid not null,
  status text not null check (status in ('pending_payment', 'ready_to_ship', 'shipped', 'completed')),
  total numeric(12, 2) not null check (total >= 0),
  checkout_group uuid not null,
  contact_name text not null default '' check (char_length(contact_name) <= 40),
  contact_phone text not null default '' check (char_length(contact_phone) <= 20),
  fulfillment_method text not null default '' check (fulfillment_method in ('', 'delivery', 'cvs', 'meetup', 'home')),
  fulfillment_detail text not null default '' check (char_length(fulfillment_detail) <= 200),
  cvs_chain text not null default '' check (cvs_chain in ('', 'seven_eleven', 'familymart', 'hilife', 'okmart')),
  payment_method text not null default '' check (payment_method in ('', 'transfer', 'cod', 'pay_in_person')),
  payment_confirmed_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint orders_buyer_id_fkey foreign key (buyer_id) references public.profiles (id),
  constraint orders_seller_id_fkey foreign key (seller_id) references public.profiles (id)
);

create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_seller_status_idx on public.orders (seller_id, status, created_at desc);
create index orders_status_idx on public.orders (status, created_at desc);
create index orders_checkout_idx on public.orders (checkout_group);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id),
  product_name text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0)
);

create index order_items_order_idx on public.order_items (order_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint order_events_actor_id_fkey foreign key (actor_id) references public.profiles (id)
);

create index order_events_order_idx on public.order_events (order_id, created_at);

-- ---------------------------------------------------------------------------
-- Role helper. Authorization lives in user_roles, never in user_metadata.
-- security definer so RLS policies can ask "does this account have admin?"
-- without opening the whole role table to anon.
-- ---------------------------------------------------------------------------

create or replace function private.has_role(target_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = (select auth.uid())
      and role = target_role
  );
$$;

revoke all on function private.has_role(text) from public;
grant execute on function private.has_role(text) to anon, authenticated;

-- Definer so a visitor can read a seller's display name without also being
-- granted SELECT on orders. The party check is inside the function because
-- definer bypasses RLS.
create or replace function private.can_read_profile(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target = (select auth.uid())
    or (select private.has_role('admin'))
    or exists (
      select 1
      from public.products pr
      where pr.seller_id = target
        and pr.listing_status = 'active'
    )
    or exists (
      select 1
      from public.orders o
      where (o.buyer_id = target or o.seller_id = target)
        and (
          o.buyer_id = (select auth.uid())
          or o.seller_id = (select auth.uid())
        )
    );
$$;

revoke all on function private.can_read_profile(uuid) from public;
grant execute on function private.can_read_profile(uuid) to anon, authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;

create or replace function private.protect_product_seller()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.seller_id is distinct from old.seller_id then
    raise exception '不能更改商品的賣家';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.protect_product_seller() from public;

create or replace function private.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.email := old.email;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_profile() from public;

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
    -- Seller role waits for admin approval.
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

revoke all on function private.handle_new_user() from public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop trigger if exists products_protect_seller on public.products;
create trigger products_protect_seller
  before update on public.products
  for each row execute function private.protect_product_seller();

drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect
  before update on public.profiles
  for each row execute function private.protect_profile();

drop trigger if exists cart_items_touch on public.cart_items;
create trigger cart_items_touch
  before update on public.cart_items
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Checkout and seller transitions.
-- These run as the function owner so a buyer can decrement someone else's
-- stock without receiving a general UPDATE grant on products.
-- Public wrappers below are the only entry points granted to signed-in users.
-- ---------------------------------------------------------------------------

create or replace function private.place_order(details jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  grp uuid := gen_random_uuid();
  cart_count integer;
  updated_count integer;
  rec record;
  seller_row record;
  ord_id uuid;
  ord_no text;
  order_total numeric(12, 2);
  seller_name text;
  v_contact_name text := btrim(coalesce(details ->> 'contact_name', ''));
  v_contact_phone text := regexp_replace(coalesce(details ->> 'contact_phone', ''), '[[:space:]]', '', 'g');
  v_fulfillment text := coalesce(details ->> 'fulfillment_method', '');
  v_fulfill_detail text := btrim(coalesce(details ->> 'fulfillment_detail', ''));
  v_payment text := coalesce(details ->> 'payment_method', '');
  result jsonb := jsonb_build_object('checkout_group', grp, 'orders', '[]'::jsonb);
begin
  perform set_config('lock_timeout', '4s', true);

  if uid is null then
    raise exception '請先登入';
  end if;

  if not private.has_role('buyer') then
    raise exception '需要買家角色才能下單';
  end if;

  if char_length(v_contact_name) < 1 or char_length(v_contact_name) > 40 then
    raise exception '請填寫聯絡人';
  end if;
  if v_contact_phone !~ '^[0-9+\-]{8,20}$' then
    raise exception '請填寫有效的聯絡電話';
  end if;
  if v_fulfillment not in ('delivery', 'cvs', 'meetup') then
    raise exception '請選擇取件方式';
  end if;
  if char_length(v_fulfill_detail) < 2 or char_length(v_fulfill_detail) > 200 then
    raise exception '請填寫地址或取件地點';
  end if;
  if v_payment not in ('transfer', 'cod', 'pay_in_person') then
    raise exception '請選擇付款方式';
  end if;
  if v_fulfillment = 'meetup' and v_payment = 'cod' then
    raise exception '面交不能選貨到付款';
  end if;
  if v_fulfillment <> 'meetup' and v_payment = 'pay_in_person' then
    raise exception '只有面交可以選面交時付款';
  end if;

  select count(*) into cart_count
  from public.cart_items
  where user_id = uid;

  if cart_count = 0 then
    raise exception '購物車是空的';
  end if;

  -- Lock every product in a stable order so two buyers cannot both take the last unit.
  perform p.id
  from public.products p
  where p.id in (
    select c.product_id from public.cart_items c where c.user_id = uid
  )
  order by p.id
  for update;

  perform c.product_id
  from public.cart_items c
  where c.user_id = uid
  order by c.product_id
  for update;

  if (
    select count(*)
    from public.cart_items c
    join public.products p on p.id = c.product_id
    where c.user_id = uid
  ) <> cart_count then
    raise exception '購物車裡有已經不存在的商品，請移除後再結帳';
  end if;

  for rec in
    select p.name, p.quantity as stock, p.listing_status, c.quantity as qty
    from public.cart_items c
    join public.products p on p.id = c.product_id
    where c.user_id = uid
    order by p.id
  loop
    if rec.listing_status <> 'active' then
      raise exception '商品已下架：%', rec.name;
    end if;
    if rec.stock < rec.qty then
      raise exception '庫存不足：%（剩下 % 件）', rec.name, rec.stock;
    end if;
  end loop;

  update public.products p
  set quantity = p.quantity - c.quantity,
      updated_at = pg_catalog.now()
  from public.cart_items c
  where c.user_id = uid
    and c.product_id = p.id
    and p.listing_status = 'active'
    and p.quantity >= c.quantity;

  get diagnostics updated_count = row_count;
  if updated_count <> cart_count then
    raise exception '庫存不足，這次結帳已取消';
  end if;

  for seller_row in
    select p.seller_id
    from public.cart_items c
    join public.products p on p.id = c.product_id
    where c.user_id = uid
    group by p.seller_id
    order by p.seller_id
  loop
    select coalesce(sum(p.price * c.quantity), 0)
    into order_total
    from public.cart_items c
    join public.products p on p.id = c.product_id
    where c.user_id = uid
      and p.seller_id = seller_row.seller_id;

    select display_name into seller_name
    from public.profiles
    where id = seller_row.seller_id;

    ord_no := 'C2C-' || lpad(nextval('public.order_no_seq')::text, 6, '0');
    ord_id := gen_random_uuid();

    insert into public.orders (
      id, order_no, buyer_id, seller_id, status, total, checkout_group,
      contact_name, contact_phone, fulfillment_method, fulfillment_detail, payment_method
    ) values (
      ord_id, ord_no, uid, seller_row.seller_id, 'pending_payment', order_total, grp,
      v_contact_name, v_contact_phone, v_fulfillment, v_fulfill_detail, v_payment
    );

    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
    select ord_id, p.id, p.name, p.price, c.quantity
    from public.cart_items c
    join public.products p on p.id = c.product_id
    where c.user_id = uid
      and p.seller_id = seller_row.seller_id;

    insert into public.order_events (order_id, from_status, to_status, actor_id)
    values (ord_id, null, 'pending_payment', uid);

    result := jsonb_set(
      result,
      '{orders}',
      (result -> 'orders') || jsonb_build_array(jsonb_build_object(
        'id', ord_id,
        'order_no', ord_no,
        'seller_id', seller_row.seller_id,
        'seller_name', coalesce(seller_name, ''),
        'total', order_total
      ))
    );
  end loop;

  delete from public.cart_items where user_id = uid;
  return result;
end;
$$;

revoke all on function private.place_order(jsonb) from public, anon, authenticated;

create or replace function private.seller_transition(target_order uuid, action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ord public.orders;
  next_status text;
begin
  if uid is null then
    raise exception '請先登入';
  end if;

  select * into ord
  from public.orders
  where id = target_order
  for update;

  if not found or ord.seller_id <> uid or not private.has_role('seller') then
    raise exception '找不到訂單';
  end if;

  if action = 'confirm_payment' and ord.status = 'pending_payment' then
    next_status := 'ready_to_ship';
    update public.orders
    set status = next_status,
        payment_confirmed_at = pg_catalog.now()
    where id = ord.id
    returning * into ord;
  elsif action = 'confirm_shipment' and ord.status = 'ready_to_ship' then
    next_status := 'shipped';
    update public.orders
    set status = next_status,
        shipped_at = pg_catalog.now()
    where id = ord.id
    returning * into ord;
  else
    raise exception '訂單狀態已更新，請重新整理';
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (ord.id, case next_status
    when 'ready_to_ship' then 'pending_payment'
    else 'ready_to_ship'
  end, next_status, uid);

  return jsonb_build_object(
    'id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'payment_confirmed_at', ord.payment_confirmed_at,
    'shipped_at', ord.shipped_at,
    'completed_at', ord.completed_at
  );
end;
$$;

revoke all on function private.seller_transition(uuid, text) from public, anon, authenticated;

create or replace function private.buyer_complete_order(target_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ord public.orders;
begin
  if uid is null then
    raise exception '請先登入';
  end if;

  select * into ord
  from public.orders
  where id = target_order
  for update;

  if not found or ord.buyer_id <> uid or not private.has_role('buyer') then
    raise exception '找不到訂單';
  end if;

  if ord.status <> 'shipped' then
    raise exception '訂單狀態已更新，請重新整理';
  end if;

  update public.orders
  set status = 'completed',
      completed_at = pg_catalog.now()
  where id = ord.id
  returning * into ord;

  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (ord.id, 'shipped', 'completed', uid);

  return jsonb_build_object(
    'id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'payment_confirmed_at', ord.payment_confirmed_at,
    'shipped_at', ord.shipped_at,
    'completed_at', ord.completed_at
  );
end;
$$;

revoke all on function private.buyer_complete_order(uuid) from public, anon, authenticated;

-- Public RPCs are one-line definer wrappers with a locked search_path.
-- Signed-in users cannot call private.place_order or private.seller_transition directly.
create or replace function public.place_order(details jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.place_order(details);
$$;

create or replace function public.seller_confirm_payment(target_order uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.seller_transition(target_order, 'confirm_payment');
$$;

create or replace function public.seller_confirm_shipment(target_order uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.seller_transition(target_order, 'confirm_shipment');
$$;

create or replace function public.buyer_complete_order(target_order uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.buyer_complete_order(target_order);
$$;

revoke all on function public.place_order(jsonb) from public;
revoke all on function public.seller_confirm_payment(uuid) from public;
revoke all on function public.seller_confirm_shipment(uuid) from public;
revoke all on function public.buyer_complete_order(uuid) from public;

grant execute on function public.place_order(jsonb) to authenticated;
grant execute on function public.seller_confirm_payment(uuid) to authenticated;
grant execute on function public.seller_confirm_shipment(uuid) to authenticated;
grant execute on function public.buyer_complete_order(uuid) to authenticated;

revoke all on sequence public.order_no_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges. RLS below still decides which rows are visible.
-- Orders cannot be inserted or updated through the Data API.
-- ---------------------------------------------------------------------------

revoke all on public.profiles from anon, authenticated;
grant select (id, display_name) on public.profiles to anon;
grant select (
  id, email, display_name, created_at,
  phone, address,
  offers_meetup, meetup_note, offers_delivery, delivery_fee
) on public.profiles to authenticated;
grant update (
  display_name, phone, address,
  offers_meetup, meetup_note, offers_delivery, delivery_fee
) on public.profiles to authenticated;

revoke all on public.user_roles from anon, authenticated;
grant select on public.user_roles to authenticated;

revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant insert (seller_id, name, category, description, price, quantity, image_url, listing_status)
  on public.products to authenticated;
grant update (name, category, description, price, quantity, image_url, listing_status, updated_at)
  on public.products to authenticated;

revoke all on public.cart_items from anon, authenticated;
grant select, insert, update, delete on public.cart_items to authenticated;

revoke all on public.orders from anon, authenticated;
grant select on public.orders to authenticated;

revoke all on public.order_items from anon, authenticated;
grant select on public.order_items to authenticated;

revoke all on public.order_events from anon, authenticated;
grant select on public.order_events to authenticated;

grant all on public.profiles to service_role;
grant all on public.user_roles to service_role;
grant all on public.products to service_role;
grant all on public.cart_items to service_role;
grant all on public.orders to service_role;
grant all on public.order_items to service_role;
grant all on public.order_events to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.products enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;

create policy profiles_select on public.profiles
  for select
  to anon, authenticated
  using (private.can_read_profile(id));

create policy profiles_update_own on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy user_roles_select_own on public.user_roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy products_select on public.products
  for select
  to anon, authenticated
  using (
    listing_status = 'active'
    or seller_id = (select auth.uid())
    or (select private.has_role('admin'))
  );

create policy products_insert_own on public.products
  for insert
  to authenticated
  with check (
    seller_id = (select auth.uid())
    and (select private.has_role('seller'))
  );

create policy products_update_own on public.products
  for update
  to authenticated
  using (
    seller_id = (select auth.uid())
    and (select private.has_role('seller'))
  )
  with check (
    seller_id = (select auth.uid())
    and (select private.has_role('seller'))
  );

create policy cart_items_own on public.cart_items
  for all
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select private.has_role('buyer'))
  )
  with check (
    user_id = (select auth.uid())
    and (select private.has_role('buyer'))
  );

create policy orders_select_party on public.orders
  for select
  to authenticated
  using (
    buyer_id = (select auth.uid())
    or seller_id = (select auth.uid())
    or (select private.has_role('admin'))
  );

create policy order_items_select_party on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
    )
  );

create policy order_events_select_party on public.order_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
    )
  );

-- Product images: sellers upload files into their own folder; visitors can view them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "product images public read" on storage.objects;
drop policy if exists "sellers upload product images" on storage.objects;
drop policy if exists "sellers update product images" on storage.objects;
drop policy if exists "sellers delete product images" on storage.objects;

create policy "product images public read"
on storage.objects for select
to public
using (bucket_id = 'product-images');

create policy "sellers upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and private.has_role('seller')
);

create policy "sellers update product images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and private.has_role('seller')
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and private.has_role('seller')
);

create policy "sellers delete product images"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and private.has_role('seller')
);

notify pgrst, 'reload schema';
