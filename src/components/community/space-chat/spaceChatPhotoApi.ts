/**
 * SC-M4 (agent 203): the space chat's photo calls, SC-BE3's routes (CONTRACT 6370301575 on b#1139; read at backend main
 * 27be6474: community-images.controller.ts:46-63, community-message.dto.ts CreateMessageDto and ImageUploadUrlDto,
 * community-messages.service.ts createImage and replay). Paths have no /api prefix (services/api adds the base).
 *   1. POST community/cohorts/:id/images/upload-url { mime: 'image/jpeg', size_bytes }  -> 201 { upload_url, key, expires_at }
 *      (the key is good at send for 600 s; the link takes one upload)
 *   2. one PUT of the file's bytes to upload_url, Content-Type image/jpeg: mealPhotoApi.upload's own step
 *      (mealPhotoApi.ts:27-35), copied because that call 1 is the food log's route
 *   3. POST community/cohorts/:id/messages { kind: 'image', image_key, width, height } with the row's Idempotency-Key
 *      -> 201 { message, crisis_flag? }; no body key (a caption is optional and "" fails MinLength)
 * Calls 1 and 3 go out bound to the sign-in that picked the photo (FIX-938 B3, as spaceChatApi.send): the request
 * interceptor checks the binding and the session generation against the credential it reads, and the next auth change
 * cancels them. The upload link, the key and the file are never logged, reported or kept.
 */
import { z } from 'zod';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import api, { type BoundRequestConfig } from '../../../services/api';
import { call } from '../../../api/apiCall';
import { boundRequestSignal } from '../../../services/accountBinding';
import { crisisLineOwner, showCrisisLineFor } from '../../../lib/communityCrisisLine';
import { SpaceMessageSchema, type SpaceMessage, type SpacePublisher } from './spaceChatApi';

const LinkSchema = z.object({ upload_url: z.string(), key: z.string(), expires_at: z.string() }).passthrough();
const SentSchema = z.object({ message: SpaceMessageSchema }).passthrough();

/** Call 1's answer, held in memory by the row only (spaceChatPhotos): where its one upload goes and until when. */
export interface SpacePhotoLink { url: string; key: string; expiresAt: number }

const bound = (by: SpacePublisher, signal: AbortSignal): BoundRequestConfig =>
  ({ accountBinding: by.binding, _sessionGeneration: by.session, signal } as BoundRequestConfig);

export const spaceChatPhotoApi = {
  /** Call 1: a signed upload for one JPEG of `sizeBytes` in this space. */
  issueUploadLink(cohortId: string, sizeBytes: number, by: SpacePublisher): Promise<SpacePhotoLink> {
    const b = boundRequestSignal(by.binding);
    return call(
      LinkSchema,
      () => api.post<unknown>(`/community/cohorts/${cohortId}/images/upload-url`, { mime: 'image/jpeg', size_bytes: sizeBytes }, bound(by, b.signal)),
      'space_chat',
    ).then((r) => ({ url: r.upload_url, key: r.key, expiresAt: Date.parse(r.expires_at) })).finally(b.done);
  },
  /** Call 2: the file's bytes, once, to the link. True only on a 2xx. */
  async uploadBytes(link: SpacePhotoLink, uri: string): Promise<boolean> {
    const status = await uploadAsync(link.url, uri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    }).then(
      (res) => res.status,
      () => 0,
    );
    return status >= 200 && status < 300;
  },
  /** Call 3: the photo message. CRISIS-TEXT-M's reader runs on the answer, for the account that sent it. */
  create(cohortId: string, photo: { key: string; width: number; height: number }, idempotencyKey: string, by: SpacePublisher): Promise<SpaceMessage> {
    const b = boundRequestSignal(by.binding);
    const owner = crisisLineOwner();
    return call(
      SentSchema,
      () => api.post<unknown>(`/community/cohorts/${cohortId}/messages`, { kind: 'image', image_key: photo.key, width: photo.width, height: photo.height }, {
        ...bound(by, b.signal),
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
      'space_chat',
    ).then((r) => {
      showCrisisLineFor(r, owner);
      return r.message;
    }).finally(b.done);
  },
};
