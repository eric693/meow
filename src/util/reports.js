// 報表查詢與匯出（bot 指令與後台共用）
// 所有營收都在 orders 這張流水帳裡（kind 區分一般訂單／贈送禮物／身分組結帳／系統調整）。
const { db, monthPrefix, orgOf, getSetting } = require('../db');
const { KINDS, STATUS, kindLabel } = require('./money');

const LIVE = "status IN ('pending','settled')";   // 退單／撤銷不計業績

// ---------- VIP 等級名稱（對齊公司既有匯出檔）----------
const DEFAULT_VIP_NAMES = [
  '一般金主 (未達VIP)', 'VIP 1', 'VIP 2', 'VIP 3', 'VIP 4', 'VIP 5', 'VIP 6 玄霖', 'SSVIP 天瀾'
];
function vipNames(guildId) {
  const raw = getSetting('vip_names', '', orgOf(guildId));
  const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
  return arr.length === 8 ? arr : DEFAULT_VIP_NAMES;
}
const vipName = (guildId, level) => vipNames(guildId)[Math.max(0, Math.min(7, level | 0))];

// ---------- 老闆消費 ----------
function customerSpend(guildId, userId, month = monthPrefix()) {
  guildId = orgOf(guildId);
  const all = db.prepare(`SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM orders
                          WHERE guild_id=? AND customer_id=? AND ${LIVE}`).get(guildId, userId);
  const mon = db.prepare(`SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM orders
                          WHERE guild_id=? AND customer_id=? AND ${LIVE} AND created_at LIKE ?`)
    .get(guildId, userId, month + '%');
  const gift = db.prepare(`SELECT COALESCE(SUM(amount),0) amt FROM orders
                           WHERE guild_id=? AND customer_id=? AND kind='gift' AND ${LIVE}`)
    .get(guildId, userId).amt;
  const c = db.prepare('SELECT * FROM customers WHERE guild_id=? AND user_id=?').get(guildId, userId);
  return {
    total: all.amt, total_count: all.cnt,
    month: mon.amt, month_count: mon.cnt,
    gift_total: gift,
    coins: c ? c.coins : 0, vip_level: c ? c.vip_level : 0, total_spend: c ? c.total_spend : 0,
    vip_name: vipName(guildId, c ? c.vip_level : 0)
  };
}

const customerOrders = (guildId, userId, limit = 50) =>
  db.prepare('SELECT * FROM orders WHERE guild_id=? AND customer_id=? ORDER BY id DESC LIMIT ?')
    .all(orgOf(guildId), userId, limit);

/** 對帳：某老闆在某陪玩身上的累計 */
function pairSpend(guildId, customerId, staffId) {
  guildId = orgOf(guildId);
  const o = db.prepare(`SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM orders
                        WHERE guild_id=? AND customer_id=? AND staff_id=? AND kind<>'gift' AND ${LIVE}`)
    .get(guildId, customerId, staffId);
  const g = db.prepare(`SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM orders
                        WHERE guild_id=? AND customer_id=? AND staff_id=? AND kind='gift' AND ${LIVE}`)
    .get(guildId, customerId, staffId);
  return { order_amount: o.amt, order_count: o.cnt, gift_amount: g.amt, gift_count: g.cnt, total: o.amt + g.amt };
}

/** 陪玩業績詳報：金主分布 Top N */
function staffDetail(guildId, staffId, top = 10) {
  guildId = orgOf(guildId);
  const total = db.prepare(`SELECT COALESCE(SUM(amount),0) amt, COALESCE(SUM(staff_share),0) share, COUNT(*) cnt
                            FROM orders WHERE guild_id=? AND staff_id=? AND ${LIVE}`).get(guildId, staffId);
  const month = db.prepare(`SELECT COALESCE(SUM(amount),0) amt, COUNT(*) cnt FROM orders
                            WHERE guild_id=? AND staff_id=? AND ${LIVE} AND created_at LIKE ?`)
    .get(guildId, staffId, monthPrefix() + '%');
  const gifts = db.prepare(`SELECT COALESCE(SUM(amount),0) amt FROM orders
                            WHERE guild_id=? AND staff_id=? AND kind='gift' AND ${LIVE}`).get(guildId, staffId).amt;
  const patrons = db.prepare(`SELECT customer_id, customer_name, SUM(amount) amount, COUNT(*) cnt
                              FROM orders WHERE guild_id=? AND staff_id=? AND ${LIVE}
                              GROUP BY customer_id ORDER BY amount DESC LIMIT ?`).all(guildId, staffId, top);
  return {
    total: total.amt, total_count: total.cnt, total_share: total.share,
    month: month.amt, month_count: month.cnt, gifts, patrons
  };
}

