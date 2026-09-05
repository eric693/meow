/* PWA：安裝到桌面、離線提示、有新版時提醒重整。
   帳務資料一律不快取（見 sw.js），這裡只處理「殼」與提示。 */
const PWA = {
  deferred: null,

  init() {
    this.applyShortcut();
    this.register();
    this.watchNetwork();
    this.watchInstall();
  },

  // manifest 的捷徑（/?p=orders）與桌面圖示都用查詢字串指定要開哪一頁
  applyShortcut() {
    const p = new URLSearchParams(location.search).get('p');
    if (!p || typeof App === 'undefined') return;
    App.page = p;
    try { localStorage.setItem('meow_page', p); } catch { /* 無痕模式 */ }
    history.replaceState(null, '', location.pathname);
  },

  async register() {
    if (!('serviceWorker' in navigator) || location.protocol === 'http:' && location.hostname !== 'localhost') return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      // 已經有新版在等，或安裝過程中出現新版 → 提示使用者更新
      if (reg.waiting) this.offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) this.offerUpdate(sw);
        });
      });
      // 換版之後重整一次，避免新舊資源混用
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true; location.reload();
      });
    } catch (e) { /* 不支援或被封鎖就當一般網頁用 */ }
  },

  offerUpdate(sw) {
    this.banner('後台有新版本', '更新', () => sw.postMessage('skip-waiting'));
  },

  watchNetwork() {
    const show = () => { if (!navigator.onLine) this.banner('目前離線，畫面上的數字可能不是最新的', '重試', () => location.reload(), 'off'); };
    addEventListener('offline', show);
    addEventListener('online', () => { const b = document.getElementById('pwa-bar-off'); if (b) b.remove(); });
    show();
  },

  // 瀏覽器判定可安裝時才會給 beforeinstallprompt；iOS 沒有，改給「加入主畫面」說明
  watchInstall() {
    addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.deferred = e;
      this.banner('把後台安裝到桌面，開起來像 App', '安裝', async () => {
        const d = this.deferred; this.deferred = null;
        if (!d) return;
        d.prompt();
        await d.userChoice;
      }, 'install');
    });
    addEventListener('appinstalled', () => {
      this.deferred = null;
      const b = document.getElementById('pwa-bar-install'); if (b) b.remove();
    });
  },

  banner(text, btnText, onClick, id = 'update') {
    const key = 'pwa-bar-' + id;
    document.getElementById(key)?.remove();
    // 安裝提示按過「以後再說」就一個月內不再出現
    if (id === 'install' && Number(localStorage.getItem('pwa_install_hide') || 0) > Date.now()) return;
    const bar = document.createElement('div');
    bar.id = key;
    bar.className = 'pwa-bar';
    bar.innerHTML = `<span></span><button class="pwa-ok"></button><button class="pwa-x" aria-label="關閉">✕</button>`;
    bar.querySelector('span').textContent = text;
    bar.querySelector('.pwa-ok').textContent = btnText;
    bar.querySelector('.pwa-ok').onclick = () => { bar.remove(); onClick(); };
    bar.querySelector('.pwa-x').onclick = () => {
      bar.remove();
      if (id === 'install') {
        try { localStorage.setItem('pwa_install_hide', String(Date.now() + 30 * 864e5)); } catch { /* 無痕模式 */ }
      }
    };
    document.body.appendChild(bar);
  }
};
