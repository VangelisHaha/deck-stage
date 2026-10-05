#!/usr/bin/env python3
"""
拆分稿体检。

大稿子把页面拆在 acts/、台词拆在 notes/、样式拆在 css/ 里（见 references/split-deck.md），
而 check_deck.py 只认单文件结构。这里把拆开的文件拼回单文件结构放到临时目录，
再交给 check_deck.py 校验，规则一条不少。

用法：
  python3 check_split.py <稿子目录> [--strict]
  （省略目录则用当前目录）

约定：
  index.html 里 <div id="slides"></div> 是空的，页面由 acts/*.js 里的 __act(`<section…>`) 追加；
  台词由 notes/*.js 里的 __note({ … }) 合并进 window.__NOTES；
  样式由 <link rel="stylesheet" href="css/…"> 引入。
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

CHECKER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "check_deck.py")


def main():
    args = sys.argv[1:]
    root = os.getcwd()
    if args and not args[0].startswith("--"):
        root = os.path.abspath(args.pop(0))

    def read(p):
        with open(os.path.join(root, p), encoding="utf-8") as f:
            return f.read()

    if not os.path.isfile(os.path.join(root, "index.html")):
        sys.exit(f"[check_split] {root} 里没有 index.html")

    html = read("index.html")
    acts = re.findall(r'<script src="(acts/[^"]+)"></script>', html)
    notes = re.findall(r'<script src="(notes/[^"]+)"></script>', html)

    sections = []
    for a in acts:
        m = re.search(r"__act\(`(.*)`\);", read(a), re.S)
        if not m:
            sys.exit(f"[check_split] {a} 没找到 __act(`…`)")
        sections.append(m.group(1))
    if '<div id="slides"></div>' not in html:
        sys.exit('[check_split] index.html 里没有空的 <div id="slides"></div>，拆分稿的页面应由 acts/ 追加')
    merged_html = html.replace('<div id="slides"></div>', '<div id="slides">' + "\n".join(sections) + "</div>")

    # 官方脚本扫内联 <style> 找 background-clip:text，所以把 css/ 内联进去
    css = "".join(read(p) for p in re.findall(r'<link rel="stylesheet" href="(css/[^"]+)">', html))
    merged_html = merged_html.replace("</head>", "<style>\n" + css + "\n</style>\n</head>")

    bodies = []
    for n in notes:
        m = re.search(r"__note\(\{(.*)\}\);", read(n), re.S)
        if not m:
            sys.exit(f"[check_split] {n} 没找到 __note({{…}})")
        bodies.append(m.group(1).strip().rstrip(","))
    merged_notes = "window.__NOTES = {\n" + ",\n".join(bodies) + "\n};\n"

    tmp = tempfile.mkdtemp(prefix="deck-check-")
    try:
        for f in ["deck.css", "deck.js", "deck.config.js"]:
            shutil.copy(os.path.join(root, f), tmp)
        shutil.copytree(os.path.join(root, "lib"), os.path.join(tmp, "lib"))
        os.makedirs(os.path.join(tmp, "assets"), exist_ok=True)
        with open(os.path.join(tmp, "index.html"), "w", encoding="utf-8") as f:
            f.write(merged_html)
        with open(os.path.join(tmp, "notes.js"), "w", encoding="utf-8") as f:
            f.write(merged_notes)
        r = subprocess.run([sys.executable, CHECKER, tmp] + args)
        sys.exit(r.returncode)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