/**
 * 老闆的專屬點單紀錄：依陪玩彙總，含一般訂單、身分組結帳與贈禮。
 *
 * 兩個重點：
 * 1. 明細與總計都以訂單為準（不用 customers.total_spend）。total_spend 還含著舊系統匯入的
 *    累計金額，跟明細不同來源，兩邊擺在一起就會對不上。
 * 2. 「共消費」看的是訂單原價，折抵的部分另外標出來，跟舊系統的呈現一致。
 */
function patronOrders(guildId, customerId, limit = 0) {
  guildId = orgOf(guildId);
  // 0 元的補登空單只會讓清單出現「某某：0 元」，沒有資訊量，濾掉
  const where = `guild_id=? AND customer_id=? AND status!='refunded' AND (list_price > 0 OR amount > 0)`;
  // 匯入的舊單多半沒存 staff_name，改去員工名冊補回名字，純文字版才不會列出一串 ID
  const rows = db.prepare(`SELECT o.staff_id,
      COALESCE(NULLIF(MAX(o.staff_name), ''), MAX(s.name), MAX(s.code), o.staff_id) staff_name,
      SUM(o.list_price) list, SUM(o.amount) paid, SUM(o.list_price - o.amount) discount,
      SUM(CASE WHEN o.kind='gift' THEN o.list_price ELSE 0 END) gift, COUNT(*) cnt
    FROM orders o LEFT JOIN staff s ON s.guild_id = o.guild_id AND s.user_id = o.staff_id
    WHERE ${where.replace(/guild_id=\?/, 'o.guild_id=?').replace('customer_id=?', 'o.customer_id=?')
                 .replace("status!='refunded'", "o.status!='refunded'")
                 .replace('list_price > 0 OR amount > 0', 'o.list_price > 0 OR o.amount > 0')}
    GROUP BY o.staff_id ORDER BY list DESC ${limit > 0 ? 'LIMIT ?' : ''}`)
    .all(...(limit > 0 ? [guildId, customerId, limit] : [guildId, customerId]));
  const all = db.prepare(`SELECT COALESCE(SUM(list_price),0) list, COALESCE(SUM(amount),0) paid,
      COALESCE(SUM(list_price - amount),0) discount,
      COALESCE(SUM(CASE WHEN kind='gift' THEN list_price ELSE 0 END),0) gift,
      COUNT(*) cnt, COUNT(DISTINCT staff_id) staff
    FROM orders WHERE ${where}`).get(guildId, customerId);
  // 舊系統有一批消費只留下扣雨幣的流水、沒有對應訂單（rebuild-spend.js 重建累計消費時
  // 有把它們算回去，否則這些人會平白掉 VIP 等級）。明細列不出來，但金額要交代，
  // 否則這裡的總計會跟「地下金庫／老闆與 VIP」的歷史消費對不上，老闆就會來問。
  const spend = db.prepare('SELECT total_spend FROM customers WHERE guild_id=? AND user_id=?')
    .get(guildId, customerId);
  // 總計直接用會員資料上的歷史消費，跟地下金庫、老闆與 VIP 同一個數字。
  // 明細列的是訂單原價，加起來會比總計少——差額是舊系統只留扣款流水、
  // 沒有訂單可列的那些消費，不另外拆行說明（店長要求只看到一個數字）。
  all.lifetime = Math.max(Number(spend?.total_spend || 0), Number(all.list || 0));
  // 早期有一批消費只留下扣款紀錄、查不到是哪位陪玩，列不進上面的明細。
  // 不補這一行的話，明細加起來就是不等於總計，老闆一定會來問。
  all.unlisted = all.lifetime - Number(all.list || 0);
  return { rows, total: all };
}

