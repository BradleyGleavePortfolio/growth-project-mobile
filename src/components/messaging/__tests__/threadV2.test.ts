import {
  messageActionOptions,
  newClientMessageId,
  readThreadV2Fields,
  replyQuoteText,
  resolveSenderRole,
  withinEditWindow,
} from '../threadV2';

const NOW = Date.parse('2026-10-05T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const keys = (o: { key: string }[]) => o.map((x) => x.key);

describe('resolveSenderRole (the thread routes send sender_id, not sender_role)', () => {
  it('derives the side from sender_id; a teammate coach is the coach side', () => {
    expect(resolveSenderRole({ sender_id: 'c1' }, 'c1', 'client')).toBe('client');
    expect(resolveSenderRole({ sender_id: 'sub-coach' }, 'c1', 'client')).toBe('coach');
  });
  it('without sender_id keeps an explicit sender_role, else the other party', () => {
    expect(resolveSenderRole({ sender_role: 'client' }, 'c1', 'client')).toBe('client');
    expect(resolveSenderRole({ sender_id: null }, 'c1', 'client')).toBe('coach');
    expect(resolveSenderRole({ sender_id: 'x' }, undefined, 'client')).toBe('coach');
  });
});

describe('readThreadV2Fields / replyQuoteText', () => {
  it('reads quote, tombstone, edited, pinned and send key; legacy rows read as plain', () => {
    const quote = { id: 'm0', sender_id: 'c1', kind: 'text', preview: 'hi' };
    expect(
      readThreadV2Fields({ reply_to: quote, edited_at: 'e', pinned_at: 'p', client_message_id: 'k1' }),
    ).toEqual({ reply_to: quote, deleted: false, edited_at: 'e', pinned_at: 'p', client_message_id: 'k1' });
    expect(readThreadV2Fields({ id: 'a' })).toEqual({
      reply_to: null,
      deleted: false,
      edited_at: null,
      pinned_at: null,
      client_message_id: null,
    });
    expect(readThreadV2Fields({ reply_to: { id: 'm', kind: 'image', preview: '' } }).reply_to).toBeNull();
    expect(readThreadV2Fields({ deleted_at: '2026-10-05T10:00:00Z' }).deleted).toBe(true);
  });
  it('the quote says what happened to the quoted message', () => {
    const q = (kind: 'text' | 'voice' | 'deleted' | 'unavailable', preview = '') => replyQuoteText({ id: 'm', sender_id: null, kind, preview });
    expect([q('deleted'), q('unavailable'), q('voice'), q('text', 'see you')]).toEqual([
      'Message deleted',
      'Message unavailable',
      'Voice note',
      'see you',
    ]);
  });
});

describe('messageActionOptions (backend rules: author, 48 hours, live, text)', () => {
  const base = { pending: false, deleted: false, hasText: true, pinned: false, now: NOW, createdAt: iso(HOUR) };

  it('own message: edit and delete only inside 48 hours; never report', () => {
    expect(keys(messageActionOptions({ ...base, isMine: true }))).toEqual(['reply', 'copy', 'edit', 'pin', 'delete']);
    expect(keys(messageActionOptions({ ...base, isMine: true, createdAt: iso(48 * HOUR + 1) }))).toEqual(['reply', 'copy', 'pin']);
  });
  it('the other person\'s message: report, never edit or delete; unpin when pinned', () => {
    expect(keys(messageActionOptions({ ...base, isMine: false }))).toEqual(['reply', 'copy', 'pin', 'report']);
    expect(keys(messageActionOptions({ ...base, isMine: false, pinned: true }))).toContain('unpin');
  });
  it('voice note: no edit, no copy; tombstone: nothing for the author, report for the other', () => {
    const k = keys(messageActionOptions({ ...base, isMine: true, hasText: false }));
    expect(k).toEqual(['reply', 'pin', 'delete']);
    expect(messageActionOptions({ ...base, isMine: true, deleted: true })).toEqual([]);
    expect(keys(messageActionOptions({ ...base, isMine: false, deleted: true }))).toEqual(['report']);
  });
  it('unsent message: send again (same key) and copy only', () => {
    expect(keys(messageActionOptions({ ...base, isMine: true, pending: true }))).toEqual(['retry', 'copy']);
  });
  it('labels are plain copy (no first person, no exclamation marks)', () => {
    const all = [true, false].flatMap((isMine) => messageActionOptions({ ...base, isMine }));
    for (const o of all) expect(o.label).not.toMatch(/!|\b(I|we|our|us|my)\b/i);
  });
});

describe('withinEditWindow / newClientMessageId', () => {
  it('48 hours or older and unparseable dates are outside; keys are distinct', () => {
    expect([withinEditWindow('x', NOW), withinEditWindow(iso(48 * HOUR), NOW), withinEditWindow(iso(47 * HOUR), NOW)]).toEqual([
      false,
      false,
      true,
    ]);
    expect(newClientMessageId()).not.toBe(newClientMessageId());
  });
});
