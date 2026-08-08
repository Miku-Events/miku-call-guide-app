import { expect, type Locator, type Page } from '@playwright/test'

type Rect = {
  bottom: number
  height: number
  left: number
  right: number
  top: number
  width: number
}

function rectsIntersect(left: Rect, right: Rect, clearance: number): boolean {
  return (
    left.left < right.right - clearance
    && left.right > right.left + clearance
    && left.top < right.bottom - clearance
    && left.bottom > right.top + clearance
  )
}

export async function expectMarkerGeometryReady(marker: Locator): Promise<void> {
  await expect(marker).toHaveAttribute('data-geometry-state', 'ready')
  await expect(marker).toBeVisible()
}

export async function expectAllMarkerGeometryReady(scope: Locator, expectedCount?: number): Promise<void> {
  const markers = scope.locator('.call-marker')
  if (expectedCount !== undefined) {
    await expect(markers).toHaveCount(expectedCount)
  }

  await expect.poll(
    () => markers.evaluateAll((elements) => (
      elements.length > 0 && elements.every((element) => element.getAttribute('data-geometry-state') === 'ready')
    )),
    { message: 'expected every call marker in the scoped lyric line to finish geometry measurement' },
  ).toBe(true)
}

export async function expectLocatorMinTouchTarget(locator: Locator, minimum = 44): Promise<void> {
  await expect.poll(
    async () => {
      const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { height: rect.height, width: rect.width }
      }))
      return boxes.length > 0 && boxes.every((box) => box.height >= minimum && box.width >= minimum)
    },
    { message: `expected every target to measure at least ${minimum}px by ${minimum}px` },
  ).toBe(true)
}

export async function expectPageContained(page: Page, tolerance = 1): Promise<void> {
  await expect.poll(
    () => page.evaluate((allowedOverflow) => {
      const root = document.documentElement
      const body = document.body
      return (
        root.scrollWidth <= window.innerWidth + allowedOverflow
        && body.scrollWidth <= window.innerWidth + allowedOverflow
      )
    }, tolerance),
    { message: 'expected the document to remain horizontally contained in the viewport' },
  ).toBe(true)
}

export async function expectPageScrollY(page: Page, expected = 0, tolerance = 1): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => window.scrollY),
    { message: `expected the page scroll position to remain within ${tolerance}px of ${expected}px` },
  ).toBeGreaterThanOrEqual(expected - tolerance)
  await expect.poll(
    () => page.evaluate(() => window.scrollY),
    { message: `expected the page scroll position to remain within ${tolerance}px of ${expected}px` },
  ).toBeLessThanOrEqual(expected + tolerance)
}

export async function expectPracticeRootScrollReady(page: Page, dragHandle: Locator): Promise<void> {
  await expect.poll(
    () => dragHandle.evaluate((element) => {
      const root = document.documentElement
      const scrollingElement = document.scrollingElement
      const rootOverflowY = getComputedStyle(root).overflowY
      const touchAction = getComputedStyle(element).touchAction

      return (
        root.classList.contains('call-guide-root-scroll')
        && scrollingElement === root
        && (rootOverflowY === 'auto' || rootOverflowY === 'scroll')
        && scrollingElement.scrollHeight > scrollingElement.clientHeight
        && touchAction === 'pan-y'
      )
    }),
    { message: 'expected the call guide drag handle to expose a native root-scroll path' },
  ).toBe(true)
}

export async function expectPracticeRootScrollRestored(page: Page): Promise<void> {
  await expect.poll(
    () => page.evaluate(() => {
      const root = document.documentElement
      return !root.classList.contains('call-guide-root-scroll') && getComputedStyle(root).overflowY === 'hidden'
    }),
    { message: 'expected route navigation to restore the locked application root' },
  ).toBe(true)
  await expectPageScrollY(page, 0)
}

export async function wheelPageFromLocator(locator: Locator, deltaY: number): Promise<void> {
  const page = locator.page()
  const box = await locator.boundingBox()
  if (!box) throw new Error('cannot wheel from a locator without a rendered bounding box')

  const previousScrollY = await page.evaluate(() => window.scrollY)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, deltaY)
  await expect.poll(
    () => page.evaluate(() => window.scrollY),
    { message: 'expected the native root scroller to move from the drag handle' },
  ).toBeGreaterThan(previousScrollY)
}

export async function expectLocatorContainedInVisualViewport(
  page: Page,
  locator: Locator,
  tolerance = 1,
): Promise<void> {
  await expect.poll(
    () => locator.evaluateAll((elements, allowedOverflow) => {
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const right = left + (viewport?.width ?? window.innerWidth)
      const bottom = top + (viewport?.height ?? window.innerHeight)

      return elements.length > 0 && elements.every((element) => {
        const rect = element.getBoundingClientRect()
        return (
          rect.left >= left - allowedOverflow
          && rect.right <= right + allowedOverflow
          && rect.top >= top - allowedOverflow
          && rect.bottom <= bottom + allowedOverflow
        )
      })
    }, tolerance),
    { message: 'expected every target to remain inside the visual viewport' },
  ).toBe(true)
}