/** 點單紀錄的顯示文字（Discord 用，!查點單 與會員面板共用同一份） */
function patronOrdersText(guildId, customerId, limit = 0) {
  const { rows, total } = patronOrders(guildId, customerId, limit);
  const n = v => Number(v || 0).toLocaleString('en-US');
  if (!rows.length) return '目前沒有任何點單紀錄。';
  const lines = rows.map(r => {
    const who = /^\d{15,25}$/.test(String(r.staff_id || '')) ? `<@${r.staff_id}>` : (r.staff_name || '（未指定）');
    const extra = [
      r.discount > 0 ? `使用了 ${n(r.discount)} 元折價` : '',
      r.gift > 0 ? `含禮物 ${n(r.gift)} 元` : ''
    ].filter(Boolean).join('、');
    return `・${who}：共消費 \`${n(r.list)}\` 元${extra ? `（${extra}）` : ''}`;
  });
  if (total.unlisted > 0)
    lines.push(`・*早期紀錄（查不到陪玩）*：共消費 \`${n(total.unlisted)}\` 元`);

  const tail = ['\n━━━━━━━━━━━━━━━━━━', `💰 **歷史總計消費：** \`${n(total.lifetime)}\` 元`];
  if (total.gift > 0) tail.push(`🎁 其中禮物：\`${n(total.gift)}\` 元`);
  if (total.discount > 0) tail.push(`🎟️ 累計折抵：\`${n(total.discount)}\` 元`);


  // 預設列出全部陪玩；Discord 的 embed 說明欄有 4096 字上限，真的塞不下才截斷，
  // 並明講少列了幾位（總計一律是全部的金額，不受截斷影響）。
  const LIMIT = 3900;
  const tailText = () => '\n' + tail.join('\n');
  let body = lines.join('\n');
  if (body.length + tailText().length > LIMIT) {
    const kept = [];
    let len = 0;
    for (const l of lines) {
      const note = `\n…版面已滿，其餘 ${lines.length - kept.length} 位未列出（總計已包含全部）`;
      if (len + l.length + 1 + tailText().length + note.length > LIMIT) break;
      kept.push(l);
      len += l.length + 1;
    }
    body = kept.join('\n') + `\n…版面已滿，其餘 ${lines.length - kept.length} 位未列出（總計已包含全部）`;
  }
  return body + tailText();
}

/**
 * 點單紀錄的純文字版：手機上 Discord 沒辦法選取 embed 裡的文字，
 * 要能複製就得走一般訊息內容。順便把 @提及換成陪玩名稱，複製出去才看得懂。
 */
function patronOrdersPlain(guildId, customerId, name = '') {
  const { rows, total } = patronOrders(guildId, customerId, 0);
  const n = v => Number(v || 0).toLocaleString('en-US');
  if (!rows.length) return `${name || ''} 目前沒有任何點單紀錄。`.trim();
  const lines = rows.map(r => {
    const who = r.staff_name || (r.staff_id ? r.staff_id : '（未指定）');
    const extra = [
      r.discount > 0 ? `使用了 ${n(r.discount)} 元折價` : '',
      r.gift > 0 ? `含禮物 ${n(r.gift)} 元` : ''
    ].filter(Boolean).join('、');
    return `${who}：共消費 ${n(r.list)} 元${extra ? `（${extra}）` : ''}`;
  });
  if (total.unlisted > 0)
    lines.push(`早期紀錄（查不到陪玩）：共消費 ${n(total.unlisted)} 元`);
  const tail = ['────────────────', `歷史總計消費：${n(total.lifetime)} 元`];
  if (total.gift > 0) tail.push(`其中禮物：${n(total.gift)} 元`);
  if (total.discount > 0) tail.push(`累計折抵：${n(total.discount)} 元`);

  return [`${name || ''}的點單紀錄`.trim(), ...lines, ...tail].join('\n');
}

/**
 * 週結薪資：某一週每位陪玩該領多少。
 *
 * 一律以「核銷日」為準——核銷才是薪水真正進到可提領的時點。
 * 用下單日算會對不上：這週核銷上週的單很常見，兩種算法每週都會差幾百到上萬。
 * weekStart 給該週的第一天（預設本週一，台北時間）。
 */
