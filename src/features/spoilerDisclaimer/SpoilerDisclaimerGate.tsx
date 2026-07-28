import { useState, type ReactNode } from 'react'
import { Button } from '@astryxdesign/core/Button'
import { Dialog } from '@astryxdesign/core/Dialog'
import { Heading } from '@astryxdesign/core/Heading'
import { Layout, LayoutContent, LayoutFooter, VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { useFocusTrap } from '@astryxdesign/core/hooks'
import {
  isSpoilerDisclaimerAcknowledged,
  storeSpoilerDisclaimerAcknowledgement,
} from './storage'
import './spoilerDisclaimer.css'

const TITLE_ID = 'spoiler-disclaimer-title'
const DESCRIPTION_ID = 'spoiler-disclaimer-description'

interface SpoilerDisclaimerGateProps {
  children: ReactNode
}

function keepRequiredDialogOpen() {}

export function SpoilerDisclaimerGate({ children }: SpoilerDisclaimerGateProps) {
  const [isAcknowledged, setIsAcknowledged] = useState(() =>
    isSpoilerDisclaimerAcknowledged()
  )
  const { containerRef: dialogRef } = useFocusTrap<HTMLDialogElement>({
    isActive: !isAcknowledged,
  })

  if (isAcknowledged) {
    return <>{children}</>
  }

  const acknowledge = () => {
    storeSpoilerDisclaimerAcknowledgement()
    setIsAcknowledged(true)
  }

  return (
    <VStack
      className="spoiler-disclaimer-gate"
      data-testid="spoiler-disclaimer-gate"
      minHeight="100dvh"
    >
      <Dialog
        ref={dialogRef}
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        className="spoiler-disclaimer-dialog"
        data-testid="spoiler-disclaimer-dialog"
        isOpen
        maxHeight="calc(100dvh - 2rem)"
        onOpenChange={keepRequiredDialogOpen}
        purpose="required"
        width="min(32rem, calc(100vw - 2rem))"
      >
        <Layout
          height="auto"
          content={
            <LayoutContent isScrollable={false}>
              <VStack gap={3}>
                <Heading id={TITLE_ID} level={1}>
                  스포일러 안내
                </Heading>
                <Text as="p" display="block" id={DESCRIPTION_ID}>
                  이 앱에는 개최 예정이거나 개최 중인 공연과 관련된 스포일러가 포함될 수
                  있습니다. 스포일러 노출을 줄이기 위해 카탈로그 첫 화면의 곡 목록은 무작위
                  순서로 표시하지만, 경우에 따라 목록에 포함된 곡 자체가 스포일러로 느껴질 수
                  있으니 이용에 주의해 주세요.
                </Text>
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <Button
                className="spoiler-disclaimer-confirm"
                data-autofocus
                label="확인하고 계속하기"
                onClick={acknowledge}
                variant="primary"
              />
            </LayoutFooter>
          }
        />
      </Dialog>
    </VStack>
  )
}
