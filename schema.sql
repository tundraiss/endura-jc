-- ENDURA JC v3 proposed PostgreSQL schema for future hosted deployment.
-- Not connected to the standalone browser prototype.
create extension if not exists pgcrypto;
create table customers (id uuid primary key default gen_random_uuid(), name text not null, whatsapp_number text, sage_customer_id text, created_at timestamptz not null default now());
create table jobs (id uuid primary key default gen_random_uuid(), job_number text unique not null, customer_id uuid not null references customers(id), received_on date not null default current_date, due_on date not null, stage text not null default 'New Job' check(stage in ('New Job','Pretreatment','Powder Coating','Curing / QC','Ready for Collection','Collected')), notes text, updated_at timestamptz not null default now(), created_at timestamptz not null default now());
create table job_items (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id) on delete cascade, description text not null, quantity integer not null check(quantity>0), colour text, stage text not null default 'New Job', position integer not null default 0);
create table invoices (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id) on delete cascade, source text not null check(source in ('upload','sage')), storage_path text, sage_invoice_id text, file_name text, created_at timestamptz not null default now());
create table job_events (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id) on delete cascade, event_type text not null, detail text, actor_id uuid, created_at timestamptz not null default now());
create table message_approvals (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id) on delete cascade, kind text not null check(kind in ('ready','delay')), message_text text, status text not null default 'pending' check(status in ('pending','approved','sent','failed','dismissed')), approved_by uuid, approved_at timestamptz, sent_at timestamptz, provider_message_id text, created_at timestamptz not null default now());
create index jobs_due_idx on jobs(due_on,stage);
create index job_items_job_idx on job_items(job_id);
create index message_approvals_status_idx on message_approvals(status);
-- Production requirements: Supabase Auth, tenant/user role mappings, RLS policies,
-- private invoice storage with signed URLs, server-side WhatsApp send worker,
-- webhook delivery statuses, explicit customer opt-in, and Sage API credentials.
