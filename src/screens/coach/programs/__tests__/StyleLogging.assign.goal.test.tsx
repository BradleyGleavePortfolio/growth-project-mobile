/**
 * STYLE-LOGGING-M: the coach's program assign in its picked drawing, K3 Style C
 * planning/MOCKUP3/K3/style-c/C_assign_ios390_100.png (context a9434a53; 780 px wide for 390 pt, 2x). Each case names
 * the pixel rows it was read from and mounts the real screen at 390 x 844 (text 100%) and 320 x 568 (text 130%).
 * Words, requests, keys and controls are main's (the last case, H5, pins the request key through a two-chunk run).
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import {
  PixelRatio,
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

const mockNavigation = { navigate: jest.fn(), setOptions: jest.fn(), goBack: jest.fn() };
const mockAssign = jest.fn();
let mockClients: { id: string; name: string; email: string }[] = [];
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
jest.mock("../../../../hooks/usePrograms", () => ({
  useProgram: () => ({ data: { id: "p1", name: "Strength foundations" }, isLoading: false }),
  useAssignableClients: () => ({ data: mockClients, isLoading: false, refetch: jest.fn() }),
  useInvalidatePrograms: () => jest.fn(async () => undefined),
}));
jest.mock("../../../../api/programsApi", () => ({
  ...jest.requireActual("../../../../api/programsApi"),
  programsApi: { assign: (...a: unknown[]) => mockAssign(...a) },
}));

import ProgramAssignScreen from "../ProgramAssignScreen";
import { layout, lightTokens as sc, radius, typography } from "../../../../theme/tokens";
import { mast } from "../../../client/workouts/workoutStyleC";
import { toIsoDate } from "../../../../api/programsApi";

type Flat = ViewStyle & TextStyle;
const flat = (node: { props: { style?: unknown } }): Flat =>
  (StyleSheet.flatten(node.props.style as StyleProp<Flat>) ?? {}) as Flat;
type Host = { type: string; props: Record<string, unknown>; children: (Host | string)[] | null };
function hosts(root: unknown): Host[] {
  const out: Host[] = [];
  const walk = (n: Host | Host[] | string | null) => {
    if (!n || typeof n === "string") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(root as Host | Host[] | null);
  return out;
}
const styleOf = (n: Host) => flat({ props: { style: n.props.style } });

const DEVICES = [
  { name: "390 x 844, text 100%", frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 }, fontScale: 1 },
  { name: "320 x 568, text 130%", frame: { x: 0, y: 0, width: 320, height: 568 }, insets: { top: 20, bottom: 0, left: 0, right: 0 }, fontScale: 1.3 },
] as const;
type Device = (typeof DEVICES)[number];
function mount(device: Device) {
  jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(device.fontScale);
  const props = { route: { params: { programId: "p1" } }, navigation: mockNavigation } as unknown as Parameters<typeof ProgramAssignScreen>[0];
  return render(
    <SafeAreaProvider initialMetrics={{ frame: device.frame, insets: device.insets }}>
      <ProgramAssignScreen {...props} />
    </SafeAreaProvider>,
  );
}
const client = (i: number) => ({ id: `c${i}`, name: `Client ${i}`, email: `c${i}@example.test` });

beforeEach(() => {
  jest.clearAllMocks();
  mockClients = [client(1), client(2), client(3)];
  mockAssign.mockResolvedValue({ results: [] });
});

describe.each(DEVICES)("at $name", (device) => {
  it("the route bar takes the masthead's ground and ink with no rule (C_assign rows 0-200: one forest top)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../../../navigation/ProgramsStackNavigator.tsx"), "utf8");
    const block = src.slice(src.indexOf('name="ProgramAssign"'), src.indexOf('name="ProgramPackages"'));
    expect(block).toMatch(/title: "Assign program"/);
    expect(block).toMatch(/headerStyle: \{ backgroundColor: mast\.ground \}/);
    expect(block).toMatch(/headerTintColor: mast\.ink/);
    expect(block).toMatch(/headerShadowVisible: false/);
  });

  it("the start date block sits on the deep forest masthead with 24 pt bottom corners (C_assign rows 0-661, col 10 ends at 642)", async () => {
    const view = await mount(device);
    const heads = hosts(view.toJSON()).filter((n) => styleOf(n).backgroundColor === mast.ground);
    expect(heads.length).toBeGreaterThan(0);
    const st = styleOf(heads[0]);
    expect(st.borderBottomLeftRadius).toBe(radius.sheet);
    expect(st.borderBottomRightRadius).toBe(radius.sheet);
    expect(st.paddingHorizontal).toBe(layout.gutter);
    const head = view.getByText("Start date");
    expect(flat(head).color).toBe(mast.muted); // "FIRST WEEK" rows 210-226
    expect(head.props.accessibilityRole).toBe("header");
  });

  it("the quick dates are 44 pt pills framed on forest, the chosen one filled leaf (C_assign rows 442-529, line #627669, fill #A3C46A)", async () => {
    const view = await mount(device);
    const pills = hosts(view.toJSON()).filter((n) => styleOf(n).borderRadius === radius.chip && styleOf(n).minHeight === layout.touchMin);
    expect(pills.length).toBeGreaterThanOrEqual(3);
    const chosen = pills.filter((n) => styleOf(n).backgroundColor === mast.chosen);
    expect(chosen).toHaveLength(1); // Next Monday is the default start date
    expect(pills.filter((n) => styleOf(n).borderColor === mast.line).length).toBeGreaterThanOrEqual(2);
    expect(flat(view.getByText("Today")).color).toBe(mast.ink);
    expect(flat(view.getByText("Next Monday")).color).toBe(mast.ground);
  });

  it("the typed date sits on the masthead in the forest field (C_picker's field on forest, rows 204-295)", async () => {
    const view = await mount(device);
    const field = view.getByLabelText("Start date, year month day");
    const st = flat(field);
    expect(st.backgroundColor).toBe(mast.field);
    expect(st.borderColor).toBe(mast.line);
    expect(st.borderRadius).toBe(radius.input);
    expect(st.color).toBe(mast.ink);
  });

  it("the client search is the light field with a 1 pt line and 12 pt corners, 44 pt tall (C_assign rows 794-881)", async () => {
    const view = await mount(device);
    const st = flat(view.getByLabelText("Search clients by name or email"));
    const box = hosts(view.toJSON()).find((n) => styleOf(n).backgroundColor === sc.bgSurface && styleOf(n).borderColor === sc.border);
    expect(box).toBeTruthy();
    expect(styleOf(box as Host).borderRadius).toBe(radius.input);
    expect(styleOf(box as Host).minHeight).toBe(layout.touchMin);
    expect(st.color).toBe(sc.textPrimary);
  });

  it("Select all shown is the forest link at the right of the section head (C_assign rows 726-745)", async () => {
    const view = await mount(device);
    expect(flat(view.getByText("Select all shown (3)")).color).toBe(sc.accentText);
    expect(flat(view.getByLabelText("Select all shown (3)")).minHeight).toBeGreaterThanOrEqual(layout.touchMin);
  });

  it("a client row is a 56 pt hairline row with no box, the name in Inter 17 and a round check (C_assign rows 883-995, cols 680-731)", async () => {
    const view = await mount(device);
    const rowNode = view.getByRole("checkbox", { name: "Client 1" });
    const st = flat(rowNode);
    expect(st.minHeight).toBe(layout.rowMinHeight);
    expect(st.borderBottomWidth).toBe(StyleSheet.hairlineWidth);
    expect(st.borderBottomColor).toBe(sc.border);
    expect(st.backgroundColor).toBeUndefined();
    expect(st.borderRadius).toBeUndefined();
    expect(flat(view.getByText("Client 1")).fontFamily).toBe(typography.h4.fontFamily); // "J" cap rows 924-947
    const off = hosts(view.toJSON()).filter((n) => n.type === "Ionicons" && n.props.name === "ellipse-outline");
    expect(off).toHaveLength(3);
    expect(off[0].props.size).toBe(32); // a 26 pt circle inside the glyph's box
    await fireEvent.press(rowNode);
    const on = hosts(view.toJSON()).filter((n) => n.type === "Ionicons" && n.props.name === "checkmark-circle");
    expect(on).toHaveLength(1);
    expect(on[0].props.color).toBe(sc.accent); // #2C4A36
  });

  it("Assign is the one forest button pinned at the foot, outside the list (C_assign rows 1496-1603)", async () => {
    const view = await mount(device);
    await fireEvent.press(view.getByRole("checkbox", { name: "Client 1" }));
    const btn = view.getByLabelText("Assign to 1 client");
    const st = flat(btn);
    expect(st.backgroundColor).toBe(sc.accent);
    expect(st.minHeight).toBe(layout.buttonHeight);
    expect(st.borderRadius).toBe(radius.button);
    let up = btn.parent;
    while (up) { expect(up.type).not.toBe("RCTScrollView"); up = up.parent; }
    expect(flat(view.getByText("Assign to 1 client")).fontFamily).toBe("Inter_600SemiBold");
    expect(flat(view.getByText("Assign to 1 client")).color).toBe(sc.textOnAccent);
  });
});

// H5: the one-way write stays exact (main's rule, ProgramAssignScreen.tsx:81-92, :157-215 at the base).
it("two chunks with one failure: Retry failed reuses the run's key and a new start date gets a new key", async () => {
  mockClients = Array.from({ length: 51 }, (_, i) => client(i + 1));
  mockAssign
    .mockResolvedValueOnce({ results: mockClients.slice(0, 50).map((c) => ({ client_id: c.id, status: "assigned" })) })
    .mockResolvedValueOnce({ results: [{ client_id: "c51", status: "failed", message: "Try again" }] })
    .mockResolvedValueOnce({ results: [{ client_id: "c51", status: "failed", message: "Try again" }] })
    .mockResolvedValue({ results: [] });
  const view = await mount(DEVICES[0]);
  await fireEvent.press(view.getByLabelText("Select all shown (51)"));
  await fireEvent.press(view.getByLabelText("Assign to 51 clients"));
  expect(mockAssign).toHaveBeenCalledTimes(2);
  expect(mockAssign.mock.calls[0][1].client_ids).toHaveLength(50);
  expect(mockAssign.mock.calls[1][1].client_ids).toEqual(["c51"]);
  expect(mockAssign.mock.calls[1][2]).toBe(mockAssign.mock.calls[0][2]);
  await fireEvent.press(await view.findByLabelText("Retry 1 failed"));
  expect(mockAssign).toHaveBeenCalledTimes(3);
  expect(mockAssign.mock.calls[2][1].client_ids).toEqual(["c51"]);
  expect(mockAssign.mock.calls[2][2]).toBe(mockAssign.mock.calls[0][2]);
  // The retry failed again, so the key is still the run's; a new start date is a new intent with a new key.
  const field = view.getByLabelText("Start date, year month day");
  const [y, m, d] = String(field.props.value).split("-").map(Number);
  await fireEvent.changeText(field, toIsoDate(new Date(y, m - 1, d + 7)));
  await fireEvent.press(view.getByLabelText("Assign to 51 clients"));
  expect(mockAssign).toHaveBeenCalledTimes(5);
  expect(mockAssign.mock.calls[3][2]).not.toBe(mockAssign.mock.calls[0][2]);
  expect(mockAssign.mock.calls[4][2]).toBe(mockAssign.mock.calls[3][2]);
});