function weeklyPayroll(guildId, weekStart = '') {
  guildId = orgOf(guildId);
  const start = weekStart
    || db.prepare("SELECT date('now','localtime','weekday 0','-6 days') d").get().d;
  const end = db.prepare("SELECT date(?, '+6 days') d").get(start).d;

  // 名單要從「這週實際有金流的人」出發，不能只從員工名冊撈：
  // 匯入的舊單有不少陪玩已離職或從沒建檔，只看名冊會整批漏掉（曾漏掉 37,370 元）。
  const ids = db.prepare(`
    SELECT staff_id FROM orders
      WHERE guild_id=? AND status='settled' AND staff_id!=''
        AND date(settled_at) BETWEEN date(?) AND date(?)
    UNION
    SELECT staff_id FROM orders
      WHERE guild_id=? AND status='refunded' AND staff_id!=''
        AND date(created_at) BETWEEN date(?) AND date(?)
    UNION
    SELECT staff_id FROM withdrawals
      WHERE guild_id=? AND status!='rejected' AND staff_id!=''
        AND date(COALESCE(done_at, created_at)) BETWEEN date(?) AND date(?)
    UNION
    SELECT user_id FROM staff WHERE guild_id=? AND kind='player' AND (income > 0 OR pending_income > 0)
  `).all(guildId, start, end, guildId, start, end, guildId, start, end, guildId).map(r => r.staff_id);

  const one = db.prepare(`SELECT
      COALESCE((SELECT SUM(staff_share) FROM orders WHERE guild_id=? AND staff_id=? AND status='settled'
                AND date(settled_at) BETWEEN date(?) AND date(?)), 0) settled,
      COALESCE((SELECT COUNT(*) FROM orders WHERE guild_id=? AND staff_id=? AND status='settled'
                AND date(settled_at) BETWEEN date(?) AND date(?)), 0) cnt,
      COALESCE((SELECT SUM(staff_share) FROM orders WHERE guild_id=? AND staff_id=? AND status='refunded'
                AND date(created_at) BETWEEN date(?) AND date(?)), 0) refunded,
      COALESCE((SELECT SUM(amount) FROM withdrawals WHERE guild_id=? AND staff_id=? AND status!='rejected'
                AND date(COALESCE(done_at, created_at)) BETWEEN date(?) AND date(?)), 0) paid`);
  const info = db.prepare('SELECT code, name, income, pending_income, active FROM staff WHERE guild_id=? AND user_id=?');
  const fallbackName = db.prepare(`SELECT staff_name FROM orders
    WHERE guild_id=? AND staff_id=? AND staff_name!='' ORDER BY id DESC LIMIT 1`);

  const rows = ids.map(id => {
    const v = one.get(guildId, id, start, end, guildId, id, start, end,
                      guildId, id, start, end, guildId, id, start, end);
    const s = info.get(guildId, id);
    return {
      user_id: id,
      code: s ? s.code : '',
      name: (s && s.name) || fallbackName.get(guildId, id)?.staff_name || id,
      // 不在名冊的人沒有餘額欄位，週結時要看得出來是誰，才不會默默少發
      in_roster: !!s,
      active: s ? !!s.active : false,
      income: s ? s.income : 0,
      pending_income: s ? s.pending_income : 0,
      ...v
    };
  }).filter(r => r.settled || r.paid || r.refunded || r.income || r.pending_income)
    .sort((a, b) => b.settled - a.settled || String(a.name).localeCompare(String(b.name)));

  const sum = k => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
  return {
    start, end, rows,
    total: { settled: sum('settled'), paid: sum('paid'), refunded: sum('refunded'),
             income: sum('income'), pending: sum('pending_income'), staff: rows.length,
             // 這週有入帳但不在名冊的人，要另外提醒
             off_roster: rows.filter(r => !r.in_roster && r.settled > 0).length,
             off_roster_amount: rows.filter(r => !r.in_roster).reduce((a, r) => a + r.settled, 0) }
  };
}

