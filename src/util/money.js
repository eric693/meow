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
// 送禮分潤成數（%）：禮物定價 × 此比例 = 陪玩實拿，其餘為平台抽成
const giftShareRate = guildId => getNum('gift_share_rate', 70, orgOf(guildId));
// 結帳親密度成數（%）：實收金額 × 此比例 = 本單增加的羈絆點數
const intimacyRate = guildId => getNum('order_intimacy_rate', 100, orgOf(guildId));

/**
 * 重算「暫存薪水」：直接以未核銷訂單的抽成合計為準。
 *
 * 暫存薪水完全由訂單推導得出，所以不用加加減減去維護餘額——只要訂單有異動就重算，
 * 帳面永遠等於「未核銷訂單合計」，不會因為匯入、加減時被夾在 0、或任何一步漏算而對不上。
 * （可提領餘額則不行：它還牽涉提領紀錄與舊系統轉入的餘額，仍需逐筆加減。）
 */
// 從舊系統匯入的歷史訂單：薪水在舊系統多半已經結算發放過，
// 在這裡再核銷一次就等於同一筆錢發兩次（曾經一次誤核銷 58 筆、多發十萬元）。
const isLegacyOrder = o =>
  ['legacy', 'import'].includes(o.source) || String(o.order_no || '').startsWith('IMP-');

// 這筆單當初是不是真的從錢包扣了雨幣。
//
// 不能只看 pay_method：補單、匯入的歷史單都走 skipWallet 沒扣過錢，付款方式卻仍寫「雨幣扣款」，
// 事後改單／刪單就會照帳面金額退錢出去（曾因此憑空生出 6,241 雨幣）。
// 以「這張單有沒有留下扣款流水」為準最實在。
function chargedCoins(guildId, o) {
  if (!o.customer_id) return 0;
  // 取「淨扣款」：扣過的減掉改單時已退還的，否則先改金額再退單會多退一次差額
  const v = db.prepare(`SELECT COALESCE(SUM(-delta),0) v FROM coin_tx
                        WHERE guild_id=? AND user_id=? AND ref=?`)
    .get(orgOf(guildId), o.customer_id, o.order_no).v;
  return Math.max(0, v);
}
const paidByCoins = (guildId, o) => /雨幣/.test(o.pay_method || '') && chargedCoins(guildId, o) > 0;

// 現金／轉帳是場外收款，系統無從得知錢有沒有真的進來。
// 這種單一律標記為「待對帳」，但不擋核銷：財務不會隨時在線，擋著會讓客服沒辦法
// 即時幫陪玩核銷報單。改成事後對帳制——財務從後台核對銀行帳單／現金，
// 真的沒收到款再按「沒收到款」把核銷取消、抽成扣回來（revokeCashPayment）。
const CASH_METHODS = /現金|轉帳|匯款/;
const isCashPay = payMethod => CASH_METHODS.test(String(payMethod || ''));
/** 這張單現在是不是還卡在待確認收款 */
const isUnconfirmedCash = o => Number(o?.cash_confirmed ?? 1) === 0;

function recalcPending(guildId, staffId) {
  if (!staffId) return;
  guildId = orgOf(guildId);
  // 現金單未對帳也照算暫存薪水：單子照常能核銷，帳面就該誠實顯示欠陪玩這筆
  db.prepare(`UPDATE staff SET pending_income = COALESCE(
      (SELECT SUM(staff_share) FROM orders
       WHERE guild_id=? AND staff_id=? AND status='pending'), 0)
    WHERE guild_id=? AND user_id=?`).run(guildId, staffId, guildId, staffId);
}

/**
 * 建立一筆交易（報單／送禮／身分組結帳）。
 * 老闆雨幣即時扣款，陪玩抽成先進「暫存薪水」，核銷後才轉可提領。
 * listPrice 是訂單原價、amount 是實收金額（可折扣）；未指定則兩者相同。
 * 折扣由伺服器吸收：陪玩抽成以原價計算，淨利＝實收－抽成（折太多會是負的）。
 */
