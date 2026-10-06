// react-native-health 1.19.0 calls a bridge API removed by RN 0.85.
// Keep its legacy wiring only where that API exists. Bridgeless builds must
// retain the callableJSModules instance injected by React Native instead.
const fs = require('node:fs');
const path = require('node:path');

const packageFile = require.resolve('react-native-health/package.json');
const { version } = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
if (version !== '1.19.0') {
  throw new Error(`Revalidate the react-native-health native patch for version ${version}`);
}

const sourceFile = path.join(
  path.dirname(packageFile), 'RCTAppleHealthKit', 'RCTAppleHealthKit.m',
);
const source = fs.readFileSync(sourceFile, 'utf8');
const legacyWiring = [
  '    self.callableJSModules = [RCTAppleHealthKit sharedJsModule];',
  '    [self.callableJSModules setBridge:self.bridge];',
].join('\n');
const compatibleWiring = [
  '#ifndef RCT_REMOVE_LEGACY_ARCH',
  legacyWiring,
  '#endif // RCT_REMOVE_LEGACY_ARCH',
].join('\n');

if (source.includes(compatibleWiring)) {
  console.log('react-native-health RN 0.85 compatibility patch already applied');
} else {
  if (source.split(legacyWiring).length !== 2) {
    throw new Error('react-native-health native source changed; compatibility patch not applied');
  }
  fs.writeFileSync(sourceFile, source.replace(legacyWiring, compatibleWiring));
  console.log('Applied react-native-health RN 0.85 compatibility patch');
}
