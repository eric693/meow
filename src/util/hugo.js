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

// 中獎局數依線數分：{ 1: n, 2: n, 3: n, jackpot: n, total: n }
// 全盤同圖案（12 條線）另外歸到 jackpot，客服備獎時才分得出頭獎與一般連線
function byLines(gid, extra) {
  const out = { 1: 0, 2: 0, 3: 0, jackpot: 0, total: 0 };
  for (const r of db.prepare(`SELECT lines, COUNT(*) c FROM bingo_rounds
                              WHERE guild_id=? AND lines > 0 ${extra} GROUP BY lines`).all(gid)) {
    if (r.lines >= JACKPOT_LINES) out.jackpot += r.c;
    else out[r.lines] = (out[r.lines] || 0) + r.c;
    out.total += r.c;
  }
  return out;
}

/** 全服統計：流通量、儲值、扣款、下注，以及各線數中獎與待兌換的局數 */
function stats(guildId) {
  const gid = orgOf(guildId);
  const sum = k => db.prepare('SELECT COALESCE(SUM(delta),0) v FROM hugo_tx WHERE guild_id=? AND kind=?').get(gid, k).v;
  return {
    circulating: db.prepare('SELECT COALESCE(SUM(balance),0) v FROM hugo_wallet WHERE guild_id=?').get(gid).v,
    holders: db.prepare('SELECT COUNT(*) c FROM hugo_wallet WHERE guild_id=? AND balance <> 0').get(gid).c,
    topup: sum('topup'), deduct: sum('deduct'), bet: -sum('bet'),
    rounds: db.prepare('SELECT COUNT(*) c FROM bingo_rounds WHERE guild_id=?').get(gid).c,
    // 獎勵內容另外公布，這裡只算局數：依線數分開，客服才知道要準備幾份哪一種獎
    wins: byLines(gid, ''),
    pending: byLines(gid, "AND redeemed_at=''")
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
  // 頭獎：整盤同一個圖案，12 條線全中
  if (target >= JACKPOT_LINES) return new Array(25).fill(pick(SYM));
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

// 全盤同圖案＝12 條線全中，也就是頭獎
const JACKPOT_LINES = 12;
const DEFAULT_ODDS = [30, 40, 20, 8, 2];

/**
 * 中獎機率（後台 bingo_odds 可調）：依序是 0 線、1 線、2 線、3 線、全盤同圖案。
 * 機率是對全體玩家而言的長期比例，不是保證每個人都照這個比例中。
 * 舊設定只填四個數字時，補一個 0 當頭獎機率，行為跟以前一樣。
 */
function odds(guildId) {
  const raw = getSetting('bingo_odds', '', orgOf(guildId)).split(',').map(Number).filter(n => n >= 0);
  let w = raw.length >= 4 ? raw.slice(0, 5) : DEFAULT_ODDS;
  if (w.length === 4) w = [...w, 0];
  return w.reduce((a, b) => a + b, 0) > 0 ? w : DEFAULT_ODDS;
}
const minBet = guildId => Math.max(1, getNum('bingo_min_bet', 500, orgOf(guildId)));

/** 頭獎總共幾份（後台 bingo_jackpot_limit，預設 1；填 0 代表不限） */
const jackpotLimit = guildId => Math.max(0, getNum('bingo_jackpot_limit', 1, orgOf(guildId)));

/** 頭獎還有沒有剩：開出過的全盤同圖局數還沒達到上限就算有 */
function jackpotLeft(guildId) {
  const gid = orgOf(guildId);
  const limit = jackpotLimit(gid);
  if (limit === 0) return Infinity;
  const won = db.prepare('SELECT COUNT(*) c FROM bingo_rounds WHERE guild_id=? AND lines >= ?')
    .get(gid, JACKPOT_LINES).c;
  return Math.max(0, limit - won);
}

/** 抽這一局中幾條線；頭獎已經被抽走就把那份機率讓給其餘結果 */
function rollLines(guildId) {
  const w = odds(guildId).slice();
  if (!jackpotLeft(guildId)) w[4] = 0;
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let r = Math.random() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i === 4 ? JACKPOT_LINES : i;
  }
  return 0;
}

/**
 * 玩一局：扣注金，再依機率決定線數、產生盤面。
 *
 * 雨果幣只能靠客服手動儲值進帳，中獎不會自動發回雨果幣。
 * 獎勵內容由店家另外公布，系統只記下中了幾條線，由玩家截圖找客服兌換。
 */
function playBingo(guildId, userId, bet, name = '') {
  const gid = orgOf(guildId);
  bet = Math.round(Number(bet));
  const min = minBet(guildId);
  if (!Number.isFinite(bet) || bet < min) throw new Error(`最低下注 ${min.toLocaleString('en-US')} 雨果幣`);
  const before = balanceOf(gid, userId);
  if (before < bet) throw new Error(`雨果幣不足：目前 ${before.toLocaleString('en-US')}，需要 ${bet.toLocaleString('en-US')}`);

  // 抽線數與寫入放在同一個交易裡：兩個人幾乎同時抽中頭獎時，
  // 後面那位在交易內會發現頭獎已經沒了，改成一般結果，不會發出兩份頭獎。
  const { round, lines, grid } = db.transaction(() => {
    let lines = rollLines(gid);
    if (lines >= JACKPOT_LINES && !jackpotLeft(gid)) lines = 3;
    const grid = buildGrid(gid, lines);
    addHugo(gid, userId, -bet, { kind: 'bet', reason: `BINGO 下注 ${bet}`, operator: userId, name });
    // payout 欄位保留不用（固定 0）：獎勵另外公布，不在系統裡定價
    const round = db.prepare(`INSERT INTO bingo_rounds (guild_id, user_id, bet, lines, payout, grid)
                       VALUES (?,?,?,?,0,?)`).run(gid, userId, bet, lines, grid.join(',')).lastInsertRowid;
    return { round, lines, grid };
  })();

  audit(name || userId, 'BINGO',
    `下注 ${bet}／${lines >= JACKPOT_LINES ? '全盤同圖（頭獎）' : `${lines} 線`}`,
    gid, { actorId: userId, source: 'game' });
  return { round, bet, lines, grid, balance: balanceOf(gid, userId) };
}

/**
 * 客服兌換中獎局的獎勵。同一局只能兌換一次——截圖可以複製，局號不行。
 * 用 UPDATE ... WHERE redeemed_at='' 一次完成檢查與標記，兩位客服同時按也只會成功一次。
 */
function redeemRound(guildId, roundId, operator) {
  const gid = orgOf(guildId);
  const r = db.prepare('SELECT * FROM bingo_rounds WHERE guild_id=? AND id=?').get(gid, roundId);
  if (!r) throw new Error(`查無局號 #${roundId}`);
  if (!r.lines) throw new Error(`局號 #${roundId} 沒有中獎，沒有獎勵可兌換`);
  if (r.redeemed_at) throw new Error(`局號 #${roundId} 已經在 ${r.redeemed_at} 由 ${r.redeemed_by} 兌換過了`);
  const done = db.prepare(`UPDATE bingo_rounds SET redeemed_at=datetime('now','localtime'), redeemed_by=?
                           WHERE guild_id=? AND id=? AND redeemed_at=''`).run(operator, gid, roundId);
  if (!done.changes) throw new Error(`局號 #${roundId} 剛剛已被兌換`);
  audit(operator, '兌換 BINGO 獎勵', `#${roundId} ${r.user_id} ${r.lines} 線`, gid, { source: 'game' });
  return db.prepare('SELECT * FROM bingo_rounds WHERE id=?').get(roundId);
}

/** 某人還沒兌換的中獎局 */
const unredeemed = (guildId, userId) =>
  db.prepare(`SELECT * FROM bingo_rounds WHERE guild_id=? AND user_id=? AND lines > 0 AND redeemed_at=''
              ORDER BY id DESC`).all(orgOf(guildId), userId);

// 還沒翻開的牌
const CARD_BACK = '⬛';

/** 盤面畫成 5 行文字；revealed 是已翻開幾列（翻牌動畫用，預設全開） */
const renderGrid = (grid, revealed = 5) => {
  const rows = [];
  for (let r = 0; r < 5; r++) {
    rows.push(r < revealed ? grid.slice(r * 5, r * 5 + 5).join('') : CARD_BACK.repeat(5));
  }
  return rows.join('\n');
};

/** 落在中獎線上的格子 */
const winningCells = grid => {
  const hit = new Set();
  for (const L of LINES) if (L.every(i => grid[i] === grid[L[0]])) L.forEach(i => hit.add(i));
  return hit;
};

/** 中獎位置圖：連成線的格子標綠，其餘暗色，一眼看出是哪幾條 */
const renderWinMap = grid => {
  const hit = winningCells(grid);
  const rows = [];
  for (let r = 0; r < 5; r++) {
    rows.push([0, 1, 2, 3, 4].map(c => (hit.has(r * 5 + c) ? '🟩' : '⬛')).join(''));
  }
  return rows.join('\n');
};

/** 中了哪幾條線，寫成人看得懂的字 */
const describeLines = grid => {
  // 全盤同圖案列 12 條線太長，直接講結論
  if (countLines(grid) >= JACKPOT_LINES) return ['全盤同圖案（12 條線全中）'];
  const names = [];
  LINES.forEach((L, k) => {
    if (!L.every(i => grid[i] === grid[L[0]])) return;
    names.push(k < 5 ? `第 ${k + 1} 橫列` : k < 10 ? `第 ${k - 4} 直行` : k === 10 ? '左上右下斜線' : '右上左下斜線');
  });
  return names;
};

/** 這一局是不是頭獎（全盤同圖案） */
const isJackpot = lines => Number(lines) >= JACKPOT_LINES;
/** 結果的顯示名稱，指令與卡片共用同一套說法 */
const resultTag = lines => (isJackpot(lines) ? '🏆 5×5 全盤同圖（頭獎）'
  : ['槓龜', '一條線', '兩條線', '三條線'][lines] || `${lines} 條線`);

module.exports = {
  balanceOf, addHugo, history, holders, stats,
  playBingo, redeemRound, unredeemed, renderGrid, renderWinMap, winningCells, describeLines,
  buildGrid, countLines, odds, minBet, symbols, LINES,
  JACKPOT_LINES, jackpotLimit, jackpotLeft, isJackpot, resultTag, rollLines
};
