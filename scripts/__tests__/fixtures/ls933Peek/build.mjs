// PEEK-K1-M2 (agent 197), adapted from op-194 COACH-DAY-ORDER-M. Harness-only bundler: esbuild (from the preinstalled global convex package),
// shared mobile node_modules, real coach client-detail code from SRC (before: main, after: the branch).
import { build } from '/usr/local/lib/node_modules/convex/node_modules/esbuild/lib/main.js';
import path from 'node:path';
import fs from 'node:fs';

const H = path.dirname(new URL(import.meta.url).pathname);
const NM = '/home/user/workspace/repos/growth-project-mobile/node_modules';
const M = (f) => path.join(H, 'mocks', f);

const SRC = process.env.SRC;
const OUT = process.env.OUT;
const redirect = [
  [/(^|\/)services\/api$/, M('api.tsx')],
  [/(^|\/)hooks\/useFeatureFlags$/, M('hooks.ts')],
  [/(^|\/)hooks\/useMacros$/, M('hooks.ts')],
  [/(^|\/)hooks\/useIdentity$/, M('misc.ts')],
  [/(^|\/)services\/commandCenterApi$/, M('misc.ts')],
  [/(^|\/)store\/coachStore$/, M('misc.ts')],
  [/(^|\/)haptics\/haptics\.service$/, M('misc.ts')],
  [/(^|\/)utils\/logger$/, M('misc.ts')],
  [/^@expo\/vector-icons$/, M('icons.tsx')],
];

const require_resolve = (p) => ['.tsx', '.ts'].map((e) => p + e).find((f) => fs.existsSync(f));
const plugin = {
  name: 'harness',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.path === 'react-native' && !args.importer.endsWith(path.join('mocks', 'rn.tsx'))) {
        return { path: M('rn.tsx') };
      }
      if (args.path.startsWith('SRC/')) return { path: require_resolve(path.join(SRC, 'src', args.path.slice(4))) };
      for (const [re, to] of redirect) if (re.test(args.path)) return { path: to };
      // One copy of every package: bare imports resolve from the shared mobile node_modules (never ~/node_modules).
      if (!args.pluginData && /^[^./]/.test(args.path) && !path.isAbsolute(args.path)) {
        return b.resolve(args.path, { resolveDir: '/home/user/workspace/repos/growth-project-mobile', kind: args.kind, pluginData: 1 });
      }
      // Crisp Roman at 2x: use the @3x face file.
      if (/assets\/roman\/(neutral|smile)\.png$/.test(args.path)) {
        const p = path.resolve(args.resolveDir, args.path).replace(/\.png$/, '@3x.png');
        return { path: p };
      }
      return undefined;
    });
  },
};

await build({
  entryPoints: [path.join(H, process.env.ENTRY ?? 'entry.tsx')],
  bundle: true,
  // Optional native-only package: storage/mmkv.ts returns before requiring it on web.
  external: ['react-native-mmkv'],
  outfile: path.join(OUT, 'bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  nodePaths: [NM],
  resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.json'],
  mainFields: ['browser', 'module', 'main'],
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.ttf': 'file', '.js': 'jsx' },
  define: { __DEV__: 'false', 'process.env.NODE_ENV': '"production"', global: 'globalThis', 'process.env.EXPO_OS': '"web"' },
  plugins: [plugin],
  banner: {
    js:
      'var process = { env: { NODE_ENV: "production", EXPO_PUBLIC_SUPABASE_URL: "https://harness.invalid", EXPO_PUBLIC_SUPABASE_ANON_KEY: "harness", EXPO_PUBLIC_API_URL: "https://harness.invalid",' +
      ' EXPO_PUBLIC_FF_TEAM_MODE: new URLSearchParams(location.search).get("team") === "1" ? "true" : "" } };',
  },
  logLevel: 'warning',
});

const F = (p) => 'file://' + path.join(NM, p);
const faces = [
  ['CormorantGaramond_400Regular', '@expo-google-fonts/cormorant-garamond/400Regular/CormorantGaramond_400Regular.ttf'],
  ['CormorantGaramond_500Medium', '@expo-google-fonts/cormorant-garamond/500Medium/CormorantGaramond_500Medium.ttf'],
  ['Inter_400Regular', '@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf'],
  ['Inter_500Medium', '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf'],
  ['Inter_600SemiBold', '@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf'],
  ['ionicons', '@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'],
];
const css = faces.map(([n, p]) => `@font-face{font-family:'${n}';src:url('${F(p)}') format('truetype');}`).join('\n');
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${css}
html,body{margin:0;padding:0;overflow:hidden;background:#F5EFE4}
#root{position:absolute;inset:0;display:flex}
#checks{display:none}
.chrome{position:fixed;pointer-events:none;z-index:10;font-family:Inter_600SemiBold}
</style></head><body><div id="root"></div><pre id="checks"></pre><div id="chrome"></div>
<script src="bundle.js"></script></body></html>`,
);
console.log('built');
