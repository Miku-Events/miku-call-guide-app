# Agent Instructions for Miku Call Guide App

This repository contains the Vite + React frontend web application. All AI agents must strictly adhere to the following package, styling, and testing specifications.

## Package Manager & Toolchain
Use **npm**: `npm install`, `npm run dev`

## File-Scoped & Verification Commands
Always run verification locally before submitting any pull requests:

| Task | Command |
|------|---------|
| Run Vite development server | `npm run dev` |
| Compile TypeScript & build bundle | `npm run build` |
| Run ESLint linter check | `npm run lint` |
| Run Vitest component tests | `npm run test` |
| Run Playwright E2E browser tests | `npm run test:e2e` |

## Strict Coding Guidelines

### 0. Build & Lint Guarantee (MANDATORY)
- **Always Verify Build**: After modifying any files, you MUST run both `npm run test` and `npm run build` to verify that all unit tests pass and compilation/bundler outputs build successfully without any TS or linter errors.

### 1. Tailwind CSS v4 Styling Spec
- **CSS-First Config**: Tailwind CSS v4 is used with `@tailwindcss/vite`. Configurations are defined in `src/index.css` via modern CSS directives. Do not look for or create a `tailwind.config.js` file.
- **Theme Binding**: Strictly use class utility rules rather than ad-hoc inline styles. Keep colors and layout spacing consistent with the premium glassmorphism system defined in `src/index.css`.

### 2. Playwright E2E Testing Standards
- **Mock Player**: When writing tests for features interacting with YouTube video sync, always append `?mockPlayer=1` to the URL.
- **Async Locators**: Never use `page.waitForTimeout(N)` to resolve race conditions. Use Playwright's built-in auto-waiting locators and expectations (e.g. `expect(locator).toBeVisible()`).
- **Isolation**: Always mock external network requests to ensure tests can run robustly in offline or CI environments.

## Environment Specifications
Verify that local development configurations in `.env` match the following system keys:

| Environment Variable | Description |
|----------------------|-------------|
| `VITE_DATA_MANIFEST_URL` | Validated root manifest JSON |
| `VITE_SUBMISSION_API_URL` | API Endpoint for event submissions |
| `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` | Cloudflare captcha key for anti-spam |
| `APP_ORIGIN` | Serverless API origin |
| `SESSION_SECRET` | Session cookie encrypt key |
| `GITHUB_OAUTH_CLIENT_ID` / `_SECRET` | GitHub client credentials |
| `GITHUB_APP_ID` / `_PRIVATE_KEY` | Serverless app credentials for issue/PR creation |
