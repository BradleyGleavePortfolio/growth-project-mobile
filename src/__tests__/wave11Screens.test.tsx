/**
 * Wave 11 screen render tests.
 *
 * Asserts the main render paths for all 4 Wave 11 surfaces:
 *   1. ClientPathCopilotScreen  — flag-off empty state + contract invariants
 *   2. PrivateCommunityHubScreen — flag-off empty state + contract invariants
 *   3. CoachBriefScreen          — flag-off empty state + approve-draft contract
 *   4. AdminControlRoomScreen    — flag-off empty state + KPI + alert contracts
 *
 * Pattern: source-level guards for contract invariants + light RTL renders
 * for the flag-off branches (no axios calls, no navigation stack).
 */

import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { render } from '@testing-library/react-native';

const ROOT = path.resolve(__dirname, '..', '..');

// ─── Source paths ─────────────────────────────────────────────────────────────

const COPILOT_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'ClientPathCopilotScreen.tsx'),
  'utf8',
);

const COMMUNITY_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'PrivateCommunityHubScreen.tsx'),
  'utf8',
);

const BRIEF_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'CoachBriefScreen.tsx'),
  'utf8',
);

const CONTROL_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'AdminControlRoomScreen.tsx'),
  'utf8',
);

// ─── Source-level contract guards ─────────────────────────────────────────────

describe('ClientPathCopilotScreen — source guards', () => {
  it('gates rendering behind featureFlags.clientPathCopilot', () => {
    expect(COPILOT_SRC).toMatch(/featureFlags\.clientPathCopilot/);
  });

  it('renders loading indicator while fetching', () => {
    expect(COPILOT_SRC).toMatch(/ActivityIndicator/);
    expect(COPILOT_SRC).toMatch(/loading && !payload/);
  });

  it('wraps AI content in AINote', () => {
    expect(COPILOT_SRC).toMatch(/AINote/);
    expect(COPILOT_SRC).toMatch(/variant="summary"/);
  });

  it('shows stale notice when payload.isStale is true', () => {
    expect(COPILOT_SRC).toMatch(/payload\?\.isStale/);
    expect(COPILOT_SRC).toMatch(/pull to refresh/i);
  });

  it('uses VerifiedProgressRow for pending submissions', () => {
    expect(COPILOT_SRC).toMatch(/VerifiedProgressRow/);
    expect(COPILOT_SRC).toMatch(/pendingVerifiedProgress/);
  });

  it('has accessibilityLabel on screen root and section headers', () => {
    expect(COPILOT_SRC).toMatch(/accessibilityLabel.*Client Path Copilot screen/);
    expect(COPILOT_SRC).toMatch(/accessibilityRole="header"/);
  });

  it('has accessibilityLabel on SuggestionCard', () => {
    expect(COPILOT_SRC).toMatch(/accessibilityLabel.*Suggestion:/);
  });
});

describe('PrivateCommunityHubScreen — source guards', () => {
  it('gates rendering behind featureFlags.privateCommunityHub', () => {
    expect(COMMUNITY_SRC).toMatch(/featureFlags\.privateCommunityHub/);
  });

  it('rounds member counts to discourage vanity', () => {
    expect(COMMUNITY_SRC).toMatch(/approxCount/);
    expect(COMMUNITY_SRC).toMatch(/about 20 members/);
  });

  it('voice note affordance is gated behind communityVoiceNotes flag', () => {
    expect(COMMUNITY_SRC).toMatch(/featureFlags\.communityVoiceNotes/);
  });

  it('has no global feed tab — doctrine "no public feed"', () => {
    expect(COMMUNITY_SRC).not.toMatch(/globalFeed|global_feed|Global Feed/);
  });

  it('has accessibilityLabel on screen root and room rows', () => {
    expect(COMMUNITY_SRC).toMatch(/accessibilityLabel.*Private Community Hub screen/);
    expect(COMMUNITY_SRC).toMatch(/accessibilityRole="header"/);
  });
});

describe('CoachBriefScreen — source guards', () => {
  it('gates rendering behind featureFlags.coachBrief', () => {
    expect(BRIEF_SRC).toMatch(/featureFlags\.coachBrief/);
  });

  it('approve-to-send toggle has accessibilityRole="button"', () => {
    expect(BRIEF_SRC).toMatch(/accessibilityRole="button"/);
  });

  it('approve button has descriptive accessibilityLabel', () => {
    expect(BRIEF_SRC).toMatch(/Approve draft to send/);
    expect(BRIEF_SRC).toMatch(/Draft approved/);
  });

  it('shows stale banner when payload.isStale is true', () => {
    expect(BRIEF_SRC).toMatch(/payload\?\.isStale/);
    expect(BRIEF_SRC).toMatch(/isn.*t live yet/i);
  });

  it('wraps AI draft in AINote component', () => {
    expect(BRIEF_SRC).toMatch(/AINote/);
    expect(BRIEF_SRC).toMatch(/variant="draft"/);
  });

  it('uses VerifiedProgressRow for client cards', () => {
    expect(BRIEF_SRC).toMatch(/VerifiedProgressRow/);
    expect(BRIEF_SRC).toMatch(/latestVerifiedProgress/);
  });

  it('has accessibilityLabel on screen and section headers', () => {
    expect(BRIEF_SRC).toMatch(/accessibilityLabel.*Coach Brief screen/);
    expect(BRIEF_SRC).toMatch(/accessibilityRole="header"/);
  });
});

