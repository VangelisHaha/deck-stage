package com.vangelis.deckstage.remote;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.Collections;

/** 遥控页独立运行，不把 Capacitor 插件能力暴露给远端网页。 */
public class RemoteActivity extends Activity {
    private WebView web;
    private String url;
    private boolean errorShown;
    private volatile boolean bundledDocument;
    private final Runnable connectionTimeout = () -> showError("连接超时。请确认电脑遥控已开启，手机与电脑连接同一个 Wi-Fi。");

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        url = getIntent().getStringExtra("url");
        if (url == null) { finish(); return; }
        web = new WebView(this);
        web.setBackgroundColor(RemoteTheme.color(this, R.color.deckstage_ink));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        // 在页面脚本运行前注入已有遥控页约定的能力对象，兼容已发布桌面版。
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web,
                "window.DeckStageNative={volumeKeys:true,enableVolumeKeys:function(){}};",
                Collections.singleton(origin(Uri.parse(url))));
        }
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (!"GET".equals(request.getMethod()) || !origin(target).equals(origin(Uri.parse(url)))) return null;
                // 配对令牌由电脑验证并设置 cookie；只替换界面，API 仍请求电脑。
                if (target.getQueryParameter("t") != null) return null;
                String asset;
                String mime;
                switch (target.getPath()) {
                    case "/": asset = "index.html"; mime = "text/html"; break;
                    case "/remote.css": asset = "remote.css"; mime = "text/css"; break;
                    case "/remote.js": asset = "remote.js"; mime = "application/javascript"; break;
                    default: return null;
                }
                try {
                    java.io.InputStream content = getAssets().open("public/remote/" + asset);
                    if (request.isForMainFrame() && "/".equals(target.getPath())) bundledDocument = true;
                    return new WebResourceResponse(mime, "UTF-8", content);
                } catch (java.io.IOException error) { return null; }
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !origin(request.getUrl()).equals(origin(Uri.parse(url)));
            }
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showError("连不上电脑。请检查同一 Wi-Fi、遥控开关、地址和电脑防火墙。");
            }
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame()) showError(response.getStatusCode() == 403
                    ? "二维码链接已失效，请返回并输入电脑遥控地址，用最新的配对码连接。"
                    : "电脑遥控服务暂时不可用，请重试。");
            }
            @Override
            public void onPageFinished(WebView view, String pageUrl) {
                web.removeCallbacks(connectionTimeout);
                CookieManager.getInstance().flush();
                // 部分 WebView 不拦截重定向后的文档；令牌配对完成后显式打开内置界面。
                if (!bundledDocument && !errorShown && origin(Uri.parse(pageUrl)).equals(origin(Uri.parse(url)))) {
                    view.loadUrl(origin(Uri.parse(url)) + "/");
                }
            }
        });
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(0, RemoteTheme.statusBarHeight(this), 0, 0);
        layout.setBackgroundColor(RemoteTheme.color(this, R.color.deckstage_ink));
        layout.addView(RemoteTheme.backButton(this, "← 更换电脑", () -> finish()));
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        web.loadUrl(url);
        web.postDelayed(connectionTimeout, 12000);
    }

    private static String origin(Uri uri) {
        int port = uri.getPort();
        if (port == -1) port = "https".equals(uri.getScheme()) ? 443 : 80;
        return uri.getScheme() + "://" + uri.getHost() + ":" + port;
    }

    private void showError(String message) {
        if (errorShown || isFinishing()) return;
        errorShown = true;
        web.removeCallbacks(connectionTimeout);
        RemoteTheme.showDialog(this, "连接失败", message, "重试", () -> {
                errorShown = false;
                web.loadUrl(url);
                web.postDelayed(connectionTimeout, 12000);
            }, "更换电脑", () -> finish());
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int key = event.getKeyCode();
        if (key == KeyEvent.KEYCODE_VOLUME_UP || key == KeyEvent.KEYCODE_VOLUME_DOWN) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                String detail = key == KeyEvent.KEYCODE_VOLUME_UP ? "volumeUp" : "volumeDown";
                web.evaluateJavascript("if(document.getElementById('live') && !document.getElementById('live').hidden)"
                    + "window.dispatchEvent(new CustomEvent('deckstage:key',{detail:'" + detail + "'}));", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onPause() { if (web != null) web.onPause(); super.onPause(); }

    @Override
    protected void onResume() { super.onResume(); if (web != null) web.onResume(); }

    @Override
    protected void onDestroy() {
        if (web != null) { web.removeCallbacks(connectionTimeout); web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }
}
