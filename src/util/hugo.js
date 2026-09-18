// 雨果幣與 BINGO：與雨幣完全分開的另一本帳，只用在遊戲，不會影響點單消費與 VIP 累計。
const { db, orgOf, audit, getSetting, getNum } = require('../db');

// ---------- 錢包 ----------
const wallet = (guildId, userId) =>
  db.prepare('SELECT * FROM hugo_wallet WHERE guild_id=? AND user_id=?').get(orgOf(guildId), userId)
  || { guild_id: orgOf(guildId), user_id: userId, balance: 0, name: '' };

const balanceOf = (guildId, userId) => wallet(guildId, userId).balance;

/**
 * 加減雨果幣，餘額與流水一起寫，兩者永遠對得起來。
 * 預設不允許扣成負數：餘額不夠就擋下來，不要讓負債默默累積。
 */
function addHugo(guildId, userId, delta, { kind = 'adjust', reason = '', ref = '',
                                           operator = '', name = '', allowNegative = false } = {}) {
  const gid = orgOf(guildId);
  delta = Math.round(Number(delta));
  if (!Number.isFinite(delta) || delta === 0) throw new Error('金額不正確');
  return db.transaction(() => {
    const cur = db.prepare('SELECT balance FROM hugo_wallet WHERE guild_id=? AND user_id=?').get(gid, userId);
    const before = cur ? cur.balance : 0;
    const after = before + delta;
    if (after < 0 && !allowNegative) throw new Error(`雨果幣不足：目前 ${before.toLocaleString('en-US')}`);
    db.prepare(`INSERT INTO hugo_wallet (guild_id, user_id, balance, name)
                VALUES (?,?,?,?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET
                  balance = excluded.balance,
                  name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE hugo_wallet.name END,
                  updated_at = datetime('now','localtime')`)
      .run(gid, userId, after, name);
    db.prepare(`INSERT INTO hugo_tx (guild_id, user_id, delta, kind, reason, ref, operator)
                VALUES (?,?,?,?,?,?,?)`)
      .run(gid, userId, delta, kind, reason, ref, operator);
    return after;
  })();
}

/** 某人的雨果幣流水（預設最近 20 筆） */
const history = (guildId, userId, limit = 20) =>
  db.prepare('SELECT * FROM hugo_tx WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT ?')
    .all(orgOf(guildId), userId, limit);

/** 所有還有餘額的人（總覽用） */
const holders = guildId =>
  db.prepare('SELECT * FROM hugo_wallet WHERE guild_id=? AND balance <> 0 ORDER BY balance DESC')
    .all(orgOf(guildId));

/** 全服統計：流通量、儲值、派彩、店家淨收 */
function stats(guildId) {
  const gid = orgOf(guildId);
  const sum = k => db.prepare('SELECT COALESCE(SUM(delta),0) v FROM hugo_tx WHERE guild_id=? AND kind=?').get(gid, k).v;
  return {
    circulating: db.prepare('SELECT COALESCE(SUM(balance),0) v FROM hugo_wallet WHERE guild_id=?').get(gid).v,
    holders: db.prepare('SELECT COUNT(*) c FROM hugo_wallet WHERE guild_id=? AND balance <> 0').get(gid).c,
    topup: sum('topup'), deduct: sum('deduct'), bet: -sum('bet'), win: sum('win'),
    rounds: db.prepare('SELECT COUNT(*) c FROM bingo_rounds WHERE guild_id=?').get(gid).c
  };
}

// ---------- BINGO ----------
// 圖案可在後台改（bingo_symbols，逗號分隔）。要換成伺服器自訂表情就填
// <:名稱:ID> 這種格式，換圖不必動程式。
const DEFAULT_SYMBOLS = ['🐱', '🐈', '🐈‍⬛', '🐯', '🦁', '🐰', '🐻', '🐼', '🦊', '🌙', '🍋', '🍊'];
const symbols = guildId => {
  const raw = getSetting('bingo_symbols', '', orgOf(guildId));
  // 自訂表情本身含冒號，所以用逗號分隔；不足 12 種就退回預設，避免中獎率被玩壞
  const list = raw.split(',').map(x => x.trim()).filter(Boolean);
  return list.length >= 12 ? list.slice(0, 12) : DEFAULT_SYMBOLS;
};

// 5×5 的 12 條線：5 橫、5 直、2 斜
const LINES = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map(c => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map(r => r * 5 + c));
  L.push([0, 6, 12, 18, 24]);
  L.push([4, 8, 12, 16, 20]);
  return L;
})();

const countLines = grid => LINES.filter(L => L.every(i => grid[i] === grid[L[0]])).length;
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const shuffle = arr => arr.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(x => x[1]);

/**
 * 產生剛好有 target 條線的盤面。
 *
 * 純隨機填 5×5 幾乎不可能連線，所以是先決定要中幾條、再把盤面做出來：
 * 挑好目標線 → 有交叉的線必須同圖案（交點只能有一個圖案），用併查集分組 →
 * 填完其餘格子 → 驗算實際線數，不符就重抽。
 * 驗算這一步不能省：填空格時可能不小心多湊出一條線。
 */
