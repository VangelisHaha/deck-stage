package com.vangelis.deckstage.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.widget.Button;
import android.widget.TextView;

/** 原生页面公共样式。颜色资源由网页遥控样式生成。 */
final class RemoteTheme {
    static int color(Activity activity, int resource) { return activity.getColor(resource); }
    static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }
    static int statusBarHeight(Activity activity) {
        int id = activity.getResources().getIdentifier("status_bar_height", "dimen", "android");
        return id == 0 ? 0 : activity.getResources().getDimensionPixelSize(id);
    }
    static Button backButton(Activity activity, String label, Runnable action) {
        Button button = new Button(activity);
        button.setText(label);
        button.setTextColor(color(activity, R.color.deckstage_paper));
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        button.setPadding(dp(activity, 24), 0, dp(activity, 24), 0);
        button.setMinHeight(dp(activity, 48));
        button.setMinimumHeight(dp(activity, 48));
        GradientDrawable background = new GradientDrawable();
        background.setColor(color(activity, R.color.deckstage_ink));
        background.setStroke(dp(activity, 1), color(activity, R.color.deckstage_rule));
        button.setBackground(background);
        button.setOnClickListener(view -> action.run());
        return button;
    }
    static TextView text(Activity activity, String content, int size, int color, boolean serif) {
        TextView view = new TextView(activity);
        view.setText(content);
        view.setTextSize(size);
        view.setTextColor(color(activity, color));
        view.setPadding(dp(activity, 24), dp(activity, 12), dp(activity, 24), dp(activity, 12));
        if (serif) view.setTypeface(Typeface.create("serif", Typeface.BOLD));
        return view;
    }
    static void showDialog(Activity activity, String title, String message,
                           String primary, Runnable retry, String secondary, Runnable leave) {
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setCustomTitle(text(activity, title, 24, R.color.deckstage_paper, true))
            .setMessage(message)
            .setPositiveButton(primary, (d, which) -> retry.run())
            .setNegativeButton(secondary, (d, which) -> leave.run())
            .setOnCancelListener(d -> leave.run()).create();
        dialog.setOnShowListener(d -> {
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(color(activity, R.color.deckstage_ink)));
            TextView body = dialog.findViewById(android.R.id.message);
            if (body != null) body.setTextColor(color(activity, R.color.deckstage_body));
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setTextColor(color(activity, R.color.deckstage_signal));
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).setTextColor(color(activity, R.color.deckstage_paper));
        });
        dialog.show();
    }
}
