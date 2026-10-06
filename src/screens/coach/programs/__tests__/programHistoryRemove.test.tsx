/**
 * Programs fix round (B-358-2 / B-358-3) — "Remove from program" acts on
 * every run of the program a client is on, so the screen offers one Remove
 * per client and the confirmation states that scope; failure telemetry never
 * carries a client name or a package title.
 */
import React from "react";
import { Alert } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockNavigation = { navigate: jest.fn(), setOptions: jest.fn() };
const mockAssignees = jest.fn();
const mockUnassign = jest.fn();
const mockAttach = jest.fn();
const mockCapture = jest.fn();

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../../../theme/ThemeProvider", () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => "#123456" }) }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [
      {
        id: "pkg1",
        title: "Private Package Title",
        priceCents: 0,
        currency: "usd",
        status: "active",
        subscriberCount: 3,
        archivedAt: null,
      },
    ],
    isLoading: false,
    error: null,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {},
  coachApi: {},
}));
jest.mock("../../../../hooks/usePrograms", () => ({
  useProgram: () => ({
    data: { id: "p1", name: "Master", packages: [] },
    isLoading: false,
    error: null,
  }),
  useProgramRevisions: () => ({ data: { items: [] }, isLoading: false }),
  useProgramAssignees: (...a: unknown[]) => mockAssignees(...a),
  useInvalidatePrograms: () => async () => undefined,
}));
jest.mock("../../../../api/programsApi", () => ({
  ...jest.requireActual("../../../../api/programsApi"),
  programsApi: { unassign: (...a: unknown[]) => mockUnassign(...a) },
}));
jest.mock("../../../../api/packagesApi", () => ({ coachPackagesApi: {} }));
jest.mock("../../../../api/packageContentsApi", () => ({
  coachPackageContentsApi: {
    attach: (...a: unknown[]) => mockAttach(...a),
  },
}));

import ProgramHistoryScreen from "../ProgramHistoryScreen";
import ProgramPackagesScreen from "../ProgramPackagesScreen";

function fake<T>(v: unknown): T {
  return v as T;
}
const props = <T,>() =>
  fake<T>({
    route: { params: { programId: "p1" } },
    navigation: mockNavigation,
  });

const run1 = {
  client_id: "c1",
  client_name: "Synthetic Person",
  copy_program_id: "run1",
  start_date: "2026-09-07",
  end_date: "2026-10-02",
  workouts: 12,
  completed: 10,
};
const run2 = {
  ...run1,
  copy_program_id: "run2",
  start_date: "2026-11-02",
  end_date: "2026-11-27",
  workouts: 5,
  completed: 0,
};

function assigneesReturn(items: unknown[], hasNextPage = false) {
  return {
    data: { pages: [{ items, next_cursor: hasNextPage ? "n" : null }] },
    isLoading: false,
    error: null,
    hasNextPage,
    isFetchingNextPage: false,
    refetch: jest.fn(),
    fetchNextPage: jest.fn(),
  };
}

async function confirmRemove() {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const screen = await render(
    <ProgramHistoryScreen
      {...props<Parameters<typeof ProgramHistoryScreen>[0]>()}
    />,
  );
  const removes = screen.getAllByLabelText("Remove");
  await fireEvent.press(removes[0]);
  return { screen, removes, alert };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockAssignees.mockReturnValue(assigneesReturn([run2, run1]));
  mockUnassign.mockResolvedValue({ removed_workouts: 7, kept_workouts: 10 });
});

describe("ProgramHistoryScreen Remove scope (B-358-2)", () => {
  it("a client on two runs gets one Remove whose confirmation covers every run", async () => {
    const { removes, alert } = await confirmRemove();
    expect(removes).toHaveLength(1);
    const message = String(alert.mock.calls[0][1]);
    expect(message).toContain("is on 2 runs of this program");
    expect(message).toContain(
      "Every run of this program on their plan, including copies delivered by a package",
    );
    // 2 + 5 not finished across both runs; started ones stay, so "up to".
    expect(message).toContain("Up to 7 upcoming workouts are removed");
    expect(message).toContain("10 finished workouts stay");
    expect(message).toContain("any workout already started");
  });

  it("with more clients still to load, no count is promised", async () => {
    mockAssignees.mockReturnValue(assigneesReturn([run2, run1], true));
    const { alert } = await confirmRemove();
    const message = String(alert.mock.calls[0][1]);
    expect(message).toContain("Every run of this program");
    expect(message).not.toMatch(/\d+ upcoming/);
  });

  it("after removal the server's own totals are shown", async () => {
    const { screen, alert } = await confirmRemove();
    const remove = alert.mock.calls[0][2]!.find((b) => b.text === "Remove")!;
    await act(async () => {
      await remove.onPress!();
    });
    expect(mockUnassign).toHaveBeenCalledWith("p1", "c1", expect.any(String));
    expect(
      screen.getByText(
        "Synthetic Person is off this program: 7 upcoming workouts were removed and 10 workouts stay in their history.",
      ),
    ).toBeTruthy();
  });
});

describe("Programs failure telemetry carries no names (B-358-3)", () => {
  it("a failed removal sends no client name to telemetry", async () => {
    mockUnassign.mockRejectedValueOnce(new Error("Network Error"));
    const { alert } = await confirmRemove();
    const remove = alert.mock.calls[0][2]!.find((b) => b.text === "Remove")!;
    await act(async () => {
      await remove.onPress!();
    });
    await waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(
      "Synthetic Person",
    );
  });

  it("a failed package attach sends no package title to telemetry", async () => {
    mockAttach.mockRejectedValueOnce(new Error("Network Error"));
    const screen = await render(
      <ProgramPackagesScreen
        {...props<Parameters<typeof ProgramPackagesScreen>[0]>()}
      />,
    );
    await act(async () => {
      await fireEvent.press(
        screen.getByLabelText(
          "Private Package Title, Free ($0), active, 3 clients",
        ),
      );
    });
    await waitFor(() => expect(mockCapture).toHaveBeenCalled());
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(
      "Private Package Title",
    );
  });
});
