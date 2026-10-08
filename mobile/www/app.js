(function () {
  const address = document.getElementById('address');
  const error = document.getElementById('error');
  const button = document.getElementById('connect');
  const scan = document.getElementById('scan');
  const native = () => {
    const plugin = window.Capacitor && window.Capacitor.Plugins.DeckStageRemote;
    if (!plugin) throw new Error('请在 DeckStage Android App 中连接；浏览器请直接打开电脑的遥控地址');
    return plugin;
  };
  const busy = (value) => { button.disabled = value; scan.disabled = value; };
  // 扫码与手动输入走同一条地址校验和连接路径。
  async function connect(value) {
    const url = DeckStageConnection.normalizeAddress(value);
    address.value = new URL(url).origin;
    await native().connect({ url });
    try { localStorage.setItem('deckstage.computer', new URL(url).origin); } catch (_) {}
  }
  async function run(action) {
    error.textContent = '';
    busy(true);
    try { await action(); }
    catch (e) { error.textContent = e.message || '连接失败，请重试'; }
    finally { busy(false); }
  }
  try { address.value = localStorage.getItem('deckstage.computer') || ''; } catch (_) {}
  document.getElementById('connectForm').addEventListener('submit', (event) => {
    event.preventDefault();
    run(() => connect(address.value));
  });
  scan.onclick = () => run(async () => {
    const result = await native().scan();
    if (!result.cancelled) await connect(DeckStageConnection.normalizeScanResult(result.url));
  });
})();
