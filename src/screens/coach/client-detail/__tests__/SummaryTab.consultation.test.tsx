/**
 * S-REACH — the "Consultation" action on client detail > Summary exists only
 * when featureFlags.coachConsultationView is on AND a handler is supplied
 * (the route is registered behind the same flag), so it is never a dead
 * button. ClientDetailScreen wires it to the ClientConsultation route.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockFlags: Record<string, boolean> = { coachConsultationView: false };
jest.mock("../../../../config/featureFlags", () => ({
  featureFlags: new Proxy(
    {},
    { get: (_t, k: string) => mockFlags[k] ?? false },
  ),
}));
jest.mock("../../../../components/coach/CoachAiSection", () => () => null);
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { SummaryTab } from "../SummaryTab";

const styles = new Proxy({}, { get: () => ({}) }) as never;
const colors = new Proxy({}, { get: () => "#000000" }) as never;

async function renderTab(onOpenConsultation?: () => void) {
  await render(
    <SummaryTab
      profile={null}
      totals={{ calories: 0, protein: 0, carbs: 0, fat: 0 }}
      clientId="c1"
      clientName="Sam Lee"
      nudgeSuccess={false}
      onOpenMessages={jest.fn()}
      onOpenNudge={jest.fn()}
      onOpenMacrosReview={jest.fn()}
      onOpenWorkoutBuilder={jest.fn()}
      onOpenConsultation={onOpenConsultation}
      colors={colors}
      styles={styles}
    />,
  );
}

describe("SummaryTab consultation action", () => {
  beforeEach(() => {
    mockFlags.coachConsultationView = false;
  });

  it("is absent while the flag is off, even with a handler", async () => {
    await renderTab(jest.fn());
    expect(screen.queryByTestId("summary-tab-consultation-pill")).toBeNull();
  });

  it("is absent with the flag on but no handler", async () => {
    mockFlags.coachConsultationView = true;
    await renderTab(undefined);
    expect(screen.queryByTestId("summary-tab-consultation-pill")).toBeNull();
  });

  it("opens the consultation when the flag is on", async () => {
    mockFlags.coachConsultationView = true;
    const open = jest.fn();
    await renderTab(open);
    await fireEvent.press(screen.getByTestId("summary-tab-consultation-pill"));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("ClientDetailScreen passes a handler only behind the flag and targets ClientConsultation", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "ClientDetailScreen.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /onOpenConsultation=\{\s*featureFlags\.coachConsultationView\s*\?[\s\S]*?navigate\('ClientConsultation',[\s\S]*?:\s*undefined/,
    );
  });
});
