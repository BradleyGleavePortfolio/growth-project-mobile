import { KNOWN_GAPS, REGISTRY } from '../../test/savedKeyLifetimes/savedKeyRegistry';

describe('LS-910 B1 registry matches mobile main 5507233f', () => {
  it.each([
    ['async', 'roman.ed3.first-payment-seen.{uid}', 'MARK'],
    ['async', 'gp_notif_category_prefs', 'ACCOUNT'],
  ])('registers current main %s %s as %s', (store, key, lifetime) => {
    expect(REGISTRY.find((row) => row[0] === store && row[1] === key)?.[2]).toBe(lifetime);
  });

  it.each([
    ['prefs', 'roman.ed3.first-payment-seen.{uid}', 'signout'],
    ['async', 'roman_join_offer:{uid}', 'deletion'],
  ])('removes the closed current-main gap %s %s %s', (store, key, rule) => {
    expect(KNOWN_GAPS.filter((row) => row[0] === store && row[1] === key && row[2] === rule)).toEqual([]);
  });
});
