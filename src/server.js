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
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit
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
  audit(user.name || user.username, '登入後台');
  res.json({ ok: true });
});

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
app.use('/api', require('./routes/extras'));
app.use('/api', require('./routes/admin'));

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
