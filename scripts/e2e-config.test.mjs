import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import localConfig, {
  DESKTOP_E2E_GREP,
  MOBILE_E2E_GREP,
} from '../playwright.config'
import ciConfig from '../playwright.ci.config'
import { E2E_SCENARIOS } from '../tests/e2eInventory'

const execFileAsync = promisify(execFile)
const playwrightCli = path.join(process.cwd(), 'node_modules/@playwright/test/cli.js')

async function listedTests(config) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [playwrightCli, 'test', '--list', '--reporter=line', `--config=${config}`],
    { cwd: process.cwd(), maxBuffer: 2 * 1024 * 1024 },
  )
  const projects = { desktop: 0, mobile: 0 }
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*\[(desktop|mobile)\]\s/)
    if (match) {
      projects[match[1]] += 1
    }
  }
  return { projects, stdout }
}

describe('risk-based E2E configuration', () => {
  it('selects audience tags in the two standard browser projects', () => {
    expect(localConfig.projects?.map((project) => [project.name, String(project.grep)])).toEqual([
      ['desktop', String(DESKTOP_E2E_GREP)],
      ['mobile', String(MOBILE_E2E_GREP)],
    ])
    expect(ciConfig.projects?.map((project) => [project.name, String(project.grep)])).toEqual([
      ['desktop', String(DESKTOP_E2E_GREP)],
      ['mobile', String(MOBILE_E2E_GREP)],
    ])
  })

  it('lists exactly 29 desktop and 13 mobile standard instances', async () => {
    const listed = await listedTests('playwright.ci.config.ts')
    expect(listed.projects).toEqual({ desktop: 29, mobile: 13 })
    expect(listed.stdout).toContain('Total: 42 tests')

    const listedCoverage = new Map()
    for (const match of listed.stdout.matchAll(/^\s*\[(desktop|mobile)\].*\[([A-Z0-9-]+)\]/gm)) {
      const [, project, id] = match
      listedCoverage.set(id, [...(listedCoverage.get(id) ?? []), project])
    }
    const expectedCoverage = new Map(E2E_SCENARIOS.map(({ audience, id }) => [
      id,
      audience === 'both' ? ['desktop', 'mobile'] : [audience],
    ]))
    expect([...listedCoverage].sort()).toEqual([...expectedCoverage].sort())
  }, 20_000)

})
