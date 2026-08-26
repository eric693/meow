// 後台 API：報表匯出、系統設定、帳號權限、Discord 資源（頻道／身分組）
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, monthPrefix, getSetting, setSetting, audit, DEFAULT_VIP, HOME_GUILD,
        orgOf, bindOrg, orgGuilds, migrateOrgData } = require('../db');
const { requireAuth, guardModule, MODULE_KEYS, parsePermissions } = require('../auth');
const R = require('../util/reports');
const bot = require('../bot');

const router = express.Router();
router.use(requireAuth());

// ---------------- 報表 ----------------
router.use('/reports', guardModule('reports'));
router.get('/reports/summary', (req, res) => {
  const month = req.query.month || monthPrefix();
  res.json({
    finance: R.financeReport(req.orgId, month),
    staff: R.staffRanking(req.orgId, month),
    spend: R.spendRanking(req.orgId, 20),
    cs: R.csRanking(req.orgId, req.query.from || '', req.query.to || '')
  });
});
router.delete('/reports/cs', (req, res) => {
  const c = db.prepare('DELETE FROM cs_stats WHERE guild_id=?').run(req.orgId).changes;
  audit(req.user.name, '清空客服業績', `${c} 筆`, req.orgId, { source: 'web' });
  res.json({ ok: true, deleted: c });
});

// 舊的匯出路徑保留相容，一律轉到新的匯出引擎（支援 csv / xlsx / pdf）
router.get('/reports/export/consumption', (req, res) =>
  res.redirect(307, '/api/exports/patrons?' + new URLSearchParams(req.query)));
router.get('/reports/export/ledger', (req, res) =>
  res.redirect(307, '/api/exports/ledger?' + new URLSearchParams(req.query)));
router.get('/reports/export/withdrawals', (req, res) =>
  res.redirect(307, '/api/exports/withdrawals?' + new URLSearchParams(req.query)));

// ---------------- 系統設定 ----------------
// 集團層設定：整個集團共用一份（品牌、分潤、VIP 門檻）
const ORG_KEYS = ['brand_name', 'staff_share_rate', 'gift_share_rate', 'vip_thresholds', 'vip_names',
  'order_intimacy_rate', 'high_income_threshold'];
// 單一伺服器設定：每台群組各自不同（身分組、頻道、分類、機器人狀態）
const GUILD_KEYS = [
  'bot_activity',
  'role_admin', 'role_cs', 'role_player', 'role_boss', 'role_drop',
  // 身份大廳（旅人／寄宿貓貓）領取用；沒設就退回老闆／陪玩身分組
  'role_traveler', 'role_cat', 'role_trainer', 'role_examiner',
  'category_ticket', 'category_exam', 'category_report',
  'category_order_done', 'category_order_public', 'category_order_anon', 'category_order_closed',
  'channel_order_log', 'channel_suggestion', 'channel_staff_box',
  // 播報類
  'channel_vip_announce', 'channel_gift_announce', 'channel_title_announce',
  // 後台類
  'channel_update_log', 'channel_bug_report', 'channel_finance', 'channel_export',
  // 結帳明細備份（含金額）另開一個頻道，沒設就沿用 channel_finance
  'channel_checkout_log',
  // 會員售後類
  'channel_member_system', 'channel_notice_log', 'channel_cs_lobby',
  // 入口類
  'channel_order_entry', 'channel_exam_entry', 'channel_intro',
  'channel_command_log', 'channel_money_log',
  // 語音房
  'channel_voice_hub', 'category_voice', 'voice_room_name', 'voice_room_private',
  // 下單選單選項（逗號分隔）
  'order_genders', 'order_services', 'order_categories', 'order_addons',
  'order_type_labels', 'ticket_seq_start', 'order_max_open', 'order_cooldown_sec',
  // 技術單定級與陪玩身分組分流
  'order_rank_services', 'order_want_ranks', 'order_want_ranks_female', 'order_rank_ladder', 'order_role_routes',
  // 結單頻道幾天後自動刪除
  'ticket_delete_days'
];
const SETTING_KEYS = [...ORG_KEYS, ...GUILD_KEYS];