/** 消費榜 / 金主榜 */
function spendRanking(guildId, limit = 10) {
  guildId = orgOf(guildId);
  const history = db.prepare(`SELECT user_id, name, total_spend, vip_level FROM customers
                              WHERE guild_id=? AND total_spend > 0
                              ORDER BY total_spend DESC LIMIT ?`).all(guildId, limit)
    .map(c => ({ ...c, vip_name: vipName(guildId, c.vip_level) }));
  // 財務調整（平帳）與沒填到老闆的單不是任何人的消費，混進榜上會冒出一行「<@>」，
  // 而且金額往往很大，直接壓在榜首。
  const month = db.prepare(`SELECT customer_id user_id, customer_name name, SUM(amount) amount FROM orders
                            WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?
                              AND customer_id <> '' AND kind <> 'adjust'
                            GROUP BY customer_id ORDER BY amount DESC LIMIT ?`)
    .all(guildId, monthPrefix() + '%', limit);
  return { history, month };
}

/** 金主榜完整版（匯出用）：排名／金主名稱／Discord ID／歷史總消費／本月消費／預估 VIP 等級 */
function patronBoard(guildId, month = monthPrefix()) {
  guildId = orgOf(guildId);
  const monthMap = Object.fromEntries(
    db.prepare(`SELECT customer_id, SUM(amount) a FROM orders
                WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?
                  AND customer_id <> '' AND kind <> 'adjust' GROUP BY customer_id`)
      .all(guildId, month + '%').map(r => [r.customer_id, r.a]));
  return db.prepare('SELECT * FROM customers WHERE guild_id=? ORDER BY total_spend DESC').all(guildId)
    .map((c, i) => ({
      rank: i + 1,
      name: c.name || c.user_id,
      user_id: c.user_id,
      total_spend: c.total_spend,
      month_spend: monthMap[c.user_id] || 0,
      vip_level: c.vip_level,
      vip_name: vipName(guildId, c.vip_level),
      coins: c.coins
    }));
}

/** 業績查詢：某月所有陪玩的業績結算 */
function staffRanking(guildId, month = monthPrefix()) {
  guildId = orgOf(guildId);
  return db.prepare(`
    SELECT s.user_id, s.code, s.name, s.income, s.pending_income,
           COALESCE(o.amt, 0) amount, COALESCE(o.cnt, 0) cnt, COALESCE(o.share, 0) share,
           COALESCE(o.net, 0) net
    FROM staff s
    LEFT JOIN (SELECT staff_id, SUM(amount) amt, COUNT(*) cnt, SUM(staff_share) share, SUM(net) net
               FROM orders WHERE guild_id=? AND ${LIVE} AND created_at LIKE ? GROUP BY staff_id) o
      ON o.staff_id = s.user_id
    WHERE s.guild_id=? AND s.active=1 AND s.kind='player'
    ORDER BY amount DESC`).all(guildId, month + '%', guildId);
}

/** 財務報表：某月淨利 */
function financeReport(guildId, month = monthPrefix()) {
  guildId = orgOf(guildId);
  const like = month + '%';
  const rev = db.prepare(`SELECT COALESCE(SUM(list_price),0) list, COALESCE(SUM(amount),0) a,
                                 COALESCE(SUM(staff_share),0) share, COALESCE(SUM(net),0) net, COUNT(*) c
                          FROM orders WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?`).get(guildId, like);
  const gift = db.prepare(`SELECT COALESCE(SUM(amount),0) a, COUNT(*) c FROM orders
                           WHERE guild_id=? AND kind='gift' AND ${LIVE} AND created_at LIKE ?`).get(guildId, like);
  const refund = db.prepare(`SELECT COALESCE(SUM(amount),0) a, COUNT(*) c FROM orders
                             WHERE guild_id=? AND status='refunded' AND created_at LIKE ?`).get(guildId, like);
  const pending = db.prepare(`SELECT COALESCE(SUM(amount),0) a, COUNT(*) c FROM orders
                              WHERE guild_id=? AND status='pending' AND created_at LIKE ?`).get(guildId, like);
  const wd = db.prepare(`SELECT COALESCE(SUM(amount),0) a, COUNT(*) c FROM withdrawals
                         WHERE guild_id=? AND status='done' AND created_at LIKE ?`).get(guildId, like);
  const byKind = db.prepare(`SELECT kind, COUNT(*) c, COALESCE(SUM(amount),0) a, COALESCE(SUM(net),0) net
                             FROM orders WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?
                             GROUP BY kind ORDER BY a DESC`).all(guildId, like)
    .map(r => ({ ...r, label: kindLabel(r.kind) }));
  return {
    month,
    list_price: rev.list, revenue: rev.a, order_count: rev.c,
    gift_revenue: gift.a, gift_count: gift.c,
    discount: rev.list - rev.a,
    staff_share: rev.share, net: rev.net,
    refund: refund.a, refund_count: refund.c,
    pending: pending.a, pending_count: pending.c,
    withdrawn: wd.a, withdraw_count: wd.c,
    by_kind: byKind,
    top3: staffRanking(guildId, month).slice(0, 3)
  };
}

