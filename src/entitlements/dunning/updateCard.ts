import * as WebBrowser from 'expo-web-browser';
import { captureError } from '../../services/sentry';
import { assertStripeUrl } from '../../utils/stripeUrlValidator';
import { dunningApi } from './dunningApi';
import { describeDunningError, type DunningErrorCopy } from './dunningErrorCopy';

/** The billing portal's return_url scheme (backend STRIPE_BILLING_PORTAL_RETURN_URL). */
export const PORTAL_RETURN_PREFIX = 'com.growthproject.app://';

/**
 * Open the Stripe Billing Portal so the client can replace the card and pay
 * the open invoice (S-DUNNING). Same path as CoachBillingScreen: mint on the
 * backend, refuse any non-Stripe URL, open an in-app auth session that closes
 * on the portal's return redirect (or when the client taps Done).
 *
 * Resolves `null` once the sheet closes (the caller refreshes status), or a
 * specific error copy. Unexpected failures are reported to Sentry here.
 */
export async function openUpdateCard(surface: string): Promise<DunningErrorCopy | null> {
  try {
    const url = await dunningApi.createPortalUrl();
    assertStripeUrl(url, `${surface}.portal`);
    await WebBrowser.openAuthSessionAsync(url, PORTAL_RETURN_PREFIX);
    return null;
  } catch (err) {
    const copy = describeDunningError(err, 'update_card');
    if (copy.report) {
      captureError(err, {
        surface,
        dunning_error_code: copy.code,
        request_id: copy.reference,
      });
    }
    return copy;
  }
}
