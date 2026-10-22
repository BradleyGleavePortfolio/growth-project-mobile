/**
 * BRIEF-AGG: selectBriefActions is the only source of the brief's action rows.
 * Table: messages {0,1,2,6} x weight {0,1,2,6} x check-ins {0,1,5}: at most two
 * rows in the fixed kind order, exact labels and destinations, every counted
 * client listed A to Z, the very same result reversed and shuffled. Then every
 * order of tricky sets, names, ids, unknown kinds, head coach rows.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { CoachBriefActionItem } from '../../../../api/coachBriefApi';
import { featureFlags } from '../../../../config/featureFlags';

jest.mock('../../../../config/featureFlags', () => ({
  featureFlags: { coachBrief: true, coachBriefGate: true, teamMode: false, romanChat: false, coachTabsV2: false },
}));

import {
  actionTarget,
  briefFirstName,
  briefHasExtras,
  briefSections,
  compareBrief,
  selectBriefActions,
  MAX_BRIEF_ACTIONS,
  type BriefAction,
} from '../briefActions';

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
const head = (type: string): CoachBriefActionItem => ({ type, detail: `${type} detail`, priority: 1 });

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

/** Every order of `list` (Heap's algorithm). */
function* everyOrder<T>(list: T[]): Generator<T[]> {
  const a = [...list];
  const c = Array.from({ length: a.length }, () => 0);
  yield [...a];
  let i = 1;
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[i], a[j]] = [a[j], a[i]];
      yield [...a];
      c[i] += 1;
      i = 1;
    } else {
      c[i] = 0;
      i += 1;
    }
  }
}

/** Runs the selector on every order of `list`; all of them must give one and the same result. */
function sameForEveryOrder(list: CoachBriefActionItem[], teamMode: boolean): BriefAction[] {
  const seen = new Set<string>();
  let orders = 0;
  for (const order of everyOrder(list)) {
    seen.add(JSON.stringify(selectBriefActions(order, { teamMode })));
    orders += 1;
  }
  expect(orders).toBe([...list.keys()].reduce((f, k) => f * (k + 1), 1));
  expect(seen.size).toBe(1);
  return selectBriefActions(list, { teamMode });
}

const KINDS = [
  { type: 'message_unread', kind: 'messages', one: 'Reply to Sarah', many: 'See messages', screen: 'ClientMessages' },
  { type: 'weight_flag', kind: 'weight', one: 'Review Maya\u2019s weight change', many: 'See weight logs', screen: 'ClientDetail' },
  { type: 'checkin_missing', kind: 'checkins', one: 'Check on Tom', many: 'See check-ins', screen: 'ClientDetail' },
] as const;

const MONEY = { kind: 'money', label: 'See payments', opens: 'screen', target: { tab: 'SettingsStack', params: { screen: 'CoachMoney', initial: false } } };
const TEAM = { kind: 'team', label: 'See your team', opens: 'screen', target: { tab: 'TeamStack' } };

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
        // Every client counted, A to Z by name.
        const az = NAMES[spec.type].slice(0, count).map((name, n) => ({ name, id: `${spec.type}-${n}` }));
        az.sort((a, b) => a.name.localeCompare(b.name));
        expect(row.items.map((x) => x.client_id)).toEqual(az.map((x) => x.id));
      }
      expect(row.label).not.toMatch(/\d/);
    });

    // The whole result, list order included, is the same for any input order.
    expect(selectBriefActions([...items].reverse())).toEqual(rows);
    for (const seed of [1, 7, 42, 99, 2026]) expect(selectBriefActions(shuffle(items, seed))).toEqual(rows);
  });
});

