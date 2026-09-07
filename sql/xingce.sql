-- 行测作答云同步表（Supabase Postgres；docs/行测做题模块设计方案.md X3）
-- 执行：Supabase 控制台 → SQL Editor → 粘贴运行（幂等）
-- 约定与 sync.sql 一致：user_id + LWW（data.updatedAt），RLS 限本人
-- data 存 XgAnswer 原样：{ paperId, qIdx, picked, correct, seconds, origin, updatedAt }
-- 主键 key 为 `${paperId}#${qIdx}`（单键，无申论 traces/marks 双键问题）

create table if not exists public.xg_answers (
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.xg_answers enable row level security;

drop policy if exists "本人可读自己的行测作答" on public.xg_answers;
create policy "本人可读自己的行测作答" on public.xg_answers
  for select using (auth.uid() = user_id);

drop policy if exists "本人可写自己的行测作答" on public.xg_answers;
create policy "本人可写自己的行测作答" on public.xg_answers
  for insert with check (auth.uid() = user_id);

drop policy if exists "本人可更新自己的行测作答" on public.xg_answers;
create policy "本人可更新自己的行测作答" on public.xg_answers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 同步保活任务收录新表（sql/sync.sql 的 keepalive 已按列表排除，这里不重复建函数）
