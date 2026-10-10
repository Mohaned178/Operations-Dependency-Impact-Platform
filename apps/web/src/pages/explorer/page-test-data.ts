import type { SourceRecordListResponse } from '@opsgraph/shared';

export { F1_BLOCKERS } from '../entities/tracing-test-data';

/** One source record, enough for the node panel's evidence section in page tests. */
export const RECORDS_STUB: SourceRecordListResponse = {
  items: [
    {
      id: '12121212-1212-4212-8212-121212121212',
      kind: 'ENTITY',
      sourceSystem: 'OMS',
      sourceId: '18492',
      observedAt: '2026-09-29T11:40:00.000Z',
      receivedAt: '2026-09-29T11:41:00.000Z',
      importId: '99999999-9999-4999-8999-999999999999',
      rawPayload: {},
    },
  ],
  nextCursor: null,
};
