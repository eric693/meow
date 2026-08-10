// 多步驟互動（結帳選券→選付款、下單逐步選單）的暫存資料。
// 只活在機器人記憶體裡，重啟或逾時就消失——這些都是還沒成立的流程，掉了重跑即可。
const store = new Map();
const TTL_MS = 15 * 60 * 1000;   // 與「15 分鐘未回覆視同棄單」一致

const newId = () => Math.random().toString(36).slice(2, 10);

function put(data) {
  const id = newId();
  store.set(id, { data, at: Date.now() });
  return id;
}
function get(id) {
  const row = store.get(id);
  if (!row) return null;
  if (Date.now() - row.at > TTL_MS) { store.delete(id); return null; }
  return row.data;
}
const update = (id, patch) => {
  const d = get(id);
  if (!d) return null;
  Object.assign(d, patch);
  return d;
};
const drop = id => store.delete(id);

// 定期清掉過期的，避免長時間執行累積
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.at > TTL_MS) store.delete(k);
}, 5 * 60 * 1000).unref();

module.exports = { put, get, update, drop };
