/**
 * S-COACH — coach setup wizard building blocks: Connect status truth,
 * wizard step walking, error copy, package floor, QR, Get paid return flow,
 * Home checklist.
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
jest.mock("../../../../services/api", () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPut(...a),
  },
}));

const mockCapture = jest.fn();
jest.mock("../../../../services/sentry", () => ({
  captureError: (...a: unknown[]) => mockCapture(...a),
}));

const mockOpenAuth = jest.fn();
jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...a),
}));

const mockCreatePackage = jest.fn();
jest.mock("../../../../api/packagesApi", () => ({
  coachPackagesApi: {
    create: (...a: unknown[]) => mockCreatePackage(...a),
    list: jest.fn(async () => ({ data: [] })),
  },
  isLivePackage: jest.requireActual("../../../../api/packagesApi")
    .isLivePackage,
}));

import {
  advanceWizardTo,
  coachSetupApi,
  toConnectView,
} from "../../../../api/coachSetupApi";
import {
  describeError,
  COACH_SUPPORT_EMAIL,
} from "../../../../lib/coachSetup/errors";
import {
  connectCopy,
  requirementLabels,
} from "../../../../lib/coachSetup/connectCopy";
import FirstPackageForm, {
  parsePriceCents,
  validatePackage,
} from "../FirstPackageForm";
import { qrPath } from "../QrCode";
import GetPaidPanel from "../GetPaidPanel";
import { buildChecklist } from "../CoachSetupChecklist";
import { resumeRoute } from "../../../../navigation/CoachWizardNavigator";

function httpError(
  status: number,
  data?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data, headers: headers ?? {} },
  });
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockCapture.mockReset();
  mockOpenAuth.mockReset();
  mockCreatePackage.mockReset();
});

describe("toConnectView", () => {
  it("uses the server state and requirement buckets when present", () => {
    const v = toConnectView({
      account_id: "acct_1",
      charges_enabled: false,
      payouts_enabled: false,
      state: "restricted",
      details_submitted: true,
      action_required: true,
      requirements: {
        currently_due: ["external_account"],
        past_due: ["individual.verification.document"],
        current_deadline: "2026-10-20T00:00:00.000Z",
      },
    });
    expect(v).toMatchObject({
      state: "restricted",
      actionRequired: true,
      currentlyDue: ["external_account"],
      pastDue: ["individual.verification.document"],
      deadline: "2026-10-20T00:00:00.000Z",
    });
  });

  it("derives a state from an older backend payload", () => {
    expect(toConnectView({ account_id: null }).state).toBe("not_started");
    expect(
      toConnectView({
        account_id: "a",
        charges_enabled: true,
        payouts_enabled: true,
      }).state,
    ).toBe("active");
    expect(
      toConnectView({ account_id: "a", requirements_due: ["external_account"] })
        .state,
    ).toBe("details_needed");
    expect(toConnectView({ account_id: "a" }).state).toBe(
      "pending_verification",
    );
    expect(toConnectView({ account_id: "a", state: "made_up" }).state).toBe(
      "pending_verification",
    );
  });
});

describe("coachSetupApi", () => {
  it("refresh falls back to GET status on an older backend", async () => {
    mockPost.mockRejectedValueOnce(httpError(404));
    mockGet.mockResolvedValueOnce({
      data: { account_id: "a", charges_enabled: true, payouts_enabled: true },
    });
    const v = await coachSetupApi.refreshConnectStatus();
    expect(mockPost).toHaveBeenCalledWith("/coach/connect/status/refresh");
    expect(mockGet).toHaveBeenCalledWith("/coach/connect/status");
    expect(v.state).toBe("active");
    expect(v.refreshed).toBe(false);
  });

  it("advanceWizardTo walks forward one step at a time and sends data once", async () => {
    let current = 2;
    mockGet.mockResolvedValue({
      data: { current_step: 2, is_complete: false },
    });
    mockPost.mockImplementation(async (url: string) => {
      const n = Number(url.split("/").pop());
      current = n;
      return { data: { current_step: current, is_complete: false } };
    });
    await advanceWizardTo(4, { invite_shared: true });
    expect(mockPost.mock.calls).toEqual([
      ["/coach/onboarding/steps/3", {}],
      ["/coach/onboarding/steps/4", { data: { invite_shared: true } }],
    ]);
  });

  it("advanceWizardTo starts the wizard when the server has no row yet", async () => {
    mockGet.mockRejectedValueOnce(httpError(404));
    mockPost.mockImplementation(async (url: string) => {
      if (url === "/coach/onboarding/start")
        return { data: { current_step: 1 } };
      return { data: { current_step: Number(url.split("/").pop()) } };
    });
    await advanceWizardTo(1, { practice_name: "North" });
    expect(mockPost.mock.calls).toEqual([
      ["/coach/onboarding/start"],
      ["/coach/onboarding/steps/1", { data: { practice_name: "North" } }],
    ]);
  });
});

describe("describeError", () => {
  it("maps known codes to specific copy and never says something went wrong", () => {
    const cases = [
      describeError(
        httpError(503, { error: "CONNECT_NOT_CONFIGURED" }),
        "open Stripe",
      ),
      describeError(
        httpError(502, {
          error: "STRIPE_CONNECT_ERROR",
          stripeCode: "configuration_missing",
        }),
        "open Stripe",
      ),
      describeError(
        httpError(409, { error: "CONNECT_ONBOARDING_INCOMPLETE" }),
        "open payout settings",
      ),
      describeError(httpError(429), "open Stripe"),
      describeError(httpError(401), "open Stripe"),
      describeError(
        httpError(400, {
          code: "PACKAGE_PRICE_BELOW_MINIMUM",
          message: "Paid packages start at $19.99, or make it free.",
        }),
        "create your package",
      ),
      describeError(
        Object.assign(new Error("Network Error"), { request: {} }),
        "open Stripe",
      ),
    ];
    expect(cases.map((c) => c.title)).toEqual([
      "Payouts are not switched on for your account yet",
      "Payouts are not switched on for your account yet",
      "Finish Stripe setup first",
      "Too many tries in a row",
      "Your session ended",
      "Check the package details",
      "You appear to be offline",
    ]);
    expect(cases[5].body).toBe(
      "Paid packages start at $19.99, or make it free.",
    );
    for (const c of cases) {
      expect(`${c.title} ${c.body}`).not.toMatch(/something went wrong|!/i);
    }
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("unknown failures show the request reference and support path, and go to Sentry", () => {
    const e = describeError(
      httpError(500, { request_id: "req_123" }),
      "load your payout setup",
    );
    expect(e.requestId).toBe("req_123");
    expect(e.body).toContain("req_123");
    expect(e.body).toContain(COACH_SUPPORT_EMAIL);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    const u = describeError(
      httpError(418, {}, { "x-request-id": "req_9" }),
      "save this step",
    );
    expect(u.title).toBe("We could not save this step");
    expect(u.body).toContain("req_9");
  });
});

describe("connectCopy", () => {
  it("lists what Stripe needs in plain words with the deadline", () => {
    expect(
      requirementLabels([
        "external_account",
        "individual.verification.document",
        "individual.dob.day",
        "individual.dob.month",
        "something.new",
      ]),
    ).toEqual([
      "Bank account for payouts",
      "Photo ID",
      "Date of birth",
      "Other details Stripe asks for",
    ]);
    const copy = connectCopy(
      toConnectView({
        account_id: "a",
        state: "restricted",
        requirements: {
          currently_due: ["external_account"],
          current_deadline: "2026-10-20T12:00:00.000Z",
        },
      }),
    );
    expect(copy.action).toBe("Update details with Stripe");
    expect(copy.due).toEqual(["Bank account for payouts"]);
    expect(copy.body).toMatch(/2026/);
  });

  it("has no exclamation marks in any state", () => {
    for (const state of [
      "not_started",
      "details_needed",
      "pending_verification",
      "restricted",
      "active",
      "deauthorized",
    ]) {
      const c = connectCopy(toConnectView({ account_id: "a", state }));
      expect(`${c.title} ${c.body} ${c.action ?? ""}`).not.toMatch(/!/);
    }
  });
});

describe("first package", () => {
  it("parses prices and enforces the $19.99 floor or free", () => {
    expect(parsePriceCents("$49")).toBe(4900);
    expect(parsePriceCents("19.9")).toBe(1990);
    expect(parsePriceCents("1,000.05")).toBe(100005);
    expect(parsePriceCents("abc")).toBeNull();
    expect(
      validatePackage({ title: "A", free: false, priceText: "19.98" }),
    ).toBe("Paid packages start at $19.99, or make it free.");
    expect(
      validatePackage({ title: "A", free: false, priceText: "19.99" }),
    ).toBeNull();
    expect(
      validatePackage({ title: "A", free: true, priceText: "" }),
    ).toBeNull();
    expect(validatePackage({ title: " ", free: true, priceText: "" })).toMatch(
      /name/,
    );
  });

  it("a free package is created one-time at $0, published, and attached to the invite link", async () => {
    mockCreatePackage.mockResolvedValue({
      data: { id: "pkg_1", title: "North coaching" },
    });
    mockPost.mockResolvedValue({ data: {} });
    mockGet.mockResolvedValue({
      data: {
        code: "GP-ABC",
        url: "https://app.trygrowthproject.com/join/GP-ABC",
      },
    });
    mockPut.mockResolvedValue({ data: {} });
    const onCreated = jest.fn();
    const { getByTestId } = await render(
      <FirstPackageForm
        defaultTitle="North coaching"
        chargesEnabled={false}
        onCreated={onCreated}
      />,
    );
    await fireEvent.press(getByTestId("first-package-free"));
    await fireEvent.press(getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mockCreatePackage.mock.calls[0][0]).toMatchObject({
      priceCents: 0,
      billingInterval: "one_time",
    });
    expect(typeof mockCreatePackage.mock.calls[0][1]).toBe("string");
    expect(mockPost).toHaveBeenCalledWith("/v1/coach/packages/pkg_1/publish");
    expect(mockPut).toHaveBeenCalledWith(
      "/v1/invite-codes/GP-ABC/package-binding",
      {
        package_id: "pkg_1",
        grant_mode: "free",
      },
    );
    expect(onCreated.mock.calls[0][0]).toMatchObject({
      id: "pkg_1",
      freeOnJoin: true,
    });
  });

  it("a paid package below the floor is stopped before any request", async () => {
    const { getByTestId, findByTestId } = await render(
      <FirstPackageForm
        defaultTitle="North coaching"
        chargesEnabled
        onCreated={jest.fn()}
      />,
    );
    await fireEvent.changeText(getByTestId("first-package-price"), "10");
    await fireEvent.press(getByTestId("first-package-create"));
    expect((await findByTestId("first-package-invalid")).props.children).toBe(
      "Paid packages start at $19.99, or make it free.",
    );
    expect(mockCreatePackage).not.toHaveBeenCalled();
  });
});

describe("QR code", () => {
  it("encodes the invite link into a square module grid", () => {
    const { path, modules } = qrPath(
      "https://app.trygrowthproject.com/join/GP-ABC123",
    );
    expect(modules).toBeGreaterThanOrEqual(21 + 8);
    expect(path.length).toBeGreaterThan(100);
    expect(path.startsWith("M")).toBe(true);
  });
});

describe("GetPaidPanel", () => {
  it("opens Stripe, re-mints an expired link once, then shows the fresh state", async () => {
    mockGet.mockResolvedValueOnce({ data: { account_id: null } });
    mockPost.mockImplementation(async (url: string) => {
      if (url === "/coach/connect/onboarding-link") {
        return {
          data: {
            url: "https://connect.stripe.com/setup/e/acct_1/abc",
            expires_at: null,
          },
        };
      }
      if (url === "/coach/connect/status/refresh") {
        return {
          data: {
            account_id: "acct_1",
            state: "pending_verification",
            details_submitted: true,
            refreshed: true,
          },
        };
      }
      throw httpError(404);
    });
    mockOpenAuth
      .mockResolvedValueOnce({
        type: "success",
        url: "tgp://connect/onboarding/refresh",
      })
      .mockResolvedValueOnce({
        type: "success",
        url: "tgp://connect/onboarding/return",
      });
    const { findByText, getByTestId } = await render(<GetPaidPanel />);
    await findByText("Get paid with Stripe");
    await fireEvent.press(getByTestId("get-paid-open"));
    await findByText("Stripe is checking your details");
    expect(mockOpenAuth).toHaveBeenCalledTimes(2);
    expect(mockOpenAuth.mock.calls[0][1]).toBe("tgp://connect/onboarding");
    expect(
      mockPost.mock.calls.filter(
        (c) => c[0] === "/coach/connect/onboarding-link",
      ),
    ).toHaveLength(2);
  });

  it("shows specific copy when payouts are not configured on the server", async () => {
    mockGet.mockResolvedValueOnce({ data: { account_id: null } });
    mockPost.mockRejectedValueOnce(
      httpError(503, { error: "CONNECT_NOT_CONFIGURED" }),
    );
    const { findByText, getByTestId } = await render(<GetPaidPanel />);
    await findByText("Get paid with Stripe");
    await fireEvent.press(getByTestId("get-paid-open"));
    await findByText("Payouts are not switched on for your account yet");
    expect(mockOpenAuth).not.toHaveBeenCalled();
  });
});

describe("Home checklist and resume", () => {
  it("builds four items in order with truthful done flags", () => {
    const items = buildChecklist({
      connectActive: false,
      connectNeedsAttention: true,
      hasPackage: true,
      hasClient: false,
      sharedLink: false,
      paid: false,
    });
    expect(items.map((i) => [i.key, i.done])).toEqual([
      ["get_paid", false],
      ["package", true],
      ["invite", false],
      ["money", false],
    ]);
    expect(items[0].detail).toBe("Stripe needs a few more details from you.");
  });

  it("resumes the wizard on the step the server has", () => {
    expect(resumeRoute(1)).toBe("CoachWizardStep1");
    expect(resumeRoute(3)).toBe("CoachWizardStep3");
    expect(resumeRoute(6)).toBe("CoachWizardStep5");
  });
});
