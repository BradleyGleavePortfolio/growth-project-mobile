// PEEK-K1-M2 harness entry: the REAL ClientPeekSheet (growth-project-mobile#933 head) over a plain backdrop.
// Query: w, h (viewport), t / b (device insets), fs (system text scale), st (state).
import React from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientPeekSheet from 'SRC/screens/coach/lookup/ClientPeekSheet';
import Colors from 'SRC/constants/colors';
import { ST } from './mocks/state';
const q = new URLSearchParams(location.search);
const w = Number(q.get('w') ?? '390'), h = Number(q.get('h') ?? '844');
const top = Number(q.get('t') ?? '47'), bottom = Number(q.get('b') ?? '0');
(globalThis as any).__CFG = { fontScale: Number(q.get('fs') ?? '1') };
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const review = ST === 'toreview' || ST === 'paymentsoff' || ST === 'longname' ? 1 : ST === 'twelve' ? 12 : 0;
// The roster row the coach tapped (RosterClient), as the roster read sends it.
const CLIENT = {
  id: 'c1', firstName: ST === 'longname' ? 'Maximiliana-Jo' : 'Jordan', lastName: ST === 'longname' ? 'Featherstonehaugh' : 'Reyes',
  email: 'jordan@harness.invalid', role: 'client', status: 'active', createdAt: '2026-08-14T16:00:00.000Z',
  activity: ST === 'notshared' || ST === 'nothing' ? { lastActiveOn: null, checkInsToReview: 0 } : { lastActiveOn: '2026-11-04', checkInsToReview: review },
} as never;
function App() {
  return (
    <QueryClientProvider client={qc}>
      <SafeAreaInsetsContext.Provider value={{ top, bottom, left: 0, right: 0 }}>
        <View style={{ width: w, height: h, backgroundColor: '#123326', paddingTop: top + 16, paddingHorizontal: 16 }}>
          <Text style={{ fontFamily: 'CormorantGaramond_400Regular', fontSize: 34, color: '#F5EFE4', opacity: 0.25 }}>Clients</Text>
          <ClientPeekSheet client={CLIENT} onClose={() => undefined} onOpen={() => undefined} onNudge={() => undefined} />
        </View>
      </SafeAreaInsetsContext.Provider>
    </QueryClientProvider>
  );
}
AppRegistry.registerComponent('h', () => App);
AppRegistry.runApplication('h', { rootTag: document.getElementById('root') });
