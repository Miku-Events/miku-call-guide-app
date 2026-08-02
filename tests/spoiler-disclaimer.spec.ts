import AxeBuilder from '@axe-core/playwright'
import { expect, SPOILER_DISCLAIMER_STORAGE_KEY, test } from './fixtures/app-test'
import { expectLocatorMinTouchTarget, expectPageContained } from './fixtures/geometry'

test.use({ spoilerDisclaimerAcknowledged: false })

test('gates fresh touch visits accessibly and starts loading only after confirmation', { tag: '@mobile' }, async ({ page }) => {
  let rootManifestRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/manifest.json')) {
      rootManifestRequests += 1
    }
  })

  await page.goto('/?mockPlayer=1', { waitUntil: 'domcontentloaded' })

  const dialog = page.getByRole('alertdialog')
  const continueButton = dialog.getByRole('button', { name: '확인하고 계속하기' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '스포일러 안내' })).toBeVisible()
  await expect(dialog).toContainText('공연과 관련된 스포일러가 포함될 수 있습니다')
  await expect(continueButton).toBeVisible()
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toHaveCount(0)
  await expect(page.locator('.catalog-song-card')).toHaveCount(0)
  expect(rootManifestRequests).toBe(0)

  const accessibilityResults = await new AxeBuilder({ page }).analyze()
  const seriousOrCriticalViolations = accessibilityResults.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  )
  expect(
    seriousOrCriticalViolations,
    JSON.stringify(seriousOrCriticalViolations, null, 2),
  ).toEqual([])
  await expectLocatorMinTouchTarget(continueButton)
  await expectPageContained(page)

  await continueButton.tap()
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  await expect.poll(() => rootManifestRequests).toBe(1)
})

test('cannot be dismissed with Escape or a backdrop click', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1')

  const dialog = page.getByRole('alertdialog')
  const continueButton = dialog.getByRole('button', { name: '확인하고 계속하기' })
  await expect(dialog).toBeVisible()
  await expect(continueButton).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Tab')
  await expect(continueButton).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(continueButton).toBeFocused()

  await page.mouse.click(1, 1)
  await expect(dialog).toBeVisible()
})

test('persists confirmation and does not show the disclaimer after reload', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1')

  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: '확인하고 계속하기' }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  expect(await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), SPOILER_DISCLAIMER_STORAGE_KEY))
    .toBe('1')

  await page.reload()

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
})

test('gates a direct song deep link and resumes the original route after confirmation', { tag: '@desktop' }, async ({ page }) => {
  await page.goto('/?mockPlayer=1#/songs/future-light-sample')

  await expect(page).toHaveURL(/#\/songs\/future-light-sample$/)
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toHaveCount(0)

  await page.getByRole('button', { name: '확인하고 계속하기' }).click()

  await expect(page).toHaveURL(/#\/songs\/future-light-sample$/)
  await expect(page.getByRole('heading', { name: '퓨처 라이트 샘플' })).toBeVisible()
})

test('continues for the current visit but asks again after a storage write failure', { tag: '@desktop' }, async ({ page }) => {
  await page.addInitScript((storageKey) => {
    const nativeSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (key === storageKey) {
        throw new DOMException('Storage is unavailable.', 'QuotaExceededError')
      }
      nativeSetItem.call(this, key, value)
    }
  }, SPOILER_DISCLAIMER_STORAGE_KEY)

  await page.goto('/?mockPlayer=1')
  await page.getByRole('button', { name: '확인하고 계속하기' }).click()

  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toBeVisible()
  expect(await page.evaluate((storageKey) => window.localStorage.getItem(storageKey), SPOILER_DISCLAIMER_STORAGE_KEY))
    .toBeNull()

  await page.reload()

  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('heading', { name: '콜 가이드' })).toHaveCount(0)
})
