import { describe, expect, it } from 'vitest'
import {
  findE2ESourceViolations,
  inspectE2ESource,
} from './check-e2e-source.mjs'

describe('E2E source guard', () => {
  it('requires exactly one audience tag on every behavioral test', () => {
    const missing = inspectE2ESource(
      'tests/example.spec.ts',
      "test('missing', async () => {})",
    )
    const duplicated = inspectE2ESource(
      'tests/example.spec.ts',
      "test('duplicate', { tag: ['@desktop', '@both'] }, async () => {})",
    )
    const valid = inspectE2ESource(
      'tests/example.spec.ts',
      "test('valid', { tag: '@mobile' }, async () => {})",
    )
    const skippedWithoutTag = inspectE2ESource(
      'tests/example.spec.ts',
      "test.skip('skipped', async () => {})",
    )

    expect(missing.map(({ rule }) => rule)).toContain(
      'test must declare exactly one audience tag; found 0',
    )
    expect(duplicated.map(({ rule }) => rule)).toContain(
      'test must declare exactly one audience tag; found 2',
    )
    expect(skippedWithoutTag.map(({ rule }) => rule)).toContain(
      'test must declare exactly one audience tag; found 0',
    )
    expect(valid).toEqual([])
  })

  it('rejects fixed waits, raw layout reads, and external font dependencies in specs', () => {
    const violations = inspectE2ESource(
      'tests/example.spec.ts',
      `
        test('unsafe', { tag: '@desktop' }, async ({ page }) => {
          await page.waitForTimeout(100)
          await page.waitForLoadState('networkidle')
          await page.evaluate(() => requestAnimationFrame(() => {}))
          await page.locator('main').boundingBox()
          document.body.getBoundingClientRect()
          getComputedStyle(document.body)
          document.body.scrollWidth
          await page.goto('https://fonts.googleapis.com/css2')
        })
      `,
    )

    expect(violations.map(({ rule }) => rule)).toEqual(expect.arrayContaining([
      'fixed timeout',
      'network-idle wait',
      'fixed animation frame wait',
      'raw locator bounds',
      'raw DOM bounds',
      'raw computed style',
      'raw element dimensions',
      'external Google Fonts dependency',
    ]))
  })

  it('allows raw geometry only in the shared invariant helper and font URLs only in the app fixture', () => {
    expect(inspectE2ESource(
      'tests/fixtures/geometry.ts',
      'element.getBoundingClientRect(); element.scrollWidth; locator.boundingBox()',
    )).toEqual([])
    expect(inspectE2ESource(
      'tests/fixtures/app-test.ts',
      `
        await page.route('https://fonts.googleapis.com/**', async (route) => {
          await route.fulfill({ body: '', contentType: 'text/css' })
        })
        await page.route('https://fonts.gstatic.com/**', async (route) => {
          await route.abort('blockedbyclient')
        })
      `,
    )).toEqual([])
  })

  it('requires the deterministic empty stylesheet and blocked font asset fixture', () => {
    const violations = inspectE2ESource(
      'tests/fixtures/app-test.ts',
      "await page.route('https://fonts.googleapis.com/**', route => route.continue())",
    )

    expect(violations.map(({ rule }) => rule)).toEqual(expect.arrayContaining([
      'missing empty Google Fonts stylesheet response',
      'missing Google Fonts asset route',
      'missing blocked Google Fonts asset response',
    ]))
  })

  it('keeps the checked-in E2E suite compliant', async () => {
    expect(await findE2ESourceViolations()).toEqual([])
  })
})
