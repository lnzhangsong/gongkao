/**
 * 全文搜索 FTS5 迁移：为 data/articles.db 建 trigram 分词的 FTS5 虚表 + 同步触发器。
 * trigram 分词支持中文子串匹配（默认 unicode61 对中文整段成词，无法检索）。
 * 查询端：api-server.mjs queryMetaList —— 关键词 ≥3 字符走 FTS，短词回退 LIKE/instr。
 *
 * 用法：node scripts/migrate-fts.mjs   （幂等，可重复执行）
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const db = new DatabaseSync(path.join(ROOT, 'data', 'articles.db'))

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
    id UNINDEXED, title, summary, content, tokenize='trigram'
  );
  CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(rowid, id, title, summary, content)
    VALUES (new.rowid, new.id, new.title, new.summary, new.content_json);
  END;
  CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
    DELETE FROM articles_fts WHERE rowid = old.rowid;
  END;
  CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE ON articles BEGIN
    DELETE FROM articles_fts WHERE rowid = old.rowid;
    INSERT INTO articles_fts(rowid, id, title, summary, content)
    VALUES (new.rowid, new.id, new.title, new.summary, new.content_json);
  END;
`)

// 全量重建（幂等：清空后重灌，保证与 articles 表一致）
db.exec('DELETE FROM articles_fts')
db.exec(`
  INSERT INTO articles_fts(rowid, id, title, summary, content)
  SELECT rowid, id, title, summary, content_json FROM articles
`)

const n = db.prepare('SELECT COUNT(*) AS n FROM articles_fts').get().n
console.log(`articles_fts 就绪：${n} 篇已入索引`)