function createOrder({
  guildId, customerId, customerName = '', staffId, staffName = '', csId = '', csName = '',
  kind = 'order', item = '', qty = 1, unitPrice = 0, listPrice = null, amount = null,
  staffShare = null, source = 'self', note = '', operator = '', orderNo = null, createdAt = null,
  status = 'pending', skipWallet = false, payMethod = '雨幣扣款',
  intimacy = null, allowNoStaff = false, allowZero = false, orderPrefix = 'ORD',
  cashConfirmed = null
}) {
  guildId = orgOf(guildId);
  // 伺服器冠名、財務調整這類收入沒有對應陪玩，staffId 允許留空
  const staff = staffId ? getStaff(guildId, staffId) : null;
  if (staffId && (!staff || !staff.active))
    throw new Error('查無此陪玩（或已離職），請先用 /入職 建檔');
  if (!staffId && !allowNoStaff) throw new Error('請指定陪玩');

  const paid = Math.round(amount == null ? Number(qty) * Number(unitPrice) : Number(amount));
  if (!Number.isFinite(paid)) throw new Error('實收金額格式不正確');
  // 匯入歷史資料與財務調整允許 0 元紀錄；日常開單則不允許
  if (paid === 0 && !skipWallet && !allowZero) throw new Error('實收金額不可為 0');
  const list = Math.round(listPrice == null ? paid : Number(listPrice));
  // 折扣一律由伺服器吸收：陪玩抽成固定以「訂單原價」計算，不受折價券或 VIP 折扣影響
  const share = !staffId ? 0
    : Math.round(staffShare == null ? list * shareRate(guildId) / 100 : Number(staffShare));
  const net = paid - share;
  // 一般訂單與身分組結帳會累積羈絆；送禮由 gifts.sendGift 另外計算，這裡傳 0
  const bond = Math.round(intimacy == null
    ? (staffId && customerId && (kind === 'order' || kind === 'role') ? paid * intimacyRate(guildId) / 100 : 0)
    : Number(intimacy));
  const no = orderNo || nextOrderNo(orderPrefix);
  const vipBefore = customerId ? getCustomer(guildId, customerId).vip_level : 0;

  // 現金／轉帳的新單預設標「待對帳」（只是標記，不擋核銷）；匯入的歷史單是既成事實，不用再對一次
  const legacySource = ['legacy', 'import'].includes(source) || String(no).startsWith('IMP-');
  const confirmed = cashConfirmed != null ? (cashConfirmed ? 1 : 0)
    : (isCashPay(payMethod) && !legacySource ? 0 : 1);

  db.transaction(() => {
    // 匯入歷史資料時不動錢包（skipWallet），避免把過去的帳重算一次
    if (!skipWallet && paid !== 0 && customerId) {
      addCoins(guildId, customerId, -paid, `${KINDS[kind]?.label || kind} ${no}`,
        { ref: no, operator, name: customerName });
    }
    if (customerId) {
      db.prepare('UPDATE customers SET total_spend = total_spend + ? WHERE guild_id = ? AND user_id = ?')
        .run(paid, guildId, customerId);
    }
    db.prepare(`INSERT INTO orders
        (order_no, guild_id, customer_id, staff_id, cs_id, customer_name, staff_name, cs_name,
         kind, item, qty, unit_price, list_price, amount, staff_share, net, source, status, note,
         pay_method, intimacy, cash_confirmed, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, datetime('now','localtime')))`)
      .run(no, guildId, customerId, staffId, csId,
           customerName || (customerId ? getCustomer(guildId, customerId).name || customerId : ''),
           staffName || (staff ? staff.name || staff.code : ''), csName,
           kind, item, Number(qty) || 1, Math.round(unitPrice) || 0,
           list, paid, share, net, source, status, note, payMethod || '雨幣扣款', bond,
           confirmed, createdAt);
    // 一建立就是「已核銷」的單（身分組結帳、補單）也要有核銷時間，否則報表以核銷日篩選會漏掉
    if (status === 'settled') {
      db.prepare("UPDATE orders SET settled_at = COALESCE(settled_at, created_at) WHERE order_no = ? AND guild_id = ?")
        .run(no, guildId);
    }
    if (staffId) {
      if (status === 'settled') {
        db.prepare(`UPDATE staff SET income = income + ?, total_income = total_income + ?
                    WHERE guild_id=? AND user_id=?`).run(share, share, guildId, staffId);
      } else {
        recalcPending(guildId, staffId);
      }
    }
    if (bond && staffId && customerId) {
      require('./gifts').addIntimacy(guildId, customerId, staffId, bond);
    }
  })();

  if (customerId) {
    const vipAfter = refreshVip(guildId, customerId);
    if (vipAfter > vipBefore) require('./announce').vipUpgraded(guildId, customerId, vipBefore, vipAfter);
  }
  audit(operator || customerId, '建立交易', `${no} ${kindLabel(kind)} ${paid}`, guildId, { source: 'orders' });
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
    // 現金／轉帳的單只改帳面數字，不動雨幣錢包（當初就沒扣過）
    if (dAmount && o.status !== 'refunded' && paidByCoins(guildId, o) && o.customer_id) {
      // 實收變多 → 老闆再扣款；變少 → 退還差額。
      // 補收的方向不允許扣成負數：餘額不夠就要先請老闆儲值，
      // 讓餘額默默變負只會把問題往後推，之後結帳與對帳都會怪怪的。
      addCoins(guildId, o.customer_id, -dAmount, `修改訂單 ${orderNo}`,
        { ref: orderNo, operator, allowNegative: dAmount < 0 });
    }
    if (dAmount && o.status !== 'refunded' && o.customer_id) {
      db.prepare('UPDATE customers SET total_spend = MAX(0, total_spend + ?) WHERE guild_id=? AND user_id=?')
        .run(dAmount, guildId, o.customer_id);
    }
    if (dShare && o.status === 'settled') {
      db.prepare('UPDATE staff SET income = MAX(0, income + ?) WHERE guild_id=? AND user_id=?')
        .run(dShare, guildId, o.staff_id);
    }
    // 付款方式被改掉時，對帳標記要跟著調整：改成雨幣扣款代表錢已經在系統裡，
    // 直接視為已收款；反過來改成現金，錢就跑到系統外了，要退回待對帳讓財務再看一次。
    if (patch.pay_method != null && patch.pay_method !== o.pay_method) {
      if (!isCashPay(patch.pay_method)) {
        db.prepare('UPDATE orders SET cash_confirmed=1 WHERE id=?').run(o.id);
      } else if (Number(o.cash_confirmed) === 1 && !isCashPay(o.pay_method)) {
        db.prepare('UPDATE orders SET cash_confirmed=0 WHERE id=?').run(o.id);
      }
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
    recalcPending(guildId, o.staff_id);
  })();

  // 改單把消費金額往上調也可能升等，一樣要播報（原本只有建立訂單時會發）
  const vipBefore = o.customer_id ? getCustomer(guildId, o.customer_id).vip_level : 0;
  const vipAfter = refreshVip(guildId, o.customer_id);
  if (o.customer_id && vipAfter > vipBefore)
    require('./announce').vipUpgraded(guildId, o.customer_id, vipBefore, vipAfter);
  audit(operator, '修改交易', `${orderNo}`, guildId, { source: 'orders' });
  return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
}

