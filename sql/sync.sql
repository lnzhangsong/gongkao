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

-- ---------- v3：产品埋点 — 已废弃 ----------
-- 曾自建 app_events 表承载 pageview 与功能事件；现改由 PostHog 云承载
-- （前端 src/lib/analytics.ts，见 docs/产品埋点设计方案.md），故整表下线。
-- 保留这段 drop 是为了让已建过表的环境重跑本文件即清理干净——顺带移除原先
-- 「任何人可 insert」的宽松策略（匿名上报不再需要，留着等于开一个公开写入口）。
drop table if exists public.app_events;

-- ---------- v4：LWW 时间戳改由服务端赋值 ----------
-- 问题：客户端用本机墙钟（new Date().toISOString()）作 updated_at，设备间时钟偏差
--       会让「较新的写入」被判成旧的而被忽略。
-- 处理：所有同步表的 updated_at 一律由数据库 now() 覆盖（客户端传什么都会被替换），
--       客户端下一次 pull 读回服务端时间戳写进 meta，LWW 基准即统一到服务端时钟。
-- 注：learning_events 是 append-only 且只有 created_at（无 updated_at），不挂触发器；
--     其余表才有 updated_at 列。now() 是事务开始时间，同一批 upsert 的多行会拿到相同
--     时间戳——当前 pull 走全表比对（非 incremental watermark），不会因此漏行。
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'reading_progress', 'annotations', 'article_study', 'exam_study',
    'user_prefs', 'ai_assists', 'article_edits', 'user_ai_config'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t
    );
  end loop;
end $$;
