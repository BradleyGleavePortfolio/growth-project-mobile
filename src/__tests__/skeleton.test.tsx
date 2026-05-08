/**
 * Tests for the Skeleton primitive and the SkeletonClientCard consumer.
 *
 * Strategy: source-level contract guards (cheap, CI-stable without native modules).
 * The Skeleton component uses react-native-reanimated shared values which require
 * a native runtime; CI-safe tests verify contracts via source analysis instead.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');

// ─── Source files under test ──────────────────────────────────────────────────

const SKELETON_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'ui', 'skeletons', 'Skeleton.tsx'),
  'utf8',
);

const CLIENT_CARD_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'ui', 'skeletons', 'SkeletonClientCard.tsx'),
  'utf8',
);

const INDEX_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'ui', 'skeletons', 'index.ts'),
  'utf8',
);

const CLIENTS_LIST_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'ClientsListScreen.tsx'),
  'utf8',
);

const COACH_HOME_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'CoachHomeScreen.tsx'),
  'utf8',
);

const CLIENT_DETAIL_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'coach', 'ClientDetailScreen.tsx'),
  'utf8',
);

// ─── Skeleton primitive — contract guards ─────────────────────────────────────

describe('Skeleton primitive — source contracts', () => {
  it('uses react-native-reanimated for pulse animation, not a third-party library', () => {
    expect(SKELETON_SRC).toMatch(/react-native-reanimated/);
    expect(SKELETON_SRC).not.toMatch(/react-native-reanimated-skeleton/);
  });

  it('pulses opacity between 0.4 and 1.0', () => {
    expect(SKELETON_SRC).toMatch(/0\.4/);
    expect(SKELETON_SRC).toMatch(/1\.0/);
  });

  it('uses withRepeat for continuous pulse animation', () => {
    expect(SKELETON_SRC).toMatch(/withRepeat/);
  });

  it('accepts width, height, and optional borderRadius props', () => {
    expect(SKELETON_SRC).toMatch(/width/);
    expect(SKELETON_SRC).toMatch(/height/);
    expect(SKELETON_SRC).toMatch(/borderRadius/);
  });

  it('sets accessibilityElementsHidden so screen readers skip placeholders', () => {
    expect(SKELETON_SRC).toMatch(/accessibilityElementsHidden/);
  });

  it('uses theme token for background color, not a hardcoded hex', () => {
    // backgroundColor must reference a token, not a literal hex
    const bgLine = SKELETON_SRC.match(/backgroundColor:.*$/m)?.[0] ?? '';
    expect(bgLine).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    expect(bgLine).toMatch(/token/);
  });

  it('animation duration is 1500ms', () => {
    expect(SKELETON_SRC).toMatch(/1500/);
  });

  it('exports Skeleton as named export', () => {
    expect(SKELETON_SRC).toMatch(/export function Skeleton/);
  });
});

// ─── SkeletonClientCard — source contracts ────────────────────────────────────

describe('SkeletonClientCard — source contracts', () => {
  it('imports Skeleton primitive from ./Skeleton', () => {
    expect(CLIENT_CARD_SRC).toMatch(/import.*Skeleton.*from '\.\/Skeleton'/);
  });

  it('renders an avatar circle (borderRadius 999)', () => {
    expect(CLIENT_CARD_SRC).toMatch(/borderRadius.*999/);
  });

  it('renders at least 4 Skeleton blocks (avatar, name, email, status)', () => {
    const skeletonMatches = CLIENT_CARD_SRC.match(/<Skeleton /g) ?? [];
    expect(skeletonMatches.length).toBeGreaterThanOrEqual(4);
  });

  it('hides from accessibility tree', () => {
    expect(CLIENT_CARD_SRC).toMatch(/accessibilityElementsHidden/);
  });
});

// ─── Index barrel exports all 6 components ───────────────────────────────────

describe('skeletons/index.ts — barrel exports', () => {
  it('exports Skeleton', () => {
    expect(INDEX_SRC).toMatch(/export.*Skeleton/);
  });

  it('exports SkeletonClientCard', () => {
    expect(INDEX_SRC).toMatch(/export.*SkeletonClientCard/);
  });

  it('exports SkeletonWorkoutRow', () => {
    expect(INDEX_SRC).toMatch(/export.*SkeletonWorkoutRow/);
  });

  it('exports SkeletonStatTile', () => {
    expect(INDEX_SRC).toMatch(/export.*SkeletonStatTile/);
  });

  it('exports SkeletonProgressChart', () => {
    expect(INDEX_SRC).toMatch(/export.*SkeletonProgressChart/);
  });

  it('exports SkeletonProfileHeader', () => {
    expect(INDEX_SRC).toMatch(/export.*SkeletonProfileHeader/);
  });
});

// ─── Wired screens — source contracts ────────────────────────────────────────

describe('ClientsListScreen — skeleton wiring', () => {
  it('imports skeleton from ui/skeletons', () => {
    expect(CLIENTS_LIST_SRC).toMatch(/ui\/skeletons/);
  });

  it('renders SkeletonClientCard while loading', () => {
    expect(CLIENTS_LIST_SRC).toMatch(/SkeletonClientCard/);
  });

  it('renders multiple SkeletonClientCard instances via array map', () => {
    expect(CLIENTS_LIST_SRC).toMatch(/SkeletonClientCard/);
    expect(CLIENTS_LIST_SRC).toMatch(/\.map\(/);
  });

  it('no longer uses ActivityIndicator as the primary loading indicator', () => {
    expect(CLIENTS_LIST_SRC).not.toMatch(/ActivityIndicator/);
  });
});

describe('CoachHomeScreen — skeleton wiring', () => {
  it('imports skeleton from ui/skeletons', () => {
    expect(COACH_HOME_SRC).toMatch(/ui\/skeletons/);
  });

  it('renders SkeletonStatTile in the loading gate', () => {
    expect(COACH_HOME_SRC).toMatch(/SkeletonStatTile/);
  });

  it('loading gate no longer uses a full-screen ActivityIndicator spinner', () => {
    expect(COACH_HOME_SRC).not.toMatch(/<ActivityIndicator[^/]*size="large"/);
  });
});

describe('ClientDetailScreen — skeleton wiring', () => {
  it('imports skeleton from ui/skeletons', () => {
    expect(CLIENT_DETAIL_SRC).toMatch(/ui\/skeletons/);
  });

  it('renders SkeletonProfileHeader in the loading gate', () => {
    expect(CLIENT_DETAIL_SRC).toMatch(/SkeletonProfileHeader/);
  });

  it('renders SkeletonWorkoutRow in the loading gate', () => {
    expect(CLIENT_DETAIL_SRC).toMatch(/SkeletonWorkoutRow/);
  });
});
