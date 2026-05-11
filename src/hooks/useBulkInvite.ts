/**
 * useBulkInvite — React Query mutations over bulkInviteApi.
 *
 * Two mutations:
 *   parse  — pure paste-area tokeniser. No DB writes. Throttled but
 *            forgiving. Safe to call on debounced input changes.
 *   submit — persists invite codes and emails them. Throttled 5/min
 *            per coach by the backend. One bad row rejects the whole
 *            batch with a 400; callers MUST pre-validate via
 *            filterValidRows(rows) from bulkInviteApi before invoking.
 *
 * No query keys — neither call has a cached read counterpart in v1.
 */

import { useMutation } from '@tanstack/react-query';
import {
  bulkInviteApi,
  type BulkInviteParseResult,
  type BulkInviteRow,
  type BulkInviteSubmitResult,
} from '../api/bulkInviteApi';

export function useBulkInviteParse() {
  return useMutation<BulkInviteParseResult, Error, string>({
    mutationFn: (input) => bulkInviteApi.parse(input).then((r) => r.data),
  });
}

export function useBulkInviteSubmit() {
  return useMutation<BulkInviteSubmitResult, Error, BulkInviteRow[]>({
    mutationFn: (rows) => bulkInviteApi.submit(rows).then((r) => r.data),
  });
}
