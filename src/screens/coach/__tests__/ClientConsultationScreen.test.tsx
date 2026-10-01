/**
 * S-REACH — coach view of a client's consultation answers (backend #607
 * GET /coach/clients/:clientId/consultation). Covers the answers view, the
 * two honest 404 states (route not deployed vs no answers on file), the
 * error + retry path, and that the answers never enter the persisted cache.
 */
import React from "react";
import * as fs from "fs";
import * as path from "path";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockGet = jest.fn();
jest.mock("../../../services/api", () => ({
  __esModule: true,
  default: { get: (u: string) => mockGet(u) },
}));
jest.mock("../../../theme/ThemeProvider", () => ({
  useTheme: () => ({ semanticColors: new Proxy({}, { get: () => "#000000" }) }),
}));

import ClientConsultationScreen from "../ClientConsultationScreen";
import {
  fetchClientConsultation,
  isRouteMissing,
} from "../../../api/coachConsultationApi";

const CLIENT = "11111111-1111-4111-8111-111111111111";

function axios404(message: string) {
  return Object.assign(new Error("Request failed with status code 404"), {
    isAxiosError: true,
    response: {
      status: 404,
      data: { statusCode: 404, message, error: "Not Found" },
    },
  });
}

const VIEW = {
  version: "consult-v1",
  revision: 3,
  revision_cause: "complete",
  submitted_at: "2026-10-01T15:00:00.000Z",
  saved_at: "2026-10-01T15:00:00.000Z",
  chapters: [
    {
      key: "body",
      title: "Body basics",
      answers: [
        {
          screen: "B3",
          question: "Your height and weight.",
          answer_label: "5 ft 6 in (168 cm), 172 lb",
        },
      ],
    },
  ],
  screening: {
    any_yes: true,
    items: [
      {
        key: "P1",
        question:
          "Has a doctor said you should only exercise under supervision?",
        answer: "no",
        note: null,
      },
      {
        key: "P2",
        question: "Do you feel chest pain during activity?",
        answer: "yes",
        note: "Only on stairs",
      },
    ],
  },
  consent: {
    version: "consult-consent-v2",
    agreed_at: "2026-10-01T14:00:00.000Z",
  },
};

async function renderScreen() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  await render(
    <QueryClientProvider client={qc}>
      <ClientConsultationScreen
        route={{
          key: "k",
          name: "ClientConsultation",
          params: { clientId: CLIENT, clientName: "Sam Lee" },
        }}
      />
    </QueryClientProvider>,
  );
}

describe("ClientConsultationScreen", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads the #607 coach endpoint and shows the flagged readiness items first, then each chapter", async () => {
    mockGet.mockResolvedValue({ data: VIEW });
    await renderScreen();
    expect(await screen.findByTestId("consultation-answers")).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith(
      `/coach/clients/${CLIENT}/consultation`,
    );
    expect(screen.getByTestId("consultation-screening-flag")).toBeTruthy();
    expect(
      screen.getByText("Do you feel chest pain during activity?"),
    ).toBeTruthy();
    expect(screen.getByText("Only on stairs")).toBeTruthy();
    // A "no" item is not listed as flagged.
    expect(
      screen.queryByText(
        "Has a doctor said you should only exercise under supervision?",
      ),
    ).toBeNull();
    expect(screen.getByText("Body basics")).toBeTruthy();
    expect(screen.getByText("5 ft 6 in (168 cm), 172 lb")).toBeTruthy();
  });

  it("says the view is not on this server yet when the route itself is missing (before #607 deploys)", async () => {
    mockGet.mockRejectedValue(
      axios404(`Cannot GET /api/coach/clients/${CLIENT}/consultation`),
    );
    await renderScreen();
    expect(await screen.findByTestId("consultation-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("consultation-error")).toBeNull();
  });

  it("says no answers are on file for the service 404", async () => {
    mockGet.mockRejectedValue(axios404("Consultation not found"));
    await renderScreen();
    expect(await screen.findByTestId("consultation-none")).toBeTruthy();
  });

  it("offers a retry on any other failure, and a retry that succeeds shows the answers", async () => {
    mockGet.mockRejectedValueOnce(
      Object.assign(new Error("boom"), {
        isAxiosError: true,
        response: { status: 500, data: {} },
      }),
    );
    await renderScreen();
    expect(await screen.findByTestId("consultation-error")).toBeTruthy();
    mockGet.mockResolvedValueOnce({ data: VIEW });
    await fireEvent.press(screen.getByTestId("consultation-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("consultation-answers")).toBeTruthy(),
    );
  });

  it("treats a response that drifts from the contract as an error, not as answers", async () => {
    mockGet.mockResolvedValue({ data: { version: "consult-v1" } });
    await expect(fetchClientConsultation(CLIENT)).rejects.toThrow();
  });

  it("isRouteMissing only matches the Nest router 404", () => {
    expect(isRouteMissing({ message: "Cannot GET /api/x" })).toBe(true);
    expect(isRouteMissing({ message: "Consultation not found" })).toBe(false);
    expect(isRouteMissing(null)).toBe(false);
  });

  it("keeps the answers out of the persisted query cache and uses no exclamation marks in copy", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "ClientConsultationScreen.tsx"),
      "utf8",
    );
    expect(src).toMatch(/meta:\s*\{\s*persist:\s*false\s*\}/);
    const strings = src.match(/>\s*[^<>{}]*[A-Za-z][^<>{}]*\s*</g) ?? [];
    for (const s of strings) expect(s).not.toMatch(/!/);
  });
});
