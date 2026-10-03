/**
 * S-MWB-2 fix round — request keys follow the logical intent (B-328-1,
 * B-328-2) and a conflict reload rebases the form instead of pairing a stale
 * body with a fresh version (B-328-4).
 */
import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

const mockNavigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
};
const mockProgram = jest.fn();
const mockCreate = jest.fn();
const mockAssign = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => mockNavigation,
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../../../theme/ThemeProvider", () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => "#123456" }) }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    setQueryData: jest.fn(),
    invalidateQueries: jest.fn(),
  }),
}));
jest.mock("../../../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {},
  coachApi: {},
}));
jest.mock("../../../../hooks/usePrograms", () => ({
  programKeys: { detail: (id: string) => ["d", id] },
  useProgram: (...a: unknown[]) => mockProgram(...a),
  useAssignableClients: () => ({
    data: [{ id: "c1", name: "Client 1", email: "a@example.test" }],
    isLoading: false,
  }),
  useInvalidatePrograms: () => jest.fn(async () => undefined),
}));
jest.mock("../../../../api/programsApi", () => ({
  ...jest.requireActual("../../../../api/programsApi"),
  programsApi: {
    create: (...a: unknown[]) => mockCreate(...a),
    assign: (...a: unknown[]) => mockAssign(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
}));

import ProgramFormScreen from "../ProgramFormScreen";
import ProgramAssignScreen from "../ProgramAssignScreen";

/** Test seam: hand a partial navigation fake to the typed screen prop. */
function fake<T>(v: unknown): T {
  return v as T;
}

const detail = {
  id: "p1",
  version: 3,
  name: "Original name",
  description: "",
  goal_tag: "",
  weeks: 4,
  days_per_week: 3,
  filled_days: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockProgram.mockReturnValue({
    data: detail,
    isLoading: false,
    refetch: jest.fn(),
  });
  mockCreate.mockResolvedValue({ id: "new" });
  mockAssign.mockResolvedValue({
    results: [{ client_id: "c1", status: "assigned" }],
  });
  mockUpdate.mockResolvedValue({ ...detail, version: 4 });
});

function assignScreen() {
  return render(
    <ProgramAssignScreen
      {...fake<Parameters<typeof ProgramAssignScreen>[0]>({
        route: { params: { programId: "p1" } },
        navigation: mockNavigation,
      })}
    />,
  );
}

const keyOf = (call: number) => mockAssign.mock.calls[call][2];

describe("ProgramAssignScreen request keys (B-328-1)", () => {
  it("a new start date is a new intent: fresh key and the old results are cleared", async () => {
    const screen = await assignScreen();
    await fireEvent.press(screen.getByLabelText("Select all shown (1)"));
    await fireEvent.press(screen.getByLabelText("Assign to 1 client"));
    expect(await screen.findByText(/1 assigned/)).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Start date, year month day"),
      "2026-11-09",
    );
    expect(screen.queryByText(/1 assigned/)).toBeNull();
    await fireEvent.press(screen.getByLabelText("Assign to 1 client"));
    expect(mockAssign).toHaveBeenCalledTimes(2);
    expect(mockAssign.mock.calls[1][1]).toMatchObject({
      start_date: "2026-11-09",
    });
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("a run with no failures retires its key, so the next press is a new assignment", async () => {
    const screen = await assignScreen();
    await fireEvent.press(screen.getByLabelText("Select all shown (1)"));
    await fireEvent.press(screen.getByLabelText("Assign to 1 client"));
    await screen.findByText(/1 assigned/);
    await fireEvent.press(screen.getByLabelText("Assign to 1 client"));
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it("Retry failed reuses the key of the run that failed, and replayed rows are counted on their own", async () => {
    mockAssign
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce({
        results: [{ client_id: "c1", status: "assigned", replayed: true }],
      });
    const screen = await assignScreen();
    await fireEvent.press(screen.getByLabelText("Select all shown (1)"));
    await fireEvent.press(screen.getByLabelText("Assign to 1 client"));
    await fireEvent.press(await screen.findByLabelText("Retry 1 failed"));
    expect(mockAssign).toHaveBeenCalledTimes(2);
    expect(keyOf(1)).toBe(keyOf(0));
    expect(
      await screen.findByText(
        "0 assigned · 1 confirmed from an earlier attempt · 0 already on it · 0 failed",
      ),
    ).toBeTruthy();
  });
});

async function formScreen(programId?: string) {
  const props = fake<Parameters<typeof ProgramFormScreen>[0]>({
    route: { params: programId ? { programId } : {} },
    navigation: mockNavigation,
  });
  const screen = await render(<ProgramFormScreen {...props} />);
  return { props, screen };
}

describe("ProgramFormScreen request keys (B-328-2)", () => {
  it("an unknown create outcome keeps the key and the body, and locks the fields", async () => {
    mockCreate.mockRejectedValueOnce(new Error("connection lost after commit"));
    const { screen } = await formScreen();
    await fireEvent.changeText(
      screen.getByLabelText("Program name"),
      "Fresh program",
    );
    await fireEvent.press(screen.getByLabelText("Create program"));
    expect(
      await screen.findByText(/could not confirm whether this saved/),
    ).toBeTruthy();
    // S-MWB-3: no first person in coach-facing failure copy.
    expect(screen.queryByText(/\bWe could not\b/)).toBeNull();
    expect(screen.getByLabelText("Program name").props.editable).toBe(false);
    await fireEvent.press(screen.getByLabelText("Create program"));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1]).toBe(mockCreate.mock.calls[0][1]);
    expect(mockCreate.mock.calls[1][0]).toEqual(mockCreate.mock.calls[0][0]);
    expect(mockNavigation.replace).toHaveBeenCalledWith("ProgramEditor", {
      programId: "new",
    });
  });

  it("a definite refusal (the server answered 400) releases the key for the next attempt", async () => {
    mockCreate.mockRejectedValueOnce({
      response: { status: 400, data: { message: "name is too long" } },
    });
    const { screen } = await formScreen();
    await fireEvent.changeText(screen.getByLabelText("Program name"), "Name");
    await fireEvent.press(screen.getByLabelText("Create program"));
    await screen.findByText(/name is too long/);
    expect(screen.getByLabelText("Program name").props.editable).toBe(true);
    await fireEvent.press(screen.getByLabelText("Create program"));
    expect(mockCreate.mock.calls[1][1]).not.toBe(mockCreate.mock.calls[0][1]);
  });
});

describe("ProgramFormScreen conflict reload (B-328-4)", () => {
  it("untouched fields take the new server values and the save sends the fresh version with them", async () => {
    mockUpdate.mockRejectedValueOnce({
      response: { status: 409, data: { code: "program_version_conflict" } },
    });
    const { screen, props } = await formScreen("p1");
    await fireEvent.press(screen.getByLabelText("Save details"));
    mockProgram.mockReturnValue({
      data: { ...detail, version: 4, name: "Other device name" },
      isLoading: false,
      refetch: jest.fn(),
    });
    await act(async () => {
      await screen.rerender(<ProgramFormScreen {...props} />);
    });
    expect(screen.getByLabelText("Program name").props.value).toBe(
      "Other device name",
    );
    await fireEvent.press(screen.getByLabelText("Save details"));
    expect(mockUpdate.mock.calls[1][1]).toMatchObject({
      name: "Other device name",
      expected_version: 4,
    });
  });

  it("a field changed on both sides must be resolved before saving", async () => {
    mockUpdate.mockRejectedValueOnce({
      response: { status: 409, data: { code: "program_version_conflict" } },
    });
    const { screen, props } = await formScreen("p1");
    await fireEvent.changeText(
      screen.getByLabelText("Program name"),
      "My name",
    );
    await fireEvent.press(screen.getByLabelText("Save details"));
    mockProgram.mockReturnValue({
      data: { ...detail, version: 4, name: "Their name" },
      isLoading: false,
      refetch: jest.fn(),
    });
    await act(async () => {
      await screen.rerender(<ProgramFormScreen {...props} />);
    });
    expect(screen.getByLabelText("Program name").props.value).toBe("My name");
    expect(
      screen.getByText(/Name also changed on another device to "Their name"/),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("Save details").props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(screen.getByLabelText("Use latest"));
    expect(screen.getByLabelText("Program name").props.value).toBe(
      "Their name",
    );
    await fireEvent.press(screen.getByLabelText("Save details"));
    expect(mockUpdate.mock.calls[1][1]).toMatchObject({
      name: "Their name",
      expected_version: 4,
    });
  });
});