/** 刪除一筆交易（會回沖錢包與薪資），與「退單」不同：這是把紀錄整筆移除 */
function deleteOrder(guildId, orderNo, operator = '') {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  db.transaction(() => {
    if (o.status !== 'refunded') {
      if (paidByCoins(guildId, o) && o.customer_id) {
        addCoins(guildId, o.customer_id, o.amount, `刪除訂單 ${orderNo}`, { ref: orderNo, operator, allowNegative: true });
      }
      db.prepare('UPDATE customers SET total_spend = MAX(0, total_spend - ?) WHERE guild_id=? AND user_id=?')
        .run(o.amount, guildId, o.customer_id);
      if (o.status === 'settled') {
        db.prepare('UPDATE staff SET income = MAX(0, income - ?) WHERE guild_id=? AND user_id=?')
          .run(o.staff_share, guildId, o.staff_id);
      }
    }
    // 整筆刪除等同交易沒發生過，券也要還回去
    if (o.status !== 'refunded') require('./gifts').restoreCoupons(guildId, o.order_no);
    db.prepare('DELETE FROM gift_logs WHERE guild_id=? AND order_no=?').run(guildId, orderNo);
    db.prepare('DELETE FROM coupon_uses WHERE guild_id=? AND order_no=?').run(guildId, orderNo);
    db.prepare('DELETE FROM orders WHERE id=?').run(o.id);
    recalcPending(guildId, o.staff_id);
  })();
  audit(operator, '刪除交易', orderNo, guildId, { source: 'orders' });
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
  // 核銷前允許重報（陪玩填錯可以自己更正），核銷後才鎖定
  if (o.status === 'settled') throw new Error(`訂單 ${o.order_no} 已核銷完畢，不需再報單`);

  db.prepare(`UPDATE orders SET reporter_id=?, reported_at=?, item=COALESCE(?, item),
              qty=COALESCE(?, qty), note=? WHERE id=?`)
    .run(reporterId, now(), item, qty, note ? (o.note ? o.note + ' / ' + note : note) : o.note, o.id);
  audit(reporterId, '陪玩報單', o.order_no, guildId, { source: 'orders', actorId: reporterId });
  return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
}

