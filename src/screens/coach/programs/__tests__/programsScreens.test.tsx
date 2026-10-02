/**
 * S-MWB — Programs screens render live data (counts from the API), wire the
 * grid to the existing workout builder, and show specific failures.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

const mockNavigate = jest.fn();
const mockPush = jest.fn();
const mockRefetch = jest.fn();

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    push: mockPush,
    setOptions: jest.fn(),
  }),
  useFocusEffect: jest.fn(),
}));

jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaView: View };
});

jest.mock("../../../../theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: new Proxy({}, { get: () => "#123456" }),
  }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));

const mockCaptureError = jest.fn();
jest.mock("../../../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCaptureError(...a),
}));
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {},
  coachApi: {},
}));

const mockProgramList = jest.fn();
const mockSaved = jest.fn();
const mockProgram = jest.fn();
jest.mock("../../../../hooks/usePrograms", () => ({
  programKeys: { detail: (id: string) => ["d", id] },
  useProgramList: (...a: unknown[]) => mockProgramList(...a),
  useSavedWorkouts: (...a: unknown[]) => mockSaved(...a),
  useProgram: (...a: unknown[]) => mockProgram(...a),
  useInvalidatePrograms: () => jest.fn(),
}));

import ProgramsLibraryScreen from "../ProgramsLibraryScreen";
import ProgramEditorScreen from "../ProgramEditorScreen";

type EditorProps = Parameters<typeof ProgramEditorScreen>[0];
/** Test seam: hand a partial navigation fake to the typed screen prop. */
function fake<T>(value: unknown): T {
  return value as T;
}

const SUMMARY = {
  id: "p-1",
  name: "Men's intro",
  description: null,
  goal_tag: "Intro",
  weeks: 2,
  days_per_week: 3,
  filled_days: 2,
  assigned_count: 14,
  package_count: 1,
  is_regime: false,
  regime_display_name: null,
  version: 3,
  can_edit: true,
  updated_at: "2026-10-01T00:00:00.000Z",
  archived_at: null,
};

function listResult(over: Record<string, unknown> = {}) {
  return {
    data: {
      pages: [
        {
          items: [SUMMARY],
          next_cursor: null,
          goal_tags: ["Intro", "Strength"],
        },
      ],
    },
    error: null,
    isLoading: false,
    isRefetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    refetch: mockRefetch,
    fetchNextPage: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSaved.mockReturnValue(
    listResult({ data: { pages: [{ items: [], next_cursor: null }] } }),
  );
});

describe("ProgramsLibraryScreen", () => {
  it("shows each program with live counts and goal filters, and opens the editor", async () => {
    mockProgramList.mockReturnValue(listResult());
    const screen = await render(<ProgramsLibraryScreen />);
    expect(screen.getByText("Men's intro")).toBeTruthy();
    expect(
      screen.getByText(/2 weeks x 3 days · 2 of 14 days filled/),
    ).toBeTruthy();
    expect(screen.getByText(/14 clients assigned · in 1 package/)).toBeTruthy();
    expect(screen.getByLabelText("Goal Strength")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Men's intro, goal Intro/));
    expect(mockNavigate).toHaveBeenCalledWith("ProgramEditor", {
      programId: "p-1",
    });
  });

  it("flag-off backend shows the specific unavailable copy with a support path, not a generic error", async () => {
    mockProgramList.mockReturnValue(
      listResult({
        data: undefined,
        error: {
          response: { status: 404, data: { code: "programs_unavailable" } },
        },
      }),
    );
    const screen = await render(<ProgramsLibraryScreen />);
    expect(
      screen.getByText(/Programs are not switched on for your account yet/),
    ).toBeTruthy();
    expect(screen.getByLabelText("Contact support")).toBeTruthy();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("saved workouts tab opens the builder for a new standalone workout", async () => {
    mockProgramList.mockReturnValue(listResult());
    const screen = await render(<ProgramsLibraryScreen />);
    await fireEvent.press(screen.getByLabelText("Saved workouts"));
    await fireEvent.press(screen.getByLabelText("New workout"));
    expect(mockNavigate).toHaveBeenCalledWith("CoachWorkoutBuilder");
  });
});

describe("ProgramEditorScreen", () => {
  const nav = {
    navigate: mockNavigate,
    push: mockPush,
    setOptions: jest.fn(),
    replace: jest.fn(),
    goBack: jest.fn(),
  };
  async function renderEditor() {
    return render(
      <ProgramEditorScreen
        route={{
          key: "k",
          name: "ProgramEditor",
          params: { programId: "p-1" },
        }}
        navigation={fake<EditorProps["navigation"]>(nav)}
      />,
    );
  }

  it("renders the week x day grid; a filled day opens the existing workout builder", async () => {
    mockProgram.mockReturnValue({
      data: {
        ...SUMMARY,
        days: [
          {
            week_index: 0,
            day_index: 0,
            plan_id: "plan-a",
            name: "Full body A",
            type: "strength",
            duration_estimate_minutes: 45,
            exercise_count: 6,
            updated_at: "x",
          },
        ],
        packages: [
          {
            content_id: "c",
            package_id: "pkg",
            package_name: "Clinic intro",
            cadence_kind: "immediate",
          },
        ],
      },
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const screen = await renderEditor();
    expect(screen.getByText("Clinic intro")).toBeTruthy();
    expect(
      screen.getByLabelText("Week 2, Day 7: rest day, empty"),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText("Week 1, Day 1: Full body A, 6 exercises"),
    );
    await fireEvent.press(screen.getByLabelText("Open in workout builder"));
    expect(mockNavigate).toHaveBeenCalledWith("CoachWorkoutBuilder", {
      planId: "plan-a",
    });
    await fireEvent.press(screen.getByLabelText("Assign to clients"));
    expect(mockNavigate).toHaveBeenCalledWith("ProgramAssign", {
      programId: "p-1",
    });
  });

  it("an empty program cannot be assigned or packaged (buttons disabled with a reason)", async () => {
    mockProgram.mockReturnValue({
      data: { ...SUMMARY, filled_days: 0, days: [], packages: [] },
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const screen = await renderEditor();
    const assign = screen.getByLabelText("Assign to clients");
    expect(assign.props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    await fireEvent.press(
      screen.getByLabelText("Week 1, Day 2: rest day, empty"),
    );
    expect(screen.getByLabelText("New workout")).toBeTruthy();
    expect(screen.getByLabelText("Use a saved workout")).toBeTruthy();
  });
});
