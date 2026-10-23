/**
 * FX-COMM (agent 170): the voice note a coach opens from the inbox draws the
 * note's own loudness bars (waveform_peaks from GET /community/voice-notes/:id),
 * not a flat line.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

jest.mock("../../../config/featureFlags", () => {
  const actual = jest.requireActual("../../../config/featureFlags");
  return {
    ...actual,
    featureFlags: { ...actual.featureFlags, communityVoiceNotes: true },
  };
});
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
  useRoute: () => ({ params: { voiceNoteId: "n1" } }),
}));
jest.mock("../../../hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {} }),
}));
jest.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "coach-1" }),
}));
jest.mock("../../../components/community/SafetyMenu", () => () => null);
const mockPlayer = jest.fn();
jest.mock(
  "../../../components/community/VoiceNotePlayer",
  () => (props: unknown) => {
    mockPlayer(props);
    return null;
  },
);
jest.mock("../../../api/communityVoiceApi", () => ({
  communityVoiceApi: {
    getOne: jest.fn(async () => ({
      id: "n1",
      author_id: "u1",
      url: "https://x/n1.m4a",
      duration_ms: 42000,
      created_at: new Date().toISOString(),
      waveform_peaks: [0.2, 0.9, 0.4],
    })),
  },
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

import CommunityVoiceNoteDetail from "../CommunityVoiceNoteDetail";

it("passes the note's waveform peaks to the player", async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { findByTestId } = await render(
    <QueryClientProvider client={qc}>
      <CommunityVoiceNoteDetail />
    </QueryClientProvider>,
  );
  await findByTestId("community-voice-detail-scroll");
  const last = mockPlayer.mock.calls.at(-1)?.[0] as
    { peaks?: number[] } | undefined;
  expect(last?.peaks).toEqual([0.2, 0.9, 0.4]);
});
