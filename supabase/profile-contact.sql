-- Optional contact fields for personal profile / checkout prefills.
alter table public.profiles
  add column if not exists phone text not null default '',
  add column if not exists address text not null default '';

alter table public.profiles drop constraint if exists profiles_phone_check;
alter table public.profiles add constraint profiles_phone_check check (
  phone = '' or phone ~ '^[0-9+\-]{8,20}$'
);

alter table public.profiles drop constraint if exists profiles_address_check;
alter table public.profiles add constraint profiles_address_check check (
  char_length(address) <= 200
);

grant select (
  id, email, display_name, created_at,
  phone, address,
  offers_meetup, meetup_note, offers_delivery, delivery_fee
) on public.profiles to authenticated;

grant update (
  display_name, phone, address,
  offers_meetup, meetup_note, offers_delivery, delivery_fee
) on public.profiles to authenticated;

notify pgrst, 'reload schema';
