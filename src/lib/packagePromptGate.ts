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
 *  - Never on a hidden iOS build (operator 2026-09-30, store package P0).
 *    On iOS a client package may be bought only on the clearly labelled
 *    1:1 coaching screen (ClientPackages, oneToOneCoachingLabel), reached
 *    deliberately from More. The unsolicited sheet ("Choose your plan",
 *    shown after Day-1 and before the app opens) is not that screen, so it
 *    is suppressed and makes no entitlement lookup.
 */
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { nonP2PPurchasesHidden } from '../config/purchaseSurfaces';

export async function shouldOfferPackagePrompt(
  purchasesHidden: boolean = nonP2PPurchasesHidden(),
): Promise<boolean> {
  if (purchasesHidden) return false;
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
