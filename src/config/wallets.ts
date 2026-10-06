/**
 * Apple Pay and Google Pay inside the native PaymentSheet (OR-113-2).
 *
 * Off by config: a wallet is offered only when its configuration exists, so a
 * build without an Apple merchant ID never shows a dead Apple Pay button and
 * never errors. PaymentSheet itself hides the wallet button when the device
 * has no wallet set up.
 *
 *   EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER  Apple merchant ID (merchant.*).
 *       Unset -> no Apple Pay. The same value must reach the
 *       @stripe/stripe-react-native config plugin (app.config.js) so the
 *       iOS entitlement is in the binary.
 *   EXPO_PUBLIC_GOOGLE_PAY_ENABLED          '1' or 'true' -> Google Pay on
 *       Android (app.config.js also enables the wallet meta-data).
 *   EXPO_PUBLIC_STRIPE_MERCHANT_COUNTRY     two-letter country of the Stripe
 *       platform account, default 'US'.
 *
 * Reads are literal process.env.EXPO_PUBLIC_* member expressions so
 * babel-preset-expo inlines them in release bundles.
 */
import { Platform } from "react-native";

export interface WalletConfig {
  /** For initStripe(); undefined when Apple Pay is off. */
  merchantIdentifier?: string;
  /** For initPaymentSheet({ applePay }); undefined when off. */
  applePay?: { merchantCountryCode: string };
  /** For initPaymentSheet({ googlePay }); undefined when off. */
  googlePay?: {
    merchantCountryCode: string;
    currencyCode: string;
    testEnv: boolean;
  };
}

const MERCHANT_ID_RE = /^merchant\.[A-Za-z0-9.-]+$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

export function resolveWalletConfig(opts: {
  currency: string;
  publishableKey: string;
  os?: string;
}): WalletConfig {
  const os = opts.os ?? Platform.OS;
  const merchantId = (
    process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ?? ""
  ).trim();
  const googleFlag = (process.env.EXPO_PUBLIC_GOOGLE_PAY_ENABLED ?? "")
    .trim()
    .toLowerCase();
  const countryRaw = (process.env.EXPO_PUBLIC_STRIPE_MERCHANT_COUNTRY ?? "")
    .trim()
    .toUpperCase();
  const merchantCountryCode = COUNTRY_RE.test(countryRaw) ? countryRaw : "US";

  const out: WalletConfig = {};
  if (os === "ios" && MERCHANT_ID_RE.test(merchantId)) {
    out.merchantIdentifier = merchantId;
    out.applePay = { merchantCountryCode };
  }
  if (os === "android" && (googleFlag === "1" || googleFlag === "true")) {
    out.googlePay = {
      merchantCountryCode,
      currencyCode: (opts.currency || "usd").toUpperCase(),
      // A test-mode key must use the Google Pay test environment.
      testEnv: opts.publishableKey.startsWith("pk_test_"),
    };
  }
  return out;
}
