#!/usr/bin/env python3
"""校验发布 APK 包含连接页与原生遥控实现，拒绝占位页。"""
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1]) as apk:
    page = apk.read('assets/public/index.html').decode()
    assert '环境验证页' not in page, 'APK 仍是环境验证占位页'
    assert 'connectForm' in page and 'address' in page and 'id="scan"' in page, 'APK 缺少连接入口'
    for asset in ('app.js', 'connection.js', 'remote.css', 'connection.css'):
        assert apk.read('assets/public/' + asset), 'APK 缺少连接脚本'
    for asset in ('index.html', 'remote.css', 'remote.js'):
        assert apk.read('assets/public/remote/' + asset), 'APK 缺少内置遥控页'
    dex = b''.join(apk.read(name) for name in apk.namelist() if name.endswith('.dex'))
    for native in (b'DeckStageRemotePlugin', b'RemoteActivity', b'ScanActivity', b'deckstage:key'):
        assert native in dex, 'APK 缺少原生遥控实现：' + native.decode()
print('APK 内容检查通过：连接页、连接脚本、扫码、公共样式、原生遥控窗口和音量键事件齐全')
