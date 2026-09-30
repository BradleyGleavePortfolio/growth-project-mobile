/**
 * Should the client be shown the PackageSelectionSheet (Day1Win or the
 * 24h `package_prompt` re-surface)?
 *
 *  - Never when the server says the entitlement is already active. Clinic
 *    clients get a comp entitlement from their invite code (C01), so they
 *    are active and must never be asked to buy.
 *  - 1:1 coach packages are person-to-person services (Guideline
 *    3.1.3(d), Stripe), so iOS is NOT special-cased here.
 *  - Otherwise, preserve the previous behaviour (the caller still applies
 *    its own 24h / has-packages gates). An entitlement lookup failure falls
 *    back to the previous behaviour rather than hiding the prompt forever.
 */
import { clientPaymentsApi } from '../api/clientPaymentsApi';

export async function shouldOfferPackagePrompt(): Promise<boolean> {
  try {
    const res = await clientPaymentsApi.getEntitlement();
    if (res.ok && res.data?.active === true) return false;
  } catch {
    // fall through: keep legacy behaviour
  }
  return true;
}
