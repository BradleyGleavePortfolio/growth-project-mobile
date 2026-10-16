import React from 'react';
import { Alert, Pressable } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as bloodworkCopy from '../constants/bloodworkCopy';
import BloodworkReviewQueueScreen from '../screens/coach/BloodworkReviewQueueScreen';
import { RespirationCard } from '../screens/client/wearables/cards/RespirationCard';
import { testColors } from '../screens/client/wearables/recoveryTestColors';
import type { BloodworkReviewQueueItem, BloodworkReviewState } from '../types/bloodwork';

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: jest.requireActual('../screens/client/wearables/recoveryTestColors').testColors }),
}));
jest.mock('../config/featureFlags', () => ({ isFeatureEnabled: () => true }));
jest.mock('../components/HapticPressable', () => ({
  __esModule: true,
  default: (props: React.ComponentProps<typeof Pressable>) => {
    const { Pressable: Button } = jest.requireActual('react-native');
    return <Button {...props} />;
  },
}));
jest.mock('../screens/client/wearables/cards/SrCard', () => ({
  SrCard: ({ children, title }: { children: React.ReactNode; title: string }) => {
    const { View, Text } = jest.requireActual('react-native');
    return <View><Text>{title}</Text>{children}</View>;
  },
}));

afterEach(() => jest.restoreAllMocks());

function copyText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return Object.values(value).map(copyText).join('\n');
  return '';
}

it('keeps all changed health copy, spoken labels and state alerts within C-6', async () => {
  const barred = /cl[i]nic|p[a]tient/i;
  expect(copyText(bloodworkCopy)).not.toMatch(barred);

  for (const [respiratoryRate, spo2, spo2NeedsAttention] of [
    [null, null, false], [13, 97, false], [14.2, 88, true],
  ] as const) {
    const card = await render(
      <RespirationCard
        respiration={{ respiratoryRate, spo2, spo2NeedsAttention, respiratoryTrend: [], spo2Trend: [] }}
        colors={testColors}
      />,
    );
    expect(JSON.stringify(card.toJSON())).not.toMatch(barred);
    await card.unmount();
  }

  // Read the declared wire states so every enum is exercised without duplicating it.
  const contract = readFileSync(join(__dirname, '../types/bloodwork.ts'), 'utf8');
  const union = contract.match(/export type BloodworkReviewState =([\s\S]*?);/)?.[1] ?? '';
  const states = Array.from(union.matchAll(/'([^']+)'/g), ([, state]) => state as BloodworkReviewState);
  expect(states).toHaveLength(7);
  const items: BloodworkReviewQueueItem[] = states.map((reviewState, index) => ({
    panelId: `panel-${index}`, clientId: `client-${index}`, clientDisplayName: 'Sam',
    submittedAt: '2026-10-15T12:00:00Z', reviewState,
    flaggedMarkerCount: 0, hasUnreviewedAIDraft: false,
  }));
  jest.spyOn(React, 'useState').mockImplementationOnce(() => [items, jest.fn()]);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const queue = await render(<BloodworkReviewQueueScreen />);
  expect(queue.getByText('Doctor referral')).toBeTruthy();
  expect(JSON.stringify(queue.toJSON())).not.toMatch(barred);
  const buttons = queue.getAllByRole('button');
  expect(buttons).toHaveLength(states.length * 5);
  for (const button of buttons) await fireEvent.press(button);
  expect(alert).toHaveBeenCalledTimes(buttons.length);
  expect(alert.mock.calls.some(([title]) => title === 'Action not available')).toBe(true);
  expect(alert.mock.calls.some(([title]) => title === 'Recorded locally')).toBe(true);
  expect(JSON.stringify(alert.mock.calls)).not.toMatch(barred);
});
