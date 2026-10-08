#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
deck-html 稿子体检（单文件稿、拆分稿都用它）。

用法:
    python3 check_deck.py <稿子目录>          # 默认当前目录
    python3 check_deck.py <稿子目录> --strict  # warn 也计入失败

退出码: 0 全过 / 1 有 error（--strict 时 warn 也算）/ 2 目录不对

拆分稿的 <!-- @include 相对路径 --> 会先展开（规则和 DeckStage 一致），再按整份稿子检查。

检查项（E=error 会挡住，W=warn 只提示）:
  E1  必需文件齐全           index.html、notes.js
  E2  引用与加载顺序         引用了 /_deckstage/deck.css 和 /_deckstage/deck.js；
                             notes.js（及 notes/、deck.config.js）在内核之前；引用的本地文件都存在；
                             没有手写内核骨架（#stage #slides #dots #lb #pv …）
  E3  每页有 data-t 且唯一   演讲者视图、台词、目录全靠它
  E4  台词 ↔ data-t         双向一一对应，不许有孤儿
  E5  渐变文字登记齐全       CSS 里 background-clip:text 的选择器必须在 gradientText 里
  E6  动画延迟类不越界       .dN 的 N 不能超过内核定义的上限（16，稿子自己补定义的也算）
  E7  台阶条 map 指向存在    rail.map 的 key 必须是某页的 data-t
  E8  include 片段存在       <!-- @include --> 指向的文件要在稿子目录里
  W1  素材文件缺失           data-src / data-avatar 指向的文件不在（占位是合法状态）
  W2  写死的 <img src>       幻灯里应走 data-src 机制，否则图没就位会留空洞
  W3  幻灯里有 id=           演讲者视图的上下页预览会剥掉 id，依赖 id 的效果在预览里会失效
  W4  台词缺 sec             演讲者视图算不出本页进度
  W6  gradientText 登记多余  登记了但 CSS 里找不到对应的 background-clip:text
  W7  可点击内容没标 data-sync  页内按钮/输入等交互状态不会自动同步到观众屏

最后会打印页数与台词总时长，方便核对时间预算。
"""

import os
import re
import sys

KERNEL_CSS = "/_deckstage/deck.css"
KERNEL_JS = "/_deckstage/deck.js"
KERNEL_MAX_DELAY = 16
INCLUDE_RE = re.compile(r"<!--\s*@include\s+(\S+?)\s*-->")
MAX_DEPTH = 5

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
    """去掉 /*...*/ 和整行 //...——只用于提取 key 和配置，够用。"""
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$", "", s)


def expand(file, root, depth=0):
    """展开 <!-- @include -->，规则同 DeckStage：路径相对引用它的文件，不能出稿子目录。"""
    html = read(file)
    if depth >= MAX_DEPTH:
        return html

    def sub(m):
        rel = m.group(1)
        target = os.path.realpath(os.path.join(os.path.dirname(file), rel))
        if not (target + os.sep).startswith(root + os.sep):
            err("E8", f"{os.path.relpath(file, root)} 引用的片段 {rel} 跑出了稿子目录")
            return ""
        if not os.path.isfile(target):
            err("E8", f"{os.path.relpath(file, root)} 引用的片段 {rel} 不存在")
            return ""
        return expand(target, root, depth + 1)

    return INCLUDE_RE.sub(sub, html)


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
    """台词文件顶层的 'key': { ... } —— 只认行首（可含缩进）的单引号 key。"""
    return re.findall(r"(?m)^\s*'([^']+)'\s*:\s*\{", strip_js_comments(js))


def notes_secs(js):
    out = {}
    for k, sec in re.findall(r"(?m)^\s*'([^']+)'\s*:\s*\{\s*sec\s*:\s*(\d+)", strip_js_comments(js)):
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


def css_gradient_text_selectors(css_blobs):
    """扫 CSS，找出用了 background-clip:text 的规则的选择器。"""
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


def local_ref(ref):
    """本地相对路径才检查；/_deckstage/、http(s)、data: 不管。"""
    return not re.match(r"^(/|[a-z]+:)", ref, flags=re.I)


# ---------------------------------------------------------------- W7

SYNC_MARKUP = re.compile(r'<(button|input|select|textarea|details)\b|\bonclick\s*=', re.I)
SYNC_LISTENER = re.compile(r'addEventListener\(\s*[\'"](click|pointerdown|mousedown|change|input)[\'"]')


