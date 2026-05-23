// Stripe URL allow-list guard.
//
// Every WebBrowser.openBrowserAsync() call against a backend-returned
// payment URL MUST pass through assertStripeUrl() first. If the backend
// is misconfigured, compromised, or the response is tampered with, an
// unguarded openBrowserAsync() would render an attacker-controlled page
// inside a branded checkout sheet — a phishing P0 for a payments app.
//
// Closed allow-list: hostname must be one of STRIPE_ALLOWED_HOSTS (or a
// subdomain of one) AND the scheme must be https.
//
// On rejection: throw a generic STRIPE_URL_REJECTED Error. The caller
// renders a user-safe message; the URL host is logged (host only — never
// the full URL or query string) so triage can confirm the rejection
// without leaking the attacker payload.

const STRIPE_ALLOWED_HOSTS = [
  'checkout.stripe.com',
  'connect.stripe.com',
  'dashboard.stripe.com',
  'billing.stripe.com',
];

export function validateStripeUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    return STRIPE_ALLOWED_HOSTS.some(
      (h) => host === h || host.endsWith('.' + h),
    );
  } catch {
    return false;
  }
}

export function assertStripeUrl(url: string, context: string): void {
  if (!validateStripeUrl(url)) {
    console.error(
      `[stripe-url-guard] Rejected non-Stripe URL in ${context}: host=${tryParseHost(url)}`,
    );
    throw new Error('STRIPE_URL_REJECTED');
  }
}

function tryParseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unparseable';
  }
}
