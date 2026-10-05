#!/usr/bin/env python3
"""
稿子的本地后台服务模板。

页面要调本机接口时（例如「发送消息」按钮）用它：服务独立监听一个端口，页面 fetch 它。
配合稿子目录里的 deckstage.json，DeckStage 放映时会替用户启动、结束时关闭（见 references/deckstage.md）。

用法：复制到稿子目录（例如 service/server.py），改下面的 ACTIONS，deckstage.json 里这样写：
  { "services": [ { "name": "我的服务", "command": ["python3", "service/server.py"],
                    "health": "http://127.0.0.1:8898/health" } ] }

安全要点（别删）：
  - 只监听 127.0.0.1
  - 任何网页都能向 127.0.0.1 发请求，所以只认本机页面：校验 Origin 和 Host
    （Host 校验防 DNS 重绑定：别人的域名解析到 127.0.0.1 后冒充同源）
  - 只回 CORS 头给本机页面，别的来源的网页读不到响应
  - 动作写死在 ACTIONS 里，不接受页面传来的命令或路径
  - 同一时间只执行一个动作，防止连点重复触发
"""
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("SERVICE_PORT", "8898"))
LOCK = threading.Lock()

LOCAL = r"(127\.0\.0\.1|localhost|\[::1\])(:\d+)?"
ORIGIN_RE = re.compile(r"^https?://" + LOCAL + r"$")
HOST_RE = re.compile(r"^" + LOCAL + r"$")


def do_hello(params):
    """示例动作：改成你要做的事，返回要给页面的 JSON。"""
    return {"ok": True, "message": "hello"}


# 页面调用 POST /do?action=hello。只有这里登记的动作才会执行。
ACTIONS = {"hello": do_hello}


class Handler(BaseHTTPRequestHandler):
    def _host_ok(self):
        return bool(HOST_RE.match(self.headers.get("Host", "")))

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        return origin is None or bool(ORIGIN_RE.match(origin))   # 没有 Origin 的是命令行等非浏览器客户端

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and ORIGIN_RE.match(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _deny(self):
        self._json(403, {"ok": False, "error": "来源不被允许"})

    def do_OPTIONS(self):
        if not (self._host_ok() and self._origin_ok()):
            return self._deny()
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if not self._host_ok():
            return self._deny()
        if urlparse(self.path).path == "/health":          # DeckStage 和页面都用它判断服务在不在
            return self._json(200, {"ok": True})
        self._json(404, {"ok": False})

    def do_POST(self):
        if not (self._host_ok() and self._origin_ok()):
            return self._deny()
        u = urlparse(self.path)
        if u.path != "/do":
            return self._json(404, {"ok": False})
        params = {k: v[0] for k, v in parse_qs(u.query).items()}
        action = ACTIONS.get(params.get("action", ""))
        if not action:
            return self._json(400, {"ok": False, "error": "未知动作"})
        if not LOCK.acquire(blocking=False):
            return self._json(409, {"ok": False, "error": "上一个动作还在执行"})
        try:
            res = action(params)
        except Exception as e:                             # 错误信息给页面看，别吞掉
            res = {"ok": False, "error": str(e)}
        finally:
            LOCK.release()
        self._json(200 if res.get("ok") else 500, res)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"本地服务 http://127.0.0.1:{PORT}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
