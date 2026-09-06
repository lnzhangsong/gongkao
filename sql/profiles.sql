-- profiles：账号体系用户资料表（Vercel Postgres）
-- 前置：Vercel 项目已创建 Postgres 库（Storage → Create Database）。
-- 执行：把 DATABASE_URL 配到环境后，用任意 psql 客户端或 Vercel 控制台执行本脚本。
--       身份认证本身由 Supabase Auth 承担，本表只存展示资料，id 即 Supabase auth.users.id。

CREATE TABLE IF NOT EXISTS profiles (
  id           text PRIMARY KEY,              -- Supabase auth.users.id
  email        text,
  nickname     text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- 后续数据同步（阅读进度/笔记等）都以 user_id = profiles.id 关联
CREATE INDEX IF NOT EXISTS profiles_last_seen_idx ON profiles (last_seen_at DESC);
