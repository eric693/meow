// SPA 外殼：登入、側邊選單、路由

// 線條圖示（stroke 走 currentColor，深淺色模式共用）
const svg = d => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICONS = {
  dashboard: svg('<path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5" rx="1"/><rect x="12" y="7" width="3" height="9" rx="1"/><rect x="17" y="13" width="3" height="3" rx="1"/>'),
  orders:    svg('<path d="M6 3.5 7.5 5 9 3.5 10.5 5 12 3.5 13.5 5 15 3.5 16.5 5 18 3.5v15.9a1.6 1.6 0 0 1-1.6 1.6H7.6A1.6 1.6 0 0 1 6 19.4Z"/><path d="M9.5 9h5"/><path d="M9.5 13h5"/><path d="M9.5 17h3"/>'),
  reconcile: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="2.5"/><path d="M7.5 9.5h9"/><path d="m7.5 14 2 2 4-4.5"/><path d="M15 16h2"/>'),
  bank:      svg('<path d="M3 10 12 4l9 6"/><path d="M5 10v8"/><path d="M9.5 10v8"/><path d="M14.5 10v8"/><path d="M19 10v8"/><path d="M3 21h18"/>'),
  salary:    svg('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 10v4"/><path d="M18 10v4"/>'),
  payroll:   svg('<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9h17"/><path d="M7.5 13h4"/><path d="M7.5 16.5h7"/><path d="M16.5 12.5v5"/><path d="M14.5 15h4"/>'),
  customers: svg('<path d="M3 8.5 6.8 12 12 5l5.2 7L21 8.5 19.2 18H4.8Z"/><path d="M4.8 21h14.4"/>'),
  hr:        svg('<rect x="4.5" y="3.5" width="15" height="17" rx="2.5"/><path d="M9 3.5h6v3H9z"/><path d="M8.5 11h7"/><path d="M8.5 15h4.5"/>'),
  gifts:     svg('<path d="M20.8 8.6a4.6 4.6 0 0 0-6.6-6.4L12 4.4 9.8 2.2a4.6 4.6 0 0 0-6.6 6.4l8.1 8.3a1 1 0 0 0 1.4 0Z"/>'),
  backpack:  svg('<path d="M6 9a6 6 0 0 1 12 0v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2Z"/><path d="M9.5 9V6.5a2.5 2.5 0 0 1 5 0V9"/><path d="M9 15h6"/>'),
  titles:    svg('<path d="M20.6 8.4 12 3 3.4 8.4v7.2L12 21l8.6-5.4Z"/><circle cx="12" cy="12" r="2.6"/>'),
  tickets:   svg('<path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h15A1.5 1.5 0 0 1 21 8.5v2a2 2 0 0 0 0 3v2A1.5 1.5 0 0 1 19.5 17h-15A1.5 1.5 0 0 1 3 15.5v-2a2 2 0 0 0 0-3Z"/><path d="M14 7v10"/>'),
  polls:     svg('<path d="M4 7.5 12 3l8 4.5-8 4.5Z"/><path d="M4 12l8 4.5L20 12"/><path d="M4 16.5 12 21l8-4.5"/>'),
  reports:   svg('<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7.5 15 3.5-4 3 2.4L19.5 7"/><path d="M19.5 7h-3.2"/><path d="M19.5 7v3.2"/>'),
  panels:    svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M7 13l2 2-2 2"/><path d="M12 17h5"/>'),
  snippets:  svg('<path d="M14.7 6.3a3.5 3.5 0 1 1 3 3l-9.4 9.4-4 1 1-4Z"/><path d="M12.5 8.5l3 3"/>'),
  settings:  svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1Z"/>'),
  users:     svg('<circle cx="8" cy="9" r="3.2"/><path d="M2.8 20a5.4 5.4 0 0 1 10.4 0"/><path d="M16 8.5h5.5"/><path d="M19 8.5v3"/><path d="M21.5 8.5v2"/>'),
  lock:      svg('<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14v2.5"/>'),
  logout:    svg('<path d="M14.5 3.5h3A2.5 2.5 0 0 1 20 6v12a2.5 2.5 0 0 1-2.5 2.5h-3"/><path d="M10 8 6 12l4 4"/><path d="M6 12h9"/>'),
  brand:     svg('<path d="M3.2 12a8.8 8.8 0 0 1 17.6 0Z"/><path d="M12 3.2V12"/><path d="M12 12v6.4a2.4 2.4 0 0 0 4.8 0"/>')
};

const NAV = [
  { key: 'dashboard', label: '總覽' },
  { key: 'orders',    label: '交易流水帳' },
  { key: 'bank',      label: '地下金庫' },
  { key: 'reconcile', label: '收款對帳' },
  { key: 'salary',    label: '薪資與提領' },
  { key: 'payroll',   label: '記帳・未發薪資' },
  { key: 'customers', label: '老闆與 VIP' },
  { key: 'hr',        label: '人事名單' },
  { key: 'gifts',     label: '禮物與親密度' },
  { key: 'backpack',  label: '背包與折價券' },
  { key: 'titles',    label: '冠名與身份組' },
  { key: 'tickets',   label: '客服單與考核' },
  { key: 'polls',     label: '投票與意見箱' },
  { key: 'reports',   label: '報表與匯出' },
  { key: 'panels',    label: '面板指令表' },
  { key: 'snippets',  label: '小工作台' },
  { key: 'settings',  label: '系統設定' },
  { key: 'logs',      label: '操作紀錄' },
  { key: 'users',     label: '帳號權限' }
].map(n => ({ ...n, icon: ICONS[n.key] }));

