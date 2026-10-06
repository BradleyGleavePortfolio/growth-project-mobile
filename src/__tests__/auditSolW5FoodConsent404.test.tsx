import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { coachApi } from '../services/api';
import { useClientDetailData } from '../screens/coach/client-detail/useClientDetailData';
import { SummaryTab } from '../screens/coach/client-detail/SummaryTab';
import { makeStyles } from '../screens/coach/client-detail/styles';
import type { ThemeColors } from '../theme/ThemeProvider';

jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
  coachApi: { getClientSummary: jest.fn() },
}));
jest.mock('../hooks/useMacros', () => ({
  useCurrentMacrosForClient: () => ({
    data: { calories_kcal: 2200, protein_g: 160, carbs_g: 245, fats_g: 65 },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../components/coach/CoachAiSection', () => () => null);
jest.mock('../screens/coach/client-detail/ConsultationSummaryCard', () => ({
  ConsultationSummaryCard: () => null,
}));
jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ colors: {} }),
}));

const colors = {} as ThemeColors;
const styles = makeStyles(colors);
const noop = () => undefined;

function RealSummaryDataHarness() {
  const detail = useClientDetailData('client-a', colors);
  useEffect(() => { void detail.loadData(); }, [detail.loadData]);
  if (detail.isLoading) return null;
  return <SummaryTab
    {...detail}
    clientId="client-a"
    clientName="Client"
    nudgeSuccess={false}
    onOpenMessages={noop}
    onOpenNudge={noop}
    onOpenMacrosReview={noop}
    onOpenWorkoutBuilder={noop}
    colors={colors}
    styles={styles}
  />;
}

it('does not present withheld food data as zero percent of a real daily target', async () => {
  // This is the ordinary summary response when food sharing is off:
  // the server intentionally returns no entries and zero aggregates,
  // while the coach can still read the target they prescribed.
  jest.mocked(coachApi.getClientSummary).mockResolvedValue({
    data: {
      client_name: 'Client',
      profile: { macro_target_calories: 2200 },
      today: {
        entries: [],
        total_calories: 0,
        total_protein_g: 0,
        total_carbs_g: 0,
        total_fat_g: 0,
      },
      weight_logs: [],
      recent_workouts: [],
      recent_assignments: [],
      consent: { food_macros: false, body_metrics: true },
    },
  } as never);
  await render(<RealSummaryDataHarness />);
  await waitFor(() => expect(screen.getByText('/ 2200 kcal')).toBeTruthy());
  expect(screen.queryByText('0% of daily target')).toBeNull();
  expect(screen.getByText('Food logs are not shared with this coach.')).toBeTruthy();
});
