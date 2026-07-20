'use strict'
// audit-judge.js — chấm điểm SELF-AUDIT cho AI trọng tài (gs_ai_verdicts.judge_correct).
// STAGED: chạy tay/cron riêng, KHÔNG động vào settle.js hiện có.
//
// Với mỗi verdict đã có kết quả thật (gs_ht_analysis.ft_score IS NOT NULL), tính:
//   judge_correct = quyết định keep/veto của trọng tài có ĐÚNG không.
//   • keep leg  → đúng nếu leg đó THẮNG (hit=true), sai nếu THUA (hit=false).
//   • veto leg  → đúng nếu leg đó ĐÁNG LẼ THUA (hit=false), sai nếu đáng lẽ THẮNG (hit=true).
//   • leg rule=BỎ (không có kèo) hoặc push (hit=null) → KHÔNG tính leg đó (bỏ qua).
// judge_correct của verdict = true nếu MỌI leg tính được đều đúng; false nếu có ≥1 leg sai;
// giữ NULL nếu không có leg nào tính được (vd rule BỎ cả 2).
//
// Cách dùng:  node audit-judge.js            (chấm tất cả verdict đã settle)
//             node audit-judge.js <eventId>  (chấm 1 trận)
//
// NOTE gợi ý tích hợp settle.js: có thể gọi hàm auditOne() này ngay sau khi settle 1 trận,
// truyền side_hit/ou_hit vừa chấm — nhưng để STAGED, ta để nó là script độc lập, idempotent.

require('dotenv').config()
const { Pool } = require('pg')
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.ANALYSIS_DATABASE_URL })

const isBo = (x) => !x || /^bỏ|^bo\b/i.test(String(x).trim())

// đúng/sai cho 1 leg. action ∈ {keep,veto}; hit ∈ {true,false,null}; hasPick = rule có ra kèo.
// trả về true (đúng) / false (sai) / null (không tính).
function legCorrect(action, hit, hasPick) {
  if (!hasPick) return null          // rule BỎ → veto là thao tác rỗng, không tính
  if (hit == null) return null       // push → không tính
  if (action === 'keep') return hit === true
  if (action === 'veto') return hit === false
  return null                        // action rỗng (verdict cũ) → không tính leg
}

function auditOne(v) {
  const hcHasPick = !isBo(v.side_pick)
  const ouHasPick = !isBo(v.ou_pick)
  const hc = legCorrect(v.side_action, v.side_hit, hcHasPick)
  const ou = legCorrect(v.ou_action, v.ou_hit, ouHasPick)
  const legs = [hc, ou].filter((x) => x !== null)
  if (!legs.length) return null                 // không leg nào tính được
  return legs.every((x) => x === true)          // đúng hết → true; có leg sai → false
}

async function main() {
  const only = process.argv[2]
  const q = only
    ? `SELECT v.event_id, v.side_action, v.ou_action, a.side_pick, a.ou_pick, a.side_hit, a.ou_hit
       FROM gs_ai_verdicts v JOIN gs_ht_analysis a ON a.event_id=v.event_id
       WHERE v.event_id=$1 AND a.ft_score IS NOT NULL`
    : `SELECT v.event_id, v.side_action, v.ou_action, a.side_pick, a.ou_pick, a.side_hit, a.ou_hit
       FROM gs_ai_verdicts v JOIN gs_ht_analysis a ON a.event_id=v.event_id
       WHERE a.ft_score IS NOT NULL`
  const { rows } = await pool.query(q, only ? [only] : [])
  let correct = 0, wrong = 0, skipped = 0
  for (const v of rows) {
    const jc = auditOne(v)
    if (jc === null) { skipped++; continue }
    await pool.query(`UPDATE gs_ai_verdicts SET judge_correct=$2 WHERE event_id=$1`, [v.event_id, jc])
    if (jc) correct++; else wrong++
  }
  const acc = (correct + wrong) ? (100 * correct / (correct + wrong)).toFixed(1) : '—'
  console.log(`[audit-judge] done: correct=${correct} wrong=${wrong} skipped=${skipped} | accuracy=${acc}%`)
  await pool.end()
}

if (require.main === module) {
  main().catch((e) => { console.error('[audit-judge] fatal', e); process.exit(1) })
}
module.exports = { auditOne, legCorrect }
