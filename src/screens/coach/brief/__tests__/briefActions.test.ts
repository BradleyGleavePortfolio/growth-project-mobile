/**
 * BRIEF-AGG: selectBriefActions is the only source of the brief's action rows.
 *
 * Table: messages {0,1,2,6} x weight {0,1,2,6} x check-ins {0,1,5}, each case
 * also run with the items shuffled. Every case asserts: at most two action
 * rows, in the fixed kind order; the exact label; never a single-client row
 * for a kind with two or more clients; the exact destination of a
 * single-client row; and that a list row carries every client counted.
 * Then: repeats, missing names, missing client_id, unknown and retired kinds,
 * head coach kinds with Team Mode off and on.
 */
import type { CoachBriefActionItem } from '../../../../api/coachBriefApi';
import { featureFlags } from '../../../../config/featureFlags';

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { coachBrief: true, coachBriefGate: true, teamMode: false, romanChat: false },
}));

import { selectBriefActions, briefFirstName, MAX_BRIEF_ACTIONS, type BriefAction } from '../briefActions';

const NAMES = {
  message_unread: ['Sarah Lin', 'Dana Ortiz', 'Lee Park', 'Ana Silva', 'Ben Cole', 'Ivy Moss'],
  weight_flag: ['Maya Chen', 'Omar Haddad', 'Rita Gomez', 'Sam Wu', 'Tess Hale', 'Ugo Obi'],
  checkin_missing: ['Tom Ruiz', 'Kim Lowe', 'Pat Dunn', 'Ray Fox', 'Zoe Hart'],
} as const;
type ClientType = keyof typeof NAMES;

function item(type: string, n: number, over: Partial<CoachBriefActionItem> = {}): CoachBriefActionItem {
  const names = NAMES[type as ClientType];
  return {
    type,
    client_id: `${type}-${n}`,
    client_name: names ? names[n] : undefined,
    detail: `${type} detail ${n}`,
    priority: 1,
    ...over,
  };
}

const many = (type: ClientType, count: number) => Array.from({ length: count }, (_, n) => item(type, n));

function shuffle<T>(list: T[], seed: number): T[] {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const KINDS = [
  { type: 'message_unread', kind: 'messages', one: 'Reply to Sarah', many: 'See messages', screen: 'ClientMessages' },
  { type: 'weight_flag', kind: 'weight', one: 'Review Maya\u2019s weight change', many: 'See weight logs', screen: 'ClientDetail' },
  { type: 'checkin_missing', kind: 'checkins', one: 'Check on Tom', many: 'See check-ins', screen: 'ClientDetail' },
] as const;

/** Compare without depending on the order of a list row's clients. */
function normalise(rows: BriefAction[]) {
  return rows.map((r) =>
    r.opens === 'list' ? { ...r, items: r.items.map((i) => i.client_id).sort() } : r,
  );
}

const table: Array<[number, number, number]> = [];
for (const m of [0, 1, 2, 6]) for (const w of [0, 1, 2, 6]) for (const c of [0, 1, 5]) table.push([m, w, c]);

describe('selectBriefActions: messages x weight x check-ins', () => {
  it.each(table)('messages %i, weight %i, check-ins %i', (m, w, c) => {
    const counts = [m, w, c];
    const items = [...many('message_unread', m), ...many('weight_flag', w), ...many('checkin_missing', c)];
    const rows = selectBriefActions(items);

    const expected = KINDS.filter((_, k) => counts[k] > 0).slice(0, MAX_BRIEF_ACTIONS);
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rows.map((r) => r.kind)).toEqual(expected.map((k) => k.kind));

    rows.forEach((row, i) => {
      const spec = expected[i];
      const count = counts[KINDS.indexOf(spec)];
      if (count === 1) {
        const clientName = NAMES[spec.type][0];
        expect(row).toEqual({
          kind: spec.kind,
          label: spec.one,
          opens: 'screen',
          target: {
            tab: 'ClientsStack',
            params: { screen: spec.screen, params: { clientId: `${spec.type}-0`, clientName }, initial: false },
          },
        });
      } else {
        expect(row.opens).toBe('list');
        expect(row.label).toBe(spec.many);
        if (row.opens !== 'list') return;
        expect(row.items.map((x) => x.client_id).sort()).toEqual(
          Array.from({ length: count }, (_, n) => `${spec.type}-${n}`).sort(),
        );
      }
      expect(row.label).not.toMatch(/\d/);
    });

    for (const seed of [1, 7, 42]) {
      expect(normalise(selectBriefActions(shuffle(items, seed)))).toEqual(normalise(rows));
    }
  });
});

