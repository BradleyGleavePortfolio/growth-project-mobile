const { assert, withSummary, geometry, save } = require('./ls974r2-render.cjs');

// B1: the picked C2_summary_ios390_100 opening fold includes the whole meter
// and note before Send. Do not auto-scroll a locator before measuring them.
withSummary('summary', async (page, out) => {
  const r = await geometry(page, [
    'workout-summary-c5-scroll', 'effort-meter', 'coach-note', 'send-to-coach',
  ]);
  await save(page, out, 'LS-974R2-B1', r);
  const scroll = r['workout-summary-c5-scroll'];
  const note = r['coach-note'];
  const meter = r['effort-meter'];
  assert.ok(scroll && note && meter && r['send-to-coach'], 'All expected summary controls must exist');
  assert.ok(meter.top >= scroll.top && meter.bottom <= scroll.bottom,
    `Opening fold must show all ten effort choices: meter bottom ${meter.bottom}, scroll bottom ${scroll.bottom}`);
  assert.ok(note.top >= scroll.top && note.bottom <= scroll.bottom,
    `Opening fold must show the whole coach note: note ${note.top}..${note.bottom}, scroll bottom ${scroll.bottom}`);
}).catch(error => { console.error(error); process.exitCode = 1; });