describe('selectBriefActions: the same rows for every input order', () => {
  const weight = (client_id: string, client_name: string | undefined, detail = 'Weight change of 4.8 lbs needs review') =>
    ({ type: 'weight_flag', client_id, client_name, detail, priority: 2 }) as CoachBriefActionItem;

  it('repeats of one client with different names and details: one fixed pick, one fixed list', () => {
    const maya = weight('w1', 'Maya Chen');
    const mayaNoName = weight('w1', undefined);
    const mayaSmaller = weight('w1', 'Maya Chen', 'Weight change of 2.0 lbs needs review');
    const mayaOtherName = weight('w1', 'Mia Chen');
    const placeholder = weight('w2', 'Client');
    const omarPadded = weight('w3', '  Omar Haddad ');
    const omarSpacedId = weight(' w3', 'Omar Haddad');
    const blankId = weight('  ', 'Rita Gomez');
    const rows = sameForEveryOrder(
      [maya, mayaNoName, mayaSmaller, mayaOtherName, placeholder, omarPadded, omarSpacedId, blankId],
      false,
    );
    // Named before nameless, then A to Z; a repeat keeps its first entry in that same order.
    expect(rows).toEqual([{ kind: 'weight', label: 'See weight logs', opens: 'list', items: [mayaSmaller, omarSpacedId, placeholder] }]);
  });

  it.each([false, true])('client, head coach, retired and unknown kinds mixed, Team Mode %s', (teamMode) => {
    const sarah = item('message_unread', 0, { deep_link: 'tgp://messages/a' });
    const sarahAgain = item('message_unread', 0, { deep_link: 'tgp://messages/b' });
    const mixed = [
      sarah,
      sarahAgain,
      head('dunning_queue'),
      head('team_revenue_review'),
      head('team_performance'),
      item('workout_approval', 1, { client_name: 'Lee Park' }),
      head('something_new'),
    ];
    const rows = sameForEveryOrder(mixed, teamMode);
    expect(rows.map((r) => r.label)).toEqual(['Reply to Sarah', 'See payments']);
  });

  it('head coach kinds only, Team Mode on', () => {
    const rows = sameForEveryOrder(
      ['team_performance', 'dunning_queue', 'sub_coach_operations', 'team_revenue_review', 'payment_due', 'something_new'].map(head),
      true,
    );
    expect(rows).toEqual([MONEY, TEAM]);
  });

  it('a long list sorts A to Z with nameless clients last', () => {
    const list = [
      weight('a', 'Ugo Obi'),
      weight('b', undefined),
      weight('c', 'ana Silva'),
      weight('d', 'Client'),
      weight('e', 'Ben Cole'),
      weight('f', 'Ana Silva'),
      weight('g', '  '),
    ];
    const [row] = sameForEveryOrder(list, false);
    if (row.opens !== 'list') throw new Error('expected a list row');
    expect(row.items.map((i) => i.client_id)).toEqual(['c', 'f', 'e', 'a', 'b', 'g', 'd']);
  });
});

describe('selectBriefActions: counting clients', () => {
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
  const HEAD = ['dunning_queue', 'team_revenue_review', 'sub_coach_operations', 'team_performance'].map(head);

  it('Team Mode off: one Money row; the team items have nowhere to open, so no row', () => {
    expect(selectBriefActions(HEAD, { teamMode: false })).toEqual([MONEY]);
    expect(selectBriefActions([head('sub_coach_operations'), head('team_performance')], { teamMode: false })).toEqual([]);
  });

  it('Team Mode on: Money, then Team', () => {
    expect(selectBriefActions(HEAD, { teamMode: true })).toEqual([MONEY, TEAM]);
    expect(selectBriefActions([head('team_performance')], { teamMode: true })).toEqual([TEAM]);
  });

  it.each(['dunning_queue', 'team_revenue_review'])('%s alone opens Money; both together are one row', (type) => {
    expect(selectBriefActions([head(type)], { teamMode: false })).toEqual([MONEY]);
    expect(selectBriefActions([head('dunning_queue'), head('team_revenue_review')], { teamMode: false })).toEqual([MONEY]);
  });

  it('client kinds come first and the two-row cap holds', () => {
    expect(selectBriefActions([...HEAD, ...many('weight_flag', 6)], { teamMode: true }).map((r) => r.label)).toEqual([
      'See weight logs',
      'See payments',
    ]);
    expect(
      selectBriefActions([...HEAD, ...many('weight_flag', 6), item('checkin_missing', 0)], { teamMode: true }).map((r) => r.label),
    ).toEqual(['See weight logs', 'Check on Tom']);
  });

  it('without the option it follows featureFlags.teamMode at call time', () => {
    expect(selectBriefActions(HEAD)).toEqual([MONEY]);
    const on = jest.replaceProperty(featureFlags, 'teamMode', true);
    expect(selectBriefActions(HEAD)).toEqual([MONEY, TEAM]);
    on.restore();
    expect(selectBriefActions(HEAD)).toEqual([MONEY]);
  });
});

