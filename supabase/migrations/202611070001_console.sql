-- Seller data is readable only by a manually allowlisted operator. All writes use Edge Functions.
create table public.console_operators (user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.console_operators enable row level security;
revoke all on public.console_operators from anon, authenticated;
create function public.is_console_operator() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.console_operators where user_id = (select auth.uid()));
$$;
revoke all on function public.is_console_operator() from public;
grant execute on function public.is_console_operator() to authenticated;

create table public.store_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  require_approval boolean not null default true,
  automation_enabled boolean not null default false,
  min_margin numeric not null default 20 check (min_margin >= 0 and min_margin < 95),
  fee_percent numeric not null default 13.6 check (fee_percent >= 0 and fee_percent < 50),
  fixed_fee numeric not null default 0.4 check (fixed_fee >= 0),
  low_stock integer not null default 3 check (low_stock >= 0),
  updated_at timestamptz not null default now()
);
create table public.products (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  sku text not null, title text not null check (length(title) between 1 and 80),
  supplier text not null check (supplier in ('Amazon','AliExpress','Wholesale','Owned inventory')),
  supplier_url text, sourcing_model text not null default 'research' check (sourcing_model in ('research','owned','wholesale')),
  supplier_agreement boolean not null default false,
  cost numeric(12,2) not null default 0 check (cost >= 0), shipping_cost numeric(12,2) not null default 0 check (shipping_cost >= 0),
  price numeric(12,2) not null check (price > 0), quantity integer not null default 0 check (quantity >= 0),
  image_url text, description text not null default '', category_id text, aspects jsonb not null default '{}',
  condition text not null default 'NEW', location_key text, fulfillment_policy_id text, payment_policy_id text, return_policy_id text,
  snapshot_at timestamptz, created_at timestamptz not null default now(), unique(owner_id,sku)
);
create table public.listings (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  ebay_id text not null, sku text, title text not null, price numeric(12,2) not null, currency text not null default 'USD',
  quantity integer not null default 0, sold integer not null default 0, watchers integer,
  image_url text, status text not null default 'active', listing_type text, has_variations boolean not null default false,
  management text not null default 'trading', offer_id text, synced_at timestamptz not null default now(), unique(owner_id,ebay_id)
);
create table public.buyer_offers (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  ebay_offer_id text not null, listing_id text not null, title text not null, amount numeric(12,2) not null,
  currency text not null default 'USD', quantity integer not null default 1, status text not null, expires_at timestamptz,
  synced_at timestamptz not null default now(), unique(owner_id,ebay_offer_id)
);
create table public.orders (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  ebay_order_id text not null, total numeric(12,2) not null, currency text not null default 'USD',
  payment_status text not null, fulfillment_status text not null, line_items jsonb not null default '[]',
  cost_estimate numeric(12,2), fee_estimate numeric(12,2), tracking text,
  ordered_at timestamptz not null, synced_at timestamptz not null default now(), unique(owner_id,ebay_order_id)
);
create table public.traffic_daily (
  owner_id uuid not null references auth.users(id) on delete cascade, listing_id text not null,
  day date not null, views integer, impressions integer, transactions integer,
  synced_at timestamptz not null default now(), primary key(owner_id,listing_id,day)
);
create table public.action_queue (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('publish','price','stock','shipment')),
  target_id text not null, summary text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','running','completed','rejected','needs_review')),
  idempotency_key text not null, result jsonb, error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,idempotency_key)
);
create unique index one_open_action on public.action_queue(owner_id,kind,target_id)
  where status in ('pending','approved','running','needs_review');
create table public.automation_runs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
  job text not null, status text not null, detail text not null, created_at timestamptz not null default now()
);
-- Tokens and OAuth state have NO browser grants or RLS policies, including for the operator.
create table public.ebay_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null, access_token text not null, expires_at timestamptz not null, environment text not null
);
create table public.oauth_states (
  state_hash text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null
);
create table public.job_locks (owner_id uuid primary key, locked_until timestamptz not null);
alter table public.ebay_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.job_locks enable row level security;
revoke all on public.ebay_credentials, public.oauth_states, public.job_locks from anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['store_settings','products','listings','buyer_offers','orders','traffic_daily','action_queue','automation_runs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy operator_read on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select public.is_console_operator()))', t);
  end loop;
end $$;
grant all on public.console_operators,public.store_settings,public.products,public.listings,public.buyer_offers,public.orders,
  public.traffic_daily,public.action_queue,public.automation_runs,public.ebay_credentials,public.oauth_states,public.job_locks to service_role;

create function public.claim_console_job(p_owner uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.job_locks values (p_owner, now() + interval '4 minutes')
    on conflict(owner_id) do update set locked_until = excluded.locked_until where public.job_locks.locked_until < now();
  return found;
end $$;
revoke all on function public.claim_console_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_console_job(uuid) to service_role;
create index on public.automation_runs(owner_id,created_at desc);
create index on public.orders(owner_id,ordered_at desc);
create index on public.action_queue(owner_id,status);