describe('AdminControlRoomScreen — source guards', () => {
  it('gates rendering behind featureFlags.adminControlRoom', () => {
    expect(CONTROL_SRC).toMatch(/featureFlags\.adminControlRoom/);
  });

  it('renders 5 KPI tiles', () => {
    expect(CONTROL_SRC).toMatch(/activeCoaches/);
    expect(CONTROL_SRC).toMatch(/activeClients/);
    expect(CONTROL_SRC).toMatch(/pendingSignoffs/);
    expect(CONTROL_SRC).toMatch(/flaggedItems/);
    expect(CONTROL_SRC).toMatch(/disputedItems/);
  });

  it('displays AI recommendation with "AI suggests" label — never "AI decides"', () => {
    expect(CONTROL_SRC).toMatch(/AI suggests/);
    expect(CONTROL_SRC).not.toMatch(/AI decides/);
    expect(CONTROL_SRC).not.toMatch(/AI approves/);
  });

  it('has accessibilityLabel on KPI grid and alerts', () => {
    expect(CONTROL_SRC).toMatch(/accessibilityLabel.*Admin Control Room screen/);
    expect(CONTROL_SRC).toMatch(/Platform KPIs/);
    expect(CONTROL_SRC).toMatch(/accessibilityRole="header"/);
  });

  it('uses semantic colour palette for alert severity', () => {
    expect(CONTROL_SRC).toMatch(/semantic\.danger/);
    expect(CONTROL_SRC).toMatch(/semantic\.warning/);
    expect(CONTROL_SRC).toMatch(/semantic\.info/);
  });
});

// ─── Light RTL renders (flag-off branches) ────────────────────────────────────

// Mock navigation, theme, and featureFlags so the flag-off branch renders
// cleanly without network calls or native modules.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
  useRoute: () => ({ params: {} }),
}));

jest.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({
    colors: {
      background: '#F5EFE4',
      surface: '#F1E8D5',
      primary: '#2C4A36',
      textPrimary: '#1A1A18',
      textSecondary: '#3D3D3A',
      textMuted: '#B1A89F',
    },
  }),
}));

// Force all Wave 11 flags OFF for the flag-off branch tests.
jest.mock('../config/featureFlags', () => ({
  featureFlags: {
    clientPathCopilot: false,
    coachBrief: false,
    adminControlRoom: false,
    privateCommunityHub: false,
    communityVoiceNotes: false,
    verifiedProgressSignoff: false,
  },
  isFeatureEnabled: (_key: string) => false,
}));

// Mock @expo/vector-icons to avoid native module load in Jest.
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

// Mock the EmptyState component to keep renders light.
jest.mock('../components/EmptyState', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text testID="empty-state">{title}</Text>;
});

// Mock adapters so no async work fires during render.
jest.mock('../services/wave11Adapters', () => ({
  fetchClientPathCopilot: jest.fn().mockResolvedValue({
    suggestions: [],
    pendingVerifiedProgress: [],
    isStale: true,
    generatedAt: new Date().toISOString(),
  }),
  fetchCoachBrief: jest.fn().mockResolvedValue({
    morningSummary: { aiDraft: '', approvedByCoach: false },
    clients: [],
    generatedAt: new Date().toISOString(),
    isStale: true,
  }),
  fetchAdminControlRoom: jest.fn().mockResolvedValue({
    alerts: [],
    kpis: {
      activeCoaches: 0,
      activeClients: 0,
      pendingSignoffs: 0,
      flaggedItems: 0,
      disputedItems: 0,
    },
    generatedAt: new Date().toISOString(),
    isStale: true,
  }),
  fetchCommunityHub: jest.fn().mockResolvedValue({
    rooms: [],
    recentPosts: [],
    generatedAt: new Date().toISOString(),
    isStale: true,
  }),
}));

import ClientPathCopilotScreen from '../screens/client/ClientPathCopilotScreen';
import PrivateCommunityHubScreen from '../screens/client/PrivateCommunityHubScreen';
import CoachBriefScreen from '../screens/coach/CoachBriefScreen';
import AdminControlRoomScreen from '../screens/coach/AdminControlRoomScreen';

describe('Wave 11 screens — flag-off render (RTL)', () => {
  it('ClientPathCopilotScreen renders preview-only empty state when flag is OFF', () => {
    const { getByTestId } = render(<ClientPathCopilotScreen />);
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('PrivateCommunityHubScreen renders preview-only empty state when flag is OFF', () => {
    const { getByTestId } = render(<PrivateCommunityHubScreen />);
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('CoachBriefScreen renders preview-only empty state when flag is OFF', () => {
    const { getByTestId } = render(<CoachBriefScreen />);
    expect(getByTestId('empty-state')).toBeTruthy();
  });

  it('AdminControlRoomScreen renders preview-only empty state when flag is OFF', () => {
    const { getByTestId } = render(<AdminControlRoomScreen />);
    expect(getByTestId('empty-state')).toBeTruthy();
  });
});
