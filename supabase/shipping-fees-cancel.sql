-- Delivery fees (TW ~NT$60-80), platform fee, cancel/reject, stock restore.
-- Safe to re-run pieces via DROP IF EXISTS for functions.

alter table public.profiles
  add column if not exists offers_meetup boolean not null default true,
  add column if not exists meetup_note text not null default '' check (char_length(meetup_note) <= 200),
  add column if not exists offers_delivery boolean not null default true,
  add column if not exists delivery_fee numeric(12, 2) not null default 70
    check (delivery_fee >= 0 and delivery_fee <= 500);

alter table public.orders
  add column if not exists items_subtotal numeric(12, 2),
  add column if not exists shipping_fee numeric(12, 2) not null default 0 check (shipping_fee >= 0),
  add column if not exists platform_fee numeric(12, 2) not null default 0 check (platform_fee >= 0),
  add column if not exists tracking_no text not null default '' check (char_length(tracking_no) <= 80),
  add column if not exists reject_reason_code text not null default ''
    check (reject_reason_code in ('', 'unavailable', 'condition_changed', 'cannot_deliver', 'listing_error', 'other')),
  add column if not exists reject_reason_text text not null default '' check (char_length(reject_reason_text) <= 200),
  add column if not exists stock_restored_at timestamptz,
  add column if not exists meetup_note_snapshot text not null default '' check (char_length(meetup_note_snapshot) <= 200);

update public.orders
set items_subtotal = coalesce(items_subtotal, total),
    shipping_fee = coalesce(shipping_fee, 0),
    platform_fee = coalesce(platform_fee, 0)
where items_subtotal is null;

alter table public.orders
  alter column items_subtotal set default 0;

alter table public.orders
  alter column items_subtotal set not null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'pending_payment', 'ready_to_ship', 'shipped', 'completed',
  'canceled_by_buyer', 'rejected_by_seller'
));

alter table public.orders drop constraint if exists orders_fulfillment_method_check;
alter table public.orders add constraint orders_fulfillment_method_check check (
  fulfillment_method in ('', 'delivery', 'cvs', 'meetup')
);

grant update (
  display_name, offers_meetup, meetup_note, offers_delivery, delivery_fee
) on public.profiles to authenticated;

-- Classroom platform service fee (NT$) charged once per seller order.
create or replace function private.platform_fee_amount()
returns numeric
language sql
immutable
as $$
  select 4::numeric(12, 2);
$$;

revoke all on function private.platform_fee_amount() from public;
grant execute on function private.platform_fee_amount() to authenticated;

