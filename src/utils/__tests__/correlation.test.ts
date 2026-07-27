/**
 * Request correlation (M5-D).
 *
 * A support reference is only worth showing if the backend can find it, so the
 * two properties that matter are: the outbound id is a real, unlinkable UUID
 * that leaks nothing, and the inbound extractor returns the SERVER's id or
 * nothing at all — never a locally-invented value that support would chase.
 */
import {
  REQUEST_ID_HEADER,
  extractRequestId,
  newRequestId,
} from '../correlation';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newRequestId', () => {
  it('is a v4 UUID', () => {
    expect(newRequestId()).toMatch(UUID_V4);
  });

  it('is unlinkable across requests', () => {
    const ids = new Set(Array.from({ length: 200 }, newRequestId));
    expect(ids.size).toBe(200);
  });
});

describe('REQUEST_ID_HEADER', () => {
  it('is the conventional X-Request-Id spelling', () => {
    expect(REQUEST_ID_HEADER).toBe('X-Request-Id');
  });
});

describe('extractRequestId', () => {
  it('prefers the typed request_id on the error envelope', () => {
    expect(
      extractRequestId({
        response: {
          data: { statusCode: 500, error: 'x', message: 'y', request_id: 'req-abc' },
          headers: { 'x-request-id': 'header-xyz' },
        },
      }),
    ).toBe('req-abc');
  });

  it('falls back to the response header when the body has none', () => {
    expect(
      extractRequestId({ response: { data: {}, headers: { 'x-request-id': 'header-xyz' } } }),
    ).toBe('header-xyz');
  });

  it('matches the header case-insensitively', () => {
    expect(
      extractRequestId({ response: { data: {}, headers: { 'X-Request-Id': 'mixed-case' } } }),
    ).toBe('mixed-case');
  });

  it.each<[string, unknown]>([
    ['a plain Error', new Error('network down')],
    ['null', null],
    ['a string', 'boom'],
    ['an error with no response', { message: 'boom' }],
    ['a response with no data or headers', { response: {} }],
    ['a non-string request_id', { response: { data: { request_id: 42 } } }],
    ['an empty request_id', { response: { data: { request_id: '' } } }],
    ['an empty header', { response: { data: {}, headers: { 'x-request-id': '' } } }],
    ['a string body (HTML error page)', { response: { data: '<html>502</html>' } }],
  ])('returns null for %s rather than inventing a reference', (_label, err) => {
    expect(extractRequestId(err)).toBeNull();
  });
});
