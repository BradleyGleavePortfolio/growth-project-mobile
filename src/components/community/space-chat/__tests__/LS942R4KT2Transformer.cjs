// Reviewer-only mutations in Babel's input: no product file is edited on disk.
const delegate = require('babel-jest').createTransformer();
const guards = {
  READ_REPLY: ['return (t: SpaceReplyTarget) => noAccess ||', 'return (t: SpaceReplyTarget) => false ||'],
  READ_HELD: ['heldId && !noAccess ? messages.find', 'heldId ? messages.find'],
  READ_ACTION: ['(noAccess ? undefined : messages.find', '(false ? undefined : messages.find'],
  BLOCK_AUTHOR: ['(!!authorId && t.authorId === authorId)', 'false'],
};
module.exports = {
  ...delegate,
  getCacheKey(source, filename, options) {
    return `${process.env.LS942R4_MUTATION || 'NONE'}:${delegate.getCacheKey(source, filename, options)}`;
  },
  process(source, filename, options) {
    const guard = guards[process.env.LS942R4_MUTATION];
    if (guard && filename.endsWith('/src/components/community/space-chat/useSpaceChat.ts')) {
      if (!source.includes(guard[0])) throw new Error('Reviewer mutation no longer targets its guard');
      source = source.replace(guard[0], guard[1]);
    }
    return delegate.process(source, filename, options);
  },
};