describe('selectBriefActions: counting clients', () => {
  it('counts a repeated client once and keeps the entry that has a name', () => {
    const rows = selectBriefActions([
      item('weight_flag', 0, { client_name: undefined }),
      item('weight_flag', 0),
      item('weight_flag', 0, { detail: 'again' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Review Maya\u2019s weight change');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['the server placeholder', 'Client'],
  ])('one client with a %s name gets the list row, never "Client"', (_label, client_name) => {
    const rows = selectBriefActions([item('message_unread', 0, { client_name })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'messages', label: 'See messages', opens: 'list' });
    if (rows[0].opens === 'list') expect(rows[0].items.map((i) => i.client_id)).toEqual(['message_unread-0']);
    expect(rows[0].label).not.toContain('Client');
  });

  it('uses the first word of the name and trims spaces', () => {
    expect(briefFirstName('  Sarah   Lin ')).toBe('Sarah');
    expect(briefFirstName('Client')).toBeNull();
    expect(briefFirstName(null)).toBeNull();
    expect(selectBriefActions([item('checkin_missing', 0, { client_name: '  Tom  Ruiz ' })])[0].label).toBe('Check on Tom');
  });

  it('drops per-client items with no client_id', () => {
    expect(selectBriefActions([item('message_unread', 0, { client_id: undefined })])).toEqual([]);
    expect(selectBriefActions([item('weight_flag', 0, { client_id: '  ' })])).toEqual([]);
    const rows = selectBriefActions([item('message_unread', 0), item('message_unread', 1, { client_id: undefined })]);
    expect(rows.map((r) => r.label)).toEqual(['Reply to Sarah']);
  });

  it('ignores unknown kinds and the retired workout_approval', () => {
    const odd = [
      item('workout_approval', 0, { client_name: 'Lee Park' }),
      item('payment_due', 1, { client_name: 'Ana Silva' }),
      item('something_new', 2),
    ];
    expect(selectBriefActions(odd)).toEqual([]);
    expect(selectBriefActions([...odd, item('checkin_missing', 0)]).map((r) => r.label)).toEqual(['Check on Tom']);
  });

  it('returns nothing for no items', () => {
    expect(selectBriefActions(undefined)).toEqual([]);
    expect(selectBriefActions(null)).toEqual([]);
    expect(selectBriefActions([])).toEqual([]);
  });
});

describe('selectBriefActions: head coach kinds', () => {
  const head = (type: string): CoachBriefActionItem => ({ type, detail: `${type} detail`, priority: 1 });
  const money = { tab: 'SettingsStack', params: { screen: 'CoachMoney', initial: false } };

  afterEach(() => jest.replaceProperty(featureFlags, 'teamMode', false));

  it('opens Money once for failed payments and team revenue', () => {
    const rows = selectBriefActions([head('team_revenue_review'), head('dunning_queue')]);
    expect(rows).toEqual([{ kind: 'money', label: 'See Money', opens: 'screen', target: money }]);
  });

  it('hides Team rows while Team Mode is off', () => {
    expect(selectBriefActions([head('sub_coach_operations'), head('team_performance')])).toEqual([]);
    expect(selectBriefActions([head('team_performance'), head('dunning_queue')]).map((r) => r.kind)).toEqual(['money']);
  });

  it('shows one Team row after Money when Team Mode is on', () => {
    jest.replaceProperty(featureFlags, 'teamMode', true);
    const rows = selectBriefActions([head('team_performance'), head('sub_coach_operations'), head('dunning_queue')]);
    expect(rows).toEqual([
      { kind: 'money', label: 'See Money', opens: 'screen', target: money },
      { kind: 'team', label: 'See your team', opens: 'screen', target: { tab: 'TeamStack' } },
    ]);
  });

  it('client kinds come first and the total stays at two', () => {
    jest.replaceProperty(featureFlags, 'teamMode', true);
    const rows = selectBriefActions([head('dunning_queue'), head('team_performance'), ...many('weight_flag', 6), item('checkin_missing', 0)]);
    expect(rows.map((r) => r.label)).toEqual(['See weight logs', 'Check on Tom']);
  });
});