def check_sync(slides_html, scripts):
    """W7：幻灯里有按钮 / 输入而没有 data-sync；或脚本监听了点击，但整份稿子没有 data-sync。"""
    has_sync = "data-sync" in slides_html or any("data-sync" in t for t in scripts.values())
    for t, body in slide_sections(slides_html):
        if SYNC_MARKUP.search(body) and "data-sync" not in body:
            warn("W7", f"'{t}' 里有按钮 / 输入等可交互内容但没有 data-sync：演讲者窗口里点了，观众屏不会变。"
                       f"在外层容器加 data-sync（详见 references/deckstage.md）")
    if not has_sync:
        hit = [n for n, t in scripts.items() if SYNC_LISTENER.search(t)]
        if hit:
            warn("W7", f"{'、'.join(hit)} 监听了点击 / 输入，但稿子里没有任何 data-sync：这类交互产生的页面变化不会同步到观众屏")


# ---------------------------------------------------------------- 主体

def main():
    if "-h" in sys.argv or "--help" in sys.argv:
        print(__doc__.strip())
        return 0
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    strict = "--strict" in sys.argv
    root = os.path.realpath(args[0] if args else ".")

    if not os.path.isdir(root):
        print(f"目录不存在：{root}")
        return 2

    missing = [n for n in ["index.html", "notes.js"] if not os.path.isfile(os.path.join(root, n))]
    if missing:
        err("E1", "缺文件：" + "、".join(missing))
    if "index.html" in missing:
        return report(root, strict)

    html = strip_html_comments(expand(os.path.join(root, "index.html"), root))

    # ---- E2 内核引用、本地文件、加载顺序
    if not re.search(rf'<link[^>]+href="{re.escape(KERNEL_CSS)}"', html):
        err("E2", f'index.html 没引用内核样式：<link rel="stylesheet" href="{KERNEL_CSS}">（放在稿子自己的样式之前）')
    srcs = [(m.start(), m.group(1)) for m in re.finditer(r'<script[^>]+src="([^"]+)"', html)]
    hrefs = re.findall(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"', html) + \
            re.findall(r'<link[^>]+href="([^"]+)"[^>]+rel="stylesheet"', html)
    kernel_at = next((p for p, s in srcs if s == KERNEL_JS), None)
    if kernel_at is None:
        err("E2", f'index.html 没引用内核：<script src="{KERNEL_JS}"></script>（放在 notes.js 之后、稿子自己的脚本之前）')
    for p, s in srcs:
        if local_ref(s) and not os.path.isfile(os.path.join(root, s)):
            err("E2", f"index.html 引用的脚本 {s} 不存在")
        is_data = s in ("notes.js", "deck.config.js") or s.startswith("notes/")
        if is_data and kernel_at is not None and p > kernel_at:
            err("E2", f"{s} 要在内核 {KERNEL_JS} 之前加载，否则演讲者视图读不到")
    for h in hrefs:
        if local_ref(h) and not os.path.isfile(os.path.join(root, h)):
            err("E2", f"index.html 引用的样式 {h} 不存在")
    if not any(s == "notes.js" for _, s in srcs):
        err("E2", 'index.html 没加载 notes.js：<script src="notes.js"></script>')
    for sk in re.findall(r'\sid="(stage|slides|prog|dots|lb|pv|toast)"', html):
        err("E2", f'不要手写 id="{sk}"：舞台、圆点、灯箱、演讲者视图这些骨架由内核生成')
    has_cfg = os.path.isfile(os.path.join(root, "deck.config.js"))
    if has_cfg and not any(s == "deck.config.js" for _, s in srcs):
        err("E2", 'deck.config.js 存在但 index.html 没加载它：<script src="deck.config.js"></script>（放在内核之前）')

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
        err("E3", f"data-t 重复：{d}（台词和目录会串页）")

    # ---- E4 / W4 台词对齐（notes.js + index.html 加载的 notes/*.js）
    note_files = ["notes.js"] + [s for _, s in srcs if s.startswith("notes/")]
    keys, secs = [], {}
    for nf in note_files:
        p = os.path.join(root, nf)
        if os.path.isfile(p):
            js = read(p)
            keys += notes_keys(js)
            secs.update(notes_secs(js))
    kset, nset = set(keys), set(names)
    for k in sorted(kset - nset):
        err("E4", f"台词里有 '{k}'，但页面没有这个 data-t（改名后忘了同步？）")
    for n in sorted(nset - kset):
        err("E4", f"页面有 '{n}'，但没写台词")
    for n in names:
        if n in kset and not secs.get(n):
            warn("W4", f"'{n}' 没写 sec，演讲者视图算不出本页进度")

    # ---- E5 渐变文字降级
    cfg_js = read(os.path.join(root, "deck.config.js")) if has_cfg else ""
    css = re.findall(r"<style[^>]*>(.*?)</style>", html, flags=re.S)
    css += [read(os.path.join(root, h)) for h in hrefs if local_ref(h) and os.path.isfile(os.path.join(root, h))]
    used = {re.sub(r"\s+", " ", u).strip() for u in css_gradient_text_selectors(css)}
    reg = {re.sub(r"\s+", " ", r).strip()
           for r in re.findall(r"""sel\s*:\s*['"]([^'"]+)['"]""", config_field(cfg_js, "gradientText") or "")}
    for sel in sorted(used - reg):
        where = "deck.config.js 的 gradientText" if has_cfg else "deck.config.js（新建它，写 window.__DECK = { gradientText: [...] }）"
        err("E5", f"渐变文字选择器 '{sel}' 没在 {where} 里登记，导出 PPTX 时这行字会是空白")
    for r in sorted(reg - used):
        warn("W6", f"gradientText 登记了 '{r}'，但 CSS 里找不到对应的 background-clip:text（多余？）")

    # ---- E6 动画延迟类
    extra = [int(n) for n in re.findall(r"\.d(\d+)\s*\{\s*animation-delay", "\n".join(css))]
    cap = max([KERNEL_MAX_DELAY] + extra)
    for n in sorted({int(n) for n in re.findall(r'class="[^"]*\bd(\d+)\b', html)} - set(range(1, cap + 1))):
        err("E6", f"用了 .d{n}，但只定义到 .d{cap}（这个元素不会有入场延迟）")

    # ---- E7 rail.map
    rail = config_field(cfg_js, "rail")
    if rail and rail != "null":
        mm = re.search(r"map\s*:\s*\{(.*?)\}", rail, flags=re.S)
        map_blob = mm.group(1) if mm else ""
        for k in re.findall(r"""['"]([^'"]+)['"]\s*:""", map_blob):
            if k not in nset:
                err("E7", f"rail.map 里的 '{k}' 不是任何一页的 data-t，台阶条会算错")
        steps = re.findall(r"\[\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\]", rail)
        lvls = [int(v) for v in re.findall(r"""['"][^'"]+['"]\s*:\s*(\d+)""", map_blob)]
        if steps and lvls and max(lvls) > len(steps):
            err("E7", f"rail.map 里出现了第 {max(lvls)} 级，但 rail.steps 只有 {len(steps)} 级")

    # ---- W1 素材文件
    for attr in ["data-src", "data-avatar"]:
        for rel in re.findall(rf'{attr}="([^"]+)"', html):
            if not os.path.isfile(os.path.join(root, rel)):
                warn("W1", f"{attr} 指向的 {rel} 不存在（页面会保留占位框）")

    # ---- W2 写死 img / W3 幻灯里的 id
    for t, body in sections:
        if re.search(r"<img\b[^>]*\bsrc=", body):
            warn("W2", f"'{t}' 里有写死的 <img src>，建议改成 .imgslot[data-src] 自动装载")
        ids = re.findall(r'\sid="([^"]+)"', body)
        if ids:
            warn("W3", f"'{t}' 里有 id={ids}，演讲者视图的上下页预览会剥掉 id，依赖这些 id 的效果在预览里会失效")

    # ---- W7 页内交互没标 data-sync
    scripts = {}
    for _, s in srcs:
        if local_ref(s) and s not in ("notes.js", "deck.config.js") and not s.startswith("notes/") \
                and os.path.isfile(os.path.join(root, s)):
            scripts[s] = strip_js_comments(read(os.path.join(root, s)))
    for i, body in enumerate(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, flags=re.S)):
        scripts[f"index.html 内联脚本 {i + 1}"] = strip_js_comments(body)
    check_sync("\n".join(f'<section class="slide" data-t="{t}">{b}</section>' for t, b in sections), scripts)

    # ---- 汇总
    total = sum(secs.get(n, 0) for n in names)
    info(f"共 {len(names)} 页，台词合计 {total} 秒 ≈ {total/60:.1f} 分钟")
    if names and nset <= kset:
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
