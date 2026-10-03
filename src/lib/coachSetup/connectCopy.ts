/**
 * S-COACH — what the coach reads about their Stripe payout setup. Built only
 * from the live Connect status (see coachSetupApi.toConnectView).
 */
import type { ConnectState, ConnectView } from "../../api/coachSetupApi";

const LABELS: Array<[RegExp, string]> = [
  [/^external_account/, "Bank account for payouts"],
  [/verification\.(additional_)?document/, "Photo ID"],
  [/(id_number|ssn_last_4)/, "Social Security number"],
  [/\.dob\./, "Date of birth"],
  [/\.address\./, "Home address"],
  [/\.(first_name|last_name)$/, "Legal name"],
  [/\.phone$/, "Phone number"],
  [/\.email$/, "Email address"],
  [
    /^business_profile\.(url|product_description)/,
    "Website or a short description of your coaching",
  ],
  [/^business_profile\.mcc/, "Type of business"],
  [/^business_type/, "Type of business"],
  [/^company\./, "Business details"],
  [/^tos_acceptance/, "Accept Stripe terms"],
  [/^representative|^owners|^directors|^executives/, "Business owner details"],
];

/** Human label for one Stripe requirement key. Exported for tests. */
export function requirementLabel(key: string): string {
  for (const [re, label] of LABELS) if (re.test(key)) return label;
  return "Other details Stripe asks for";
}

/** Distinct labels in a stable order. */
export function requirementLabels(keys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const l = requirementLabel(k);
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

export interface ConnectCopy {
  title: string;
  body: string;
  /** Button label for the main action, or null when there is nothing to do. */
  action: string | null;
  tone: "neutral" | "progress" | "attention" | "done";
  /** Items Stripe needs now (labels), for a list under the body. */
  due: string[];
}

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function connectCopy(view: ConnectView): ConnectCopy {
  const due = requirementLabels([...view.pastDue, ...view.currentlyDue]);
  const deadline = formatDeadline(view.deadline);
  const byState: Record<ConnectState, () => ConnectCopy> = {
    not_started: () => ({
      title: "Get paid with Stripe",
      body:
        "Stripe collects your bank account and ID on a secure page, then sends your earnings to your bank. " +
        "It takes about 5 minutes.",
      action: "Continue with Stripe",
      tone: "neutral",
      due: [],
    }),
    details_needed: () => ({
      title: "Finish your Stripe details",
      body: "You started with Stripe. Finish the remaining details and you can take payments.",
      action: "Continue with Stripe",
      tone: "attention",
      due,
    }),
    // S-COACH-3: each state says exactly what Stripe allows today. Charges
    // and payouts are separate switches at Stripe; the copy never claims
    // one works when Stripe has it off.
    pending_verification: () => ({
      title: "Stripe is checking your details",
      body: view.chargesEnabled
        ? "Clients can pay you now. Stripe sends payouts to your bank once it has finished checking, usually within 2 business days."
        : "This usually takes a few minutes, and can take up to 2 business days. Clients can pay you once Stripe has finished. You can keep setting up while you wait.",
      action: null,
      tone: "progress",
      due: [],
    }),
    restricted: () => {
      const by = deadline ? ` by ${deadline}` : "";
      if (view.chargesEnabled && !view.payoutsEnabled)
        return {
          title: "Stripe has paused your payouts",
          body: `Clients can still pay you. Stripe holds your earnings until you send these${by}.`,
          action: "Update details with Stripe",
          tone: "attention",
          due,
        };
      if (!view.chargesEnabled && view.payoutsEnabled)
        return {
          title: "Stripe has paused new payments",
          body: `Clients cannot pay you until you send these to Stripe${by}. Money you already earned still pays out.`,
          action: "Update details with Stripe",
          tone: "attention",
          due,
        };
      return {
        title: "Stripe needs a little more from you",
        body: `Clients cannot pay you and payouts are paused until you send these to Stripe${by}.`,
        action: "Update details with Stripe",
        tone: "attention",
        due,
      };
    },
    active: () =>
      // B-329-4: an account that can charge today can still owe Stripe
      // details (currently or past due, with a deadline). Keep the truthful
      // "can take payments" state, but surface what is due and the action so
      // the coach fixes it before Stripe pauses payments or payouts.
      view.actionRequired || due.length > 0
        ? {
            title: "Stripe needs an update from you",
            body: deadline
              ? `Clients can pay you now. Send these to Stripe by ${deadline} so payments and payouts keep running.`
              : "Clients can pay you now. Send these to Stripe so payments and payouts keep running.",
            action: "Update details with Stripe",
            tone: "attention",
            due,
          }
        : {
            title: "You are ready to get paid",
            body: view.payoutsEnabled
              ? "Clients can pay you, and Stripe sends your earnings to your bank."
              : "Clients can pay you. Stripe will start payouts once your bank account is confirmed.",
            action: null,
            tone: "done",
            due: [],
          },
    deauthorized: () => ({
      title: "Your Stripe account is disconnected",
      body: "Clients cannot pay you right now. Connect Stripe again to take payments.",
      action: "Connect Stripe again",
      tone: "attention",
      due: [],
    }),
  };
  return byState[view.state]();
}
