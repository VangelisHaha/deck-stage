/* 连接地址规范化，页面和测试共用。 */
(function (root) {
  function normalizeAddress(value) {
    const input = String(value || '').trim();
    if (!input) throw new Error('请输入电脑上的遥控地址');
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
    let url;
    try { url = new URL(hasScheme ? input : 'http://' + input); }
    catch (_) { throw new Error('地址格式不正确，请复制电脑遥控面板上的地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      throw new Error('请输入有效的 HTTP 或 HTTPS 遥控地址');
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('请使用电脑的局域网地址，localhost 指向手机自身');
    }
    if (url.pathname !== '/' || url.hash) throw new Error('请使用电脑「手机遥控」面板显示的地址');
    if (!hasScheme && !/:\d+(?:[/?]|$)/.test(input)) url.port = '18899';
    // 只保留配对令牌；不在保存的历史地址中存令牌。
    const token = url.searchParams.get('t');
    url.search = '';
    if (token) url.searchParams.set('t', token);
    return url.href;
  }
  function normalizeScanResult(value) {
    try {
      const url = normalizeAddress(value);
      if (!new URL(url).searchParams.get('t')) throw new Error('missing token');
      return url;
    } catch (_) { throw new Error('请扫描 DeckStage 电脑端「手机遥控」面板的二维码'); }
  }
  if (typeof module !== 'undefined') module.exports = { normalizeAddress, normalizeScanResult };
  else root.DeckStageConnection = { normalizeAddress, normalizeScanResult };
})(typeof window === 'undefined' ? globalThis : window);
