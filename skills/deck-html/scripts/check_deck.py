#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deck-html 稿子体检。

用法:
    python3 check_deck.py <稿子目录>          # 默认当前目录
    python3 check_deck.py <稿子目录> --strict  # warn 也计入失败

退出码: 0 全过 / 1 有 error（--strict 时 warn 也算）/ 2 目录不对

检查项（E=error 会挡住，W=warn 只提示）:
  E1  框架文件齐全           index.html / deck.css / deck.js / deck.config.js / notes.js
  E2  index.html 正确引用    四个文件都 <link>/<script> 上了，加载顺序对
  E3  每页有 data-t 且唯一   演讲者视图、台词、预览条全靠它
  E4  notes.js ↔ data-t     双向一一对应，不许有孤儿
  E5  渐变文字登记齐全       CSS 里 background-clip:text 的选择器必须在 gradientText 里
  E6  动画延迟类不越界       .dN 的 N 不能超过 deck.css 定义的上限
  E7  台阶条 map 指向存在    rail.map 的 key 必须是某页的 data-t
  E8  导出库存在             lib/html2canvas.min.js + lib/pptxgen.bundle.js
  W1  素材文件缺失           data-src / data-avatar 指向的文件不在（占位是合法状态）
  W2  写死的 <img src>       幻灯里应走 data-src 机制，否则图没就位会留空洞
  W3  幻灯里有 id=           演讲者视图克隆会剥掉 id，依赖 id 的逻辑在缩略图里会失效
  W4  台词缺失或时长为 0     现场没词可念
  W5  channel 还是模板默认值 两份稿子同时开会互相翻页
  W6  gradientText 登记多余  登记了但 CSS 里找不到对应的 background-clip:text

最后会打印页数与台词总时长，方便核对时间预算。
"""

import json
import os
import re
import sys

ERRORS = []
WARNS = []
INFO = []


def err(code, msg):
    ERRORS.append(f"[{code}] {msg}")


def warn(code, msg):
    WARNS.append(f"[{code}] {msg}")


def info(msg):
    INFO.append(msg)


def read(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- 解析辅助

def strip_html_comments(s):
    return re.sub(r"<!--.*?-->", "", s, flags=re.S)


def strip_js_comments(s):
    """去掉 /*...*/ 和整行 //...，保留字符串里的内容不做严格处理——
    这里只用于提取 key 和配置，够用。"""
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"(?m)^\s*//.*$", "", s)
    return s


def slide_sections(html):
    """返回 [(data-t or None, 该 section 的原始文本)]。"""
    out = []
    for m in re.finditer(
        r'<section\b([^>]*\bclass="[^"]*\bslide\b[^"]*"[^>]*)>(.*?)</section>',
        html, flags=re.S
    ):
        attrs, body = m.group(1), m.group(2)
        t = re.search(r'data-t="([^"]*)"', attrs)
        out.append((t.group(1) if t else None, body))
    return out


def notes_keys(js):
    """notes.js 顶层的 'key': { ... } —— 只认行首（可含缩进）的单引号 key。"""
    js = strip_js_comments(js)
    return re.findall(r"(?m)^\s*'([^']+)'\s*:\s*\{", js)


def notes_secs(js):
    js = strip_js_comments(js)
    out = {}
    for k, sec in re.findall(r"(?m)^\s*'([^']+)'\s*:\s*\{\s*sec\s*:\s*(\d+)", js):
        out[k] = int(sec)
    return out


def config_field(js, name):
    """从 deck.config.js 抠一个字段的原始片段（够浅，不做真正的 JS 解析）。"""
    js = strip_js_comments(js)
    m = re.search(rf"\b{name}\s*:\s*", js)
    if not m:
        return None
    rest = js[m.end():].lstrip()
    if rest.startswith("null"):
        return "null"
    if rest[:1] in "[{":
        open_ch, close_ch = rest[0], "]" if rest[0] == "[" else "}"
        depth = 0
        for i, ch in enumerate(rest):
            if ch == open_ch:
                depth += 1
            elif ch == close_ch:
                depth -= 1
                if depth == 0:
                    return rest[: i + 1]
        return None
    m2 = re.match(r"""('[^']*'|"[^"]*"|[^,\n}]+)""", rest)
    return m2.group(1).strip() if m2 else None


