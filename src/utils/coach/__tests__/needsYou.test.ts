/**
 * NEEDS-YOU-M (agent 197): the one grouping behind the Home's Needs you card and the Needs you list.
 */
import type { ActionQueueItem } from '../../../services/commandCenterApi';
import type { RosterClient } from '../clientRoster';
import { alertLeadText, alertWhen, needsLead, needsYouAreas, openAlerts, sentAgo } from '../needsYou';

const item = (alert_id: string, alert_type: ActionQueueItem['alert_type'], client_name: string, message: string, dismissed_at: string | null = null) =>
  ({ alert_id, alert_type, client_id: `c-${alert_id}`, client_name, message, created_at: '2026-11-04T07:10:00', dismissed_at }) as ActionQueueItem;
const client = (id: string, name: string, lastActiveOn: string | null) =>
  ({ id, name, email: `${id}@example.com`, activity: { lastActiveOn, checkInsToReview: 0 } }) as unknown as RosterClient;

describe('needsYou (NEEDS-YOU-M)', () => {
  it('keeps open alerts only, a safety alert first', () => {
    const q = [item('a1', 'high_churn_risk', 'Hana Kim', 'x'), item('a2', 'roman_crisis_reply', 'Avery Cole', 'y'), item('a3', 'missed_checkins', 'Theo', 'z', '2026-11-04')];
    expect(openAlerts(q).map((i) => i.alert_id)).toEqual(['a2', 'a1']);
    expect(openAlerts(null)).toEqual([]);
  });

  it('counts each alert and each client once, Gone quiet longest first, and leads with the safety alert', () => {
    const rows = [
      { client: client('m', 'Marcus Bell', '2026-11-01'), reason: { text: 'Last logged 4 days ago', action: 'nudge' as const, ok: false } },
      { client: client('o', 'Maya Ortiz', '2026-10-28'), reason: { text: 'Last logged 8 days ago', action: 'nudge' as const, ok: false } },
      { client: client('k', 'Kit Morgan', null), reason: { text: 'New, no logs yet', action: 'hello' as const, ok: false } },
      { client: client('p', 'Priya Nair', '2026-11-05'), reason: { text: '1 check-in to review', action: 'review' as const, ok: false } },
    ];
    const a = needsYouAreas(rows, { p: 2 }, [item('a1', 'high_churn_risk', 'Hana Kim', 'x'), item('a2', 'roman_crisis_reply', 'Avery Cole', 'y')]);
    expect([a.safety.length, a.alerts.length, a.quiet.map((r) => r.client.id), a.fresh.length, a.attention, a.routineCount, a.total])
      .toEqual([1, 1, ['o', 'm'], 1, 5, 1, 6]);
    expect([a.routine[0].reason.action, a.routine[0].also]).toEqual(['reply', 'Also 1 check-in to review']);
    expect(needsLead(a)).toEqual({ kind: 'safety', name: 'Avery Cole' });
    expect(needsLead({ ...a, safety: [] })).toEqual({ kind: 'alert', name: 'Hana Kim', text: 'X' });
  });

  it('drops the name already beside the lead and a trailing figure, else keeps the message', () => {
    expect(alertLeadText({ client_name: 'Hana Kim', message: 'Hana Kim crossed into the red risk band (82%).' })).toBe('Crossed into the red risk band');
    expect(alertLeadText({ client_name: 'Theo Grant', message: 'Client has missed 3 consecutive check-ins' })).toBe('Client has missed 3 consecutive check-ins');
  });

  it('writes the times as drawn', () => {
    const now = new Date(2026, 10, 5, 9, 0);
    expect(alertWhen(new Date(2026, 10, 5, 7, 10).toISOString(), now)).toBe('Today, 7:10 am');
    expect(alertWhen(new Date(2026, 10, 4, 18, 0).toISOString(), now)).toBe('Yesterday');
    expect(alertWhen(new Date(2026, 9, 21, 8, 0).toISOString(), now)).toBe('Wed 21 Oct');
    expect(alertWhen('nope', now)).toBe('');
    expect(sentAgo(new Date(2026, 10, 5, 7, 0).toISOString(), now)).toBe('Sent 2 h ago');
    expect(sentAgo(new Date(2026, 10, 5, 8, 55).toISOString(), now)).toBe('Sent 5 min ago');
  });
});
