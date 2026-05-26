// P1-2 (PR #192): polyfill crypto.getRandomValues for React Native / Hermes.
// Must be the very first import so every subsequent module (including
// idempotency.ts and any uuid consumer) sees a crypto-grade RNG with no
// Math.random fallback in any build mode.
import 'react-native-get-random-values';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
