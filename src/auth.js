const jwt = require('jsonwebtoken');
const { db, SECRET, HOME_GUILD, orgOf } = require('./db');

const COOKIE = 'meow_admin';
const TOKEN_TTL = '7d';

// 後台功能模組（staff 帳號逐一勾選；admin 全開）
const MODULES = [
  { key: 'dashboard', label: '總覽' },
  { key: 'orders',    label: '交易流水帳與匯出' },
  { key: 'bank',      label: '地下金庫（雨幣）' },
  { key: 'salary',    label: '薪資與提領' },
  { key: 'payroll',   label: '記帳（未發放薪資）' },
  { key: 'customers', label: '老闆與 VIP' },
  { key: 'hr',        label: '人事（陪玩／客服）' },
  { key: 'gifts',     label: '禮物與親密度' },
  { key: 'backpack',  label: '背包與折價券' },
  { key: 'titles',    label: '冠名與身份組期限' },
  { key: 'tickets',   label: '客服單與考核' },
  { key: 'polls',     label: '投票與意見箱' },
  { key: 'reports',   label: '報表與匯出' },
  { key: 'panels',    label: '面板建置' },
  { key: 'snippets',  label: '小工作台（自訂指令）' },
  { key: 'settings',  label: '系統設定' },
  { key: 'logs',      label: '操作紀錄' },
  { key: 'users',     label: '帳號權限' }
];
const MODULE_KEYS = MODULES.map(m => m.key);

const parsePermissions = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);

// ---- 登入暴力嘗試防護 ----
const loginAttempts = new Map();
const LOGIN_MAX_FAILS = 5, LOGIN_LOCK_MS = 15 * 60 * 1000;
function loginLockedMinutes(key) {
  const a = loginAttempts.get(key);
  if (a && a.lockedUntil && a.lockedUntil > Date.now()) return Math.ceil((a.lockedUntil - Date.now()) / 60000);
  return 0;
}
function loginFailed(key) {
  if (loginAttempts.size > 10000) loginAttempts.clear();
  const a = loginAttempts.get(key) || { fails: 0 };
  a.fails++;
  if (a.fails >= LOGIN_MAX_FAILS) { a.lockedUntil = Date.now() + LOGIN_LOCK_MS; a.fails = 0; }
  loginAttempts.set(key, a);
}
const loginSucceeded = key => loginAttempts.delete(key);

function clientIp(req) {
  return (req.headers['x-real-ip'] || '').trim()
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

function rateLimit({ windowMs, max, prefix = '' }) {
  const hits = new Map();
  return (req, res, next) => {
    const nowMs = Date.now();
    const key = prefix + clientIp(req);
    if (hits.size > 20000) for (const [k, v] of hits) if (v.reset <= nowMs) hits.delete(k);
    let e = hits.get(key);
    if (!e || e.reset <= nowMs) { e = { count: 0, reset: nowMs + windowMs }; hits.set(key, e); }
    e.count++;
    if (e.count > max) {
      res.setHeader('Retry-After', Math.ceil((e.reset - nowMs) / 1000));
      return res.status(429).json({ error: '請求過於頻繁，請稍後再試' });
    }
    next();
  };
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}

const signToken = payload => jwt.sign(payload, SECRET, { expiresIn: TOKEN_TTL });
const COOKIE_SECURE = process.env.INSECURE_COOKIE ? '' : ' Secure;';
function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; HttpOnly;${COOKIE_SECURE} Path=/; Max-Age=${7 * 86400}; SameSite=Lax`);
}
function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly;${COOKIE_SECURE} Path=/; Max-Age=0; SameSite=Lax`);
}

function allowedGuildsFor(user) {
  const active = db.prepare('SELECT guild_id FROM guilds WHERE active = 1').all().map(r => r.guild_id)
    // 主營運伺服器排最前面：沒指定 x-guild-id 時就用它當預設
    .sort((a, b) => (b === HOME_GUILD) - (a === HOME_GUILD));
  if (user.role === 'admin') return active.length ? active : [HOME_GUILD];
  const bound = parsePermissions(user.guild_ids);
  if (!bound.length) return active.includes(HOME_GUILD) ? [HOME_GUILD] : active.slice(0, 1);
  const allow = bound.filter(g => active.includes(g));
  return allow.length ? allow : (active.includes(HOME_GUILD) ? [HOME_GUILD] : active.slice(0, 1));
}

function requireAuth() {
  return (req, res, next) => {
    const token = parseCookies(req)[COOKIE];
    if (!token) return res.status(401).json({ error: '未登入' });
    let data;
    try { data = jwt.verify(token, SECRET); } catch { return res.status(401).json({ error: '登入已過期' }); }
    const user = db.prepare('SELECT * FROM admin_users WHERE id = ? AND active = 1').get(data.id);
    if (!user) return res.status(401).json({ error: '帳號不存在' });
    req.user = user;
    const allowed = allowedGuildsFor(user);
    req.allowedGuilds = allowed;
    const gid = (req.headers['x-guild-id'] || '').trim();
    req.guildId = (gid && allowed.includes(gid)) ? gid : (allowed[0] || HOME_GUILD);
    // 營運資料一律以「集團」為單位；面板設定才用 req.guildId
    req.orgId = orgOf(req.guildId);
    next();
  };
}

function requireModule(mod) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登入' });
    if (req.user.role === 'admin' || parsePermissions(req.user.permissions).includes(mod)) return next();
    res.status(403).json({ error: '無此功能權限' });
  };
}

// 多個 router 共用 /api 前綴時用這個：沒權限就跳過本 router，不影響其他功能路由
function guardModule(mod) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: '未登入' });
    if (req.user.role === 'admin' || parsePermissions(req.user.permissions).includes(mod)) return next();
    return next('router');
  };
}

module.exports = {
  COOKIE, MODULES, MODULE_KEYS, parsePermissions,
  signToken, setAuthCookie, clearAuthCookie, requireAuth, requireModule, guardModule,
  loginLockedMinutes, loginFailed, loginSucceeded, rateLimit, clientIp
};
