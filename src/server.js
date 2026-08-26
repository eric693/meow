require('dotenv').config();
process.env.TZ = process.env.TZ || 'Asia/Taipei';

const fs = require('fs');
const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, getSetting, audit } = require('./db');
const {
  signToken, setAuthCookie, clearAuthCookie, requireAuth,
  MODULES, MODULE_KEYS, parsePermissions,
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit, clientIp
} = require('./auth');
const bot = require('./bot');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ---- 登入 ----
app.post('/api/login', rateLimit({ windowMs: 5 * 60 * 1000, max: 30, prefix: 'login:' }), (req, res) => {
  const { username, password } = req.body || {};
  const lockKey = `admin:${username || ''}`;
  const locked = loginLockedMinutes(lockKey);
  if (locked) return res.status(429).json({ error: `登入失敗次數過多，請 ${locked} 分鐘後再試` });
  const user = db.prepare('SELECT * FROM admin_users WHERE username = ? AND active = 1').get(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    loginFailed(lockKey);
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  loginSucceeded(lockKey);
  setAuthCookie(res, signToken({ id: user.id }));
  const ip = clientIp(req);
  db.prepare(`UPDATE admin_users SET last_login_at = datetime('now','localtime'),
                last_login_ip = ?, login_count = login_count + 1 WHERE id = ?`).run(ip, user.id);
  audit(user.name || user.username, '登入後台', `IP ${ip}`, '', { source: 'web' });
  res.json({ ok: true });
});

// ---- 用 Discord 登入 ----
// 手動建帳號的流程對不起來：管理員在後台開一個帳號，員工那邊卻不知道帳密，
// 而員工自己點連結進來又不會出現在帳號清單裡。改成讓他們用 Discord 登入——
// 第一次登入就自動建檔並綁好 discord_id，管理員只要去勾權限。
const OAUTH = {
  id: process.env.DISCORD_CLIENT_ID || '',
  secret: process.env.DISCORD_CLIENT_SECRET || '',
  // 這個網址必須跟 Discord 開發者後台 OAuth2 → Redirects 填的一字不差
  redirect: process.env.OAUTH_REDIRECT || ''
};
const oauthReady = () => !!(OAUTH.id && OAUTH.secret && OAUTH.redirect);

app.get('/api/auth/discord', (req, res) => {
  if (!oauthReady()) return res.status(503).send('尚未設定 Discord 登入');
  const url = 'https://discord.com/api/oauth2/authorize?' + new URLSearchParams({
    client_id: OAUTH.id, redirect_uri: OAUTH.redirect, response_type: 'code', scope: 'identify'
  });
  res.redirect(url);
});

app.get('/api/auth/discord/callback', async (req, res) => {
  if (!oauthReady()) return res.status(503).send('尚未設定 Discord 登入');
  try {
    const code = String(req.query.code || '');
    if (!code) return res.redirect('/?login=cancel');
    const tok = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: OAUTH.id, client_secret: OAUTH.secret,
        grant_type: 'authorization_code', code, redirect_uri: OAUTH.redirect
      })
    }).then(r => r.json());
    if (!tok.access_token) throw new Error(tok.error_description || 'Discord 沒有回傳授權');
    const du = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tok.access_token}` }
    }).then(r => r.json());
    if (!du.id) throw new Error('取不到 Discord 帳號資料');

    let user = db.prepare('SELECT * FROM admin_users WHERE discord_id = ?').get(du.id);
    if (!user) {
      // 沒綁過就一律新建一個「零權限」帳號，等管理員去勾。
      // 不用「名字相同就自動認領既有帳號」那種做法——Discord 使用者名稱是自己取的，
      // 撞到管理員的名字就等於把後台送出去了。要對應到既有帳號請管理員手動填 Discord ID。
      {
        // 帳號名稱可能撞到，撞了就接一段 Discord ID
        let username = du.username;
        if (db.prepare('SELECT 1 FROM admin_users WHERE username = ?').get(username))
          username = `${du.username}.${du.id.slice(-4)}`;
        const info = db.prepare(`INSERT INTO admin_users
            (username, password_hash, name, role, permissions, discord_id)
            VALUES (?,?,?,'staff','',?)`)
          .run(username, '!discord-only', du.global_name || du.username, du.id);
        user = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(info.lastInsertRowid);
        audit(user.name || user.username, '自助建立後台帳號', `Discord ${du.id}`, '', { source: 'web' });
      }
    }
    if (!user.active) return res.redirect('/?login=disabled');

    const ip = clientIp(req);
    db.prepare(`UPDATE admin_users SET last_login_at = datetime('now','localtime'),
                  last_login_ip = ?, login_count = login_count + 1 WHERE id = ?`).run(ip, user.id);
    setAuthCookie(res, signToken({ id: user.id }));
    audit(user.name || user.username, '登入後台（Discord）', `IP ${ip}`, '', { source: 'web' });
    res.redirect('/');
  } catch (e) {
    console.warn('Discord 登入失敗：', e.message);
    res.redirect('/?login=error');
  }
});

// 登入頁要知道能不能顯示「用 Discord 登入」；這支不需要登入
app.get('/api/auth/config', (req, res) => res.json({ discord: oauthReady() }));

app.post('/api/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get('/api/me', requireAuth(), (req, res) => {
  res.json({
    id: req.user.id, username: req.user.username, name: req.user.name, role: req.user.role,
    modules: req.user.role === 'admin' ? MODULE_KEYS : parsePermissions(req.user.permissions),
    all_modules: MODULES,
    guild_id: req.guildId,
    bot_online: bot.isReady(),
    brand: getSetting('brand_name', '喚雨', req.guildId)
  });
});

// ---- 功能路由 ----
app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/ledger'));
app.use('/api', require('./routes/payroll'));
app.use('/api', require('./routes/extras'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/discord-ops'));

// ---- 前端（快取破壞）----
const PUB = path.join(__dirname, '..', 'public');
function assetVersion() {
  let mx = 0;
  for (const dir of ['js', 'css']) {
    try {
      for (const f of fs.readdirSync(path.join(PUB, dir))) {
        const m = fs.statSync(path.join(PUB, dir, f)).mtimeMs;
        if (m > mx) mx = m;
      }
    } catch {}
  }
  return Math.floor(mx).toString(36);
}
// 公開玩家手冊（不需登入，Discord 玩家可直接看）
app.get(['/rules', '/handbook'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(PUB, 'rules.html'));
});

app.get(['/', '/index.html'], (req, res) => {
  try {
    const v = assetVersion();
    const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
      .replace(/(src|href)="(\/(?:js|css)\/[A-Za-z0-9_-]+\.(?:js|css))"/g, `$1="$2?v=${v}"`);
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.type('html').send(html);
  } catch { res.sendFile(path.join(PUB, 'index.html')); }
});
app.use(['/js', '/css'], (req, res, next) => { res.set('Cache-Control', 'no-cache'); next(); });
app.use(express.static(PUB));

// ---- 統一錯誤處理 ----
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const bad = err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError);
  if (!bad) console.error('路由錯誤：', err && err.message);
  res.status(bad ? 400 : 500).json({ error: bad ? 'request body 不是合法的 JSON' : (err.message || '伺服器內部錯誤') });
});

const PORT = process.env.PORT || 4100;
app.listen(PORT, '127.0.0.1', () => console.log(`🌐 後台網站已啟動： http://127.0.0.1:${PORT}`));

bot.start().catch(e => console.error('機器人啟動失敗：', e.message));
