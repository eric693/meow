// 核心金流：報單 → 核銷 → 陪玩薪資 → 提領
// 所有金錢往來（一般訂單、贈送禮物、身分組結帳、系統調整）都寫進 orders 這張流水帳，
// 欄位對齊公司既有的匯出格式：訂單原價 / 實收金額 / 陪玩抽成 / 伺服器淨利。
const {
  db, now, nextOrderNo, getCustomer, getStaff, refreshVip, addCoins, getNum, audit, orgOf
} = require('../db');

// 交易類型（對應匯出檔的「交易類型」欄）
const KINDS = {
  order:  { label: '一般訂單',   emoji: '🧾' },
  gift:   { label: '贈送禮物',   emoji: '🎁' },
  role:   { label: '身分組結帳', emoji: '💳' },
  adjust: { label: '系統調整',   emoji: '⚙️' }
};
const kindLabel = k => (KINDS[k] ? `${KINDS[k].emoji} ${KINDS[k].label}` : k);

// 狀態（對應匯出檔的「狀態」欄）
const STATUS = { pending: '暫存中', settled: '已核銷', refunded: '已退單/撤銷' };

// 陪玩分潤成數（%），可在後台「系統設定」調整
const shareRate = guildId => getNum('staff_share_rate', 80, orgOf(guildId));

/**
 * 建立一筆交易（報單／送禮／身分組結帳）。
 * 老闆雨幣即時扣款，陪玩抽成先進「暫存薪水」，核銷後才轉可提領。
 * listPrice 是訂單原價、amount 是實收金額（可折扣）；未指定則兩者相同。
 */
function createOrder({
  guildId, customerId, customerName = '', staffId, staffName = '', csId = '', csName = '',
  kind = 'order', item = '', qty = 1, unitPrice = 0, listPrice = null, amount = null,
  staffShare = null, source = 'self', note = '', operator = '', orderNo = null, createdAt = null,
  status = 'pending', skipWallet = false, payMethod = '雨幣扣款'
}) {
  guildId = orgOf(guildId);
  const staff = getStaff(guildId, staffId);
  if (!staff || !staff.active) throw new Error('查無此陪玩（或已離職），請先用 /入職 建檔');

  const paid = Math.round(amount == null ? Number(qty) * Number(unitPrice) : Number(amount));
  if (!Number.isFinite(paid)) throw new Error('實收金額格式不正確');
  // 匯入歷史資料時允許 0 元紀錄（例如免費贈禮）；日常開單則不允許
  if (paid === 0 && !skipWallet) throw new Error('實收金額不可為 0');
  const list = Math.round(listPrice == null ? paid : Number(listPrice));
  const share = Math.round(staffShare == null ? paid * shareRate(guildId) / 100 : Number(staffShare));
  const net = paid - share;
  const no = orderNo || nextOrderNo();

  db.transaction(() => {
    // 匯入歷史資料時不動錢包（skipWallet），避免把過去的帳重算一次
    if (!skipWallet && paid !== 0) {
      addCoins(guildId, customerId, -paid, `${KINDS[kind]?.label || kind} ${no}`,
        { ref: no, operator, name: customerName });
    }
    db.prepare('UPDATE customers SET total_spend = total_spend + ? WHERE guild_id = ? AND user_id = ?')
      .run(paid, guildId, customerId);
    db.prepare(`INSERT INTO orders
        (order_no, guild_id, customer_id, staff_id, cs_id, customer_name, staff_name, cs_name,
         kind, item, qty, unit_price, list_price, amount, staff_share, net, source, status, note,
         pay_method, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, datetime('now','localtime')))`)
      .run(no, guildId, customerId, staffId, csId,
           customerName || getCustomer(guildId, customerId).name || customerId,
           staffName || staff.name || staff.code, csName,
           kind, item, Number(qty) || 1, Math.round(unitPrice) || 0,
           list, paid, share, net, source, status, note, payMethod || '雨幣扣款', createdAt);
    if (status === 'settled') {
      db.prepare(`UPDATE staff SET income = income + ?, total_income = total_income + ?
                  WHERE guild_id=? AND user_id=?`).run(share, share, guildId, staffId);
    } else {
      db.prepare('UPDATE staff SET pending_income = pending_income + ? WHERE guild_id = ? AND user_id = ?')
        .run(share, guildId, staffId);
    }
  })();

  refreshVip(guildId, customerId);
  audit(operator || customerId, '建立交易', `${no} ${kindLabel(kind)} ${paid}`, guildId);
  return db.prepare('SELECT * FROM orders WHERE order_no = ?').get(no);
}

