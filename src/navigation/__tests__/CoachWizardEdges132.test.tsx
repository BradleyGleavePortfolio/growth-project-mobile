import React from "react";
import { Share, StyleSheet } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockOpenStripe = jest.fn();
const mockClipboard = jest.fn();
let mockInsets = { top: 28, bottom: 24, left: 0, right: 0 };
jest.mock("../../services/api", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    put: jest.fn(),
  },
}));
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenStripe(...args),
  dismissAuthSession: jest.fn(),
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: string[]) => mockClipboard(...args),
}));
jest.mock("../../services/sentry", () => ({ captureError: jest.fn() }));
jest.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "coach_test", name: "North" }),
}));
jest.mock("../../api/packagesApi", () => ({
  coachPackagesApi: { list: jest.fn(async () => ({ data: [] })) },
  isLivePackage: () => false,
}));
jest.mock("../../storage/mmkv", () => ({
  prefsStorage: { getStringAsync: jest.fn(), set: jest.fn(async () => undefined) },
}));
jest.mock("../../components/coach/setup/FirstPackageForm", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../../lib/coachSetup/setupStatus", () => ({
  loadSetupStatus: jest.fn(async () => ({ errors: [] })),
  inviteSharedKey: (id: string) => `coach.setup.invite_shared:${id}`,
}));
jest.mock("react-native-safe-area-context", () => {
  const actual = require("react-native-safe-area-context/jest/mock").default;
  return {
    ...actual,
    useSafeAreaInsets: () => mockInsets,
  };
});

import CoachWizardNavigator from "../CoachWizardNavigator";
import SetupNotice from "../../components/coach/setup/SetupNotice";
import { COACH_SUPPORT_EMAIL, describeError } from "../../lib/coachSetup/errors";
import { SUPPORT_EMAIL } from "../../constants/support";
import { radius } from "../../theme/tokens";

const REF = "12345678-0000-4000-8000-000000000001";
const httpError = (code: string, status = 503) => ({
  response: { status, data: { code, request_id: REF } },
});

function backend(step: number, unavailable = true) {
  let currentStep = step;
  mockGet.mockImplementation(async (url: string) => {
    if (url === "/coach/onboarding") {
      return {
        data: {
          current_step: currentStep,
          step_data: { "1": { practice_name: "North" } },
        },
      };
    }
    if (url === "/coach/connect/status") {
      if (unavailable) throw httpError("CONNECT_NOT_CONFIGURED");
      return { data: { account_id: null } };
    }
    if (url === "/coaches/me/invite-link") {
      return { data: { code: "GP-TEST", url: "https://app.trygrowthproject.com/join/GP-TEST" } };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
  mockPost.mockImplementation(async (url: string) => {
    if (url === "/coach/onboarding/complete") return { data: {} };
    currentStep = Number(url.split("/").pop()) + 1;
    return { data: { current_step: currentStep } };
  });
}

async function wizard(step: number, unavailable = true) {
  backend(step, unavailable);
  const ui = await render(
    <NavigationContainer>
      <CoachWizardNavigator />
    </NavigationContainer>,
  );
  await ui.findByTestId(`wizard-step-${step}-cta`);
  return ui;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockClipboard.mockResolvedValue(undefined);
  mockInsets = { top: 28, bottom: 24, left: 0, right: 0 };
});

describe("B01/B09 safe areas and B08 resumed Back", () => {
  it.each([
    { top: 28, bottom: 24 },
    { top: 59, bottom: 34 },
    { top: 0, bottom: 0 },
  ])("uses top $top / bottom $bottom insets outside scroll content", async (insets) => {
    mockInsets = { ...mockInsets, ...insets };
    const ui = await wizard(4);
    const frame = ui.getByTestId("wizard-step-4-safe-area");
    expect(StyleSheet.flatten(frame.props.style)).toMatchObject({
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
    });
    const content = ui.getByTestId("wizard-step-4-scroll");
    expect(StyleSheet.flatten(content.props.contentContainerStyle)).toMatchObject({
      paddingTop: 36,
      paddingBottom: 24,
    });
    const back = ui.getByTestId("wizard-step-4-back");
    expect(StyleSheet.flatten(back.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });

  it("the wizard takes rounded corners from the semantic tokens (owner 17:07) and its serif headline never clips", async () => {
    const ui = await wizard(4);
    const cta = StyleSheet.flatten(ui.getByTestId("wizard-step-4-cta").props.style);
    expect(cta.borderRadius).toBe(radius.button);
    const headline = StyleSheet.flatten(ui.getByText("Invite your first client").props.style);
    expect(headline.lineHeight / headline.fontSize).toBeGreaterThanOrEqual(1.2);
  });

  it.each([2, 3, 4, 5])("cold resume at step %i returns to the preceding step", async (step) => {
    const ui = await wizard(step);
    await fireEvent.press(ui.getByTestId(`wizard-step-${step}-back`));
    await ui.findByTestId(`wizard-step-${step - 1}-cta`);
    if (step > 2) {
      await fireEvent.press(ui.getByTestId(`wizard-step-${step - 1}-back`));
      await ui.findByTestId(`wizard-step-${step - 2}-cta`);
    }
  });

  it("the first step has no false Back and Continue still opens step 2", async () => {
    const ui = await wizard(1);
    expect(ui.queryByTestId("wizard-step-1-back")).toBeNull();
    await fireEvent.press(ui.getByTestId("wizard-step-1-cta"));
    await ui.findByTestId("wizard-step-2-cta");
    await fireEvent.press(ui.getByTestId("wizard-step-2-back"));
    await ui.findByTestId("wizard-step-1-cta");
  });

  it.each([3, 4])("step %i retains its forward save and route", async (step) => {
    const ui = await wizard(step);
    await fireEvent.press(ui.getByTestId(`wizard-step-${step}-cta`));
    await ui.findByTestId(`wizard-step-${step + 1}-cta`);
    expect(mockPost).toHaveBeenCalledWith(
      `/coach/onboarding/steps/${step}`,
      step === 3 ? { package_skipped: true } : { invite_shared: false },
    );
  });

  it("the final dashboard action still completes setup", async () => {
    const ui = await wizard(5);
    await fireEvent.press(ui.getByTestId("wizard-step-5-cta"));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith("/coach/onboarding/complete"));
  });

  it("invite Share, Copy, QR and Continue retain their real handlers", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction });
    try {
      const ui = await wizard(4);
      await fireEvent.press(await ui.findByTestId("wizard-invite-share"));
      expect(share).toHaveBeenCalledWith({
        message: "Join my coaching on The Growth Project: https://app.trygrowthproject.com/join/GP-TEST",
      });
      await fireEvent.press(ui.getByTestId("wizard-invite-copy"));
      expect(mockClipboard).toHaveBeenCalledWith("https://app.trygrowthproject.com/join/GP-TEST");
      await fireEvent.press(ui.getByTestId("wizard-invite-qr-toggle"));
      expect(ui.getByTestId("wizard-invite-qr")).toBeTruthy();
      await fireEvent.press(ui.getByTestId("wizard-invite-qr-toggle"));
      expect(ui.queryByTestId("wizard-invite-qr")).toBeNull();
      await fireEvent.press(ui.getByTestId("wizard-step-4-cta"));
      await ui.findByTestId("wizard-step-5-cta");
      expect(mockPost).toHaveBeenCalledWith("/coach/onboarding/steps/4", { invite_shared: true });
    } finally {
      share.mockRestore();
    }
  });
});