function buildGrid(guildId, target) {
  const SYM = symbols(guildId);
  for (let attempt = 0; attempt < 400; attempt++) {
    const chosen = shuffle([...LINES.keys()]).slice(0, target);
    // 有交點的目標線要同圖案
    const group = chosen.map((_, i) => i);
    const find = i => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let a = 0; a < chosen.length; a++) {
      for (let b = a + 1; b < chosen.length; b++) {
        if (LINES[chosen[a]].some(i => LINES[chosen[b]].includes(i))) group[find(a)] = find(b);
      }
    }
    const symOf = new Map();
    const pool = shuffle(SYM);
    let next = 0;
    const grid = new Array(25).fill(null);
    let bad = false;
    for (let a = 0; a < chosen.length && !bad; a++) {
      const g = find(a);
      if (!symOf.has(g)) symOf.set(g, pool[next++ % pool.length]);
      for (const i of LINES[chosen[a]]) {
        if (grid[i] && grid[i] !== symOf.get(g)) { bad = true; break; }
        grid[i] = symOf.get(g);
      }
    }
    if (bad) continue;
    for (let i = 0; i < 25; i++) if (!grid[i]) grid[i] = pick(SYM);
    if (countLines(grid) === target) return grid;
  }
  // 極少數抽不出來時，退回「保證沒有線」的盤面，寧可不中也不要給錯的線數
  return Array.from({ length: 25 }, (_, i) => SYM[(Math.floor(i / 5) * 5 + (i % 5) * 3) % SYM.length]);
}

/** 中獎線數的機率（後台 bingo_odds 可調，預設 0 線 40%、1 線 46%、2 線 12%、3 線 2%） */
function odds(guildId) {
  const raw = getSetting('bingo_odds', '', orgOf(guildId)).split(',').map(Number).filter(n => n >= 0);
  const w = raw.length === 4 ? raw : [40, 46, 12, 2];
  return w.reduce((a, b) => a + b, 0) > 0 ? w : [40, 46, 12, 2];
}
/** 各線數拿回多少倍（含本金）。預設 1 線退本、2 線 2.5 倍、3 線 8 倍＝店家抽 8% */
function payouts(guildId) {
  const raw = getSetting('bingo_payouts', '', orgOf(guildId)).split(',').map(Number);
  const p = raw.length === 3 && raw.every(n => Number.isFinite(n) && n >= 0) ? raw : [1, 2.5, 8];
  return [0, ...p];
}
const minBet = guildId => Math.max(1, getNum('bingo_min_bet', 500, orgOf(guildId)));

function rollLines(guildId) {
  const w = odds(guildId);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
  return 0;
}

/**
 * 玩一局：先扣注金，再依機率決定線數、產生盤面，中獎才派彩。
 * 扣款與派彩都走 addHugo，所以流水與餘額一定對得起來。
 */
function playBingo(guildId, userId, bet, name = '') {
  const gid = orgOf(guildId);
  bet = Math.round(Number(bet));
  const min = minBet(guildId);
  if (!Number.isFinite(bet) || bet < min) throw new Error(`最低下注 ${min.toLocaleString('en-US')} 雨果幣`);
  const before = balanceOf(gid, userId);
  if (before < bet) throw new Error(`雨果幣不足：目前 ${before.toLocaleString('en-US')}，需要 ${bet.toLocaleString('en-US')}`);

  const lines = rollLines(gid);
  const grid = buildGrid(gid, lines);
  const payout = Math.round(bet * payouts(gid)[lines]);

  const round = db.transaction(() => {
    addHugo(gid, userId, -bet, { kind: 'bet', reason: `BINGO 下注 ${bet}`, operator: userId, name });
    const info = db.prepare(`INSERT INTO bingo_rounds (guild_id, user_id, bet, lines, payout, grid)
                             VALUES (?,?,?,?,?,?)`).run(gid, userId, bet, lines, payout, grid.join(','));
    if (payout > 0) {
      addHugo(gid, userId, payout, { kind: 'win', reason: `BINGO ${lines} 條線`, ref: String(info.lastInsertRowid), operator: 'system', name });
    }
    return info.lastInsertRowid;
  })();

  audit(name || userId, 'BINGO', `下注 ${bet}／${lines} 線／拿回 ${payout}`, gid, { actorId: userId, source: 'game' });
  return { round, bet, lines, payout, grid, balance: balanceOf(gid, userId), net: payout - bet };
}

/** 盤面畫成 5 行文字 */
const renderGrid = grid => {
  const rows = [];
  for (let r = 0; r < 5; r++) rows.push(grid.slice(r * 5, r * 5 + 5).join(''));
  return rows.join('\n');
};

module.exports = {
  balanceOf, addHugo, history, holders, stats,
  playBingo, renderGrid, buildGrid, countLines, odds, payouts, minBet, symbols, LINES
};