/** 取消報單：把報單紀錄清掉，訂單回到「未報單」狀態（核銷後不可） */
function unreportOrder(guildId, orderNo, operator = '') {
  guildId = orgOf(guildId);
  const o = getOrder(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'settled') throw new Error(`訂單 ${o.order_no} 已核銷完畢，無法取消報單`);
  if (!o.reported_at) throw new Error(`訂單 ${o.order_no} 目前沒有報單紀錄`);

  db.prepare("UPDATE orders SET reporter_id='', reported_at=NULL WHERE id=?").run(o.id);
  audit(operator, '取消報單', o.order_no, guildId, { source: 'orders' });
  return o;
}

/** 核銷：暫存薪水 → 可提領薪水 */
function settleOrder(guildId, orderNo, operator = '', { force = false } = {}) {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND order_no = ?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'settled') throw new Error(`這筆訂單（${o.order_no}）已經核銷過了！`);
  if (o.status === 'refunded') throw new Error(`訂單 ${orderNo} 已退單，無法核銷`);
  if (isLegacyOrder(o) && !force) {
    const e = new Error(`${o.order_no} 是從舊系統匯入的歷史訂單（${String(o.created_at).slice(0, 10)}），`
      + '舊系統可能已經發過這筆薪水，核銷會再發一次。確定要發放請改用「強制核銷」。');
    e.code = 'LEGACY_ORDER';
    throw e;
  }

  db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'settled', settled_at = ? WHERE id = ?").run(now(), o.id);
    db.prepare(`UPDATE staff SET income = income + ?, total_income = total_income + ?
                WHERE guild_id = ? AND user_id = ?`)
      .run(o.staff_share, o.staff_share, guildId, o.staff_id);
    recalcPending(guildId, o.staff_id);
  })();

  audit(operator, '核銷訂單',
    `${orderNo} 陪玩入帳 ${o.staff_share}${isLegacyOrder(o) ? '（強制核銷匯入的歷史單）' : ''}`,
    guildId, { source: 'salary' });
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
}

/**
 * 財務對完帳，確認這張現金／轉帳單真的收到款：把它從「待對帳」清單移除。
 * proof 建議填匯款帳號後五碼或匯款時間，事後對銀行帳單才查得到。
 */