describe("B06/B10 calm, non-blocking configuration state", () => {
  it("configured Stripe keeps its 44 pt text action beside the single primary Continue", async () => {
    const ui = await wizard(2, false);
    const stripe = await ui.findByTestId("wizard-get-paid-open");
    const style = StyleSheet.flatten(stripe.props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.backgroundColor).toBeUndefined();
    expect(ui.getByTestId("wizard-step-2-cta").props.accessibilityLabel).toBe("Continue setup");
  });

  it("unavailable Stripe has one neutral explanation, no retry trap, and setup continues", async () => {
    const ui = await wizard(2);
    await ui.findByText(
      "Payouts are not available yet. Finish setup now and connect Stripe later from Get paid on the Overview tab.",
    );
    expect(ui.queryByTestId("wizard-get-paid-open")).toBeNull();
    expect(ui.queryByTestId("wizard-get-paid-error")).toBeNull();
    expect(ui.queryByText(/Reference|12345678|Bradleyapple1031/)).toBeNull();
    expect(ui.getByTestId("wizard-step-2-cta").props.accessibilityLabel).toBe("Continue setup");
    await fireEvent.press(ui.getByTestId("wizard-step-2-cta"));
    await ui.findByTestId("wizard-step-3-cta");
    expect(mockOpenStripe).not.toHaveBeenCalled();
  });

  it.each(["CONNECT_NOT_CONFIGURED", "STRIPE_NOT_CONFIGURED", "STEP_OUT_OF_ORDER"])(
    "%s never shows a reference or a made-up second-device claim",
    (code) => {
      const error = describeError(httpError(code, code === "STEP_OUT_OF_ORDER" ? 400 : 503), "save this step");
      expect(`${error.title} ${error.body}`).not.toMatch(/12345678|another device/);
      expect(error.requestId).toBeNull();
    },
  );

  it("support references remain selectable secondary text, never part of the main message", async () => {
    const error = describeError(httpError("INTERNAL_ERROR", 500), "save this step");
    expect(error.body).not.toContain(REF);
    expect(error.body).toContain(SUPPORT_EMAIL);
    const ui = await render(<SetupNotice error={error} testID="support-notice" />);
    expect(ui.getByText(`Reference ${REF}`).props.selectable).toBe(true);
    expect(StyleSheet.flatten(ui.getByTestId("support-notice").props.style).borderWidth).toBeUndefined();
    expect(COACH_SUPPORT_EMAIL).toBe(SUPPORT_EMAIL);
  });
});
