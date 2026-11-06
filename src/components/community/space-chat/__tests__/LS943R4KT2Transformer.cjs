// Reviewer-only mutation transport. Product files remain byte-identical on disk.
const delegate = require('babel-jest').createTransformer();
const changes = {
  ROW_MENU: ['SpaceChatRow.tsx', ') : p.removed ? null : (', ') : false ? null : ('],
  ROW_BODY: ['SpaceChatRow.tsx', '{p.removed ? (', '{false ? ('],
  VOICE_CACHE: ['SpaceVoiceNote.tsx',
    'const data = !localUri && note.isError && refusedBy(note.error) ? undefined : note.data;',
    'const data = note.data;'],
  VOICE_403: ['SpaceVoiceNote.tsx', '[403, 404].includes', '[404].includes'],
  VOICE_404: ['SpaceVoiceNote.tsx', '[403, 404].includes', '[403].includes'],
  VOICE_MARK: ['SpaceVoiceNote.tsx',
    'mine || localUri || !data ? null', 'mine || localUri ? null'],
  VOICE_URL: ['SpaceVoiceNote.tsx',
    'url={localUri ?? data?.url ?? null}',
    "url={localUri ?? data?.url ?? 'https://signed.example/leak.m4a'}"],
};
module.exports = {
  ...delegate,
  getCacheKey(source, filename, options) {
    return `${process.env.LS943R4_MUTATION || 'none'}:${delegate.getCacheKey(source, filename, options)}`;
  },
  process(source, filename, options) {
    const change = changes[process.env.LS943R4_MUTATION];
    if (change && filename.endsWith(`/src/components/community/space-chat/${change[0]}`)) {
      if (source.split(change[1]).length !== 2) throw new Error(`Guard drift: ${change[0]}`);
      source = source.replace(change[1], change[2]);
    }
    return delegate.process(source, filename, options);
  },
};