router.use('/config', guardModule('settings'));
router.get('/config', (req, res) => {
  const out = {};
  for (const k of ORG_KEYS) out[k] = getSetting(k, '', req.orgId);
  for (const k of GUILD_KEYS) out[k] = getSetting(k, '', req.guildId);
  if (!out.staff_share_rate) out.staff_share_rate = '70';
  if (!out.vip_thresholds) out.vip_thresholds = DEFAULT_VIP.join(',');
  if (!out.vip_names) out.vip_names = R.DEFAULT_VIP_NAMES.join(',');
  res.json({ values: out, keys: SETTING_KEYS, org_keys: ORG_KEYS });
});
router.put('/config', (req, res) => {
  const b = req.body || {};
  for (const k of ORG_KEYS) if (k in b) setSetting(k, b[k], req.orgId);
  for (const k of GUILD_KEYS) if (k in b) setSetting(k, b[k], req.guildId);
  audit(req.user.name, '更新系統設定', '', req.orgId, { source: 'web' });
  res.json({ ok: true });
});

// ---------------- 集團綁定（陪玩群 ×員工群 資料互通）----------------
router.get('/org', guardModule('settings'), (req, res) => {
  const all = db.prepare('SELECT * FROM guilds WHERE active=1').all();
  const map = Object.fromEntries(db.prepare('SELECT * FROM guild_org').all().map(r => [r.guild_id, r]));
  res.json({
    current_guild: req.guildId,
    current_org: req.orgId,
    members: orgGuilds(req.orgId),
    guilds: all.map(g => ({
      ...g,
      org_id: map[g.guild_id]?.org_id || g.guild_id,
      label: map[g.guild_id]?.label || '',
      linked: orgOf(g.guild_id) === req.orgId
    }))
  });
});
router.put('/org', guardModule('settings'), (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '僅總管理員可調整集團綁定' });
  const { guild_id, org_id, label = '', migrate = true } = req.body || {};
  if (!guild_id) return res.status(400).json({ error: '請指定伺服器' });
  const before = orgOf(guild_id);
  bindOrg(guild_id, org_id || '', label);
  const after = orgOf(guild_id);
  // 把這台伺服器原本自己那份營運資料搬進新集團，避免舊帳失聯
  const moved = migrate && before !== after ? migrateOrgData(before, after) : 0;
  audit(req.user.name, '集團綁定', `${guild_id} → ${after}（搬移 ${moved} 筆）`, after, { source: 'web' });
  res.json({ ok: true, org_id: after, moved });
});

