-- Fixed Taiwan classroom shipping fees: CVS NT$60 / home NT$80 / platform NT$4.
-- No meetup. CVS requires chain pick (7-ELEVEN, FamilyMart, Hi-Life, OK mart).
-- Applied on live project via migrations:
--   cvs_home_fees_no_meetup, place_order_cvs_home_only, shipment_tracking_cvs_home

create or replace function private.platform_fee_amount()
returns numeric(12, 2)
language sql
immutable
as $$ select 4::numeric(12, 2); $$;

alter table public.orders
  add column if not exists cvs_chain text not null default '';

alter table public.orders drop constraint if exists orders_cvs_chain_check;
alter table public.orders add constraint orders_cvs_chain_check check (
  cvs_chain in ('', 'seven_eleven', 'familymart', 'hilife', 'okmart')
);

alter table public.orders drop constraint if exists orders_fulfillment_method_check;
alter table public.orders add constraint orders_fulfillment_method_check check (
  fulfillment_method in ('', 'delivery', 'cvs', 'meetup', 'home')
);

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
  seller_cfg jsonb;
  v_method text;
  v_chain text;
  v_name text;
  v_phone text;
  v_detail text;
  result jsonb := jsonb_build_object('checkout_group', grp, 'orders', '[]'::jsonb);