/** 儀表板圖表資料：近 12 個月趨勢、本月每日、類型佔比、狀態分佈、陪玩排行 */
function dashboardCharts(guildId, month = monthPrefix()) {
  guildId = orgOf(guildId);
  const like = month + '%';

  // 近 12 個月（含本月），沒有資料的月份補 0
  const months = [];
  const [y, m] = month.split('-').map(Number);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  const rows = db.prepare(`SELECT substr(created_at,1,7) ym, COALESCE(SUM(amount),0) revenue,
                                  COALESCE(SUM(net),0) net, COALESCE(SUM(staff_share),0) share, COUNT(*) cnt
                           FROM orders WHERE guild_id=? AND ${LIVE} AND substr(created_at,1,7) >= ?
                           GROUP BY ym`).all(guildId, months[0]);
  const byYm = Object.fromEntries(rows.map(r => [r.ym, r]));
  const monthly = months.map(ym => {
    const r = byYm[ym] || {};
    return { label: ym.slice(2), month: ym, revenue: r.revenue || 0, net: r.net || 0,
             share: r.share || 0, count: r.cnt || 0 };
  });

  // 本月每日營收
  const days = new Date(y, m, 0).getDate();
  const dayRows = db.prepare(`SELECT substr(created_at,9,2) d, COALESCE(SUM(amount),0) revenue,
                                     COALESCE(SUM(net),0) net, COUNT(*) cnt
                              FROM orders WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?
                              GROUP BY d`).all(guildId, like);
  const byDay = Object.fromEntries(dayRows.map(r => [String(Number(r.d)), r]));
  const daily = Array.from({ length: days }, (_, i) => {
    const r = byDay[String(i + 1)] || {};
    return { label: String(i + 1), revenue: r.revenue || 0, net: r.net || 0, count: r.cnt || 0 };
  });

  const byKind = db.prepare(`SELECT kind, COUNT(*) cnt, COALESCE(SUM(amount),0) amount
                             FROM orders WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?
                             GROUP BY kind ORDER BY amount DESC`).all(guildId, like)
    .map(r => ({ ...r, label: kindLabel(r.kind) }));

  const byStatus = db.prepare(`SELECT status, COUNT(*) cnt, COALESCE(SUM(amount),0) amount
                               FROM orders WHERE guild_id=? AND created_at LIKE ?
                               GROUP BY status`).all(guildId, like)
    .map(r => ({ ...r, label: STATUS[r.status] || r.status }));

  const topStaff = staffRanking(guildId, month)
    .filter(s => s.amount > 0).slice(0, 8)
    .map(s => ({ label: s.name || s.code || s.user_id, amount: s.amount, net: s.net, cnt: s.cnt }));

  const topCustomers = db.prepare(`SELECT customer_id, customer_name, COALESCE(SUM(amount),0) amount, COUNT(*) cnt
                                   FROM orders WHERE guild_id=? AND ${LIVE} AND created_at LIKE ?
                                   GROUP BY customer_id ORDER BY amount DESC LIMIT 8`).all(guildId, like)
    .map(c => ({ label: c.customer_name || c.customer_id, amount: c.amount, cnt: c.cnt }));

  return { month, monthly, daily, by_kind: byKind, by_status: byStatus, top_staff: topStaff, top_customers: topCustomers };
}

/** 客服接單排行（基於傳票紀錄，可指定區間） */
function csRanking(guildId, from = '', to = '') {
  guildId = orgOf(guildId);
  const cond = [], args = [guildId];
  if (from) { cond.push('date(created_at) >= date(?)'); args.push(from); }
  if (to) { cond.push('date(created_at) <= date(?)'); args.push(to); }
  const where = cond.length ? ' AND ' + cond.join(' AND ') : '';
  const tickets = db.prepare(`SELECT cs_id, COUNT(*) cnt FROM cs_stats WHERE guild_id=?${where}
                              GROUP BY cs_id ORDER BY cnt DESC`).all(...args);
  // 經辦客服的實際成交金額（流水帳裡的 cs_id）
  const orders = db.prepare(`SELECT cs_id, cs_name, COUNT(*) cnt, COALESCE(SUM(amount),0) amount
                             FROM orders WHERE guild_id=? AND cs_id<>'' AND ${LIVE}${where}
                             GROUP BY cs_id ORDER BY amount DESC`).all(...args);
  return { tickets, orders };
}

