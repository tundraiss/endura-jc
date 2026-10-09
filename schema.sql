-- ENDURA JC cloud schema. Run once in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.staff (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'Office', created_at timestamptz not null default now()
);
create table if not exists public.customers (
 id uuid primary key default gen_random_uuid(), name text not null, phone text not null default '',
 created_at timestamptz not null default now()
);
create table if not exists public.jobs (
 id uuid primary key default gen_random_uuid(), job_number text not null unique,
 customer_id uuid not null references public.customers(id), received_date date not null default current_date,
 due_date date not null, status text not null default 'New', notes text not null default '',
 invoice_path text, invoice_name text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint job_status_valid check (status in ('New','Pretreatment','Powder Coating','Curing / QC','Ready for Collection','Collected'))
);
create table if not exists public.job_items (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
 description text not null, quantity integer not null default 1 check (quantity > 0),
 colour text not null default '', dimensions text not null default '',
 price numeric(12,2) not null default 0 check (price >= 0),
 status text not null default 'New',
 constraint item_status_valid check (status in ('New','Pretreatment','Powder Coating','Curing / QC','Ready for Collection','Collected'))
);
create table if not exists public.job_history (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
 status text not null, changed_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id) on delete cascade,
 kind text not null check(kind in ('delay','collection')),
 status text not null default 'draft' check(status in ('draft','approved','pending_integration','sent','failed')),
 message text not null default '', created_at timestamptz not null default now(),
 unique(job_id,kind)
);
create index if not exists jobs_due_idx on public.jobs(due_date);
create index if not exists job_items_job_idx on public.job_items(job_id);
create index if not exists notifications_job_idx on public.notifications(job_id);
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.staff where user_id = (select auth.uid()));
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated;
-- No public/anonymous access to customer or job data.
alter table public.staff enable row level security;
alter table public.customers enable row level security;
alter table public.jobs enable row level security;
alter table public.job_items enable row level security;
alter table public.job_history enable row level security;
alter table public.notifications enable row level security;
create policy staff_read_self on public.staff for select to authenticated using (user_id = (select auth.uid()));
create policy customers_staff on public.customers for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy jobs_staff on public.jobs for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy items_staff on public.job_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy history_staff on public.job_history for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy notifications_staff on public.notifications for all to authenticated using (public.is_staff()) with check (public.is_staff());
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 values ('invoices','invoices',false,10485760,array['application/pdf'])
 on conflict(id) do update set public=false, file_size_limit=10485760,allowed_mime_types=array['application/pdf'];
create policy invoice_staff_read on storage.objects for select to authenticated using (bucket_id='invoices' and public.is_staff());
create policy invoice_staff_upload on storage.objects for insert to authenticated with check (bucket_id='invoices' and public.is_staff());
create policy invoice_staff_delete on storage.objects for delete to authenticated using (bucket_id='invoices' and public.is_staff());
-- IMPORTANT: after creating a user in Authentication > Users, run separately:
-- insert into public.staff (user_id,display_name) values ('REPLACE-WITH-AUTH-USER-UUID','Office Admin');