/** 更新一筆交易（後台編輯）。金額有變動時同步修正老闆錢包與陪玩薪資。 */
function updateOrder(guildId, orderNo, patch = {}, operator = '') {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);

  const paid = patch.amount == null ? o.amount : Math.round(Number(patch.amount));
  const list = patch.list_price == null ? o.list_price : Math.round(Number(patch.list_price));
  const share = patch.staff_share == null ? o.staff_share : Math.round(Number(patch.staff_share));
  if (!Number.isFinite(paid) || !Number.isFinite(share)) throw new Error('金額格式不正確');
  const dAmount = paid - o.amount, dShare = share - o.staff_share;

  db.transaction(() => {
    if (dAmount && o.status !== 'refunded') {
      // 實收變多 → 老闆再扣款；變少 → 退還差額
      addCoins(guildId, o.customer_id, -dAmount, `修改訂單 ${orderNo}`, { ref: orderNo, operator, allowNegative: true });
      db.prepare('UPDATE customers SET total_spend = MAX(0, total_spend + ?) WHERE guild_id=? AND user_id=?')
        .run(dAmount, guildId, o.customer_id);
    }
    if (dShare && o.status !== 'refunded') {
      const col = o.status === 'settled' ? 'income' : 'pending_income';
      db.prepare(`UPDATE staff SET ${col} = MAX(0, ${col} + ?) WHERE guild_id=? AND user_id=?`)
        .run(dShare, guildId, o.staff_id);
    }
    db.prepare(`UPDATE orders SET kind=?, item=?, qty=?, unit_price=?, list_price=?, amount=?,
                staff_share=?, net=?, note=?, cs_id=?, cs_name=?, customer_name=?, staff_name=?,
                source=?, pay_method=?, created_at=? WHERE id=?`)
      .run(patch.kind ?? o.kind, patch.item ?? o.item, patch.qty ?? o.qty,
           patch.unit_price ?? o.unit_price, list, paid, share, paid - share,
           patch.note ?? o.note, patch.cs_id ?? o.cs_id, patch.cs_name ?? o.cs_name,
           patch.customer_name ?? o.customer_name, patch.staff_name ?? o.staff_name,
           patch.source ?? o.source, patch.pay_method ?? o.pay_method,
           patch.created_at ?? o.created_at, o.id);
  })();

  refreshVip(guildId, o.customer_id);
  audit(operator, '修改交易', `${orderNo}`, guildId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
}

/** 刪除一筆交易（會回沖錢包與薪資），與「退單」不同：這是把紀錄整筆移除 */
function deleteOrder(guildId, orderNo, operator = '') {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  db.transaction(() => {
    if (o.status !== 'refunded') {
      addCoins(guildId, o.customer_id, o.amount, `刪除訂單 ${orderNo}`, { ref: orderNo, operator, allowNegative: true });
      db.prepare('UPDATE customers SET total_spend = MAX(0, total_spend - ?) WHERE guild_id=? AND user_id=?')
        .run(o.amount, guildId, o.customer_id);
      const col = o.status === 'settled' ? 'income' : 'pending_income';
      db.prepare(`UPDATE staff SET ${col} = MAX(0, ${col} - ?) WHERE guild_id=? AND user_id=?`)
        .run(o.staff_share, guildId, o.staff_id);
    }
    db.prepare('DELETE FROM gift_logs WHERE guild_id=? AND order_no=?').run(guildId, orderNo);
    db.prepare('DELETE FROM orders WHERE id=?').run(o.id);
  })();
  audit(operator, '刪除交易', orderNo, guildId);
  return { ok: true };
}

/** 依編號取單（跨群共用同一份帳） */
function getOrder(guildId, orderNo) {
  return db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?')
    .get(orgOf(guildId), String(orderNo || '').trim().toUpperCase());
}

/**
 * 陪玩在員工群報單：認領主群結帳時已建立的訂單。
 * 只補上回報人、服務內容與時間，不動任何金流（錢在結帳時就收了）。
 */