begin
  perform set_config('lock_timeout', '4s', true);
  if uid is null then raise exception '請先登入'; end if;
  if not private.has_role('buyer') then raise exception '需要買家角色才能下單'; end if;
  select count(*) into cart_count from public.cart_items where user_id = uid;
  if cart_count = 0 then raise exception '購物車是空的'; end if;
  select count(distinct p.seller_id) into seller_count
  from public.cart_items c join public.products p on p.id = c.product_id
  where c.user_id = uid;
  detail_count := coalesce(jsonb_array_length(details -> 'sellers'), 0);
  if detail_count <> seller_count then raise exception '請為每一位賣家選擇交付方式'; end if;
  perform p.id from public.products p
  where p.id in (select c.product_id from public.cart_items c where c.user_id = uid)
  order by p.id for update;
  perform c.product_id from public.cart_items c where c.user_id = uid order by c.product_id for update;
  if (select count(*) from public.cart_items c join public.products p on p.id = c.product_id where c.user_id = uid) <> cart_count then
    raise exception '購物車裡有已經不存在的商品，請移除後再結帳';
  end if;
  for rec in
    select p.name, p.quantity as stock, p.listing_status, c.quantity as qty
    from public.cart_items c join public.products p on p.id = c.product_id
    where c.user_id = uid order by p.id
  loop
    if rec.listing_status <> 'active' then raise exception '商品已下架：%', rec.name; end if;
    if rec.stock < rec.qty then raise exception '庫存不足：%（剩下 % 件）', rec.name, rec.stock; end if;
  end loop;
  update public.products p
  set quantity = p.quantity - c.quantity, updated_at = pg_catalog.now()
  from public.cart_items c
  where c.user_id = uid and c.product_id = p.id and p.listing_status = 'active' and p.quantity >= c.quantity;
  get diagnostics updated_count = row_count;
  if updated_count <> cart_count then raise exception '庫存不足，這次結帳已取消'; end if;
  for seller_row in
    select p.seller_id from public.cart_items c join public.products p on p.id = c.product_id
    where c.user_id = uid group by p.seller_id order by p.seller_id
  loop
    select elem into seller_cfg
    from jsonb_array_elements(details -> 'sellers') as elem
    where (elem ->> 'seller_id') = seller_row.seller_id::text
    limit 1;
    if seller_cfg is null then raise exception '請為每一位賣家選擇交付方式'; end if;
    select display_name into seller_name from public.profiles where id = seller_row.seller_id;
    seller_name := coalesce(seller_name, '');
    v_method := coalesce(seller_cfg ->> 'fulfillment_method', '');
    v_chain := coalesce(seller_cfg ->> 'cvs_chain', '');
    v_name := btrim(coalesce(seller_cfg ->> 'contact_name', ''));
    v_phone := regexp_replace(coalesce(seller_cfg ->> 'contact_phone', ''), '[[:space:]]', '', 'g');
    v_detail := btrim(coalesce(seller_cfg ->> 'fulfillment_detail', ''));
    if v_method = 'cvs' then
      ship_fee := 60;
      if v_chain not in ('seven_eleven', 'familymart', 'hilife', 'okmart') then
        raise exception '請選擇超商店家';
      end if;
      if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception '請填寫收件姓名'; end if;
      if v_phone !~ '^[0-9+\-]{8,20}$' then raise exception '請填寫有效的收件電話'; end if;
      if char_length(v_detail) < 2 or char_length(v_detail) > 200 then
        raise exception '請填寫超商門市名稱或店號';
      end if;
    elsif v_method = 'home' then
      ship_fee := 80;
      v_chain := '';
      if char_length(v_name) < 1 or char_length(v_name) > 40 then raise exception '請填寫收件姓名'; end if;
      if v_phone !~ '^[0-9+\-]{8,20}$' then raise exception '請填寫有效的收件電話'; end if;
      if char_length(v_detail) < 5 or char_length(v_detail) > 200 then
        raise exception '請填寫完整收件地址';
      end if;
    else
      raise exception '請選擇超商宅配或到府宅配';
    end if;
    select coalesce(sum(p.price * c.quantity), 0) into items_sub
    from public.cart_items c join public.products p on p.id = c.product_id
    where c.user_id = uid and p.seller_id = seller_row.seller_id;
    order_total := items_sub + ship_fee + plat_fee;
    ord_no := 'C2C-' || lpad(nextval('public.order_no_seq')::text, 6, '0');
    ord_id := gen_random_uuid();
    insert into public.orders (
      id, order_no, buyer_id, seller_id, status,
      items_subtotal, shipping_fee, platform_fee, total, checkout_group,
      contact_name, contact_phone, fulfillment_method, fulfillment_detail,
      payment_method, cvs_chain
    ) values (
      ord_id, ord_no, uid, seller_row.seller_id, 'pending_payment',
      items_sub, ship_fee, plat_fee, order_total, grp,
      v_name, v_phone, v_method, v_detail, 'transfer', v_chain
    );
    insert into public.order_items (order_id, product_id, product_name, unit_price, quantity)
    select ord_id, p.id, p.name, p.price, c.quantity
    from public.cart_items c join public.products p on p.id = c.product_id
    where c.user_id = uid and p.seller_id = seller_row.seller_id;
    insert into public.order_events (order_id, from_status, to_status, actor_id)
    values (ord_id, null, 'pending_payment', uid);
    result := jsonb_set(
      result, '{orders}',
      (result -> 'orders') || jsonb_build_array(jsonb_build_object(
        'id', ord_id, 'order_no', ord_no, 'seller_id', seller_row.seller_id,
        'seller_name', seller_name, 'items_subtotal', items_sub,
        'shipping_fee', ship_fee, 'platform_fee', plat_fee, 'total', order_total
      ))
    );
  end loop;
  delete from public.cart_items where user_id = uid;
  return result;
end;
$$;

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
    update public.orders set status = next_status, payment_confirmed_at = pg_catalog.now()
    where id = ord.id returning * into ord;
  elsif action = 'confirm_shipment' and ord.status = 'ready_to_ship' then
    next_status := 'shipped';
    update public.orders set status = next_status, shipped_at = pg_catalog.now(),
      tracking_no = case when ord.fulfillment_method in ('delivery', 'home', 'cvs') then track else ord.tracking_no end
    where id = ord.id returning * into ord;
  else
    raise exception '訂單狀態已更新，請重新整理';
  end if;
  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (
    ord.id,
    case next_status when 'ready_to_ship' then 'pending_payment' else 'ready_to_ship' end,
    next_status, uid
  );
  return jsonb_build_object(
    'id', ord.id, 'order_no', ord.order_no, 'status', ord.status, 'tracking_no', ord.tracking_no,
    'payment_confirmed_at', ord.payment_confirmed_at, 'shipped_at', ord.shipped_at, 'completed_at', ord.completed_at
  );
end;
$$;

notify pgrst, 'reload schema';
