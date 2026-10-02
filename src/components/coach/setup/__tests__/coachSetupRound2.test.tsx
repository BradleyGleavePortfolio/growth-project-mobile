/**
 * S-COACH-MOB-2 — fix round for mobile #329 (AUD-OPUS-4). Each test failed
 * on 4071d0ce:
 *   A-329-1  the Home checklist never opens the retired Earnings screen
 *   B-329-1  a retry after a partial failure never creates a second package
 *   B-329-2  "payouts not configured" copy is truthful with a working action
 *   C-329-1  a draft or archived package is not "live"
 *   C-329-2  the invite tick comes from the server (a client joined)
 *   C-329-3  the wizard's last step reads Stripe from the server on resume
 *   C-329-4  checklist load failures show specific copy with a retry
 */
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";

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

jest.mock("../../../../services/sentry", () => ({
  captureError: jest.fn(),
}));

jest.mock("expo-web-browser", () => ({
  __esModule: true,
  openAuthSessionAsync: jest.fn(),
}));

const mockCreate = jest.fn();
const mockList = jest.fn();
const mockUpdate = jest.fn();
jest.mock("../../../../api/packagesApi", () => ({
  coachPackagesApi: {
    create: (...a: unknown[]) => mockCreate(...a),
    list: (...a: unknown[]) => mockList(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
  },
  isLivePackage: jest.requireActual("../../../../api/packagesApi")
    .isLivePackage,
}));

const mockShared = jest.fn();
jest.mock("../../../../storage/mmkv", () => ({
  prefsStorage: {
    getStringAsync: (...a: unknown[]) => mockShared(...a),
    set: jest.fn(async () => undefined),
  },
}));

jest.mock("../../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ id: "coach_1", email: "c@example.com" }),
}));

jest.mock("../../../../screens/coach/ed/firstPaymentGate", () => ({
  hasSeenFirstPayment: jest.fn(async () => false),
}));

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate }),
    useFocusEffect: (cb: () => void) => {
      const R = jest.requireActual("react");
      R.useEffect(cb, [cb]);
    },
  };
});

import { isLivePackage, type CoachPackage } from "../../../../api/packagesApi";
import { describeError } from "../../../../lib/coachSetup/errors";
import { loadSetupStatus } from "../../../../lib/coachSetup/setupStatus";
import FirstPackageForm from "../FirstPackageForm";
import CoachSetupChecklist, { buildChecklist } from "../CoachSetupChecklist";
import CoachHomeCards from "../../../../screens/coach/command-center/CoachHomeCards";
import CoachWizardNavigator from "../../../../navigation/CoachWizardNavigator";

function httpError(status: number, data?: Record<string, unknown>) {
  return Object.assign(new Error(`HTTP ${status}`), {
    response: { status, data: data ?? {}, headers: {} },
  });
}
const offline = () =>
  Object.assign(new Error("timeout of 15000ms exceeded"), {
    code: "ECONNABORTED",
    request: {},
  });

function pkg(over: Partial<CoachPackage> = {}): CoachPackage {
  return {
    id: "pkg_1",
    coachUserId: "coach_1",
    title: "North coaching",
    description: null,
    priceCents: 4900,
    currency: "usd",
    billingInterval: "monthly",
    intervalCount: 1,
    trialDays: 0,
    features: [],
    status: "active",
    shareToken: null,
    subscriberCount: 0,
    monthlyRevenueCents: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    publishedAt: null,
    ...over,
  };
}

/** Route GETs by URL so every loader sees its own answer. */
function routeGets(map: Record<string, () => unknown>) {
  mockGet.mockImplementation(async (url: string) => {
    const h = map[url];
    if (!h) throw httpError(404);
    return { data: h() };
  });
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockPut.mockReset();
  mockCreate.mockReset();
  mockList.mockReset();
  mockUpdate.mockReset();
  mockShared.mockReset();
  mockNavigate.mockReset();
  mockShared.mockResolvedValue(null);
});

