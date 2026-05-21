// Hunt P0-aiGuide regression — the hardcoded "Offline reply" keyword matcher
// (src/utils/aiGuide.ts → getAIResponse) is gone. Any consumer expecting it
// would silently fall through to the fail-closed branch in AIGuideScreen.

describe('aiGuide.ts deletion (Hunt P0-aiGuide / R18)', () => {
  it('src/utils/aiGuide is no longer resolvable', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../aiGuide');
    }).toThrow();
  });
});
