alter table public.orders
  add column if not exists contact_name text not null default '' check (char_length(contact_name) <= 40),
  add column if not exists contact_phone text not null default '' check (char_length(contact_phone) <= 20),
  add column if not exists fulfillment_method text not null default '' check (fulfillment_method in ('', 'delivery', 'cvs', 'meetup')),
  add column if not exists fulfillment_detail text not null default '' check (char_length(fulfillment_detail) <= 200),
  add column if not exists payment_method text not null default '' check (payment_method in ('', 'transfer', 'cod', 'pay_in_person'));

drop function if exists public.place_order();
drop function if exists public.place_order(jsonb);
drop function if exists private.place_order();
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

notify pgrst, 'reload schema';
