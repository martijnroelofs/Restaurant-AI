-- ─── RoosterAI Database Schema ────────────────────────────────────────────────

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────
create type contract_type as enum ('vast', 'oproep', 'min_max', 'stagiair');
create type leave_status as enum ('pending', 'approved', 'rejected');
create type swap_status as enum ('pending', 'approved', 'rejected');
create type roster_status as enum ('concept', 'review', 'published');
create type dept_key as enum ('bar', 'wijkloper', 'runner', 'keuken', 'spoelkeuken');
create type slot_type as enum ('Ochtend', 'Middag', 'Avond', 'Dubbel', 'Split');

-- ─── Organisations (multi-restaurant support) ─────────────────────────────────
create table organisations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  created_at timestamptz default now()
);

-- ─── Staff profiles ───────────────────────────────────────────────────────────
create table staff (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  auth_id uuid references auth.users(id) on delete set null,
  name text not null,
  role text,
  email text,
  color text default '#1D4ED8',
  contract_type contract_type default 'vast',
  contract_hours numeric default 20,    -- hours/week for 'vast'
  min_hours numeric default 8,          -- for min_max contracts
  max_hours numeric default 32,         -- for min_max contracts
  hourly_rate numeric default 13.50,    -- admin only
  depts dept_key[] default '{}',
  is_active boolean default true,
  is_admin boolean default false,
  created_at timestamptz default now()
);

-- ─── Shift templates ──────────────────────────────────────────────────────────
create table shift_templates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes int default 30,
  color text default '#1D4ED8',
  created_at timestamptz default now(),
  unique(org_id, name)
);

-- Default shifts inserted per org via function
create or replace function create_default_shifts(p_org_id uuid)
returns void language plpgsql as $$
begin
  insert into shift_templates(org_id,name,start_time,end_time,break_minutes,color) values
    (p_org_id,'Ochtend','08:00','14:00',30,'#1D4ED8'),
    (p_org_id,'Middag','12:00','18:00',30,'#C4882A'),
    (p_org_id,'Avond','17:00','23:00',30,'#5E30A0'),
    (p_org_id,'Dubbel','10:00','22:00',60,'#B84C2C'),
    (p_org_id,'Split','11:00','15:00',0,'#0A7B8A');
end;
$$;

-- ─── Bezetting template ───────────────────────────────────────────────────────
-- day_of_week: 0=Monday, 6=Sunday
create table template_slots (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  day_of_week int check(day_of_week between 0 and 6),
  dept dept_key,
  shift_name text,           -- references shift_templates.name
  count int default 1,
  is_recurring boolean default true,   -- repeats every week
  specific_date date,                  -- if not recurring
  created_at timestamptz default now()
);

-- ─── Peak moments ─────────────────────────────────────────────────────────────
create table peak_moments (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  date date not null,
  label text,
  slots int default 7,  -- bitmask: 1=Ochtend 2=Middag 4=Avond 7=All
  created_at timestamptz default now()
);

-- ─── Public holidays / feestdagen ────────────────────────────────────────────
create table public_holidays (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  date date not null,
  name text not null,
  is_closed boolean default true,
  created_at timestamptz default now()
);

-- Holiday override slots (when not closed)
create table holiday_slots (
  id uuid primary key default uuid_generate_v4(),
  holiday_id uuid references public_holidays(id) on delete cascade,
  dept dept_key,
  shift_name text,
  count int default 1
);

-- ─── Availability ─────────────────────────────────────────────────────────────
-- Weekly pattern: bitmask per day (1=Ochtend 2=Middag 4=Avond 7=All)
create table availability_patterns (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references staff(id) on delete cascade,
  day_of_week int check(day_of_week between 0 and 6),
  slots int default 7,
  updated_at timestamptz default now(),
  unique(staff_id, day_of_week)
);

-- Date-specific overrides
create table availability_overrides (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references staff(id) on delete cascade,
  date date not null,
  slots int,  -- null = unavailable all day
  updated_at timestamptz default now(),
  unique(staff_id, date)
);

-- ─── Rosters ──────────────────────────────────────────────────────────────────
create table rosters (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  week_start date not null,  -- always Monday
  status roster_status default 'concept',
  published_at timestamptz,
  created_at timestamptz default now(),
  unique(org_id, week_start)
);

-- Individual assignments
create table roster_assignments (
  id uuid primary key default uuid_generate_v4(),
  roster_id uuid references rosters(id) on delete cascade,
  staff_id uuid references staff(id) on delete cascade,
  date date not null,
  shift_name text not null,
  dept dept_key,
  custom_start time,   -- override shift start
  custom_end time,     -- override shift end
  created_at timestamptz default now(),
  unique(roster_id, staff_id, date)
);