describe('actionTarget', () => {
  it('takes Team Mode as an argument, and lives here so brief/ never imports CoachBriefScreen', () => {
    expect([false, true].map((on) => actionTarget(head('team_performance'), on))).toEqual([null, { tab: 'TeamStack' }]);
    const dir = path.resolve(__dirname, '..');
    const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
    expect(files).toContain('briefActions.ts');
    for (const f of files) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/from '\.\.\/CoachBriefScreen'/);
  });

  it('with the six coach tabs a chat opens in Messages and Money opens the Money tab (COACH-CHAT-BACK, COACHTABS)', () => {
    const on = jest.replaceProperty(featureFlags, 'coachTabsV2', true);
    expect(actionTarget(item('message_unread', 0))).toEqual({
      tab: 'Messages',
      params: { screen: 'ClientMessages', params: { clientId: 'message_unread-0', clientName: 'Sarah Lin' }, initial: false },
    });
    expect(selectBriefActions([head('dunning_queue')])).toEqual([
      { ...MONEY, target: { tab: 'MoneyStack', params: { screen: 'CoachMoney', pop: true } } },
    ]);
    on.restore();
  });
});

// ROMAN-EXTRAS-M (Style A, folded rows): a brief from a server that sends the check-in and new-client rows.
describe('selectBriefActions: folded rows (brief_context.checkins_to_review present)', () => {
  const at = (mins: number) => new Date(Date.UTC(2026, 9, 21, 9, 0) - mins * 60_000).toISOString();
  const one = (type: string, id: string, name: string, over: Partial<CoachBriefActionItem> = {}): CoachBriefActionItem => ({
    type,
    client_id: id,
    client_name: name,
    detail: type === 'checkin_review' ? 'Check-in needs review' : type === 'checkin_missing' ? 'Has not checked in today' : `${type} ${id}`,
    priority: 1,
    ...over,
  });
  const many = (type: string, n: number) =>
    Array.from({ length: n }, (_, i) => one(type, `${type}-${i}`, `Client${String(i).padStart(3, '0')} Lee`, { occurred_at: at(i) }));
  const extras = { extras: true };

  it('briefHasExtras reads only brief_context.checkins_to_review', () => {
    expect(briefHasExtras({ brief_context: { checkins_to_review: 0 } })).toBe(true);
    expect(briefHasExtras({ brief_context: {} })).toBe(false);
    expect(briefHasExtras({ brief_context: null })).toBe(false);
    expect(briefHasExtras(null)).toBe(false);
  });

  it('100 clients: one folding row per kind with every client counted, new clients last', () => {
    const items = [...many('client_joined', 20), ...many('checkin_missing', 23), ...many('checkin_review', 50), ...many('weight_flag', 6), ...many('message_unread', 14)];
    const rows = selectBriefActions(items, extras);
    expect(rows.map((r) => [r.label, r.opens === 'list' ? r.items.length : 1, r.opens === 'list' && r.fold])).toEqual([
      ['See messages', 14, true],
      ['See weight logs', 6, true],
      ['See check-ins', 73, true],
      ['See new clients', 20, true],
    ]);
    expect(selectBriefActions([...items].reverse(), extras)).toEqual(rows);
  });

  it('the same items on an older brief keep today\u2019s two rows that open the list', () => {
    const rows = selectBriefActions([...many('message_unread', 14), ...many('weight_flag', 6), ...many('checkin_missing', 5)]);
    expect(rows.map((r) => r.label)).toEqual(['See messages', 'See weight logs']);
    expect(rows.length).toBe(MAX_BRIEF_ACTIONS);
    expect(rows.every((r) => r.opens === 'list' && r.fold === undefined)).toBe(true);
  });

  it('10 clients: one message, three check-ins, one new client', () => {
    const rows = selectBriefActions(
      [
        one('message_unread', 'm1', 'Maya Chen'),
        one('checkin_review', 'c1', 'Dev Haddad', { occurred_at: at(5) }),
        one('checkin_review', 'c2', 'Eli Wolfe', { occurred_at: at(9) }),
        one('checkin_missing', 'c3', 'Iris Moreau'),
        one('client_joined', 'j1', 'Lena Park', { detail: 'Joined yesterday' }),
      ],
      extras,
    );
    expect(rows.map((r) => r.label)).toEqual(['Reply to Maya', 'See check-ins', 'Say hello to Lena']);
    expect(rows[2]).toEqual({
      kind: 'welcome',
      label: 'Say hello to Lena',
      opens: 'screen',
      target: actionTarget(one('message_unread', 'j1', 'Lena Park')),
    });
  });

  it('a client both waiting on a review and missing today counts in each group', () => {
    const [row] = selectBriefActions([one('checkin_review', 'c1', 'Dev Haddad', { occurred_at: at(1) }), one('checkin_missing', 'c1', 'Dev Haddad')], extras);
    expect(row).toMatchObject({ label: 'See check-ins', opens: 'list' });
    if (row.opens !== 'list') throw new Error('expected a list row');
    expect(briefSections(row.items).map((s) => [s.title, s.items.length])).toEqual([
      ['Check-in needs review', 1],
      ['Has not checked in today', 1],
    ]);
  });

  it('newest first by occurred_at, reviews before missed check-ins, A to Z when there is no time', () => {
    const items = [
      one('checkin_missing', 'x', 'Ann Zed'),
      one('checkin_review', 'old', 'Bo Old', { occurred_at: at(300) }),
      one('checkin_review', 'none', 'Al None'),
      one('checkin_review', 'new', 'Cy New', { occurred_at: at(1) }),
      one('checkin_missing', 'y', 'Abe Young'),
    ];
    const [row] = selectBriefActions(items, extras);
    if (row.opens !== 'list') throw new Error('expected a list row');
    expect(row.items.map((i) => i.client_id)).toEqual(['new', 'old', 'none', 'y', 'x']);
    expect(compareBrief(items[1], items[3])).toBeGreaterThan(0);
  });

  it('every new item type opens a real place', () => {
    expect(actionTarget(one('checkin_review', 'c1', 'Dev Haddad'))).toEqual({
      tab: 'ClientsStack',
      params: { screen: 'ClientDetail', params: { clientId: 'c1', clientName: 'Dev Haddad' }, initial: false },
    });
    expect(actionTarget(one('client_joined', 'j1', 'Lena Park'))).toEqual(actionTarget(one('message_unread', 'j1', 'Lena Park')));
  });

  it('briefSections: grouped types under their detail in first-seen order; others in one untitled run', () => {
    const joined = [one('client_joined', 'a', 'Al A', { detail: 'Joined today' }), one('client_joined', 'b', 'Bo B', { detail: 'Joined yesterday' }), one('client_joined', 'c', 'Cy C', { detail: 'Joined today' })];
    expect(briefSections(joined).map((s) => [s.title, s.items.map((i) => i.client_id)])).toEqual([
      ['Joined today', ['a', 'c']],
      ['Joined yesterday', ['b']],
    ]);
    expect(briefSections(many('weight_flag', 3)).map((s) => [s.title, s.items.length])).toEqual([[null, 3]]);
  });
});
