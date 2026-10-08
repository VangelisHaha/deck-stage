package com.vangelis.deckstage.remote;

import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import com.google.zxing.client.android.Intents;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

@CapacitorPlugin(name = "DeckStageRemote")
public class DeckStageRemotePlugin extends Plugin {
    @PluginMethod
    public void scan(PluginCall call) {
        IntentIntegrator scanner = new IntentIntegrator(getActivity());
        scanner.setCaptureActivity(ScanActivity.class);
        scanner.setDesiredBarcodeFormats(IntentIntegrator.QR_CODE);
        scanner.setPrompt("将电脑遥控二维码放入框内");
        scanner.setOrientationLocked(false);
        scanner.setBeepEnabled(false);
        scanner.addExtra(Intents.Scan.SHOW_MISSING_CAMERA_PERMISSION_DIALOG, false);
        getActivity().runOnUiThread(() -> startActivityForResult(call, scanner.createScanIntent(), "scanResult"));
    }

    @ActivityCallback
    private void scanResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (data != null && data.getBooleanExtra(Intents.Scan.MISSING_CAMERA_PERMISSION, false)) {
            call.reject("相机权限未开启，请允许相机权限后重试，或使用手动输入地址");
            return;
        }
        IntentResult scanned = IntentIntegrator.parseActivityResult(result.getResultCode(), data);
        JSObject response = new JSObject();
        boolean cancelled = scanned == null || scanned.getContents() == null;
        response.put("cancelled", cancelled);
        if (!cancelled) response.put("url", scanned.getContents());
        call.resolve(response);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        if (!("http".equals(uri.getScheme()) || "https".equals(uri.getScheme()))
                || uri.getHost() == null || uri.getUserInfo() != null
                || !"/".equals(uri.getPath()) || uri.getFragment() != null) {
            call.reject("请输入有效的电脑遥控地址");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Intent intent = new Intent(getContext(), RemoteActivity.class);
            intent.putExtra("url", url);
            getActivity().startActivity(intent);
            call.resolve();
        });
    }
}