-- ─── Leave requests ───────────────────────────────────────────────────────────
create table leave_requests (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references staff(id) on delete cascade,
  date date not null,
  reason text,
  status leave_status default 'pending',
  reviewed_by uuid references staff(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- ─── Swap requests ────────────────────────────────────────────────────────────
create table swap_requests (
  id uuid primary key default uuid_generate_v4(),
  from_staff_id uuid references staff(id) on delete cascade,
  to_staff_id uuid references staff(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  status swap_status default 'pending',
  reviewed_by uuid references staff(id),
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- ─── Overtime tracking ────────────────────────────────────────────────────────
create table overtime_log (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references staff(id) on delete cascade,
  roster_id uuid references rosters(id) on delete cascade,
  hours_worked numeric,
  hours_contract numeric,
  overtime_hours numeric,
  compensated_hours numeric default 0,
  created_at timestamptz default now(),
  unique(staff_id, roster_id)
);

-- ─── Capacity scores ──────────────────────────────────────────────────────────
create table capacity_scores (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references staff(id) on delete cascade,
  dept dept_key,
  score int default 5 check(score between 1 and 10),
  updated_at timestamptz default now(),
  unique(staff_id, dept)
);

-- ─── Push subscriptions ───────────────────────────────────────────────────────
create table push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  staff_id uuid references staff(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now(),
  unique(staff_id, endpoint)
);

-- ─── Email log ────────────────────────────────────────────────────────────────
create table email_log (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organisations(id) on delete cascade,
  to_email text,
  subject text,
  status text,
  sent_at timestamptz default now()
);

-- ─── Settings ─────────────────────────────────────────────────────────────────
create table org_settings (
  org_id uuid primary key references organisations(id) on delete cascade,
  resend_api_key text,
  sender_email text default 'rooster@restaurant.nl',
  auto_email_enabled boolean default true,
  auto_email_day int default 10,
  max_days_per_week int default 5,
  max_overtime_hours numeric default 4,
  min_rest_hours numeric default 11,
  manager_pin text default '0000',
  update_code text default 'UPDATE2025',
  update_url text
);

-- ─── RLS Policies ─────────────────────────────────────────────────────────────
alter table organisations enable row level security;
alter table staff enable row level security;
alter table shift_templates enable row level security;
alter table template_slots enable row level security;
alter table rosters enable row level security;
alter table roster_assignments enable row level security;
alter table leave_requests enable row level security;
alter table swap_requests enable row level security;
alter table availability_patterns enable row level security;
alter table availability_overrides enable row level security;
alter table capacity_scores enable row level security;
alter table overtime_log enable row level security;
alter table peak_moments enable row level security;
alter table public_holidays enable row level security;
alter table holiday_slots enable row level security;
alter table push_subscriptions enable row level security;
alter table email_log enable row level security;
alter table org_settings enable row level security;

-- Staff can read their own org data
create policy "staff_read_own_org" on staff
  for select using (
    org_id in (
      select org_id from staff where auth_id = auth.uid()
    )
  );

-- Admin can do everything in their org
create policy "admin_all" on staff
  for all using (
    org_id in (
      select org_id from staff where auth_id = auth.uid() and is_admin = true
    )
  );

-- Helper: get current staff's org_id
create or replace function get_my_org_id()
returns uuid language sql security definer as $$
  select org_id from staff where auth_id = auth.uid() limit 1;
$$;

-- Helper: is current user admin
create or replace function is_admin()
returns boolean language sql security definer as $$
  select coalesce(is_admin, false) from staff where auth_id = auth.uid() limit 1;
$$;

-- Apply org-scoped policies to all tables
create policy "org_read" on rosters for select using (org_id = get_my_org_id());
create policy "org_admin_write" on rosters for all using (org_id = get_my_org_id() and is_admin());
create policy "org_read_shifts" on shift_templates for select using (org_id = get_my_org_id());
create policy "org_admin_shifts" on shift_templates for all using (org_id = get_my_org_id() and is_admin());
create policy "org_read_slots" on template_slots for select using (org_id = get_my_org_id());
create policy "org_admin_slots" on template_slots for all using (org_id = get_my_org_id() and is_admin());
create policy "org_read_peaks" on peak_moments for select using (org_id = get_my_org_id());
create policy "org_admin_peaks" on peak_moments for all using (org_id = get_my_org_id() and is_admin());
create policy "org_read_holidays" on public_holidays for select using (org_id = get_my_org_id());
create policy "org_admin_holidays" on public_holidays for all using (org_id = get_my_org_id() and is_admin());
create policy "org_read_settings" on org_settings for select using (org_id = get_my_org_id() and is_admin());
create policy "org_admin_settings" on org_settings for all using (org_id = get_my_org_id() and is_admin());
create policy "read_assignments" on roster_assignments for select using (
  roster_id in (select id from rosters where org_id = get_my_org_id())
);
create policy "admin_assignments" on roster_assignments for all using (
  roster_id in (select id from rosters where org_id = get_my_org_id()) and is_admin()
);
create policy "own_avail_pattern" on availability_patterns for all using (
  staff_id in (select id from staff where auth_id = auth.uid())
  or is_admin()
);
create policy "own_avail_override" on availability_overrides for all using (
  staff_id in (select id from staff where auth_id = auth.uid())
  or is_admin()
);
create policy "own_leave" on leave_requests for select using (
  staff_id in (select id from staff where auth_id = auth.uid())
  or is_admin()
);
create policy "own_leave_insert" on leave_requests for insert with check (
  staff_id in (select id from staff where auth_id = auth.uid())
);
create policy "admin_leave" on leave_requests for update using (is_admin());
create policy "own_swap" on swap_requests for select using (
  from_staff_id in (select id from staff where auth_id = auth.uid())
  or to_staff_id in (select id from staff where auth_id = auth.uid())
  or is_admin()
);
create policy "own_swap_insert" on swap_requests for insert with check (
  from_staff_id in (select id from staff where auth_id = auth.uid())
);
create policy "admin_swap" on swap_requests for update using (is_admin());
create policy "admin_capacity" on capacity_scores for all using (is_admin());
create policy "read_capacity" on capacity_scores for select using (
  staff_id in (select id from staff where auth_id = auth.uid())
);
create policy "own_push" on push_subscriptions for all using (
  staff_id in (select id from staff where auth_id = auth.uid())
);
create policy "admin_email_log" on email_log for select using (org_id = get_my_org_id() and is_admin());
create policy "overtime_read" on overtime_log for select using (
  staff_id in (select id from staff where auth_id = auth.uid()) or is_admin()
);
create policy "admin_overtime" on overtime_log for all using (is_admin());