function confirmCashPayment(guildId, orderNo, operator = '', { proof = '' } = {}) {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'refunded') throw new Error(`訂單 ${orderNo} 已退單，不需確認收款`);
  if (!isUnconfirmedCash(o)) throw new Error(`訂單 ${orderNo} 不在待對帳狀態`);

  db.transaction(() => {
    db.prepare('UPDATE orders SET cash_confirmed=1, cash_proof=? WHERE id=?')
      .run(String(proof || '').trim(), o.id);
    recalcPending(guildId, o.staff_id);
  })();
  audit(operator, '確認收款', `${orderNo} ${o.amount}${proof ? `（憑證：${proof}）` : ''}`,
    guildId, { source: 'orders' });

  // 舊版把送禮／身分組的現金單壓回未核銷過，收款確認時補完那一步
  if (['gift', 'role'].includes(o.kind) && o.status === 'pending' && o.staff_id) {
    try { return settleOrder(guildId, orderNo, operator); }
    catch { /* 核銷失敗（例如匯入的歷史單）不影響收款確認本身 */ }
  }
  return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
}

/**
 * 財務對帳後發現這筆現金／轉帳根本沒收到錢：退回待對帳，並取消核銷。
 * 已核銷的單要把抽成從陪玩「可提領薪水」扣回來，退回暫存薪水（status=pending）；
 * 錢真的沒進來，這筆就不該留在可領的錢裡。訂單本身不動（要作廢請用退單）。
 */
function revokeCashPayment(guildId, orderNo, operator = '', reason = '') {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id=? AND order_no=?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'refunded') throw new Error(`訂單 ${orderNo} 已退單，不需再取消核銷`);

  const wasSettled = o.status === 'settled';
  db.transaction(() => {
    db.prepare('UPDATE orders SET cash_confirmed=0, cash_proof=?, note=? WHERE id=?')
      .run('', (o.note ? o.note + ' / ' : '') + '未收到款，取消核銷' + (reason ? '：' + reason : ''), o.id);
    if (wasSettled) {
      db.prepare("UPDATE orders SET status='pending', settled_at=NULL WHERE id=?").run(o.id);
      if (o.staff_id) {
        db.prepare(`UPDATE staff SET income = MAX(0, income - ?),
                    total_income = MAX(0, total_income - ?) WHERE guild_id=? AND user_id=?`)
          .run(o.staff_share, o.staff_share, guildId, o.staff_id);
      }
    }
    recalcPending(guildId, o.staff_id);
  })();
  audit(operator, wasSettled ? '取消核銷（未收到款）' : '標記未收到款',
    `${orderNo} ${o.amount}${wasSettled ? ` 扣回抽成 ${o.staff_share}` : ''}${reason ? `（${reason}）` : ''}`,
    guildId, { source: 'orders' });
  return db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);
}

/**
 * 儲值一定要留匯款憑證（帳號後五碼／匯款時間）。
 * 只記金額不記憑證的話，事後跟銀行帳單對不起來，也查不出是誰、哪一筆匯的。
 */
function checkTopupProof(delta, proof) {
  if (Number(delta) > 0 && !String(proof || '').trim())
    throw new Error('儲值必須填寫匯款憑證（例：帳號後五碼 12345，或匯款時間 08/22 14:30），才對得上銀行帳單。');
}

/** 還沒對帳確認收款的現金單（後台對帳頁用） */
function unconfirmedCashOrders(guildId) {
  return db.prepare(`SELECT * FROM orders WHERE guild_id=? AND cash_confirmed=0 AND status<>'refunded'
                     ORDER BY created_at DESC`).all(orgOf(guildId));
}

