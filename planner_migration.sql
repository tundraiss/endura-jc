-- ENDURA JC V4 Phase 3 enhancement: separate production schedule from promised due date.
-- Safe to rerun; does not change existing job due dates or RLS policies.
alter table public.jobs add column if not exists planned_date date;
create index if not exists jobs_planned_date_idx on public.jobs (planned_date);
