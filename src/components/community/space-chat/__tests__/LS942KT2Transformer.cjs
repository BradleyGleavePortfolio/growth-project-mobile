// Test-only mutation transport. No product file is changed on disk.
const delegate = require('babel-jest').createTransformer();
const target = '/src/components/community/space-chat/';
module.exports = {
  ...delegate,
  getCacheKey(source, filename, options) {
    return `${process.env.LS942_MUTATION || 'none'}:${delegate.getCacheKey(source, filename, options)}`;
  },
  process(source, filename, options) {
    const mutation = process.env.LS942_MUTATION;
    if (filename.includes(target) && !filename.includes('/__tests__/')) {
      if (mutation === 'BLOCK' && filename.endsWith('/useSpaceChat.ts')) {
        source = source.replace('const dropAuthor = useCallback((authorId: string) => {',
          'const dropAuthor = useCallback((authorId: string) => { return;');
      }
      if (mutation === 'READ_FLAG' && filename.endsWith('/useSpaceChat.ts')) {
        source = source.replace('const noAccess = refusedIn === cohortId || (list.isError && isNoAccess(list.error));',
          'const noAccess = false;');
      }
      if (mutation === 'READ_CACHE' && filename.endsWith('/useSpaceChat.ts')) {
        source = source
          .replace('return (t: SpaceReplyTarget) => noAccess ||', 'return (t: SpaceReplyTarget) => false ||')
          .replace('heldId && !noAccess ? messages.find', 'heldId ? messages.find')
          .replace('(noAccess ? undefined : messages.find', '(false ? undefined : messages.find');
      }
      if (mutation === 'SEND' && filename.endsWith('/spaceChatOutbox.ts')) {
        source = source.replace("if (reason === 'closed' && !next.reply)", 'if (false)');
      }
      if (mutation === 'WIRE' && filename.endsWith('/spaceChatApi.ts')) {
        source = source.replace('return status === 404 || status === 403;', 'return false;');
      }
      if (mutation === 'VOICE' && filename.endsWith('/useSpaceVoiceOutbox.ts')) {
        source = source.replace('outbox.items.filter((v) => v.input.cohortId === cohortId && v.authorId === userId)',
          'outbox.items');
      }
    }
    return delegate.process(source, filename, options);
  },
};
