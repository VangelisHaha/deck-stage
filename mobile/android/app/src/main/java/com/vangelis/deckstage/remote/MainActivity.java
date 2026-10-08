package com.vangelis.deckstage.remote;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DeckStageRemotePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
