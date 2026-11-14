const { assert, withSummary, frames, geometry, save } = require('./ls974r2-render.cjs');

// B2: a normal client scrolls to the note, types, and taps the pinned Send.
// When that send has no answer, the new card must be in the visible scroll
// viewport. Locator.waitFor({state:'visible'}) alone does not prove this.
withSummary('not-sent', async (page, out) => {
  await page.getByTestId('effort-8').first().click();
  const note = page.getByTestId('coach-note').first();
  await note.scrollIntoViewIfNeeded();
  await note.fill('Squats felt strong. Last bench set was a grind.');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await frames(page);
  await page.getByTestId('send-to-coach').first().click();
  await page.getByTestId('summary-not-sent').first().waitFor({ state: 'visible' });
  await page.getByTestId('summary-try-again').first().waitFor({ state: 'visible' });
  await frames(page);
  const r = await geometry(page, [
    'workout-summary-c5-scroll', 'summary-not-sent', 'summary-try-again',
  ]);
  await save(page, out, 'LS-974R2-B2', r);
  const scroll = r['workout-summary-c5-scroll'];
  const card = r['summary-not-sent'];
  assert.ok(scroll && card && r['summary-try-again'], 'The not-sent state must be present');
  assert.ok(card.top >= scroll.top && card.bottom <= scroll.bottom,
    `Not-sent explanation must be visible after note and Send: card ${card.top}..${card.bottom}, viewport ${scroll.top}..${scroll.bottom}`);
}).catch(error => { console.error(error); process.exitCode = 1; });
