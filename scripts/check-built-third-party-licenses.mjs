import { readdir, readFile } from 'node:fs/promises'

function normalized(text) {
  return text.replace(/\r\n/g, '\n')
}

function assertBuiltThirdPartyLicenses({
  bundledJavaScript,
  generatedLicenses,
  sourceNotices,
  deployedNotices,
}) {
  if (normalized(deployedNotices) !== normalized(sourceNotices)) {
    throw new Error('dist/THIRD_PARTY_NOTICES.md must exactly match the reviewed source notice.')
  }

  const requiredBundleSections = [
    '@astryxdesign/core',
    '@astryxdesign/theme-neutral',
    '@stylexjs/stylex',
    'lucide-react',
    'react',
    'react-dom',
    'react-router',
  ]
  for (const packageName of requiredBundleSections) {
    if (!generatedLicenses.includes(`## ${packageName} - `)) {
      throw new Error(`dist/THIRD_PARTY_LICENSES.md is missing bundled package ${packageName}.`)
    }
  }

  for (const requiredText of [
    'ISC License',
    'Permission is hereby granted, free of charge',
    'Copyright (c) 2026 Meta Platforms, Inc.',
    'Copyright (c) Meta Platforms, Inc. and affiliates.',
    'Copyright (c) 2013-present Cole Bemis',
  ]) {
    if (!generatedLicenses.includes(requiredText)) {
      throw new Error(`dist/THIRD_PARTY_LICENSES.md is missing required license text: ${requiredText}`)
    }
  }

  for (const requiredNotice of [
    '| `styleq` | 0.2.1 | MIT |',
    '| `tailwindcss` |',
    '| `vite` |',
    'Copyright (c) Nicolas Gallagher',
    'Copyright (c) 2026 GitHub Inc.',
    'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors',
    'Copyright (c) Tailwind Labs, Inc.',
  ]) {
    if (!deployedNotices.includes(requiredNotice)) {
      throw new Error(`dist/THIRD_PARTY_NOTICES.md is missing required build-output notice: ${requiredNotice}`)
    }
  }

  if (!bundledJavaScript.includes('styleq:')) {
    throw new Error('The built JavaScript no longer exposes the expected StyleQ implementation marker; review notices.')
  }
}

const assetDirectory = new URL('../dist/assets/', import.meta.url)
const javascriptAssets = (await readdir(assetDirectory)).filter((name) => name.endsWith('.js'))
const [generatedLicenses, sourceNotices, deployedNotices, javascriptChunks] = await Promise.all([
  readFile(new URL('../dist/THIRD_PARTY_LICENSES.md', import.meta.url), 'utf8'),
  readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
  readFile(new URL('../dist/THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
  Promise.all(javascriptAssets.map((name) => readFile(new URL(name, assetDirectory), 'utf8'))),
])

assertBuiltThirdPartyLicenses({
  bundledJavaScript: javascriptChunks.join('\n'),
  generatedLicenses,
  sourceNotices,
  deployedNotices,
})
