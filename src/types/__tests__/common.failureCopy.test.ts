import { errorMessage } from '../common';

describe('shared API failure copy', () => {
  it.each([500, 502, 503, 504])('describes HTTP %s without exposing generic server text', (status) => {
    expect(errorMessage({
      message: `Request failed with status code ${status}`,
      response: { status, data: { message: 'Internal Server Error' } },
    }, 'Could not load food.')).toBe(
      'The service is temporarily unavailable. Try again in a moment.',
    );
  });

  it('does not show a gateway HTML body to the person', () => {
    expect(errorMessage({
      response: { status: 502, data: '<html>Bad Gateway</html>' },
    })).toBe('The service is temporarily unavailable. Try again in a moment.');
  });

  it('explains a network failure', () => {
    expect(errorMessage({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(
      'The service could not be reached. Check your connection and try again.',
    );
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])('explains timeout code %s', (code) => {
    expect(errorMessage({ code, message: 'timeout of 30000ms exceeded' })).toBe(
      'The request timed out. Check your connection and try again.',
    );
  });

  it('keeps a specific validation or permission response', () => {
    expect(errorMessage({
      response: { status: 400, data: { message: 'Choose a serving unit.' } },
    })).toBe('Choose a serving unit.');
    expect(errorMessage({
      response: { status: 403, data: { message: 'Your coach must approve this change.' } },
    })).toBe('Your coach must approve this change.');
  });

  it('keeps the callers specific fallback and local error details', () => {
    expect(errorMessage(null, 'The entry could not be loaded.')).toBe('The entry could not be loaded.');
    expect(errorMessage(new Error('The saved routine has no exercises.'))).toBe(
      'The saved routine has no exercises.',
    );
  });

  it('has an actionable default when no detail is available', () => {
    expect(errorMessage(null)).toBe('The request could not be completed. Try again in a moment.');
  });
});