/** 退單／撤銷：退還老闆實收金額、扣回陪玩抽成 */
function refundOrder(guildId, orderNo, operator = '', reason = '', { refundCoins = true, forceLegacyCoins = false } = {}) {
  guildId = orgOf(guildId);
  const o = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND order_no = ?').get(guildId, orderNo);
  if (!o) throw new Error(`查無訂單 ${orderNo}`);
  if (o.status === 'refunded') throw new Error(`訂單 ${orderNo} 已退過款`);

  // 退幣一律以「當初真的從錢包扣走多少」為準，而不是訂單金額：
  // 現金／轉帳的單當初沒扣過雨幣，若照訂單金額退就等於平白送老闆一筆雨幣。
  // 匯入的歷史單：舊系統的扣款早就反映在轉入的餘額裡，流水只是把歷史搬過來，
  // 照著退等於同一筆錢退兩次（月冠母單就是這樣白送了 65,000）。
  // 真的要退，得明確指定 forceLegacyCoins。
  const legacyNoCoin = isLegacyOrder(o) && !forceLegacyCoins;
  const charged = legacyNoCoin ? 0 : chargedCoins(guildId, o);
  const noCoinPaid = refundCoins && o.customer_id && charged <= 0;
  let restored = [];

  db.transaction(() => {
    // 不退幣時（例如老闆違規）只撤銷訂單、扣回陪玩分潤，雨幣不還給老闆
    if (refundCoins && charged > 0) {
      addCoins(guildId, o.customer_id, charged, `退單 ${orderNo}${reason ? '：' + reason : ''}`,
        { ref: orderNo, operator });
    }
    if (o.customer_id) {
      db.prepare('UPDATE customers SET total_spend = MAX(0, total_spend - ?) WHERE guild_id = ? AND user_id = ?')
        .run(o.amount, guildId, o.customer_id);
    }
    if (o.staff_id && o.status === 'settled') {
      db.prepare(`UPDATE staff SET income = MAX(0, income - ?),
                  total_income = MAX(0, total_income - ?) WHERE guild_id = ? AND user_id = ?`)
        .run(o.staff_share, o.staff_share, guildId, o.staff_id);
    }
    // 本單當初加的羈絆點數原數扣回
    if (o.intimacy && o.staff_id && o.customer_id) {
      require('./gifts').addIntimacy(guildId, o.customer_id, o.staff_id, -o.intimacy);
    }
    // 用掉的折價券原樣還回老闆背包（面額、門檻、期限都照原本的）
    restored = require('./gifts').restoreCoupons(guildId, o.order_no);
    db.prepare("UPDATE orders SET status = 'refunded', note = ? WHERE id = ?")
      .run((o.note ? o.note + ' / ' : '') + '退單：' + (reason || '無註記')
           + (refundCoins ? (noCoinPaid ? '（原單未扣雨幣，未退幣）' : '') : '（不退幣）')
           + (restored.length ? `（已退回折價券：${restored.map(c => c.name).join('、')}）` : ''), o.id);
    recalcPending(guildId, o.staff_id);
  })();

  if (o.customer_id) refreshVip(guildId, o.customer_id);
  audit(operator, '退單',
    `${orderNo} ${refundCoins && charged > 0 ? `退還 ${charged}` : `未退（原單未扣雨幣）`}`
    + (restored.length ? `，退回折價券 ${restored.map(c => c.name).join('、')}` : ''),
    guildId, { source: 'salary' });
  // 把「實際發生了什麼」一併回傳，通知訊息才不會寫成「已退還雨幣」但其實一毛都沒退
  return {
    ...db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id),
    refunded_coins: refundCoins ? charged : 0,
    restored_coupons: restored.map(c => c.name),
    legacy_no_coin: legacyNoCoin
  };
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
  audit(operator || staffId, '申請提領', `${s.name || staffId} ${amt}`, guildId, { source: 'salary' });
  return db.prepare('SELECT * FROM withdrawals WHERE guild_id = ? AND staff_id = ? ORDER BY id DESC LIMIT 1')
    .get(guildId, staffId);
}

/** 管理員直接發薪：從陪玩「可提領」扣除並直接記為已完成，不需再審核 */
function payoutStaff(guildId, staffId, amount, operator = '', note = '') {
  const w = requestWithdraw(guildId, staffId, amount, operator, note || '管理員直接發放');
  return reviewWithdraw(guildId, w.id, 'done', operator);
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
  createOrder, updateOrder, deleteOrder, getOrder, reportOrder, unreportOrder, settleOrder, refundOrder,
  recalcPending, isLegacyOrder, isCashPay, isUnconfirmedCash,
  confirmCashPayment, revokeCashPayment, unconfirmedCashOrders, checkTopupProof,
  requestWithdraw, reviewWithdraw, payoutStaff,
  shareRate, giftShareRate, intimacyRate, KINDS, STATUS, kindLabel
};