const totalCoins = guildId =>
  db.prepare('SELECT COALESCE(SUM(coins),0) c, COUNT(*) n FROM customers WHERE guild_id=?').get(orgOf(guildId));

const unsettled = (guildId, limit = 25) =>
  db.prepare("SELECT * FROM orders WHERE guild_id=? AND status='pending' ORDER BY id ASC LIMIT ?")
    .all(orgOf(guildId), limit);

// ---------- 流水帳查詢（後台「交易流水帳」頁的核心）----------
/**
 * 支援全欄位篩選：月份／日期區間／交易類型／狀態／經辦客服／金主／陪玩／金額區間／關鍵字。
 * limit = 0 代表不分頁（匯出時使用）。
 */
function ledgerQuery(guildId, f = {}) {
  guildId = orgOf(guildId);
  const cond = ['guild_id = ?'], args = [guildId];
  const like = v => `%${v}%`;
  // 月份／起訖日要看哪個日期：預設交易時間，date_field=settled_at 就改看核銷時間
  //（用核銷時間查時，還沒核銷的單自然不會出現）
  const dateCol = f.date_field === 'settled_at' ? 'settled_at' : 'created_at';
  if (f.month)   { cond.push(`${dateCol} LIKE ?`); args.push(f.month + '%'); }
  if (f.from)    { cond.push(`date(${dateCol}) >= date(?)`); args.push(f.from); }
  if (f.to)      { cond.push(`date(${dateCol}) <= date(?)`); args.push(f.to); }
  if (f.kind)    { cond.push('kind = ?'); args.push(f.kind); }
  if (f.status)  { cond.push('status = ?'); args.push(f.status); }
  if (f.source)  { cond.push('source = ?'); args.push(f.source); }
  if (f.cs)      { cond.push('(cs_id = ? OR cs_name LIKE ?)'); args.push(f.cs, like(f.cs)); }
  if (f.customer){ cond.push('(customer_id = ? OR customer_name LIKE ?)'); args.push(f.customer, like(f.customer)); }
  if (f.staff)   { cond.push('(staff_id = ? OR staff_name LIKE ?)'); args.push(f.staff, like(f.staff)); }
  if (f.min_amount !== '' && f.min_amount != null) { cond.push('amount >= ?'); args.push(Number(f.min_amount)); }
  if (f.max_amount !== '' && f.max_amount != null) { cond.push('amount <= ?'); args.push(Number(f.max_amount)); }
  if (f.q) {
    cond.push('(order_no LIKE ? OR item LIKE ? OR note LIKE ? OR customer_name LIKE ? OR staff_name LIKE ? OR cs_name LIKE ?)');
    args.push(like(f.q), like(f.q), like(f.q), like(f.q), like(f.q), like(f.q));
  }
  const where = cond.join(' AND ');

  const sortable = ['created_at', 'settled_at', 'amount', 'staff_share', 'net', 'list_price',
    'order_no', 'status', 'kind'];
  const sort = sortable.includes(f.sort) ? f.sort : 'created_at';
  const dir = String(f.dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const summary = db.prepare(`SELECT COUNT(*) cnt, COALESCE(SUM(list_price),0) list,
      COALESCE(SUM(amount),0) amount, COALESCE(SUM(staff_share),0) share, COALESCE(SUM(net),0) net
      FROM orders WHERE ${where}`).get(...args);

  const limit = Number(f.limit) || 0;
  const rows = limit > 0
    ? db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY ${sort} ${dir}, id ${dir} LIMIT ? OFFSET ?`)
        .all(...args, limit, Math.max(0, Number(f.offset) || 0))
    : db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY ${sort} ${dir}, id ${dir}`).all(...args);

  return { rows, summary, total: summary.cnt };
}

