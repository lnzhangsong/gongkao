-- profiles：用户资料表（Supabase Postgres，与 auth.users 同库）
-- 执行：Supabase 控制台 → SQL Editor → 粘贴运行
-- 身份认证由 Supabase Auth 承担，本表只存展示资料，id 即 auth.users.id；
-- RLS 保证每个人只能读写自己的行，anon key 直连安全。

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  nickname   text check (char_length(nickname) <= 24),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "本人可读自己的 profile" on public.profiles;
create policy "本人可读自己的 profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "本人可插入自己的 profile" on public.profiles;
create policy "本人可插入自己的 profile" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "本人可更新自己的 profile" on public.profiles;
create policy "本人可更新自己的 profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 注册即建行：新用户在 auth.users 落库时自动写入空 profile
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
