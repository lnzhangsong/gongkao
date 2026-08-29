#!/usr/bin/env python3
"""重建 public/fonts 自托管字体子集。

字符源 = 现有子集字符 ∪ src/**/*.{ts,tsx,css,html} 的全部字符
（新增标题/文案后跑一次即可，新字符自动进入子集）。

用法：
  python3 scripts/build-font-subset.py [原始字体路径]
  原始字体默认从 /tmp/MaShanZheng-Regular.ttf 读取（下载：
  https://github.com/google/fonts/raw/main/ofl/mashanzheng/MaShanZheng-Regular.ttf）
"""
import glob
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_FONT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/MaShanZheng-Regular.ttf'
OUT = os.path.join(ROOT, 'public', 'fonts', 'ma-shan-zheng.woff2')


def existing_subset_chars():
    from fontTools.ttLib import TTFont
    try:
        f = TTFont(OUT)
        return {chr(c) for c in f.getBestCmap() if c > 0x20}
    except Exception:
        return set()


def source_chars():
    chars = set()
    patterns = [
        os.path.join(ROOT, 'src', '**', '*.ts'),
        os.path.join(ROOT, 'src', '**', '*.tsx'),
        os.path.join(ROOT, 'src', '**', '*.css'),
        os.path.join(ROOT, 'index.html'),
    ]
    for pat in patterns:
        for path in glob.glob(pat, recursive=True):
            with open(path, encoding='utf-8', errors='ignore') as fh:
                chars.update(fh.read())
    return chars


def main():
    from fontTools.ttLib import TTFont
    if not os.path.exists(SRC_FONT):
        sys.exit(f'原始字体不存在：{SRC_FONT}\n先下载：https://github.com/google/fonts/raw/main/ofl/mashanzheng/MaShanZheng-Regular.ttf')
    font = TTFont(SRC_FONT)
    cmap = set(font.getBestCmap().keys())

    text = existing_subset_chars() | source_chars()
    text = {c for c in text if ord(c) in cmap and ord(c) > 0x20}
    text_file = '/tmp/font-subset-chars.txt'
    with open(text_file, 'w', encoding='utf-8') as fh:
        fh.write(''.join(sorted(text)))
    print(f'子集字符数：{len(text)}')

    subprocess.run(
        [
            sys.executable, '-m', 'fontTools.subset', SRC_FONT,
            f'--text-file={text_file}',
            f'--output-file={OUT}',
            '--flavor=woff2',
            '--layout-features=*',
            '--name-IDs=*',
        ],
        check=True,
    )
    out = TTFont(OUT)
    have = {hex(c) for c in out.getBestCmap() if c in (0x6210, 0x628A, 0x771F, 0x9898, 0x8BFB, 0x7D20, 0x6750)}
    print(f'输出：{OUT}（{os.path.getsize(OUT) // 1024} KB），标题字符齐全：{len(have) == 7}')


if __name__ == '__main__':
    main()