// ---------------- 操作紀錄 ----------------
router.get('/logs', guardModule('logs'), (req, res) => {
  const q = req.query;
  const cond = ["guild_id IN (?, '')"], args = [req.orgId];
  if (q.source) { cond.push('source = ?'); args.push(q.source); }
  if (q.status) { cond.push('status = ?'); args.push(q.status); }
  if (q.actor)  { cond.push('(actor_id = ? OR actor LIKE ?)'); args.push(q.actor, `%${q.actor}%`); }
  if (q.from)   { cond.push('date(created_at) >= date(?)'); args.push(q.from); }
  if (q.to)     { cond.push('date(created_at) <= date(?)'); args.push(q.to); }
  if (q.q)      { cond.push('(action LIKE ? OR detail LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  const where = cond.join(' AND ');
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100));
  const offset = Math.max(0, Number(q.offset) || 0);
  res.json({
    total: db.prepare(`SELECT COUNT(*) c FROM audit_logs WHERE ${where}`).get(...args).c,
    rows: db.prepare(`SELECT * FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset)
  });
});

// ---------------- Discord 資源 ----------------
router.get('/discord/guilds', (req, res) => {
  const rows = db.prepare('SELECT * FROM guilds WHERE active=1').all()
    .filter(g => req.allowedGuilds.includes(g.guild_id))
    // 主營運伺服器排最前面，後台第一次開就停在它
    .sort((a, b) => (b.guild_id === HOME_GUILD) - (a.guild_id === HOME_GUILD));
  res.json({ guilds: rows, current: req.guildId, bot_online: bot.isReady() });
});
router.get('/discord/resources', async (req, res) => {
  const client = bot.getClient();
  if (!client || !bot.isReady()) return res.json({ roles: [], channels: [], categories: [], voices: [] });
  const g = await client.guilds.fetch(req.guildId).catch(() => null);
  if (!g) return res.json({ roles: [], channels: [], categories: [], voices: [] });
  const roles = (await g.roles.fetch()).filter(r => r.name !== '@everyone')
    .map(r => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name));
  const chans = await g.channels.fetch();
  res.json({
    roles,
    channels: chans.filter(c => c && c.type === 0).map(c => ({ id: c.id, name: c.name })),
    categories: chans.filter(c => c && c.type === 4).map(c => ({ id: c.id, name: c.name })),
    // 語音頻道（給「創建語音房」大廳用）
    voices: chans.filter(c => c && c.type === 2).map(c => ({ id: c.id, name: c.name }))
  });
});
router.get('/discord/member/:id', async (req, res) => {
  const client = bot.getClient();
  if (!client || !bot.isReady()) return res.status(503).json({ error: '機器人離線' });
  const g = await client.guilds.fetch(req.guildId).catch(() => null);
  const m = g && await g.members.fetch(req.params.id).catch(() => null);
  if (!m) return res.status(404).json({ error: '查無此成員' });
  res.json({ id: m.id, name: m.displayName, tag: m.user.tag, avatar: m.user.displayAvatarURL() });
});

// ---------------- 帳號權限 ----------------
router.use('/users', guardModule('users'));
router.get('/users', (req, res) => {
  res.json(db.prepare(`SELECT id, username, name, role, permissions, guild_ids, active, created_at,
            last_login_at, last_login_ip, login_count FROM admin_users ORDER BY id`).all());
});
router.post('/users', (req, res) => {
  const { username, password, name = '', role = 'staff', permissions = [], guild_ids = [] } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '請填寫帳號與密碼' });
  if (String(password).length < 8) return res.status(400).json({ error: '密碼至少 8 碼' });
  const perms = (Array.isArray(permissions) ? permissions : parsePermissions(permissions))
    .filter(p => MODULE_KEYS.includes(p)).join(',');
  try {
    db.prepare('INSERT INTO admin_users (username, password_hash, name, role, permissions, guild_ids) VALUES (?,?,?,?,?,?)')
      .run(username, bcrypt.hashSync(password, 10), name, role === 'admin' ? 'admin' : 'staff', perms,
           (Array.isArray(guild_ids) ? guild_ids : []).join(','));
  } catch { return res.status(400).json({ error: '帳號已存在' }); }
  audit(req.user.name, '新增後台帳號', username, '', { source: 'web' });
  res.json({ ok: true });
});
router.put('/users/:id', (req, res) => {
  const u = db.prepare('SELECT * FROM admin_users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: '查無帳號' });
  const b = req.body || {};
  const perms = b.permissions
    ? (Array.isArray(b.permissions) ? b.permissions : parsePermissions(b.permissions))
        .filter(p => MODULE_KEYS.includes(p)).join(',')
    : u.permissions;
  db.prepare('UPDATE admin_users SET name=?, role=?, permissions=?, guild_ids=?, active=? WHERE id=?')
    .run(b.name ?? u.name, b.role === 'admin' ? 'admin' : (b.role ? 'staff' : u.role), perms,
         b.guild_ids ? (Array.isArray(b.guild_ids) ? b.guild_ids.join(',') : b.guild_ids) : u.guild_ids,
         b.active == null ? u.active : (b.active ? 1 : 0), u.id);
  if (b.password) {
    if (String(b.password).length < 8) return res.status(400).json({ error: '密碼至少 8 碼' });
    db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(b.password, 10), u.id);
  }
  audit(req.user.name, '編輯後台帳號', u.username, '', { source: 'web' });
  res.json({ ok: true });
});
router.delete('/users/:id', (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: '不能刪除自己' });
  db.prepare('DELETE FROM admin_users WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 自己改密碼（任何帳號都可以）
router.post('/password', express.json(), (req, res) => {
  const { old_password, new_password } = req.body || {};
  if (!bcrypt.compareSync(old_password || '', req.user.password_hash))
    return res.status(400).json({ error: '舊密碼錯誤' });
  if (String(new_password || '').length < 8) return res.status(400).json({ error: '新密碼至少 8 碼' });
  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
