/**
 * B-TEST (lens LO-910R2, m#910 review round 2, B2): the saved-key scan reads the app's own entry file. App.tsx
 * (registered by index.ts) is app code that runs on every phone and already reads a saved key
 * (App.tsx:146 and :176, secureStorage.getItem('supabase_token')), but scanSavedKeys() lists files under src/
 * only (test/savedKeyLifetimes/scanSavedKeys.ts:816). A mark, draft or queue a builder saves in App.tsx is
 * never registered and never checked. At 7151e75a the scan reports no site in App.tsx.
 */
import { scanSavedKeys } from '../../test/savedKeyLifetimes/scanSavedKeys';

it("B-TEST LO-910R2 B2: the scan reads App.tsx, the app's entry file", () => {
  const sites = scanSavedKeys().sites.filter((s) => s.file === 'App.tsx');
  expect(sites).toEqual(expect.arrayContaining([
    expect.objectContaining({ file: 'App.tsx', store: 'secure-store', key: 'supabase_token' }),
  ]));
});
