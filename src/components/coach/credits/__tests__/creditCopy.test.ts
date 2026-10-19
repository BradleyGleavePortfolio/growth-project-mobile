/**
 * CREDITBUILD-143: the approved AI credit words (CREDIT-W / CREDIT-SW),
 * verbatim, and the small helpers that fill them from the real pool.
 */
import {
  CREDIT_ROMAN_ASK,
  CREDIT_SETUP_COPY,
  CREDIT_USAGE_LABEL,
  K8_CREDITS_LABEL,
  k8CreditsSentence,
  renewsLine,
  setupRows,
  usageAmount,
} from '../creditCopy';

describe('AI credit words', () => {
  it('keeps the approved setup page words', () => {
    expect(CREDIT_SETUP_COPY).toEqual({ title: 'Your AI credits.', cta: 'Continue' });
    expect(CREDIT_USAGE_LABEL).toBe('AI Usage:');
    expect(CREDIT_ROMAN_ASK).toBe('Ask me as often as you like. Every conversation uses your AI credits.');
    expect(K8_CREDITS_LABEL).toBe('AI credits');
  });

  it('ends the setup rows with "Adding more" where packs are sold', () => {
    expect(setupRows(true)).toEqual([
      { key: 'uses', label: 'What uses them', text: 'Roman and AI features, for you and your clients.' },
      {
        key: 'runOut',
        label: 'If they run out',
        text: 'Roman and AI features pause for you and your clients until they renew. Everything else keeps working.',
      },
      { key: 'add', label: 'Adding more', text: 'Tap Buy more credits on your Money page. Credit you buy and do not use carries over.' },
    ]);
  });

  it('ends them with "Where to find them" where packs are not sold, and never mentions buying', () => {
    const rows = setupRows(false);
    expect(rows.map((r) => r.key)).toEqual(['uses', 'runOut', 'find']);
    expect(rows[2]).toEqual({ key: 'find', label: 'Where to find them', text: 'Always on your Money page.' });
    expect(rows.map((r) => r.text).join(' ')).not.toMatch(/buy/i);
  });

  it('fills the amounts from the pool', () => {
    expect(k8CreditsSentence(12500)).toBe('$125 every month, on your Money page.');
    expect(usageAmount({ used_displayed_cents: 0, total_displayed_cents: 12500 })).toBe('$0 / $125');
    expect(usageAmount({ used_displayed_cents: 4250, total_displayed_cents: 15000 })).toBe('$42.50 / $150');
  });

  it('says when the pool renews (UTC day, like Settings), or nothing for a bad date', () => {
    expect(renewsLine('2026-11-01T00:00:00.000Z')).toBe('Renews Nov 1.');
    expect(renewsLine('not a date')).toBeNull();
  });
});
