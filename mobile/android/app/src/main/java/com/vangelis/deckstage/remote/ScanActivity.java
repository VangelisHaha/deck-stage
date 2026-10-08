package com.vangelis.deckstage.remote;

import android.widget.LinearLayout;
import android.widget.TextView;
import com.journeyapps.barcodescanner.CaptureActivity;
import com.journeyapps.barcodescanner.DecoratedBarcodeView;

/** 原生相机扫码，离线识别，不依赖 Google Play 服务。 */
public class ScanActivity extends CaptureActivity {
    @Override
    protected DecoratedBarcodeView initializeContent() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(0, RemoteTheme.statusBarHeight(this), 0, 0);
        layout.setBackgroundColor(RemoteTheme.color(this, R.color.deckstage_ink));
        layout.addView(RemoteTheme.backButton(this, "← 返回连接页", () -> finish()));
        layout.addView(RemoteTheme.text(this, "扫码连接", 32, R.color.deckstage_paper, true));
        layout.addView(RemoteTheme.text(this, "扫描电脑「手机遥控」面板的二维码", 14, R.color.deckstage_dim, false));
        DecoratedBarcodeView scanner = new DecoratedBarcodeView(this);
        scanner.setStatusText("将二维码放入框内，识别后自动连接");
        TextView status = scanner.findViewById(com.google.zxing.client.android.R.id.zxing_status_view);
        if (status != null) status.setTextColor(RemoteTheme.color(this, R.color.deckstage_paper));
        layout.addView(scanner, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        return scanner;
    }
}
