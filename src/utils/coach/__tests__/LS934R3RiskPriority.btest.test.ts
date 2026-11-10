/**
 * LS-934R3: NEEDS-YOU-R2 orders ordinary alerts red-risk first, not simply newest first.
 * risk_red_transition is emitted by backend main's CoachAlertsService; high_churn_risk
 * is the phone's existing red-risk type. No new API field or timestamp is required.
 */
import type { ActionQueueItem } from '../../../services/commandCenterApi';
import { needsLead, needsYouAreas } from '../needsYou';

const alert = (id: string, type: string, hour: number): ActionQueueItem => ({
  alert_id: id,
  alert_type: type as ActionQueueItem['alert_type'],
  client_id: `c-${id}`,
  client_name: `Client ${id}`,
  message: 'An open coach alert.',
  created_at: `2026-11-06T${hour}:00:00.000Z`,
  dismissed_at: null,
});

it.each(['risk_red_transition', 'high_churn_risk'])(
  'B1: an older %s leads newer non-risk alerts on Home and in Attention',
  (riskType) => {
    const newer = alert('newer', 'missed_checkins', 12);
    const risk = alert('risk', riskType, 11);
    const areas = needsYouAreas([], {}, [newer, risk]);

    expect(areas.total).toBe(2);
    expect(areas.alerts.map((row) => row.alert_id)).toEqual(['risk', 'newer']);
    expect(needsLead(areas)).toMatchObject({ kind: 'alert', name: 'Client risk' });
  },
);

it('control: safety remains first and ordinary-only order stays stable within its priority', () => {
  const newer = alert('newer', 'missed_checkins', 12);
  const older = alert('older', 'weight_not_logged', 11);
  const safety = alert('safety', 'roman_urgent_reply', 10);
  const areas = needsYouAreas([], {}, [newer, older, safety]);

  expect(areas.safety.map((row) => row.alert_id)).toEqual(['safety']);
  expect(areas.alerts.map((row) => row.alert_id)).toEqual(['newer', 'older']);
  expect(needsLead(areas)).toMatchObject({ kind: 'safety' });
});