export async function expectLocatorContained(
  scope: Locator,
  target: Locator,
  tolerance = 1,
): Promise<void> {
  await expect.poll(
    async () => {
      const scopeBox = await scope.boundingBox()
      const targetBoxes = await target.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          top: rect.top,
        }
      }))
      return Boolean(
        scopeBox
        && targetBoxes.length > 0
        && targetBoxes.every((box) => (
          box.left >= scopeBox.x - tolerance
          && box.right <= scopeBox.x + scopeBox.width + tolerance
          && box.top >= scopeBox.y - tolerance
          && box.bottom <= scopeBox.y + scopeBox.height + tolerance
        )),
      )
    },
    { message: 'expected every target to settle inside its containing element' },
  ).toBe(true)
}

export async function expectLocatorNoHorizontalOverflow(locator: Locator, tolerance = 1): Promise<void> {
  await expect.poll(
    () => locator.evaluateAll((elements, allowedOverflow) => (
      elements.length > 0
      && elements.every((element) => element.scrollWidth <= element.clientWidth + allowedOverflow)
    ), tolerance),
    { message: 'expected every target to render without horizontal content overflow' },
  ).toBe(true)
}

export async function expectLocatorsNotToOverlap(
  first: Locator,
  second: Locator,
  clearance = 0,
): Promise<void> {
  await expect.poll(
    async () => {
      const [firstRects, secondRects] = await Promise.all([
        first.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as Rect)),
        second.evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as Rect)),
      ])
      return (
        firstRects.length > 0
        && secondRects.length > 0
        && firstRects.every((left) => secondRects.every((right) => !rectsIntersect(left, right, clearance)))
      )
    },
    { message: 'expected the rendered targets not to overlap' },
  ).toBe(true)
}

export async function expectLocatorCentered(
  scope: Locator,
  target: Locator,
  tolerance = 1,
): Promise<void> {
  await expect.poll(
    async () => {
      const [scopeBox, targetBox] = await Promise.all([scope.boundingBox(), target.boundingBox()])
      if (!scopeBox || !targetBox) return Number.POSITIVE_INFINITY
      const scopeCenter = scopeBox.y + scopeBox.height / 2
      const targetCenter = targetBox.y + targetBox.height / 2
      return Math.abs(targetCenter - scopeCenter)
    },
    { message: `expected the target center to settle within ${tolerance}px of the container center` },
  ).toBeLessThanOrEqual(tolerance)
}

export async function scrollLocatorToEndInSteps(locator: Locator): Promise<void> {
  let previous = -1

  while (true) {
    const target = await locator.evaluate((element) => {
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      const next = Math.min(maximum, element.scrollTop + Math.max(1, element.clientHeight * 0.75))
      element.scrollTo({ behavior: 'instant', top: next })
      return { maximum, next }
    })

    await expect.poll(
      () => locator.evaluate((element) => element.scrollTop),
      { message: 'expected the scroll container to reach the next image-loading step' },
    ).toBeGreaterThanOrEqual(target.next - 1)

    if (target.next >= target.maximum - 1 || target.next <= previous) {
      return
    }
    previous = target.next
  }
}

export async function wheelLocatorBy(locator: Locator, deltaY: number): Promise<void> {
  const page = locator.page()
  const previousScrollTop = await locator.evaluate((element) => element.scrollTop)
  await locator.hover()
  await page.mouse.wheel(0, deltaY)
  await expect.poll(
    () => locator.evaluate((element) => element.scrollTop),
    { message: 'expected the wheel gesture to scroll the target' },
  ).not.toBe(previousScrollTop)
}

export async function expectLocatorScrollSettled(locator: Locator): Promise<void> {
  let previousScrollTop: number | null = null
  let stableSamples = 0
  await expect.poll(
    async () => {
      const currentScrollTop = await locator.evaluate((element) => element.scrollTop)
      if (previousScrollTop !== null && Math.abs(currentScrollTop - previousScrollTop) < 0.25) {
        stableSamples += 1
      } else {
        stableSamples = 0
      }
      previousScrollTop = currentScrollTop
      return stableSamples
    },
    {
      intervals: [50, 50, 100, 100, 200],
      message: 'expected the scroll position to settle before the next interaction',
    },
  ).toBeGreaterThanOrEqual(4)
}

export async function swipeLocatorUp(locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('cannot swipe a locator without a rendered bounding box')

  const x = box.x + box.width / 2
  const startY = box.y + box.height * 0.75
  const endY = box.y + box.height * 0.25
  const previousScrollTop = await locator.evaluate((element) => element.scrollTop)
  const pointer = {
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: startY,
    pointerId: 1,
    pointerType: 'touch',
  }

  await locator.dispatchEvent('pointerdown', pointer)
  await locator.evaluate((element, distance) => element.scrollBy(0, distance), startY - endY)
  await locator.dispatchEvent('pointerup', { ...pointer, buttons: 0, clientY: endY })

  await expect.poll(
    () => locator.evaluate((element) => element.scrollTop),
    { message: 'expected the touch swipe to scroll the target' },
  ).toBeGreaterThan(previousScrollTop)
}
