/**
 * AUDIT-06-125 B3: the client summary sends weight_logs newest first. Main
 * showed the newest weight as "First", the oldest as "Latest" and the change
 * with the wrong sign (a client down 10 lb read +10.0).
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import type { WeightLog } from '../../../../types';
import { makeStyles } from '../styles';
import { testColors } from '../../../client/wearables/recoveryTestColors';
import { ProgressTab } from '../ProgressTab';

const styles = makeStyles(testColors);

function log(id: string, date: string, weight: number): WeightLog {
  return { id, userId: 'client-1', coachId: '', date, weight, unit: 'lbs', notes: '', createdAt: date };
}

describe('Coach ProgressTab', () => {
  it('reads First, Latest and Change in date order from a newest-first list', async () => {
    const newestFirst = [
      log('w3', '2026-10-06', 190),
      log('w2', '2026-09-26', 195),
      log('w1', '2026-09-16', 200),
    ];
    const { getByText, queryByText, getAllByText } = await render(
      <ProgressTab weightLogs={newestFirst} colors={testColors} styles={styles} />,
    );
    expect(getByText('200')).toBeTruthy();
    expect(getByText('190')).toBeTruthy();
    // Down 10 lb: the change is negative (main showed 10.0).
    expect(getByText('-10.0')).toBeTruthy();
    expect(queryByText('10.0')).toBeNull();
    // Entries list newest first.
    expect(getAllByText(/ lbs$/).map((n) => n.props.children.join(''))).toEqual([
      '190 lbs',
      '195 lbs',
      '200 lbs',
    ]);
  });

  it('labels every entry with its unit', async () => {
    const { getAllByText } = await render(
      <ProgressTab weightLogs={[log('w1', '2026-10-06', 182.4)]} colors={testColors} styles={styles} />,
    );
    expect(getAllByText('182.4 lbs').length).toBe(1);
  });
});
