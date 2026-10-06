/**
 * Fingerprint inputs (runtimeVersion policy "fingerprint").
 *
 * Re-audit #305 A1 / #304 B3: the iOS non-P2P purchase gate
 * (`IOS_P2P_ONLY_MIN_NATIVE_BUILD` and the hide decision) lives in JS, which
 * an OTA can replace. Making the gate file a fingerprint input means ANY edit
 * to it (e.g. raising the build threshold) resolves to a NEW runtime version.
 * Installed binaries only accept updates for their own runtime, so the change
 * can only reach users in a new store build that goes through App Review.
 * scripts/validate-app-config.js fails if this entry is removed.
 *
 * @type {import('@expo/fingerprint').Config}
 */
const config = {
  extraSources: [
    {
      type: 'file',
      filePath: 'src/config/purchaseSurfaces.ts',
      reasons: ['iosPurchasePolicyGate'],
    },
  ],
};

module.exports = config;
