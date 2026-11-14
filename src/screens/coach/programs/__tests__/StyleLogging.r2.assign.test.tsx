/**
 * REFINE-987 (m#987 round 2): the coach's program assign toward K3 Style C C_assign
 * (planning/MOCKUP3/K3/style-c/C_assign_ios390_100.png, context a290b8ec; 780 px for 390 pt). From data the phone
 * already reads: the program's length (useProgram), the first week from the chosen start date (a day holds a workout
 * when a week_index 0 day sits on that day_index: the server places a day at start + week_index * 7 + day_index), each
 * client's initial, "Already on this program" from every page of useProgramAssignees (completed < workouts: the
 * server's already_assigned rule), and the end day by the server's end_date rule. What the screen sends stays main's.
 */
import React from "react";
import { PixelRatio, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

const mockNavigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() };
const mockAssign = jest.fn();
type Day = { week_index: number; day_index: number };
let mockDays: Day[] = [];
let mockLoading = false;
let mockPages: { client_id: string; workouts: number; completed: number }[][] = [];
let mockAssigneesError = false;
let mockAssigneesLoading = false;
jest.mock("@react-navigation/native", () => ({ useNavigation: () => mockNavigation }));
jest.mock("@expo/vector-icons", () => ({
  Ionicons: (p: Record<string, unknown>) => require("react").createElement("Ionicons", p),
}));
jest.mock("../../../../theme/ThemeProvider", () => ({
  useTheme: () => ({
    colors: require("../../../client/wearables/recoveryTestColors").testColors,
    semanticColors: require("../../../../theme/tokens").lightTokens,
  }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }),
}));
jest.mock("../../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("../../../../services/api", () => ({ __esModule: true, default: {}, coachApi: {} }));
jest.mock("../../../client/workouts/workoutStyleC", () => ({
  ...jest.requireActual("../../../client/workouts/workoutStyleC"),
  MastheadBand: (p: Record<string, unknown>) => require("react").createElement("MastheadBand", p),
}));
jest.mock("../../../../hooks/usePrograms", () => ({
  useProgram: () => ({
    data: { id: "p1", name: "Strength foundations", weeks: 6, days_per_week: 4, days: mockDays.map((d) => ({ ...d, plan_id: `${d.week_index}-${d.day_index}`, name: "Day", type: "strength", duration_estimate_minutes: null, exercise_count: 3, updated_at: "" })) },
    isLoading: mockLoading,
  }),
  useAssignableClients: () => ({
    data: [
      { id: "c1", name: "Jordan Ellis", email: "jordan@example.test" },
      { id: "c2", name: "priya Shah", email: "priya@example.test" },
      { id: "c3", name: "Marcus Lee", email: "marcus@example.test" },
    ],
    isLoading: mockLoading,
    refetch: jest.fn(),
  }),
  useInvalidatePrograms: () => jest.fn(async () => undefined),
  // Two pages: the screen must read on until next_cursor is null.
  useProgramAssignees: () => {
    const React = require("react");
    const [n, setN] = React.useState(1);
    return {
      data: mockAssigneesError || mockAssigneesLoading ? undefined : { pages: mockPages.slice(0, n).map((items) => ({ items, next_cursor: null })) },
      isLoading: mockAssigneesLoading,
      isError: mockAssigneesError,
      hasNextPage: !mockAssigneesError && !mockAssigneesLoading && n < mockPages.length,
      isFetchingNextPage: false,
      fetchNextPage: () => setN((v: number) => v + 1),
    };
  },
}));
jest.mock("../../../../api/programsApi", () => ({
  ...jest.requireActual("../../../../api/programsApi"),
  programsApi: { assign: (...a: unknown[]) => mockAssign(...a) },
}));

import ProgramAssignScreen from "../ProgramAssignScreen";
import { lightTokens as sc, typography } from "../../../../theme/tokens";
import { mast } from "../../../client/workouts/workoutStyleC";

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;

const DEVICES = [
  { name: "390 x 844, text 100%", frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 }, fontScale: 1 },
  { name: "320 x 568, text 130%", frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 }, fontScale: 1.3 },
] as const;
type Device = (typeof DEVICES)[number];
function mount(device: Device = DEVICES[0]) {
  jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(device.fontScale);
  const props = { route: { params: { programId: "p1" } }, navigation: mockNavigation } as unknown as Parameters<typeof ProgramAssignScreen>[0];
  return render(
    <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>
      <ProgramAssignScreen {...props} />
    </SafeAreaProvider>,
  );
}
async function setStart(view: ReturnType<typeof mount>, day: string) {
  await fireEvent.changeText(view.getByLabelText("Start date, year month day"), day);
}