describe("B-329-1 first package retry never duplicates", () => {
  const renderForm = async (onCreated = jest.fn()) => {
    const r = await render(
      <FirstPackageForm
        defaultTitle="North coaching"
        chargesEnabled
        onCreated={onCreated}
      />,
    );
    return { ...r, onCreated };
  };

  it("publish fails once: the retry resumes and calls create 0 more times", async () => {
    mockList.mockResolvedValue({ data: [] });
    mockCreate.mockResolvedValue({ data: pkg() });
    mockPost
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue({ data: {} });
    const { getByTestId, findByTestId, onCreated } = await renderForm();
    await fireEvent.press(getByTestId("first-package-create"));
    await findByTestId("first-package-error");
    await fireEvent.press(getByTestId("first-package-error-retry"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(
      mockPost.mock.calls.filter(
        (c) => c[0] === "/v1/coach/packages/pkg_1/publish",
      ),
    ).toHaveLength(2);
  });

  it("create times out after the server committed it: the retry adopts the package", async () => {
    mockList
      .mockResolvedValueOnce({ data: [pkg({ id: "old", title: "Old" })] })
      .mockResolvedValueOnce({
        data: [pkg({ id: "old", title: "Old" }), pkg({ id: "pkg_new" })],
      });
    mockCreate.mockRejectedValueOnce(offline());
    mockPost.mockResolvedValue({ data: {} });
    const { getByTestId, findByTestId, onCreated } = await renderForm();
    await fireEvent.press(getByTestId("first-package-create"));
    await findByTestId("first-package-error");
    await fireEvent.press(getByTestId("first-package-error-retry"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith("/v1/coach/packages/pkg_new/publish");
    expect(onCreated.mock.calls[0][0].id).toBe("pkg_new");
  });

  it("create timed out and nothing was committed: the retry creates once with the same key", async () => {
    mockList.mockResolvedValue({ data: [] });
    mockCreate
      .mockRejectedValueOnce(offline())
      .mockResolvedValueOnce({ data: pkg() });
    mockPost.mockResolvedValue({ data: {} });
    const { getByTestId, findByTestId, onCreated } = await renderForm();
    await fireEvent.press(getByTestId("first-package-create"));
    await findByTestId("first-package-error");
    await fireEvent.press(getByTestId("first-package-error-retry"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1]).toBe(mockCreate.mock.calls[0][1]);
  });

  it("a definitive 400 from create rotates the key for the next send", async () => {
    mockList.mockResolvedValue({ data: [] });
    mockCreate
      .mockRejectedValueOnce(
        httpError(400, { code: "PACKAGE_INVALID", message: "Name too long." }),
      )
      .mockResolvedValueOnce({ data: pkg() });
    mockPost.mockResolvedValue({ data: {} });
    const { getByTestId, findByTestId, onCreated } = await renderForm();
    await fireEvent.press(getByTestId("first-package-create"));
    await findByTestId("first-package-error");
    await fireEvent.press(getByTestId("first-package-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][1]).not.toBe(mockCreate.mock.calls[0][1]);
  });
});

describe("B-329-2 payouts not configured", () => {
  it("names the real state and a working next step, never the app version or a missing page", () => {
    for (const e of [
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
    ]) {
      expect(e.title).toBe("Payouts are not switched on for your account yet");
      expect(e.body).toMatch(/Home checklist/);
      expect(e.body).toMatch(/Bradleyapple1031@gmail\.com/);
      expect(e.body).not.toMatch(/version|Money|!/);
    }
    const withRef = describeError(
      httpError(503, { error: "CONNECT_NOT_CONFIGURED", request_id: "req_7" }),
      "open Stripe",
    );
    expect(withRef.body).toContain("req_7");
  });
});

describe("C-329-1 live packages only", () => {
  it("a draft or archived package is not live", () => {
    expect(isLivePackage(pkg({ publishedAt: null }))).toBe(false);
    expect(
      isLivePackage(
        pkg({
          publishedAt: "2026-10-01T00:00:00Z",
          status: "archived",
        }),
      ),
    ).toBe(false);
    expect(isLivePackage(pkg({ publishedAt: "2026-10-01T00:00:00Z" }))).toBe(
      true,
    );
  });
});

describe("C-329-2 / C-329-4 checklist from server data", () => {
  it("the invite tick needs a client on the server; a shared link is only a hint", async () => {
    mockShared.mockResolvedValue("true");
    mockList.mockResolvedValue({ data: [pkg({ publishedAt: null })] });
    routeGets({
      "/coach/connect/status": () => ({ account_id: null }),
      "/coach/clients": () => [],
      "/v1/coach/money/charges": () => ({ charges: [], next_cursor: null }),
    });
    const s = await loadSetupStatus("coach_1");
    expect(s.hasClient).toBe(false);
    expect(s.livePackageTitle).toBe("");
    expect(s.errors).toEqual([]);
    const items = buildChecklist({
      connectActive: false,
      connectNeedsAttention: false,
      hasPackage: false,
      hasClient: s.hasClient,
      sharedLink: s.sharedLink,
      paid: false,
    });
    expect(items[2]).toMatchObject({
      done: false,
      detail: "You shared your link. This ticks when your first client joins.",
    });
    expect(mockGet).toHaveBeenCalledWith("/coach/clients", {
      params: { status: "all", take: 1 },
    });
  });

  it("a failed read shows specific copy with a retry that reloads", async () => {
    mockList.mockResolvedValue({ data: [] });
    let fail = true;
    mockGet.mockImplementation(async (url: string) => {
      if (url === "/coach/connect/status") {
        if (fail) throw offline();
        return {
          data: {
            account_id: "a",
            state: "active",
            charges_enabled: true,
            payouts_enabled: true,
          },
        };
      }
      if (url === "/coach/clients") return { data: [{ id: "c1" }] };
      return { data: { charges: [] } };
    });
    const { findByTestId, findByText, getByTestId, queryByTestId } =
      await render(<CoachSetupChecklist onOpen={jest.fn()} />);
    await findByTestId("coach-setup-checklist-error");
    await findByText("You appear to be offline");
    await findByText("We could not check this just now.");
    fail = false;
    await fireEvent.press(getByTestId("coach-setup-checklist-error-retry"));
    await findByText("Stripe is ready to pay you.");
    expect(queryByTestId("coach-setup-checklist-error")).toBeNull();
  });
});

describe("A-329-1 checklist never opens the retired Earnings screen", () => {
  it("the first-payment item opens a live screen before and after the payment", async () => {
    mockList.mockResolvedValue({ data: [] });
    routeGets({
      "/coach/connect/status": () => ({ account_id: null }),
      "/coach/clients": () => [],
      "/v1/coach/money/charges": () => ({ charges: [] }),
    });
    const { findByTestId } = await render(<CoachHomeCards />);
    await fireEvent.press(await findByTestId("coach-setup-checklist-money"));
    for (const call of mockNavigate.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/CoachEarnings/);
    }
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("C-329-3 wizard resumes on the last step with server truth", () => {
  it("shows Stripe ready and the live package when resuming on step 5", async () => {
    mockList.mockResolvedValue({
      data: [pkg({ publishedAt: "2026-10-01T00:00:00Z" })],
    });
    routeGets({
      "/coach/onboarding": () => ({
        current_step: 5,
        is_complete: false,
        step_data: { "1": { practice_name: "North" } },
      }),
      "/coach/connect/status": () => ({
        account_id: "acct_1",
        state: "active",
        charges_enabled: true,
        payouts_enabled: true,
      }),
      "/coach/clients": () => [],
      "/v1/coach/money/charges": () => ({ charges: [] }),
    });
    const { findByLabelText } = await render(
      <NavigationContainer>
        <CoachWizardNavigator />
      </NavigationContainer>,
    );
    await findByLabelText("Stripe ready to pay you. Done");
    await findByLabelText("First package live. Done");
    await findByLabelText("First client invited. Still to do");
  });
});
