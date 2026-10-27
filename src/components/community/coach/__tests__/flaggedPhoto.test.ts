/**
 * PHOTO-MOD-M: reading the queue item's `image` (backend main FX-1139 shape)
 * and sizing the thumbnail.
 */
import { readFlaggedPhoto, thumbnailSize, THUMB_HEIGHT } from '../FlaggedPhoto';

const image = { url: 'https://storage.example.test/p', width: 800, height: 600, expires_at: 'x' };

describe('readFlaggedPhoto', () => {
  it('a message without an image key is not a photo', () => {
    expect(readFlaggedPhoto({ target_type: 'message' })).toEqual({ kind: 'none' });
    expect(readFlaggedPhoto({ target_type: 'message', image: undefined })).toEqual({
      kind: 'none',
    });
  });

  it('only a message can carry a photo', () => {
    for (const t of ['post', 'win', 'voice_note']) {
      expect(readFlaggedPhoto({ target_type: t, image })).toEqual({ kind: 'none' });
    }
  });

  it('image null or removed reads removed', () => {
    expect(readFlaggedPhoto({ target_type: 'message', image: null })).toEqual({
      kind: 'removed',
    });
    expect(readFlaggedPhoto({ target_type: 'message', removed: true, image })).toEqual({
      kind: 'removed',
    });
  });

  it('a well-formed image is a photo; a null url is kept for the cannot-show notice', () => {
    expect(readFlaggedPhoto({ target_type: 'message', image })).toEqual({
      kind: 'photo',
      image,
    });
    const unsigned = { ...image, url: null };
    expect(readFlaggedPhoto({ target_type: 'message', image: unsigned })).toEqual({
      kind: 'photo',
      image: unsigned,
    });
  });

  it('a malformed image is a photo with no link (never a blank tile)', () => {
    for (const bad of [{ url: 7 }, 'x', { url: '', width: 1, height: 1 }, { width: -1 }]) {
      expect(readFlaggedPhoto({ target_type: 'message', image: bad })).toEqual({
        kind: 'photo',
        image: { url: null, width: 0, height: 0 },
      });
    }
  });
});

describe('thumbnailSize', () => {
  it('keeps the height and follows the photo shape within the card', () => {
    expect(thumbnailSize({ width: 800, height: 600 })).toEqual({ width: 267, height: THUMB_HEIGHT });
    expect(thumbnailSize({ width: 600, height: 800 })).toEqual({ width: 150, height: THUMB_HEIGHT });
    expect(thumbnailSize({ width: 1000, height: 1000 })).toEqual({ width: 200, height: THUMB_HEIGHT });
    expect(thumbnailSize({ width: 4000, height: 1000 })).toEqual({ width: 280, height: THUMB_HEIGHT });
  });

  it('a missing size draws a square', () => {
    expect(thumbnailSize({ width: 0, height: 0 })).toEqual({ width: 200, height: THUMB_HEIGHT });
  });
});