// The drawn program: Mon, Tue, Thu and Sat in each of six weeks.
const SIX_WEEKS: Day[] = Array.from({ length: 6 }, (_, w) => [0, 1, 3, 5].map((d) => ({ week_index: w, day_index: d }))).flat();

beforeEach(() => {
  jest.clearAllMocks();
  mockDays = SIX_WEEKS;
  mockLoading = false;
  mockPages = [];
  mockAssigneesError = false;
  mockAssigneesLoading = false;
  mockAssign.mockResolvedValue({ results: [] });
});

describe("the first week and the end day (behaviour)", () => {
  it("the program's length under the bar: \"6 weeks · 4 days a week\"", async () => {
    const view = await mount();
    expect(view.getByText("6 weeks · 4 days a week")).toBeTruthy();
  });

  it("a mid-week start with days on day_index 0, 1, 3 and 5: the strip runs from the start day, workout days ringed", async () => {
    mockDays = [0, 1, 3, 5].map((d) => ({ week_index: 0, day_index: d }));
    const view = await mount();
    await setStart(view, "2026-10-21"); // a Wednesday
    expect(view.getByText("First week")).toBeTruthy();
    expect(view.getByText("Starts Wednesday, October 21")).toBeTruthy();
    const strip = view.getByTestId("assign-strip");
    const labels = within(strip).getAllByTestId(/^assign-day-\d$/).map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual([
      "Wednesday 21, planned", "Thursday 22, planned", "Friday 23, rest day", "Saturday 24, planned",
      "Sunday 25, rest day", "Monday 26, planned", "Tuesday 27, rest day",
    ]);
    expect(within(strip).getAllByText(/^[MTWFS]$/, { includeHiddenElements: true }).map((n) => n.props.children)).toEqual(["W", "T", "F", "S", "S", "M", "T"]);
    // Display only: nothing in the strip is pressable.
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
  });

  it("the start day without a workout reads rest; with one it is the leaf ring", async () => {
    mockDays = [{ week_index: 0, day_index: 2 }];
    const view = await mount();
    await setStart(view, "2026-10-19");
    expect(view.getByLabelText("Monday 19, rest day")).toBeTruthy();
    expect(view.getByLabelText("Wednesday 21, planned")).toBeTruthy();
  });

  it("an invalid date draws neither the Starts title nor the strip, and keeps R1's line", async () => {
    const view = await mount();
    await setStart(view, "2026-02-30");
    expect(view.queryByText(/^Starts /)).toBeNull();
    expect(view.queryByText("First week")).toBeNull();
    expect(view.queryByTestId("assign-strip")).toBeNull();
    expect(view.getByText(/^Enter a real date as YYYY-MM-DD/)).toBeTruthy();
    expect(view.queryByText(/^Each client gets their own copy/)).toBeNull();
  });

  it("the end day: 6 weeks whose last day sits on day_index 6 end on the server's end_date (Mon 19 Oct + 41 = Sun, Nov 29)", async () => {
    mockDays = [...SIX_WEEKS, { week_index: 5, day_index: 6 }];
    const view = await mount();
    await setStart(view, "2026-10-19");
    expect(view.getByText("Each client gets their own copy. Ends Sun, Nov 29.")).toBeTruthy();
  });

  it("the drawn strip's program (Mon, Tue, Thu, Sat for 6 weeks) ends Sat, Nov 28 by the rule", async () => {
    const view = await mount();
    await setStart(view, "2026-10-19");
    expect(view.getByText("Each client gets their own copy. Ends Sat, Nov 28.")).toBeTruthy();
  });

  it("a program with no days: the foot line has no end", async () => {
    mockDays = [];
    const view = await mount();
    await setStart(view, "2026-10-19");
    expect(view.getByText("Each client gets their own copy.")).toBeTruthy();
    expect(view.queryByText(/Ends /)).toBeNull();
  });
});