function reportOrder(guildId, orderNo, { reporterId = '', item = null, qty = null, note = '' } = {}) {
  guildId = orgOf(guildId);
  const o = getOrder(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}，請向客服確認結帳時提供的編號`);
  if (o.status === 'refunded') throw new Error(`訂單 ${o.order_no} 已退單，無法報單`);
  if (o.status === 'settled') throw new Error(`訂單 ${o.order_no} 已核銷完畢，不需再報單`);
  if (o.reported_at) throw new Error(`訂單 ${o.order_no} 已於 ${o.reported_at} 報過單了`);

  db.prepare(`UPDATE orders SET reporter_id=?, reported_at=?, item=COALESCE(?, item),
              qty=COALESCE(?, qty), note=? WHERE id=?`)
    .run(reporterId, now(), item, qty, note ? (o.note ? o.note + ' / ' + note : note) : o.note, o.id);
  audit(reporterId, '陪玩報單', o.order_no, guildId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
}

/** 核銷：暫存薪水 → 可提領薪水 */
function settleOrder(guildId, orderNo, operator = '') {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND order_no = ?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'settled') throw new Error(`訂單 ${orderNo} 已核銷過`);
  if (o.status === 'refunded') throw new Error(`訂單 ${orderNo} 已退單，無法核銷`);

  db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'settled', settled_at = ? WHERE id = ?").run(now(), o.id);
    db.prepare(`UPDATE staff SET pending_income = MAX(0, pending_income - ?),
                income = income + ?, total_income = total_income + ?
                WHERE guild_id = ? AND user_id = ?`)
      .run(o.staff_share, o.staff_share, o.staff_share, guildId, o.staff_id);
  })();

  audit(operator, '核銷訂單', `${orderNo} 陪玩入帳 ${o.staff_share}`, guildId);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
}

/** 退單／撤銷：退還老闆實收金額、扣回陪玩抽成 */
function refundOrder(guildId, orderNo, operator = '', reason = '') {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND order_no = ?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'refunded') throw new Error(`訂單 ${orderNo} 已退過款`);

  db.transaction(() => {
    addCoins(guildId, o.customer_id, o.amount, `退單 ${orderNo}${reason ? '：' + reason : ''}`,
      { ref: orderNo, operator });
    db.prepare('UPDATE customers SET total_spend = MAX(0, total_spend - ?) WHERE guild_id = ? AND user_id = ?')
      .run(o.amount, guildId, o.customer_id);
    const col = o.status === 'settled' ? 'income' : 'pending_income';
    db.prepare(`UPDATE staff SET ${col} = MAX(0, ${col} - ?) WHERE guild_id = ? AND user_id = ?`)
      .run(o.staff_share, guildId, o.staff_id);
    if (o.status === 'settled') {
      db.prepare('UPDATE staff SET total_income = MAX(0, total_income - ?) WHERE guild_id=? AND user_id=?')
        .run(o.staff_share, guildId, o.staff_id);
    }
    db.prepare("UPDATE orders SET status = 'refunded', note = ? WHERE id = ?")
      .run((o.note ? o.note + ' / ' : '') + '退單：' + (reason || '無註記'), o.id);
  })();

  refreshVip(guildId, o.customer_id);
  audit(operator, '退單', `${orderNo} 退還 ${o.amount}`, guildId);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
}

/** 陪玩提領：從「可提領」扣除，建立提領紀錄 */
function requestWithdraw(guildId, staffId, amount, operator = '', note = '') {
  guildId = orgOf(guildId);
  const s = getStaff(guildId, staffId);
  if (!s) throw new Error('查無此陪玩');
  const amt = Math.round(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) throw new Error('提領金額必須大於 0');
  if (amt > s.income) throw new Error(`可提領餘額不足：目前 ${s.income}`);

  db.transaction(() => {
    db.prepare('UPDATE staff SET income = income - ? WHERE id = ?').run(amt, s.id);
    db.prepare('INSERT INTO withdrawals (guild_id, staff_id, amount, operator, note) VALUES (?,?,?,?,?)')
      .run(guildId, staffId, amt, operator, note);
  })();
  audit(operator || staffId, '申請提領', `${s.name || staffId} ${amt}`, guildId);
  return db.prepare('SELECT * FROM withdrawals WHERE guild_id = ? AND staff_id = ? ORDER BY id DESC LIMIT 1')
    .get(guildId, staffId);
}

/** 管理員審核提領：done 完成 / rejected 退回（退回會把錢還給陪玩） */
function reviewWithdraw(guildId, id, status, operator = '') {
  guildId = orgOf(guildId);
  const w = db.prepare('SELECT * FROM withdrawals WHERE guild_id = ? AND id = ?').get(guildId, id);
  if (!w) throw new Error('查無提領紀錄');
  if (w.status !== 'pending') throw new Error('此筆提領已處理過');
  db.transaction(() => {
    db.prepare('UPDATE withdrawals SET status = ?, operator = ?, done_at = ? WHERE id = ?')
      .run(status, operator, now(), id);
    if (status === 'rejected') {
      db.prepare('UPDATE staff SET income = income + ? WHERE guild_id = ? AND user_id = ?')
        .run(w.amount, guildId, w.staff_id);
    }
  })();
  audit(operator, status === 'done' ? '完成提領' : '退回提領', `#${id} ${w.amount}`, guildId);
  return db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(id);
}

module.exports = {
  createOrder, updateOrder, deleteOrder, getOrder, reportOrder, settleOrder, refundOrder,
  requestWithdraw, reviewWithdraw, shareRate, KINDS, STATUS, kindLabel
};
