<!-- Last updated: 2026-05-07 (finisher pass) -->
# Bloodwork — Module README

**Location:** `src/screens/bloodwork/` (screens live in `src/screens/client/` and `src/screens/coach/`)

---

## Purpose

Client-entered lab results review. Lets a client type values from a lab printout or patient portal, and lets their assigned coach add plain-English educational context before anything is shown back to the client. Ships behind `EXPO_PUBLIC_FEATURE_BLOODWORK` (default OFF) — the backend storage, audit log, and consent capture flows documented in `docs/BLOODWORK_HANDOFF.md` must be live before the flag is flipped.

This is not a clinical tool. Nothing in this module constitutes medical advice, diagnosis, or treatment guidance. Every surface displays a non-medical-advice disclaimer. Users must acknowledge the disclaimer before accessing any data (stored in `expo-secure-store` keyed by user id).

---

## Screens + State Machine

### Client screens

| Screen | File | Purpose |
|--------|------|---------|
| `BloodworkEntryScreen` | `src/screens/client/BloodworkEntryScreen.tsx` | Manual entry form. First view shows `BloodworkDisclaimerModal`; subsequent views show inline disclaimer banner. Stub submit — backend tracked in `docs/BLOODWORK_HANDOFF.md`. |

### Coach screens

| Screen | File | Purpose |
|--------|------|---------|
| `BloodworkReviewQueueScreen` | `src/screens/coach/BloodworkReviewQueueScreen.tsx` | Coach reviews submitted panels. Action buttons (mark reviewed, request source, refer to clinician, hide, flag) stub to alerts in v1. |

### Supporting components

| Component | File | Purpose |
|-----------|------|---------|
| `BloodworkDisclaimerModal` | `src/components/BloodworkDisclaimerModal.tsx` | Acknowledgement-required modal. Cannot be dismissed without tapping "I understand". Calls `recordDisclaimerAcknowledgement` — if save fails, modal stays visible. |

### Panel review state machine

```
draft_client_entered
        |
        v  (client submits)
    submitted
        |
        +---> needs_source  (coach requests clarification)
        |         |
        |         v  (client re-submits)
        |     submitted
        |
        +---> needs_clinician_context  (coach punts to clinician)
        |         |
        |         v  (coach resolves)
        |     coach_reviewed
        |
        +---> coach_reviewed  (coach reviews directly)
        |         |
        |         +---> hidden_from_client
        |         +---> disputed_flagged
        |
        +---> hidden_from_client
        +---> disputed_flagged
```

**Client visibility rule:** a panel is visible to the client in any state except `hidden_from_client` and `disputed_flagged`. AI insights are visible only when `reviewState === 'coach_reviewed'` AND `aiDraft.status === 'approved'`.

---

## API Endpoints Consumed

