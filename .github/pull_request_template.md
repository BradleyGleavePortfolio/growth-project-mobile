## Summary

<!-- 1–3 bullets on what changes and why. -->

## Documentation (required)

Every PR updates the corresponding README / module documentation. This is a hard rule, not a nice-to-have — docs that drift past one or two PRs are docs that get ignored.

- [ ] I updated the README(s) for every directory this PR touches (`README.md`, `src/<module>/README.md`, and any `docs/*.md` that names the surface I changed).
- [ ] I removed or rewrote any reference to a file / route / behaviour this PR deletes or renames.
- [ ] I did not add `TODO` / `FIXME` / `Coming Soon` / "In Development" placeholders to any user-visible surface or doc (see `docs/QUIET_LUXURY_DOCTRINE.md`).
- [ ] No emoji or pictographs in `src/**` or in shipped strings.

If the change is genuinely doc-free (e.g. a CI-only commit), say so explicitly here and link to the existing docs that already describe the surface.

## Quiet-luxury reviewer checklist (UI changes only)

Paste from `docs/QUIET_LUXURY_DOCTRINE.md` §8.

- [ ] No `fontWeight: '700'` or `'800'` introduced.
- [ ] No "Coming Soon" / "Planned" / "In Development" copy introduced.
- [ ] No new emoji literals in source.
- [ ] No new exclamation marks in user-facing copy.
- [ ] No new `radius.xl` / `radius.2xl` values larger than 4.
- [ ] No new floating widgets, FABs, or global banners.
- [ ] No new TODO/FIXME comments.

## Testing

- [ ] `npm run typecheck` — clean
- [ ] `npm test` — passing
- [ ] `npm run lint` — no new errors
- [ ] `npm run validate:config` — OK (or `validate:release` for release-gating PRs)
- [ ] Manual on-device exercise where the change touches push, notifications, deep links, OAuth, or store-listing surfaces — captured under `release-artifacts/<build>/` per `docs/RELEASE_SMOKE.md`.

## Backend dependencies

<!-- List any new endpoints the mobile app calls. Note expected behaviour on 404 / pre-deploy. -->
