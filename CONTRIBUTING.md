# Contributing

Thank you for considering a contribution. This is a public application repository maintained by a
single maintainer; the data source remains private. Keep changes focused and expect required CI
checks to complete before merge.

## Before opening a pull request

1. Search existing issues and pull requests. Open an issue first for behavior changes that need
   product or data-policy discussion.
2. Do not edit `data-contracts/` by hand. Generated contract updates must come from the data
   repository through `npm run contracts:sync`.
3. Do not include credentials, `.dev.vars`, private data-repository content, personal information,
   or production logs.
4. Preserve HashRouter URLs, published data URLs, accessibility behavior, and existing API error
   contracts.

Run focused tests while developing. Before review, run:

```bash
npm run check
```

Also run `npm run check:functions` for Functions changes and `npm run test:e2e:ci` for user-flow
changes. Dependency audits run in CI.

Explain the user-visible impact, tests run, and any security or privacy implications in the pull
request description. Pull requests are squash-merged after required checks pass.

## Contribution rights

This project does not require a Contributor License Agreement (CLA) or Developer Certificate of
Origin (DCO). By submitting a contribution, you confirm that you created it or otherwise have the
right to submit it. Contributors retain copyright in their contributions.

The repository itself has no outbound reuse license. A contribution does not license unrelated
contributions or third-party assets.

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report suspected vulnerabilities through
[SECURITY.md](SECURITY.md), not a public issue.
