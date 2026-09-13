#!/usr/bin/env python3
"""一次性迁移：data/xingce/*.json 的 image/groupImage 由 base64 data URL 改为文件引用

背景：旧管线把裁片以 base64 塞进 JSON（import-xingce.mjs 再解码落盘），同一张图在 git 里
存了两份、且每次重裁都重写 MB 级 JSON。新约定是 **JSON 只存引用**：

    "image": [{"file": "q73_0.webp", "w": 1137, "h": 44}]

图片字节只存在于 data/xingce-img/{paper_id}/（裁图脚本直接落盘）。
本脚本把历史 JSON 从旧格式就地改写为新格式；图片文件此前已由 import 落盘，这里只做校验，
文件缺失时用 data URL 现场补写。对已是新格式（数组）的字段跳过，可重复运行。

用法：python3 scripts/migrate-xingce-images-to-files.py
"""
import argparse
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_URL_RE = re.compile(r"data:image/([a-zA-Z0-9.+-]+);base64,(.*)$", re.S)


def migrate_field(paper_id: str, field: str, key: int, value, img_dir: Path):
    """旧格式（JSON 字符串形式的 data URL 列表）→ (新引用列表 | None, 补写的文件名列表)。"""
    if not value or not isinstance(value, str):
        return None, []
    try:
        items = json.loads(value)
    except json.JSONDecodeError:
        return None, []
    if not isinstance(items, list):
        items = [items]
    kind = "q" if field == "image" else "g"
    refs, recovered = [], []
    for i, it in enumerate(items):
        u = it if isinstance(it, str) else (it.get("u") or "")
        m = DATA_URL_RE.match(u)
        ext = (m.group(1) if m else "webp").replace("jpeg", "jpg")
        name = f"{kind}{key}_{i}.{ext}"
        path = img_dir / paper_id / name
        if not path.exists() and m:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(m.group(2)))
            recovered.append(name)
        refs.append({"file": name, "w": it.get("w", 0) if isinstance(it, dict) else 0, "h": it.get("h", 0) if isinstance(it, dict) else 0})
    return refs, recovered


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json-dir", type=Path, default=ROOT / "data" / "xingce")
    ap.add_argument("--img-dir", type=Path, default=ROOT / "data" / "xingce-img")
    args = ap.parse_args()

    for jp in sorted(args.json_dir.glob("guokao-xingce-*.json")):
        paper = json.loads(jp.read_text(encoding="utf-8"))
        pid = paper["id"]
        changed = 0
        recovered: list[str] = []
        for q in paper["questions"]:
            refs, rec = migrate_field(pid, "image", q["idx"], q.get("image"), args.img_dir)
            if refs is not None:
                q["image"] = refs
                changed += 1
                recovered += rec
            if q.get("groupId") is not None:
                refs, rec = migrate_field(pid, "groupImage", q["groupId"], q.get("groupImage"), args.img_dir)
                if refs is not None:
                    q["groupImage"] = refs
                    changed += 1
                    recovered += rec
        if changed:
            jp.write_text(json.dumps(paper, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{jp.name}: 改写 {changed} 个字段" + (f"，补写文件 {sorted(set(recovered))}" if recovered else ""))


if __name__ == "__main__":
    main()
