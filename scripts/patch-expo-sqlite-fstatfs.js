// expo-sqlite 56.0.5 bundles SQLite, whose unixOpen() calls fstatfs() on Apple
// builds only to spot MSDOS/exFAT volumes. Apple lists fstatfs as a disk-space
// API and no approved reason describes that use. The app's databases live in
// its own container on APFS, so the iOS build drops the check (B-671-3): both
// blocks move under SQLITE_ENABLE_LOCKING_STYLE, which the podspec sets to 0.
const fs = require('node:fs');
const path = require('node:path');

const APPLE_GUARD = '#if defined(__APPLE__) || SQLITE_ENABLE_LOCKING_STYLE\n';
const LOCKING_GUARD = '#if SQLITE_ENABLE_LOCKING_STYLE\n';
const BLOCKS = [
  `${APPLE_GUARD}  struct statfs fsInfo;\n#endif\n`,
  [
    `${APPLE_GUARD}  if( fstatfs(fd, &fsInfo) == -1 ){`,
    '    storeLastErrno(p, errno);',
    '    robust_close(p, fd, __LINE__);',
    '    return SQLITE_IOERR_ACCESS;',
    '  }',
    '  if (0 == strncmp("msdos", fsInfo.f_fstypename, 5)) {',
    '    ((unixFile*)pFile)->fsFlags |= SQLITE_FSFLAGS_IS_MSDOS;',
    '  }',
    '  if (0 == strncmp("exfat", fsInfo.f_fstypename, 5)) {',
    '    ((unixFile*)pFile)->fsFlags |= SQLITE_FSFLAGS_IS_MSDOS;',
    '  }',
    '#endif',
    '',
  ].join('\n'),
];

// Returns the source with both unixOpen() guards replaced; unchanged if already patched.
function patchSource(source) {
  const start = source.indexOf('\nstatic int unixOpen(');
  const end = source.indexOf('\n}\n', start);
  if (start === -1 || end === -1) throw new Error('expo-sqlite: unixOpen() not found; fstatfs patch not applied');
  let body = source.slice(start, end);
  const patched = BLOCKS.map((block) => block.replace(APPLE_GUARD, LOCKING_GUARD));
  if (!body.includes(APPLE_GUARD) && patched.every((block) => body.split(block).length === 2)) return source;
  BLOCKS.forEach((block, i) => {
    if (body.split(block).length !== 2) {
      throw new Error('expo-sqlite: unixOpen() source changed; fstatfs patch not applied');
    }
    body = body.replace(block, patched[i]);
  });
  if (body.includes(APPLE_GUARD)) throw new Error('expo-sqlite: unixOpen() source changed; fstatfs patch not applied');
  return source.slice(0, start) + body + source.slice(end);
}

function patchPackage(dir) {
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (version !== '56.0.5') throw new Error(`Revalidate the expo-sqlite fstatfs patch for version ${version}`);
  for (const vendor of ['sqlite3', 'sqlcipher']) {
    const file = path.join(dir, 'vendor', vendor, 'sqlite3.c');
    const source = fs.readFileSync(file, 'utf8');
    const patched = patchSource(source);
    if (patched === source) {
      console.log(`expo-sqlite ${vendor} fstatfs patch already applied`);
    } else {
      fs.writeFileSync(file, patched);
      console.log(`Applied expo-sqlite ${vendor} fstatfs patch`);
    }
  }
}

if (require.main === module) {
  patchPackage(path.dirname(require.resolve('expo-sqlite/package.json')));
}

module.exports = { patchSource, patchPackage };
