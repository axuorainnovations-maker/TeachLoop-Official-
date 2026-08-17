create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  email       text unique,
  name        text,
  motivation  text,
  improve     text,
  age         text,
  level       text,
  goal        text,
  subject     text,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "anon can insert profiles"
  on public.profiles for insert to anon with check (true);

create policy "users manage their own profile"
  on public.profiles for all to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
