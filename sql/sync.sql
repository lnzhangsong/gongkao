-- 数据云同步表（Supabase Postgres）
-- 执行：Supabase 控制台 → SQL Editor → 粘贴运行（可重复执行，幂等）
-- 约定：
--   所有表带 user_id，RLS 限定 user_id = auth.uid()，anon key 直连安全
--   合并策略为按行 LWW：客户端比较行内时间戳，仅应用比本地新的行
--   data jsonb 存各 store 的原始行对象，schema 演进由前端兼容

-- 1) 阅读进度：每篇文章一行，行内 last_read_at 兼作 LWW 依据
create table if not exists public.reading_progress (
  user_id    uuid not null references auth.users (id) on delete cascade,
  article_id text not null,
  data       jsonb not null,          -- ReadingProgress 原样
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

-- 2) 摘录标注：每条一行；deleted = true 为墓碑（其他设备据此本地删除）
create table if not exists public.annotations (
  user_id    uuid not null references auth.users (id) on delete cascade,
  ann_id     text not null,           -- Annotation.id
  data       jsonb,                   -- Annotation 原样（墓碑行可为 null）
  deleted    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, ann_id)
);
create index if not exists annotations_user_updated_idx on public.annotations (user_id, updated_at);

-- 3) 申论学习：每篇文章一行（ArticleStudy 原样，含 updatedAt）
create table if not exists public.article_study (
  user_id    uuid not null references auth.users (id) on delete cascade,
  article_id text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

-- 4) 真题作答：traces / marks 两种 kind，key 为 "paperId#qIdx"
create table if not exists public.exam_study (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('trace', 'mark')),
  key        text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, key)
);

-- 5) 学习事件：append-only，按事件 id upsert，天然无冲突
create table if not exists public.learning_events (
  user_id    uuid not null references auth.users (id) on delete cascade,
  event_id   text not null,           -- LearningEvent.id
  data       jsonb not null,          -- LearningEvent 原样
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- 6) 偏好设置：单行整包（readerStore.settings + themeStore），行级 LWW
create table if not exists public.user_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,          -- { reader: ReaderSettings, theme: { theme, autoDark } }
  updated_at timestamptz not null default now()
);

-- ---------- RLS：全部限本人读写 ----------
alter table public.reading_progress enable row level security;
alter table public.annotations      enable row level security;
alter table public.article_study    enable row level security;
alter table public.exam_study       enable row level security;
alter table public.learning_events  enable row level security;
alter table public.user_prefs       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['reading_progress', 'annotations', 'article_study', 'exam_study', 'learning_events', 'user_prefs']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_own', t
    );
  end loop;
end $$;

-- ---------- v2 补充：全量数据同步 ----------

-- 7) AI 审题/作答框架：每条记录一行（AssistRecord 原样，含 updatedAt）
create table if not exists public.ai_assists (
  user_id    uuid not null references auth.users (id) on delete cascade,
  assist_id  text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, assist_id)
);

-- 8) 文章本地编辑（管理端改写/新增的文章全文）
create table if not exists public.article_edits (
  user_id    uuid not null references auth.users (id) on delete cascade,
  article_id text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, article_id)
);

-- 9) AI 服务配置（BYOK：baseUrl / apiKey / model 整包）
--    ⚠️ apiKey 明文存于本表，受 RLS 保护仅本人可读；不需要同步 key 时删掉本表并在
--    src/lib/cloudSync.ts 里移除 user_ai_config 的 push/pull 即可
create table if not exists public.user_ai_config (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.ai_assists     enable row level security;
alter table public.article_edits  enable row level security;
alter table public.user_ai_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ai_assists', 'article_edits', 'user_ai_config']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_own', t
    );
  end loop;
end $$;

-- ---------- v3：产品埋点（匿名可写、仅本人可读） ----------
-- 前端 src/lib/analytics.ts 写入：pageview + 关键功能事件，用于了解使用情况
create table if not exists public.app_events (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  visitor_id text not null,              -- 匿名访客 id（localStorage 随机 uuid，不涉个人身份）
  user_id    uuid references auth.users (id) on delete set null,  -- 登录时带上，匿名时为 null
  name       text not null,              -- 'pageview' / 'auth_login' / ...
  path       text,                       -- 页面路径
  props      jsonb                       -- 事件附加信息
);

create index if not exists app_events_name_ts_idx on public.app_events (name, ts desc);

alter table public.app_events enable row level security;

-- 任何人可写（埋点需要匿名上报）；能不能写进来仍受 Supabase 速率约束
drop policy if exists "任何人可上报埋点" on public.app_events;
create policy "任何人可上报埋点" on public.app_events
  for insert with check (true);

-- 只能看自己的行（匿名行谁也看不了，只能进 SQL Editor 聚合分析）
drop policy if exists "本人可读自己的埋点" on public.app_events;
create policy "本人可读自己的埋点" on public.app_events
  for select using (auth.uid() = user_id);
