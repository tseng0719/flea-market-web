-- Buyer cancel requires a reason (select options + optional other text).
-- Seller reject UI only appears while status = pending_payment.

alter table public.orders
  add column if not exists cancel_reason_code text not null default '',
  add column if not exists cancel_reason_text text not null default '';

alter table public.orders drop constraint if exists orders_cancel_reason_code_check;
alter table public.orders add constraint orders_cancel_reason_code_check check (
  cancel_reason_code in ('', 'changed_mind', 'ordered_wrong', 'shipping_fee', 'wait_too_long', 'other')
);

alter table public.orders drop constraint if exists orders_cancel_reason_text_check;
alter table public.orders add constraint orders_cancel_reason_text_check check (
  char_length(cancel_reason_text) <= 200
);

drop function if exists public.buyer_cancel_order(uuid);
drop function if exists private.buyer_cancel_order(uuid);

create or replace function private.buyer_cancel_order(
  target_order uuid,
  reason_code text,
  reason_text text default ''
)
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
  if not found or ord.buyer_id <> uid or not private.has_role('buyer') then
    raise exception '找不到訂單';
  end if;
  if ord.status <> 'pending_payment' then
    raise exception '訂單狀態已更新，請重新整理';
  end if;
  if code not in ('changed_mind', 'ordered_wrong', 'shipping_fee', 'wait_too_long', 'other') then
    raise exception '請選擇取消原因';
  end if;
  if code = 'other' and char_length(note) < 2 then
    raise exception '請填寫其他原因說明';
  end if;

  update public.orders
  set status = 'canceled_by_buyer',
      cancel_reason_code = code,
      cancel_reason_text = note
  where id = ord.id
  returning * into ord;

  perform private.restore_order_stock(ord.id);
  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (ord.id, 'pending_payment', 'canceled_by_buyer', uid);

  return jsonb_build_object(
    'id', ord.id,
    'order_no', ord.order_no,
    'status', ord.status,
    'cancel_reason_code', ord.cancel_reason_code,
    'cancel_reason_text', ord.cancel_reason_text
  );
end;
$$;

create or replace function public.buyer_cancel_order(
  target_order uuid,
  reason_code text,
  reason_text text default ''
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.buyer_cancel_order(target_order, reason_code, reason_text);
$$;

revoke all on function private.buyer_cancel_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.buyer_cancel_order(uuid, text, text) from public;
grant execute on function public.buyer_cancel_order(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
