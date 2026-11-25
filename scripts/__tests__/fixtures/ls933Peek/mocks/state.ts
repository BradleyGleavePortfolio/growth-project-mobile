// PEEK-K1-M2 harness: the state the URL names (?st=), read by the stubbed server replies and the stubbed flags.
const q = new URLSearchParams(location.search);
export const ST = q.get('st') ?? 'toreview';
export const PAYMENTS = ST !== 'paymentsoff';