create or replace function private.restore_order_stock(target_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ord public.orders;
begin
  select * into ord from public.orders where id = target_order for update;
  if not found then
    raise exception '找不到訂單';
  end if;
  if ord.stock_restored_at is not null then
    return;
  end if;

  update public.products p
  set quantity = p.quantity + oi.quantity,
      updated_at = pg_catalog.now()
  from public.order_items oi
  where oi.order_id = ord.id
    and oi.product_id is not null
    and p.id = oi.product_id;

  update public.orders
  set stock_restored_at = pg_catalog.now()
  where id = ord.id;
end;
$$;

revoke all on function private.restore_order_stock(uuid) from public, anon, authenticated;

drop function if exists public.place_order(jsonb);
drop function if exists private.place_order(jsonb);

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
  seller_count integer;
  detail_count integer;
  rec record;
  seller_row record;
  ord_id uuid;
  ord_no text;
  items_sub numeric(12, 2);
  ship_fee numeric(12, 2);
  plat_fee numeric(12, 2) := private.platform_fee_amount();
  order_total numeric(12, 2);
  seller_name text;
  ship record;
  seller_cfg jsonb;
  v_method text;
  v_name text;
  v_phone text;
  v_detail text;
  v_meetup_snap text;
  result jsonb := jsonb_build_object('checkout_group', grp, 'orders', '[]'::jsonb);
begin
  perform set_config('lock_timeout', '4s', true);

  if uid is null then raise exception '請先登入'; end if;
  if not private.has_role('buyer') then raise exception '需要買家角色才能下單'; end if;

  select count(*) into cart_count from public.cart_items where user_id = uid;
  if cart_count = 0 then raise exception '購物車是空的'; end if;

  select count(distinct p.seller_id) into seller_count
  from public.cart_items c
  join public.products p on p.id = c.product_id
  where c.user_id = uid;

  detail_count := coalesce(jsonb_array_length(details -> 'sellers'), 0);
  if detail_count <> seller_count then
    raise exception '請為每一位賣家選擇交付方式';
  end if;

  perform p.id
  from public.products p
  where p.id in (select c.product_id from public.cart_items c where c.user_id = uid)
  order by p.id
  for update;

  perform c.product_id
  from public.cart_items c
  where c.user_id = uid
  order by c.product_id
  for update;

  if (
    select count(*) from public.cart_items c
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
    select elem into seller_cfg
    from jsonb_array_elements(details -> 'sellers') as elem
    where (elem ->> 'seller_id') = seller_row.seller_id::text
    limit 1;

    if seller_cfg is null then
      raise exception '請為每一位賣家選擇交付方式';
    end if;

    select * into ship from public.profiles where id = seller_row.seller_id;
    seller_name := coalesce(ship.display_name, '');
    v_method := coalesce(seller_cfg ->> 'fulfillment_method', '');
    v_name := btrim(coalesce(seller_cfg ->> 'contact_name', ''));
    v_phone := regexp_replace(coalesce(seller_cfg ->> 'contact_phone', ''), '[[:space:]]', '', 'g');
    v_detail := btrim(coalesce(seller_cfg ->> 'fulfillment_detail', ''));
    v_meetup_snap := '';

    if v_method = 'meetup' then
      if not ship.offers_meetup then
        raise exception '賣家 % 不提供校園面交', seller_name;
      end if;
      ship_fee := 0;
      v_meetup_snap := left(coalesce(ship.meetup_note, ''), 200);
      if char_length(v_detail) > 200 then
        raise exception '面交備註太長';
      end if;
      v_name := coalesce(nullif(v_name, ''), left(seller_name, 40));
      v_phone := coalesce(nullif(v_phone, ''), '00000000');
      if v_detail = '' then v_detail := coalesce(nullif(v_meetup_snap, ''), 'Campus meetup'); end if;
    elsif v_method = 'delivery' then
      if not ship.offers_delivery then
        raise exception '賣家 % 不提供宅配', seller_name;
      end if;
      ship_fee := coalesce(ship.delivery_fee, 70);
      if char_length(v_name) < 1 or char_length(v_name) > 40 then
        raise exception '請填寫收件姓名';
      end if;
      if v_phone !~ '^[0-9+\-]{8,20}$' then
        raise exception '請填寫有效的收件電話';
      end if;
      if char_length(v_detail) < 5 or char_length(v_detail) > 200 then
        raise exception '請填寫完整收件地址';
      end if;
    else
      raise exception '請選擇校園面交或宅配';
    end if;

    select coalesce(sum(p.price * c.quantity), 0)
    into items_sub
    from public.cart_items c
    join public.products p on p.id = c.product_id
    where c.user_id = uid
      and p.seller_id = seller_row.seller_id;

    order_total := items_sub + ship_fee + plat_fee;
    ord_no := 'C2C-' || lpad(nextval('public.order_no_seq')::text, 6, '0');
    ord_id := gen_random_uuid();

    insert into public.orders (
      id, order_no, buyer_id, seller_id, status,
      items_subtotal, shipping_fee, platform_fee, total, checkout_group,
      contact_name, contact_phone, fulfillment_method, fulfillment_detail,
      payment_method, meetup_note_snapshot
    ) values (
      ord_id, ord_no, uid, seller_row.seller_id, 'pending_payment',
      items_sub, ship_fee, plat_fee, order_total, grp,
      v_name, v_phone, v_method, v_detail,
      'transfer', v_meetup_snap
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
        'seller_name', seller_name,
        'items_subtotal', items_sub,
        'shipping_fee', ship_fee,
        'platform_fee', plat_fee,
        'total', order_total
      ))
    );
  end loop;

  delete from public.cart_items where user_id = uid;
  return result;
end;
$$;

revoke all on function private.place_order(jsonb) from public, anon, authenticated;