None in v1. All submit handlers are stubs. Planned endpoints are documented in `docs/BLOODWORK_HANDOFF.md`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/bloodwork/panels` | Create a new panel from client entry |
| `GET` | `/bloodwork/panels` | Fetch client's own panels |
| `GET` | `/bloodwork/coach/queue` | Coach fetch of pending panels |
| `PATCH` | `/bloodwork/panels/:id/review` | Coach updates review state |

---

## Privacy Doctrine — Who Can See What

| Data | Client (owner) | Assigned coach | Other coaches | Leaderboard | Share surface | PDF export |
|------|---------------|---------------|---------------|-------------|---------------|------------|
| Panel raw values | Yes, always | Yes, with explicit client permission | Never | Never | Never | Only if explicitly user-initiated |
| Coach educational notes | Yes, after coach_reviewed | Yes | Never | Never | Never | Only if explicitly user-initiated |
| AI draft (unapproved) | Never | Yes | Never | Never | Never | Never |
| AI draft (approved) | Yes | Yes | Never | Never | Never | Only if explicitly user-initiated |

**Coach permission gating:** In v1, coach access is gated by the feature flag and by the coach being the client's assigned coach (server-side check). A full client-granted-permission UI is Future Work — see below.

Bloodwork values **never** appear on the leaderboard (Phase 7C), transformation timeline image share, or any PDF export not explicitly initiated by the client. The server must enforce these rules; the mobile layer enforces them as a second line of defence.

---

## Disclaimer Text + Storage

### Full disclaimer text (verbatim — `BLOODWORK_DISCLAIMER_LONG` in `src/constants/bloodworkCopy.ts`)

> These results, notes, and tips are educational coaching context only. They are not medical advice and are not a diagnosis, and they are not a substitute for guidance from your doctor or another licensed clinician. Always speak with your clinician about your results and before making changes to your care.

### Acknowledgement modal bullets (verbatim — `BLOODWORK_DISCLAIMER_MODAL_BULLETS`)

- The values and notes here are for your own reference only. They are not medical advice.
- This app cannot diagnose illness, recommend treatments, or replace your doctor.
- Always talk to a licensed clinician before acting on any lab result.
- Your coach may add educational context, but that is not clinical guidance.
- If you are concerned about a result, contact your doctor or health service.

### Where it is stored

- **Storage:** `expo-secure-store` on device.
- **Key format:** `bloodwork_disclaimer_ack_v1_<userId>`
- **Value:** ISO-8601 timestamp of when the user tapped "I understand".
- **Version suffix:** `v1` — bump to `v2` if the disclaimer wording changes materially, which will force all users to re-acknowledge.
- **Helper module:** `src/lib/bloodworkDisclaimerHelper.ts`

---

## Env Vars / Flags

| Variable | Default | Meaning |
|----------|---------|---------|
| `EXPO_PUBLIC_FEATURE_BLOODWORK` | `false` | Enable bloodwork screens. OFF until backend storage and consent flows are live. |

No other env vars. All API base URLs inherit from the existing `API_BASE_URL` config.

---

## Tests

| File | What it asserts |
|------|----------------|
| `src/__tests__/bloodworkCopy.test.ts` | Scans all bloodwork copy strings for forbidden diagnostic/prescriptive phrases. Also pins that `BLOODWORK_DISCLAIMER_LONG` contains the required safety phrases ("not medical advice", "not a diagnosis", "clinician"). |
| `src/__tests__/bloodworkSignoff.test.ts` | `decideClientVisibility` logic — hidden states, clinician referral, awaiting review, AI draft approval path. `canTransition` state machine transitions. |
| `src/__tests__/bloodworkFeatureFlag.test.ts` | Pins that `isFeatureEnabled('bloodwork')` is `false` when env var is unset. Tests the `true`/`false`/`"true"`/`"false"` parsing. |
| `src/__tests__/bloodworkDisclaimerGate.test.ts` | **Happy path render** — acknowledged user sees full entry form without modal. **Disclaimer required on first view** — unacknowledged user sees modal. **Empty state** — form is visible but empty state text is shown when no data entered. **Error state** — modal stays visible if acknowledgement save fails. **Feature flag OFF** — renders fail-closed state regardless of acknowledgement. |

---

## Future Work / Known Limits

- **Backend storage not wired.** Submit handler is a stub. See `docs/BLOODWORK_HANDOFF.md` for the full server-side design (encryption at rest, audit log, consent capture).
- **Coach permission UI not built.** In v1, coach sees client panels by virtue of being the assigned coach. A UI where the client explicitly grants or revokes coach bloodwork access is not yet built — gated behind the feature flag.
- **Server-side consent record.** The current acknowledgement is device-local (SecureStore). A production-grade consent record should be server-persisted so it survives device reinstall and is auditable. Add this when the bloodwork backend lands.
- **EHR import, OCR, provider connect** — explicitly out of scope for v1. Documented as optional future pathways in `docs/BLOODWORK_HANDOFF.md`.
- **Reference range display.** The form captures reference ranges from the client. A future version should display them alongside the value in a "value / reference range" view.

---

## BEFORE PUBLIC LAUNCH

Bradley must action the following with legal counsel before enabling this feature for any user:

1. **Lawyer review of disclaimer copy.** The wording in `BLOODWORK_DISCLAIMER_LONG` and `BLOODWORK_DISCLAIMER_MODAL_BULLETS` is conservatively drafted but has not been reviewed by a lawyer. It must be reviewed for the specific jurisdictions Bradley operates in (UK, AU, US at minimum).

2. **HIPAA compliance (US).** If any US users store bloodwork data, the storage, access, and audit-log infrastructure must satisfy HIPAA requirements. This includes BAA with any cloud storage provider.

3. **UK GDPR / ICO guidance on health data.** Bloodwork data is "special category data" under UK GDPR. Processing it requires explicit consent, a lawful basis, and a Data Protection Impact Assessment (DPIA). Bradley must confirm the DPA and privacy policy cover this category.

4. **Australian Privacy Act (APPs 3, 6, 11).** Health information is "sensitive information" under the Australian Privacy Act. Collecting it requires explicit consent (APP 3), use must be limited to the stated purpose (APP 6), and it must be secured (APP 11).

5. **Disclaimer version management.** When the lawyer revises the copy, bump the disclaimer version key from `v1` to `v2` in `src/lib/bloodworkDisclaimerHelper.ts` to force re-acknowledgement from all existing users.

6. **Server-side consent record.** Before launch, implement a server-persisted consent record (not just device-local SecureStore) so consent is auditable.

7. **Coach permission model.** Confirm with legal whether the current model (assigned coach sees all panels) satisfies the principle of data minimisation, or whether explicit per-panel client permission is required.
