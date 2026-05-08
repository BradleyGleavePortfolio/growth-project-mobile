// LeaderboardScreen — Phase 7C source-level guards.
//
// Mirrors the approach used in RiskBoardScreen.test.tsx: we pin the
// source-level contracts that matter most without pulling in a full
// mount chain (axios, navigation, fonts, Zustand store, etc.).
//
// What we pin:
//   1. Opt-in card is rendered when the requester is not yet opted in.
//   2. Self row carries the oxblood highlight (testID="leaderboard-self-row").
//   3. Score is displayed without raw weight, body fat, or finance strings.
//   4. combinedScore field is used, not rawWeight or similar.
//   5. Privacy: no "weight" / "income" / "finance" data exposed in the row.
//   6. The opt-in card contains the canonical empty-state copy.
//   7. The displayName input has a maxLength cap.
//   8. Cormorant + Inter font families are referenced (doctrine compliance).

import * as fs from 'fs';
import * as path from 'path';

const ROOT        = path.resolve(__dirname, '..', '..');
const SCREEN_SRC  = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'LeaderboardScreen.tsx'),
  'utf8',
);
const SETTINGS_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'screens', 'client', 'LeaderboardSettingsScreen.tsx'),
  'utf8',
);
const API_SRC = fs.readFileSync(
  path.join(ROOT, 'src', 'services', 'leaderboardApi.ts'),
  'utf8',
);

describe('LeaderboardScreen — source guards', () => {
  it('renders self row with testID leaderboard-self-row', () => {
    expect(SCREEN_SRC).toMatch(/testID="leaderboard-self-row"/);
  });

  it('highlights self row with an oxblood underline style', () => {
    expect(SCREEN_SRC).toMatch(/rowHighlighted/);
    expect(SCREEN_SRC).toMatch(/4A0404/); // oxblood hex
  });

  it('uses combinedScore field, not any raw health field', () => {
    expect(SCREEN_SRC).toMatch(/combinedScore/);
    expect(SCREEN_SRC).not.toMatch(/rawWeight|raw_weight|bodyFat|body_fat/i);
    expect(SCREEN_SRC).not.toMatch(/income|finance|netWorth/i);
  });

  it('shows the canonical opt-in empty-state copy', () => {
    expect(SCREEN_SRC).toMatch(
      /Opt in to your coach's leaderboard\. You'll show up as soon as you log activity\./,
    );
  });

  it('renders the opt-in card with testID leaderboard-opt-in-card', () => {
    expect(SCREEN_SRC).toMatch(/testID="leaderboard-opt-in-card"/);
  });

  it('caps display name input at 40 characters', () => {
    expect(SCREEN_SRC).toMatch(/maxLength=\{40\}/);
  });

  it('uses Cormorant display font', () => {
    expect(SCREEN_SRC).toMatch(/Cormorant/);
  });

  it('uses Inter body font', () => {
    expect(SCREEN_SRC).toMatch(/Inter-/);
  });

  it('does not use emoji or podium/medal language', () => {
    expect(SCREEN_SRC).not.toMatch(/🏆|🥇|🥈|🥉|🎉|confetti/i);
    expect(SCREEN_SRC).not.toMatch(/podium|medal/i);
  });
});

describe('LeaderboardSettingsScreen — source guards', () => {
  it('renders opt-in switch with testID leaderboard-opt-in-switch', () => {
    expect(SETTINGS_SRC).toMatch(/testID="leaderboard-opt-in-switch"/);
  });

  it('explains what is measured in plain English (four habit signals)', () => {
    expect(SETTINGS_SRC).toMatch(/Check-in consistency/);
    expect(SETTINGS_SRC).toMatch(/Workouts logged/);
    expect(SETTINGS_SRC).toMatch(/Meals logged/);
    expect(SETTINGS_SRC).toMatch(/Coach engagement/);
  });

  it('explicitly states what is never shared', () => {
    expect(SETTINGS_SRC).toMatch(/never surfaced/i);
    // Must mention weight and finance as excluded categories
    expect(SETTINGS_SRC).toMatch(/body weight/i);
    expect(SETTINGS_SRC).toMatch(/financial/i);
  });

  it('caps display name at 40 chars', () => {
    expect(SETTINGS_SRC).toMatch(/maxLength=\{40\}/);
  });
});

describe('leaderboardApi — source guards', () => {
  it('exports getLeaderboard and setLeaderboardOptIn', () => {
    expect(API_SRC).toMatch(/export async function getLeaderboard/);
    expect(API_SRC).toMatch(/export async function setLeaderboardOptIn/);
  });

  it('uses the /me/leaderboard endpoint path', () => {
    expect(API_SRC).toMatch(/\/me\/leaderboard/);
  });

  it('documents that combinedScore is in [0, 100] and never raw data', () => {
    expect(API_SRC).toMatch(/\[0, 100\]/);
    expect(API_SRC).toMatch(/Never raw weight/i);
  });
});