/** 流水帳的匯出欄位定義（CSV / Excel / PDF 共用，順序對齊公司既有檔案） */
const LEDGER_COLUMNS = [
  { key: 'order_no',      label: '訂單編號', width: 16 },
  { key: 'created_at',    label: '交易時間', width: 19 },
  { key: 'settled_at',    label: '核銷時間', width: 19 },
  { key: 'kind',          label: '交易類型', width: 14, map: v => kindLabel(v) },
  { key: 'cs_name',       label: '經辦客服', width: 14 },
  { key: 'customer_name', label: '金主名稱', width: 16 },
  { key: 'staff_name',    label: '陪玩名稱', width: 16 },
  { key: 'list_price',    label: '訂單原價', width: 11, num: true },
  { key: 'amount',        label: '實收金額', width: 11, num: true },
  { key: 'pay_method',    label: '支付方式', width: 12 },
  { key: 'staff_share',   label: '陪玩抽成', width: 11, num: true },
  { key: 'net',           label: '伺服器淨利', width: 12, num: true },
  { key: 'status',        label: '狀態',     width: 12, map: v => STATUS[v] || v },
  { key: 'note',          label: '備註',     width: 24 }
];

const PATRON_COLUMNS = [
  { key: 'rank',        label: '排名',        width: 7,  num: true },
  { key: 'name',        label: '金主名稱',    width: 18 },
  { key: 'user_id',     label: 'Discord ID',  width: 22 },
  { key: 'total_spend', label: '歷史總消費',  width: 13, num: true },
  { key: 'month_spend', label: '本月消費',    width: 12, num: true },
  { key: 'vip_name',    label: '預估 VIP 等級', width: 18 }
];

const STAFF_COLUMNS = [
  { key: 'code',           label: '代號',     width: 10 },
  { key: 'name',           label: '藝名',     width: 16 },
  { key: 'user_id',        label: 'Discord ID', width: 22 },
  { key: 'amount',         label: '業績',     width: 12, num: true },
  { key: 'cnt',            label: '單數',     width: 8,  num: true },
  { key: 'share',          label: '抽成',     width: 12, num: true },
  { key: 'net',            label: '公司淨利', width: 12, num: true },
  { key: 'income',         label: '可提領',   width: 12, num: true },
  { key: 'pending_income', label: '暫存薪水', width: 12, num: true }
];

const WITHDRAW_COLUMNS = [
  { key: 'id',         label: '編號',     width: 8,  num: true },
  { key: 'name',       label: '陪玩',     width: 16 },
  { key: 'staff_id',   label: 'Discord ID', width: 22 },
  { key: 'amount',     label: '金額',     width: 12, num: true },
  { key: 'status',     label: '狀態',     width: 10, map: v => ({ pending: '待處理', done: '已撥款', rejected: '已退回' }[v] || v) },
  { key: 'created_at', label: '申請時間', width: 19 },
  { key: 'done_at',    label: '處理時間', width: 19 },
  { key: 'operator',   label: '經手人',   width: 14 },
  { key: 'note',       label: '備註',     width: 20 }
];

const withdrawRows = (guildId, f = {}) => {
  const cond = ['w.guild_id = ?'], args = [orgOf(guildId)];
  if (f.month) { cond.push('w.created_at LIKE ?'); args.push(f.month + '%'); }
  if (f.status) { cond.push('w.status = ?'); args.push(f.status); }
  return db.prepare(`SELECT w.*, s.name FROM withdrawals w
    LEFT JOIN staff s ON s.guild_id=w.guild_id AND s.user_id=w.staff_id
    WHERE ${cond.join(' AND ')} ORDER BY w.id DESC`).all(...args);
};

module.exports = {
  customerSpend, customerOrders, pairSpend, staffDetail, spendRanking, patronBoard,
  staffRanking, financeReport, dashboardCharts, csRanking, totalCoins, unsettled, weeklyPayroll,
  ledgerQuery, withdrawRows, patronOrders, patronOrdersText, patronOrdersPlain,
  LEDGER_COLUMNS, PATRON_COLUMNS, STAFF_COLUMNS, WITHDRAW_COLUMNS,
  vipName, vipNames, DEFAULT_VIP_NAMES, KINDS, STATUS, kindLabel
};
