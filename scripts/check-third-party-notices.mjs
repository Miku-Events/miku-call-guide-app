import { readFile } from 'node:fs/promises'

const START_MARKER = '<!-- runtime-dependencies:start -->'
const END_MARKER = '<!-- runtime-dependencies:end -->'
const BUILD_START_MARKER = '<!-- build-output-dependencies:start -->'
const BUILD_END_MARKER = '<!-- build-output-dependencies:end -->'
const BUILD_OUTPUT_PACKAGES = ['tailwindcss', 'vite']

function dependencyTable(entries, startMarker, endMarker) {
  return [
    startMarker,
    '| Package | Version | License |',
    '|---|---:|---|',
    ...entries.map(({ license, name, version }) => `| \`${name}\` | ${version} | ${license} |`),
    endMarker,
  ].join('\n')
}

function runtimeDependencyTable(lockfile) {
  const packages = Object.entries(lockfile.packages ?? {})
    .filter(([packagePath, metadata]) => packagePath.startsWith('node_modules/') && metadata.dev !== true)
    .map(([packagePath, metadata]) => ({
      license: metadata.license,
      name: packagePath.slice('node_modules/'.length),
      version: metadata.version,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))

  for (const entry of packages) {
    if (!entry.name || !entry.version || !entry.license) {
      throw new Error(`Runtime dependency notice metadata is incomplete for ${entry.name || '(unknown)'}.`)
    }
  }

  return dependencyTable(packages, START_MARKER, END_MARKER)
}

function buildOutputDependencyTable(lockfile) {
  const packages = BUILD_OUTPUT_PACKAGES.map((name) => {
    const metadata = lockfile.packages?.[`node_modules/${name}`]
    if (!metadata?.version || !metadata.license) {
      throw new Error(`Build-output dependency notice metadata is incomplete for ${name}.`)
    }
    return { license: metadata.license, name, version: metadata.version }
  })
  return dependencyTable(packages, BUILD_START_MARKER, BUILD_END_MARKER)
}

function noticeSection(notices, startMarker, endMarker, label) {
  const start = notices.indexOf(startMarker)
  const end = notices.indexOf(endMarker)
  if (start < 0 || end < start) {
    throw new Error(`THIRD_PARTY_NOTICES.md is missing its generated ${label} section.`)
  }
  return notices.slice(start, end + endMarker.length).replace(/\r\n/g, '\n')
}

function assertThirdPartyNotices(lockfile, notices) {
  const runtimeActual = noticeSection(notices, START_MARKER, END_MARKER, 'runtime dependency')
  if (runtimeActual !== runtimeDependencyTable(lockfile)) {
    throw new Error(
      'THIRD_PARTY_NOTICES.md runtime dependencies are stale; update the generated table from package-lock.json.',
    )
  }

  const buildActual = noticeSection(
    notices,
    BUILD_START_MARKER,
    BUILD_END_MARKER,
    'build-output dependency',
  )
  if (buildActual !== buildOutputDependencyTable(lockfile)) {
    throw new Error(
      'THIRD_PARTY_NOTICES.md build-output dependencies are stale; update the generated table from package-lock.json.',
    )
  }

  for (const requiredNotice of [
    'Primer Octicons',
    'Copyright (c) 2026 Meta Platforms, Inc.',
    'Copyright (c) Meta Platforms, Inc. and affiliates.',
    'Copyright (c) Nicolas Gallagher',
    'Copyright (c) 2013-present Cole Bemis',
    'Copyright (c) 2026 GitHub Inc.',
    'Copyright (c) 2019-present, VoidZero Inc. and Vite contributors',
    'Copyright (c) Tailwind Labs, Inc.',
    'Permission is hereby granted, free of charge',
    '/THIRD_PARTY_LICENSES.md',
  ]) {
    if (!notices.includes(requiredNotice)) {
      throw new Error(`THIRD_PARTY_NOTICES.md is missing the ${requiredNotice} notice.`)
    }
  }
}

const [lockfileText, notices] = await Promise.all([
  readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
  readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
])
assertThirdPartyNotices(JSON.parse(lockfileText), notices)
