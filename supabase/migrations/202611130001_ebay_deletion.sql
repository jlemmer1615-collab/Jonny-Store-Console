-- Marketplace account deletion (§ SETUP step 8).
--
-- eBay identifies a deleted user by their immutable eBay user id, but every
-- existing table is keyed on the Supabase auth uuid. Without this column a
-- deletion notification cannot be matched to the rows that must be removed.
alter table public.ebay_credentials add column if not exists ebay_user_id text;

-- The notification lookup goes user id -> owner, so index in that direction.
create index if not exists ebay_credentials_ebay_user_idx on public.ebay_credentials (ebay_user_id);

comment on column public.ebay_credentials.ebay_user_id is
  'Immutable eBay user id from the Identity API, used to service marketplace account deletion notifications.';