def gradient_text_selectors(cfg_js):
    """gradientText 里登记的 sel 列表。"""
    blob = config_field(cfg_js, "gradientText") or ""
    return re.findall(r"""sel\s*:\s*['"]([^'"]+)['"]""", blob)


def css_gradient_text_selectors(css_blobs):
    """扫 CSS，找出用了 background-clip:text 的规则的选择器。
    做法：按 } 切块，块里出现 background-clip:text 就取它的选择器。"""
    found = []
    for blob in css_blobs:
        blob = re.sub(r"/\*.*?\*/", "", blob, flags=re.S)
        for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", blob):
            sel, body = m.group(1), m.group(2)
            if re.search(r"background-clip\s*:\s*text", body):
                for one in sel.split(","):
                    one = one.strip()
                    if one and not one.startswith("@") and ".exporting" not in one:
                        found.append(one)
    return found


def max_delay_class(css):
    ns = [int(n) for n in re.findall(r"\.d(\d+)\s*\{\s*animation-delay", css)]
    return max(ns) if ns else 0


# ---------------------------------------------------------------- 主体

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    strict = "--strict" in sys.argv
    root = os.path.abspath(args[0] if args else ".")

    if not os.path.isdir(root):
        print(f"目录不存在：{root}")
        return 2

    need = ["index.html", "deck.css", "deck.js", "deck.config.js", "notes.js"]
    missing = [n for n in need if not os.path.isfile(os.path.join(root, n))]
    if missing:
        err("E1", "缺文件：" + "、".join(missing))
    if "index.html" in missing:
        report(root, strict)
        return 1

    html_raw = read(os.path.join(root, "index.html"))
    html = strip_html_comments(html_raw)

    # ---- E2 引用与加载顺序
    for ref, pat in [
        ("deck.css",       r'<link[^>]+href="deck\.css"'),
        ("deck.config.js", r'<script[^>]+src="deck\.config\.js"'),
        ("notes.js",       r'<script[^>]+src="notes\.js"'),
        ("deck.js",        r'<script[^>]+src="deck\.js"'),
    ]:
        if not re.search(pat, html):
            err("E2", f"index.html 没引用 {ref}")
    pos = {}
    for ref in ["deck.config.js", "notes.js", "deck.js"]:
        m = re.search(rf'src="{re.escape(ref)}"', html)
        if m:
            pos[ref] = m.start()
    if len(pos) == 3 and not (pos["deck.config.js"] < pos["deck.js"]
                              and pos["notes.js"] < pos["deck.js"]):
        err("E2", "加载顺序不对：deck.config.js 和 notes.js 必须在 deck.js 之前")

    # ---- E3 data-t
    sections = slide_sections(html)
    if not sections:
        err("E3", "没找到任何 <section class=\"slide\">")
    names, seen, dup = [], set(), []
    for i, (t, _) in enumerate(sections, 1):
        if not t:
            err("E3", f"第 {i} 页没有 data-t")
            continue
        if t in seen:
            dup.append(t)
        seen.add(t)
        names.append(t)
    for d in sorted(set(dup)):
        err("E3", f"data-t 重复：{d}（台词和预览条会串页）")

    # ---- E4 / W4 台词对齐
    notes_js = read(os.path.join(root, "notes.js"))
    keys = notes_keys(notes_js)
    secs = notes_secs(notes_js)
    kset, nset = set(keys), set(names)
    for k in sorted(kset - nset):
        err("E4", f"notes.js 有台词 '{k}'，但页面没有这个 data-t（改名后忘了同步？）")
    for n in sorted(nset - kset):
        err("E4", f"页面有 '{n}'，但 notes.js 没写台词")
    for n in names:
        if n in kset and not secs.get(n):
            warn("W4", f"'{n}' 没写 sec，演讲者视图算不出本页进度")

    # ---- E5 渐变文字降级
    cfg_js = read(os.path.join(root, "deck.config.js"))
    inline_css = re.findall(r"<style[^>]*>(.*?)</style>", html, flags=re.S)
    linked_css = []
    for name in ["deck.css"]:
        p = os.path.join(root, name)
        if os.path.isfile(p):
            linked_css.append(read(p))
    used = css_gradient_text_selectors(inline_css + linked_css)
    reg = gradient_text_selectors(cfg_js)

    def norm(s):
        return re.sub(r"\s+", " ", s).strip()

    reg_n = {norm(r) for r in reg}
    for sel in sorted({norm(u) for u in used}):
        if sel not in reg_n:
            err("E5", f"渐变文字选择器 '{sel}' 没在 deck.config.js 的 gradientText 里登记，"
                      f"导出 PPTX 时这行字会是空白")
    for r in sorted(reg_n - {norm(u) for u in used}):
        warn("W6", f"gradientText 登记了 '{r}'，但 CSS 里找不到对应的 background-clip:text（多余？）")

    # ---- E6 动画延迟类
    deck_css = read(os.path.join(root, "deck.css")) if os.path.isfile(os.path.join(root, "deck.css")) else ""
    cap = max_delay_class(deck_css + "\n".join(inline_css))
    if cap:
        over = sorted({int(n) for n in re.findall(r'class="[^"]*\bd(\d+)\b', html)} - set(range(1, cap + 1)))
        for n in over:
            err("E6", f"用了 .d{n}，但 CSS 只定义到 .d{cap}（这个元素不会有入场延迟）")

    # ---- E7 rail.map
    rail = config_field(cfg_js, "rail")
    if rail and rail != "null":
        map_blob = ""
        mm = re.search(r"map\s*:\s*\{(.*?)\}", rail, flags=re.S)
        if mm:
            map_blob = mm.group(1)
        for k in re.findall(r"""['"]([^'"]+)['"]\s*:""", map_blob):
            if k not in nset:
                err("E7", f"rail.map 里的 '{k}' 不是任何一页的 data-t，台阶条会算错")
        steps = re.findall(r"\[\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\]", rail)
        lvls = [int(v) for v in re.findall(r"""['"][^'"]+['"]\s*:\s*(\d+)""", map_blob)]
        if steps and lvls and max(lvls) > len(steps):
            err("E7", f"rail.map 里出现了第 {max(lvls)} 级，但 rail.steps 只有 {len(steps)} 级")

    # ---- E8 导出库
    for lib in ["lib/html2canvas.min.js", "lib/pptxgen.bundle.js"]:
        if not os.path.isfile(os.path.join(root, lib)):
            err("E8", f"缺 {lib}，导出 PPTX 会直接报「导出库未加载」")

    # ---- W1 素材文件
    for attr in ["data-src", "data-avatar"]:
        for rel in re.findall(rf'{attr}="([^"]+)"', html):
            if not os.path.isfile(os.path.join(root, rel)):
                warn("W1", f"{attr} 指向的 {rel} 不存在（页面会保留占位框）")

    # ---- W2 写死 img
    for t, body in sections:
        if re.search(r"<img\b[^>]*\bsrc=", body):
            warn("W2", f"'{t}' 里有写死的 <img src>，建议改成 .imgslot[data-src] 自动装载")

    # ---- W3 幻灯里的 id
    for t, body in sections:
        ids = re.findall(r'\sid="([^"]+)"', body)
        if ids:
            warn("W3", f"'{t}' 里有 id={ids}，演讲者视图克隆时会被剥掉，"
                       f"依赖这些 id 的脚本在缩略图里会失效")

    # ---- W5 channel
    ch = config_field(cfg_js, "channel") or ""
    if "DECK_SLUG" in ch or ch.strip("'\"") in ("", "deck-html-sync"):
        warn("W5", f"channel 还是模板默认值 {ch}，改成这份稿子的唯一名字，"
                   f"否则同时开两份稿子会互相翻页")

    # ---- 汇总
    total = sum(secs.get(n, 0) for n in names)
    info(f"共 {len(names)} 页，台词合计 {total} 秒 ≈ {total/60:.1f} 分钟")
    if names:
        no_note = [n for n in names if n not in kset]
        if not no_note:
            info("台词覆盖 100%")

    return report(root, strict)


def report(root, strict):
    print(f"deck-html 体检 · {root}\n")
    for line in INFO:
        print(f"  ·  {line}")
    if INFO:
        print()
    for line in WARNS:
        print(f"  warn  {line}")
    for line in ERRORS:
        print(f"  ERROR {line}")
    if not WARNS and not ERRORS:
        print("  全过。")
    print(f"\n{len(ERRORS)} error / {len(WARNS)} warn")
    if ERRORS:
        return 1
    if strict and WARNS:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