const App = {
  me: null,
  page: localStorage.getItem('meow_page') || 'dashboard',

  async boot() {
    try { this.me = await GET('/me'); } catch { return this.renderLogin(); }
    await this.loadGuilds();
    this.render();
  },

  onUnauthorized() { this.me = null; this.renderLogin(); },

  renderLogin(msg = '') {
    document.getElementById('app').innerHTML = `
      <div class="login-wrap"><form class="login-card" id="lf">
        <h1>☔ 喚雨機器喵</h1>
        <p class="sub">陪玩接單管理後台</p>
        <label class="f"><span>帳號</span><input name="username" autocomplete="username" required></label>
        <label class="f"><span>密碼</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div style="color:var(--err);font-size:13px;min-height:20px">${UI.esc(msg)}</div>
        <button class="btn" style="width:100%;margin-top:6px">登入</button>
      </form></div>`;
    document.getElementById('lf').onsubmit = async e => {
      e.preventDefault();
      const f = e.target;
      try {
        await POST('/login', { username: f.username.value, password: f.password.value });
        this.boot();
      } catch (err) { this.renderLogin(err.message); }
    };
  },

  async loadGuilds() {
    try {
      const d = await GET('/discord/guilds');
      this.guilds = d.guilds || [];
      this.botOnline = d.bot_online;
      if (!window.CURRENT_GUILD && this.guilds[0]) {
        window.CURRENT_GUILD = this.guilds[0].guild_id;
        localStorage.setItem('meow_guild', window.CURRENT_GUILD);
      }
    } catch { this.guilds = []; }
  },

  can(key) { return this.me && this.me.modules.includes(key); },

  render() {
    const items = NAV.filter(n => this.can(n.key));
    if (!items.find(n => n.key === this.page)) this.page = items[0]?.key || 'dashboard';
    document.getElementById('app').innerHTML = `
      <div class="layout">
        <aside class="side" id="side">
          <div class="logo">${ICONS.brand} 喚雨機器喵 <span class="dot ${this.botOnline ? 'on' : ''}" title="機器人狀態"></span></div>
          ${items.map(n => `<div class="nav-item ${n.key === this.page ? 'active' : ''}" data-nav="${n.key}">
             ${n.icon}${n.label}</div>`).join('')}
          <div class="spacer"></div>
          ${this.guilds.length > 1 ? `<select id="gsel" style="margin-bottom:8px">
            ${this.guilds.map(g => `<option value="${g.guild_id}" ${g.guild_id === window.CURRENT_GUILD ? 'selected' : ''}>${UI.esc(g.name || g.guild_id)}</option>`).join('')}
          </select>` : ''}
          <div class="nav-item" data-act="pwd">${ICONS.lock}修改密碼</div>
          <div class="nav-item" data-act="logout">${ICONS.logout}登出（${UI.esc(this.me.name || this.me.username)}）</div>
        </aside>
        <main class="main">
          <div class="topbar">
            <button class="btn secondary sm menu-btn" id="mbtn">☰</button>
            <h2>${items.find(n => n.key === this.page)?.label || ''}</h2>
            <div class="grow"></div>
            <span class="tag ${this.botOnline ? 'ok' : 'err'}">${this.botOnline ? '機器人上線中' : '機器人離線'}</span>
          </div>
          <div id="view"><div class="empty">載入中…</div></div>
        </main>
      </div>`;

    document.querySelectorAll('[data-nav]').forEach(el => el.onclick = () => {
      this.page = el.dataset.nav;
      localStorage.setItem('meow_page', this.page);
      document.getElementById('side').classList.remove('open');
      this.render();
    });
    document.querySelector('[data-act="logout"]').onclick = async () => { await POST('/logout'); location.reload(); };
    document.querySelector('[data-act="pwd"]').onclick = () => this.changePassword();
    const mb = document.getElementById('mbtn');
    if (mb) mb.onclick = () => document.getElementById('side').classList.toggle('open');
    const gs = document.getElementById('gsel');
    if (gs) gs.onchange = () => {
      window.CURRENT_GUILD = gs.value;
      localStorage.setItem('meow_guild', gs.value);
      this.render();
    };

    const fn = Pages[this.page];
    const view = document.getElementById('view');
    if (!fn) return view.innerHTML = '<div class="empty">此功能尚未開放</div>';
    Promise.resolve(fn(view)).catch(e => view.innerHTML = `<div class="empty">載入失敗：${UI.esc(e.message)}</div>`);
  },

  reload() { this.render(); },

  changePassword() {
    UI.modal({
      title: '修改密碼',
      bodyHTML: `<label class="f"><span>舊密碼</span><input name="old" type="password"></label>
                 <label class="f"><span>新密碼（至少 8 碼）</span><input name="nw" type="password"></label>`,
      onOk: async back => {
        await POST('/password', { old_password: UI.val(back, 'old'), new_password: UI.val(back, 'nw') });
        UI.ok('密碼已更新');
      }
    });
  }
};