describe("Already on this program (behaviour)", () => {
  it("reads every assignee page: completed < workouts only, never completed == workouts", async () => {
    mockPages = [
      [{ client_id: "c1", workouts: 24, completed: 3 }],
      [{ client_id: "c3", workouts: 24, completed: 24 }, { client_id: "c2", workouts: 10, completed: 2 }],
    ];
    const view = await mount();
    await waitFor(() => expect(view.getAllByText("Already on this program")).toHaveLength(2));
    expect(within(view.getByRole("checkbox", { name: "Jordan Ellis, Already on this program" })).getByText("Already on this program")).toBeTruthy();
    expect(within(view.getByRole("checkbox", { name: "priya Shah, Already on this program" })).getByText("Already on this program")).toBeTruthy();
    expect(view.getByRole("checkbox", { name: "Marcus Lee" })).toBeTruthy();
  });

  it("the row stays selectable, and after a run the result line replaces it", async () => {
    mockPages = [[{ client_id: "c1", workouts: 24, completed: 3 }]];
    mockAssign.mockResolvedValueOnce({ results: [{ client_id: "c1", status: "already_assigned" }] });
    const view = await mount();
    await waitFor(() => expect(view.getByText("Already on this program")).toBeTruthy());
    await fireEvent.press(view.getByRole("checkbox", { name: "Jordan Ellis, Already on this program" }));
    expect(view.getByRole("checkbox", { name: "Jordan Ellis, Already on this program" }).props.accessibilityState).toEqual({ checked: true });
    await fireEvent.press(view.getByLabelText("Assign to 1 client"));
    await waitFor(() => expect(view.queryByText("Already on this program")).toBeNull());
    expect(mockAssign).toHaveBeenCalledTimes(1);
    expect(Object.keys(mockAssign.mock.calls[0][1]).sort()).toEqual(["allow_repeat", "client_ids", "start_date"]);
    expect(mockAssign.mock.calls[0][1].client_ids).toEqual(["c1"]);
  });

  it.each([["failed", () => { mockAssigneesError = true; }], ["loading", () => { mockAssigneesLoading = true; }]])(
    "a %s assignees read draws no line",
    async (_n, set) => {
      mockPages = [[{ client_id: "c1", workouts: 24, completed: 3 }]];
      set();
      const view = await mount();
      expect(view.queryByText("Already on this program")).toBeNull();
      expect(view.getByRole("checkbox", { name: "Jordan Ellis" })).toBeTruthy();
    },
  );
});

it("loading: the masthead's band is forest while clients and the program load (LO-987R1 C1)", async () => {
  mockLoading = true;
  const view = await mount();
  const band = view.UNSAFE_root.findAll((n) => (n.type as unknown) === "MastheadBand");
  expect(band.length).toBeGreaterThan(0);
  expect(band[0].props.color).toBe(mast.ground);
});

describe.each(DEVICES)("the drawn numbers at $name", (device) => {
  it("the length line is muted Inter 14 on the masthead (C_assign cap rows 156-175)", async () => {
    const view = await mount(device);
    const st = flat(view.getByText("6 weeks · 4 days a week"));
    expect(st.fontSize).toBe(typography.bodySmall.fontSize);
    expect(st.color).toBe(mast.muted);
  });

  it("\"First week\" is the eyebrow and \"Starts ...\" the Cormorant title in the masthead ink (rows 210-290)", async () => {
    const view = await mount(device);
    await setStart(view, "2026-10-19");
    const eyebrow = flat(view.getByText("First week"));
    expect(eyebrow.textTransform).toBe("uppercase");
    expect(eyebrow.color).toBe(mast.muted);
    const title = flat(view.getByText("Starts Monday, October 19"));
    expect(title.fontFamily).toBe(typography.h2.fontFamily);
    expect(title.fontSize).toBe(typography.h2.fontSize);
    expect(title.color).toBe(mast.ink);
  });

  it("\"{N} selected\" is the drawn eyebrow over the list, still a header (rows 728-743)", async () => {
    const view = await mount(device);
    const head = view.getByText("0 selected");
    expect(head.props.accessibilityRole).toBe("header");
    expect(flat(head).textTransform).toBe("uppercase");
    expect(flat(head).color).toBe(sc.textMuted);
    expect(view.queryByText(/^Clients \(/)).toBeNull();
  });

  it("each client carries a 36 pt sage disc with the initial in serif, hidden from readers (cols 48-119)", async () => {
    const view = await mount(device);
    const discs = view.getAllByTestId("assign-initial", { includeHiddenElements: true });
    expect(discs).toHaveLength(3);
    const st = flat(discs[0]);
    expect([st.width, st.height, st.backgroundColor]).toEqual([36, 36, sc.surface.sage]);
    expect(discs[0].props.importantForAccessibility).toBe("no-hide-descendants");
    const hidden = { includeHiddenElements: true };
    expect(within(discs[0]).getByText("J", hidden)).toBeTruthy();
    expect(within(discs[1]).getByText("P", hidden)).toBeTruthy();
    expect(flat(within(discs[0]).getByText("J", hidden)).fontFamily).toMatch(/^CormorantGaramond/);
    // Main's second line stays (two clients with one name stay apart).
    expect(view.getByText("jordan@example.test")).toBeTruthy();
  });

  it("the foot line sits over Assign, centred (rows 1450-1469)", async () => {
    const view = await mount(device);
    await setStart(view, "2026-10-19");
    const st = flat(view.getByText("Each client gets their own copy. Ends Sat, Nov 28."));
    expect(st.textAlign).toBe("center");
    expect(st.fontSize).toBe(typography.bodySmall.fontSize);
    expect(view.queryByText(/^Week 1, Day 1 lands on/)).toBeNull();
  });
});
