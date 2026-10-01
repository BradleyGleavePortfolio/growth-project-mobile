/**
 * Should the client be shown the UNSOLICITED PackageSelectionSheet (Day1Win
 * or the 24h `package_prompt` re-surface)?
 *
 *  - Only when the server explicitly says the entitlement is inactive
 *    (`{ ok: true, data: { active: false } }` and `entitlement_active` is not
 *    true). Clinic clients get a comp entitlement from their invite code
 *    (C01), so they are active and must never be asked to buy.
 *  - Fix round #304 (Sol B1): fail CLOSED. A rejected lookup, `{ok:false}`,
 *    or a response without an explicit `active: false` (`{}`, `null`,
 *    `active: undefined`) suppresses the prompt. A transient entitlement
 *    failure must never show a comp client an automatic package offer.
 *    This only suppresses the unsolicited prompt; the client can still open
 *    the 1:1 coaching screen deliberately from More.
 *  - 1:1 coach packages are person-to-person services (Guideline
 *    3.1.3(d), Stripe), so iOS is NOT special-cased here.
 */
import { clientPaymentsApi } from '../api/clientPaymentsApi';

export async function shouldOfferPackagePrompt(): Promise<boolean> {
  try {
    const res = await clientPaymentsApi.getEntitlement();
    if (!res || !res.ok) return false;
    const data = res.data as { active?: unknown; entitlement_active?: unknown } | null | undefined;
    if (!data || typeof data !== 'object') return false;
    if (data.entitlement_active === true) return false;
    return data.active === false;
  } catch {
    return false;
  }
}
