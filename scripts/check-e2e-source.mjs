import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const AUDIENCE_TAGS = new Set(['@desktop', '@mobile', '@both'])
const RAW_LAYOUT_ALLOWLIST = new Set(['tests/fixtures/geometry.ts'])
const FONT_MOCK_ALLOWLIST = new Set(['tests/fixtures/app-test.ts'])

const FORBIDDEN_PATTERNS = [
  ['fixed timeout', /\bwaitForTimeout\s*\(/g],
  ['fixed animation frame wait', /\brequestAnimationFrame\s*\(/g],
  ['network-idle wait', /\bnetworkidle\b/g],
  ['per-test timeout override', /\btest\s*\.\s*(?:setTimeout|slow)\s*\(/g],
]

const RAW_LAYOUT_PATTERNS = [
  ['raw locator bounds', /\.\s*boundingBox\s*\(/g],
  ['raw DOM bounds', /\bgetBoundingClientRect\s*\(/g],
  ['raw computed style', /\bgetComputedStyle\s*\(/g],
  ['raw element dimensions', /\b(?:scrollWidth|clientWidth|scrollHeight|clientHeight|offsetWidth|offsetHeight)\b/g],
]

const FONT_PATTERNS = [
  ['external Google Fonts dependency', /\bfonts\.(?:googleapis|gstatic)\.com\b/g],
]

const REQUIRED_FONT_MOCK_PATTERNS = [
  ['missing Google Fonts stylesheet route', /page\.route\(\s*['"]https:\/\/fonts\.googleapis\.com\/\*\*['"]/],
  ['missing empty Google Fonts stylesheet response', /route\.fulfill\(\{\s*body:\s*['"]{2},\s*contentType:\s*['"]text\/css['"]\s*\}\)/s],
  ['missing Google Fonts asset route', /page\.route\(\s*['"]https:\/\/fonts\.gstatic\.com\/\*\*['"]/],
  ['missing blocked Google Fonts asset response', /route\.abort\(\s*['"]blockedbyclient['"]\s*\)/],
]

function normalizeRelativePath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function lineAt(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length
}

function patternViolations(relativePath, source, patterns) {
  const violations = []

  for (const [rule, pattern] of patterns) {
    pattern.lastIndex = 0
    for (const match of source.matchAll(pattern)) {
      violations.push({
        file: relativePath,
        line: lineAt(source, match.index ?? 0),
        rule,
      })
    }
  }

  return violations
}

function literalTags(node) {
  if (ts.isStringLiteralLike(node)) {
    return [node.text]
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap(literalTags)
  }
  return []
}

function testTagViolations(relativePath, source) {
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const violations = []

  function isBehavioralTestCall(expression) {
    if (ts.isIdentifier(expression)) {
      return expression.text === 'test'
    }
    return ts.isPropertyAccessExpression(expression)
      && ts.isIdentifier(expression.expression)
      && expression.expression.text === 'test'
      && ['fail', 'fixme', 'only', 'skip'].includes(expression.name.text)
  }

  function visit(node) {
    if (ts.isCallExpression(node) && isBehavioralTestCall(node.expression)) {
      const options = node.arguments.find(ts.isObjectLiteralExpression)
      const tagProperty = options?.properties.find((property) => (
        ts.isPropertyAssignment(property)
        && ((ts.isIdentifier(property.name) && property.name.text === 'tag')
          || (ts.isStringLiteralLike(property.name) && property.name.text === 'tag'))
      ))
      const tags = tagProperty && ts.isPropertyAssignment(tagProperty)
        ? literalTags(tagProperty.initializer)
        : []
      const audienceTags = tags.filter((tag) => AUDIENCE_TAGS.has(tag))

      if (audienceTags.length !== 1) {
        violations.push({
          file: relativePath,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          rule: `test must declare exactly one audience tag; found ${audienceTags.length}`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

async function typescriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return typescriptFiles(entryPath)
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : []
  }))
  return nested.flat()
}

export async function findE2ESourceViolations(root = process.cwd()) {
  const testRoot = path.join(root, 'tests')
  const files = await typescriptFiles(testRoot)
  const violations = []

  for (const filePath of files) {
    const relativePath = normalizeRelativePath(root, filePath)
    const source = await readFile(filePath, 'utf8')
    violations.push(...inspectE2ESource(relativePath, source))
  }

  return violations.sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.rule.localeCompare(right.rule)
  ))
}

export function inspectE2ESource(relativePath, source) {
  const normalizedPath = relativePath.split(path.sep).join('/')
  const isBehavioralSpec = normalizedPath.endsWith('.spec.ts')
  const violations = isBehavioralSpec
    ? patternViolations(normalizedPath, source, FORBIDDEN_PATTERNS)
    : []

  if (!RAW_LAYOUT_ALLOWLIST.has(normalizedPath)) {
    violations.push(...patternViolations(normalizedPath, source, RAW_LAYOUT_PATTERNS))
  }
  if (!FONT_MOCK_ALLOWLIST.has(normalizedPath)) {
    violations.push(...patternViolations(normalizedPath, source, FONT_PATTERNS))
  }
  if (normalizedPath === 'tests/fixtures/app-test.ts') {
    for (const [rule, pattern] of REQUIRED_FONT_MOCK_PATTERNS) {
      if (!pattern.test(source)) {
        violations.push({ file: normalizedPath, line: 1, rule })
      }
    }
  }
  if (isBehavioralSpec) {
    violations.push(...testTagViolations(normalizedPath, source))
  }

  return violations
}

async function main() {
  const violations = await findE2ESourceViolations()
  if (violations.length === 0) {
    console.log('E2E source guard passed.')
    return
  }

  console.error('E2E source guard found forbidden synchronization or layout assertions:')
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.rule}`)
  }
  process.exitCode = 1
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  await main()
}
