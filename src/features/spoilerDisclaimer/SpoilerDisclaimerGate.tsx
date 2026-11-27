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
                  공연 전에 잠깐만요
                </Heading>
                <Text as="p" display="block" id={DESCRIPTION_ID}>
                  다가오는 공연이나 지금 열리고 있는 공연의 스포일러가 있을 수 있어요. 첫
                  화면의 곡 목록은 무작위로 섞어서 보여 드리지만, 목록에 있는 곡만 보고도
                  세트리스트가 짐작될 수 있으니 조심해 주세요.
                </Text>
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <Button
                className="spoiler-disclaimer-confirm"
                data-autofocus
                label="알겠어요, 둘러볼게요"
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
