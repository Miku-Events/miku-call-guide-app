# Agent Instructions

## Package Manager

- Use npm with Node.js from `.node-version` (24.11.1).
- Install reproducibly with `npm ci`; do not switch package managers.

## Repository Map

- `src/main.tsx` and `src/App.tsx`: client entry, Theme, `HashRouter`, lazy routes.
- `src/features/data/`: generated-contract validation, manifests, versioned cache snapshots.
- `src/features/{catalog,callGuide,events,player}/`: page-owned behavior and UI.
- `api/`: platform-neutral handlers; `functions/api/`: Cloudflare Pages adapters.
- `data-contracts/`: vendored output from the data repository; never hand-edit it.
- `tests/`: Playwright E2E; `scripts/`: CI, contract, security, and release checks.

## File-Scoped Commands

| Task | Command |
|---|---|
| Lint files | `npx eslint <files...>` |
| Typecheck app | `npx tsc -p tsconfig.app.json --noEmit` |
| Typecheck tooling | `npx tsc -p tsconfig.node.json --noEmit` |
| Unit test file | `npx vitest run <path>` |
| E2E spec | `npx playwright test <path>` |
| Sync contracts | `npm run contracts:sync` |
| Check sibling data dist | `npm run data:check` |

## Required Gates

```bash
npm run check
npm run test:e2e:ci
npm audit --audit-level=high
```

- `npm run check` must validate contract drift, lint, both TS configs, unit tests, build, and bundle budget.
- E2E and deployment must consume the already-built `dist`; do not rebuild between them.

## Key Conventions

- Keep `HashRouter` routes and published data URLs backward compatible.
- Runtime data must pass validators from `data-contracts/`; namespace cache entries by manifest identity and `dataVersion`.
- Preserve request IDs and `{ error, requestId, details? }` API errors; never expose upstream bodies or secrets.
- Test Turnstile keys are local/test only. Production/preview configuration must fail closed.
- Use Astryx components first. Run `npx astryx build "<idea>"` before substantial UI work; keep tokens/base in `src/index.css` and route styles beside each lazy page.
- Touch targets are at least 44px; preserve keyboard, focus, reduced-motion, and screen-reader behavior.
- YouTube E2E uses `?mockPlayer=1`; mock external requests and never use `waitForTimeout` for synchronization.
- Preserve unrelated and untracked user files. Never stage files outside the requested scope.

## Commit Attribution

- Do not add `Co-Authored-By` trailers automatically.
- Add attribution only when the user explicitly requests the exact identity and byline.