create or replace function public.place_order(details jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.place_order(details);
$$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to authenticated;

drop function if exists public.seller_confirm_shipment(uuid);
drop function if exists private.seller_transition(uuid, text);

create or replace function private.seller_transition(target_order uuid, action text, tracking_no text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ord public.orders;
  next_status text;
  track text := left(btrim(coalesce(tracking_no, '')), 80);
begin
  if uid is null then raise exception '請先登入'; end if;

  select * into ord from public.orders where id = target_order for update;
  if not found or ord.seller_id <> uid or not private.has_role('seller') then
    raise exception '找不到訂單';
  end if;

  if action = 'confirm_payment' and ord.status = 'pending_payment' then
    next_status := 'ready_to_ship';
    update public.orders
    set status = next_status, payment_confirmed_at = pg_catalog.now()
    where id = ord.id returning * into ord;
  elsif action = 'confirm_shipment' and ord.status = 'ready_to_ship' then
    next_status := 'shipped';
    update public.orders
    set status = next_status,
        shipped_at = pg_catalog.now(),
        tracking_no = case when ord.fulfillment_method = 'delivery' then track else ord.tracking_no end
    where id = ord.id returning * into ord;
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
    'tracking_no', ord.tracking_no,
    'payment_confirmed_at', ord.payment_confirmed_at,
    'shipped_at', ord.shipped_at,
    'completed_at', ord.completed_at
  );
end;
$$;

revoke all on function private.seller_transition(uuid, text, text) from public, anon, authenticated;

create or replace function public.seller_confirm_payment(target_order uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.seller_transition(target_order, 'confirm_payment', '');
$$;

create or replace function public.seller_confirm_shipment(target_order uuid, tracking_no text default '')
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.seller_transition(target_order, 'confirm_shipment', tracking_no);
$$;

create or replace function private.buyer_cancel_order(target_order uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ord public.orders;
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into ord from public.orders where id = target_order for update;
  if not found or ord.buyer_id <> uid or not private.has_role('buyer') then
    raise exception '找不到訂單';
  end if;
  if ord.status <> 'pending_payment' then
    raise exception '訂單狀態已更新，請重新整理';
  end if;

  update public.orders set status = 'canceled_by_buyer' where id = ord.id returning * into ord;
  perform private.restore_order_stock(ord.id);
  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (ord.id, 'pending_payment', 'canceled_by_buyer', uid);

  return jsonb_build_object('id', ord.id, 'order_no', ord.order_no, 'status', ord.status);
end;
$$;

create or replace function private.seller_reject_order(target_order uuid, reason_code text, reason_text text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  ord public.orders;
  code text := coalesce(reason_code, '');
  note text := left(btrim(coalesce(reason_text, '')), 200);
begin
  if uid is null then raise exception '請先登入'; end if;
  select * into ord from public.orders where id = target_order for update;
  if not found or ord.seller_id <> uid or not private.has_role('seller') then
    raise exception '找不到訂單';
  end if;
  if ord.status <> 'pending_payment' then
    raise exception '訂單狀態已更新，請重新整理';
  end if;
  if code not in ('unavailable', 'condition_changed', 'cannot_deliver', 'listing_error', 'other') then
    raise exception '請選擇拒絕原因';
  end if;
  if code = 'other' and char_length(note) < 2 then
    raise exception '請填寫其他原因說明';
  end if;

  update public.orders
  set status = 'rejected_by_seller',
      reject_reason_code = code,
      reject_reason_text = note
  where id = ord.id
  returning * into ord;

  perform private.restore_order_stock(ord.id);
  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (ord.id, 'pending_payment', 'rejected_by_seller', uid);

  return jsonb_build_object(
    'id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'reject_reason_code', ord.reject_reason_code,
    'reject_reason_text', ord.reject_reason_text
  );
end;
$$;

revoke all on function private.buyer_cancel_order(uuid) from public, anon, authenticated;
revoke all on function private.seller_reject_order(uuid, text, text) from public, anon, authenticated;

create or replace function public.buyer_cancel_order(target_order uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select private.buyer_cancel_order(target_order);
$$;

create or replace function public.seller_reject_order(target_order uuid, reason_code text, reason_text text default '')
returns jsonb language sql security definer set search_path = '' as $$
  select private.seller_reject_order(target_order, reason_code, reason_text);
$$;

revoke all on function public.seller_confirm_payment(uuid) from public;
revoke all on function public.seller_confirm_shipment(uuid, text) from public;
revoke all on function public.buyer_cancel_order(uuid) from public;
revoke all on function public.seller_reject_order(uuid, text, text) from public;

grant execute on function public.seller_confirm_payment(uuid) to authenticated;
grant execute on function public.seller_confirm_shipment(uuid, text) to authenticated;
grant execute on function public.buyer_cancel_order(uuid) to authenticated;
grant execute on function public.seller_reject_order(uuid, text, text) to authenticated;
grant execute on function public.buyer_complete_order(uuid) to authenticated;

notify pgrst, 'reload schema';
