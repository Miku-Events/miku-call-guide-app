import { useActionState, useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { TurnstileWidget } from '../../../components/TurnstileWidget'
import { GitHubMarkIcon } from '../../../shared/icons/GitHubMarkIcon'
import { fetchSubmissionSession, submitEditRequest, submitEventSubmission, githubLoginUrl, type SubmissionSession } from '../submissionClient'
import { COMBINED_TIMEZONES, formatIsoWithOffset } from '../utils/timezone'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TextArea } from '@astryxdesign/core/TextArea'
import { Selector } from '@astryxdesign/core/Selector'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { useFocusTrap } from '@astryxdesign/core/hooks'
import type { EventDialogState } from '../eventDialog'
import { eventTypeSelectorOptions } from '../eventTypes'

interface EventSubmitDialogProps {
  dialog: EventDialogState
  setDialog: (state: EventDialogState) => void
  submissionApiBaseUrl: string
  setSubmissionSuccess: (msg: string | null) => void
}

export function EventSubmitDialog({
  dialog,
  setDialog,
  submissionApiBaseUrl,
  setSubmissionSuccess,
}: EventSubmitDialogProps) {
  const { containerRef: dialogRef } = useFocusTrap<HTMLDialogElement>({ isActive: Boolean(dialog) })
  const [session, setSession] = useState<SubmissionSession>({ authenticated: false })
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [turnstileResetNonce, setTurnstileResetNonce] = useState(0)
  const dialogIdentity = dialog
    ? `${dialog.kind}:${dialog.kind === 'edit' ? dialog.event.id : 'new'}`
    : null
  const previousDialogIdentityRef = useRef(dialogIdentity)
  const dialogGenerationRef = useRef(0)
  const [addForm, setAddForm] = useState(() => ({
    title: '',
    slug: '',
    type: 'concert',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    snsUrl: '',
    sourceUrl: '',
    note: '',
  }))

  const [editForm, setEditForm] = useState(() => ({
    message: '',
    sourceUrl: '',
  }))

  useEffect(() => {
    const controller = new AbortController()
    fetchSubmissionSession(submissionApiBaseUrl, controller.signal).then(setSession).catch(() => {
      if (!controller.signal.aborted) {
        setSession({ authenticated: false })
      }
    })
    return () => controller.abort()
  }, [submissionApiBaseUrl])

  useEffect(() => {
    if (previousDialogIdentityRef.current === dialogIdentity) return
    previousDialogIdentityRef.current = dialogIdentity
    dialogGenerationRef.current += 1
    setSubmissionError(null)
    setTurnstileResetNonce(0)
    setTurnstileToken(null)
  }, [dialogIdentity])

  const closeDialog = () => {
    dialogGenerationRef.current += 1
    setSubmissionError(null)
    setTurnstileResetNonce(0)
    setTurnstileToken(null)
    setDialog(null)
  }

  const openLogin = () => {
    if (!submissionApiBaseUrl) {
      setSubmissionError('Submission API가 설정되지 않았습니다.')
      return
    }
    window.location.href = githubLoginUrl(submissionApiBaseUrl, window.location.href)
  }

  // React 19 Action State for adding event
  const [, addAction, addPending] = useActionState(
    async (_prevState: unknown, formData: FormData) => {
      const submissionGeneration = dialogGenerationRef.current
      setSubmissionError(null)
      try {
        const startDate = String(formData.get('startDate') ?? '')
        const startTime = String(formData.get('startTime') ?? '')
        const endDate = String(formData.get('endDate') ?? '')
        const endTime = String(formData.get('endTime') ?? '')
        const timezone = String(formData.get('timezone') ?? '')

        let startsAt: string | undefined = undefined
        let endsAt: string | undefined = undefined
        let startsOn: string | undefined = undefined
        let endsOn: string | undefined = undefined

        if (startTime) {
          startsAt = formatIsoWithOffset(`${startDate}T${startTime}`, timezone)
          if (endDate && endTime) {
            endsAt = formatIsoWithOffset(`${endDate}T${endTime}`, timezone)
          }
        } else {
          startsOn = startDate
          if (endDate) {
            endsOn = endDate
          }
        }

        const result = await submitEventSubmission(submissionApiBaseUrl, {
          title: String(formData.get('title') ?? ''),
          type: String(formData.get('type') ?? ''),
          startsAt,
          endsAt,
          startsOn,
          endsOn,
          timezone,
          snsUrl: String(formData.get('snsUrl') ?? ''),
          sourceUrl: String(formData.get('sourceUrl') ?? '') || undefined,
          note: String(formData.get('note') ?? '') || undefined,
          slug: String(formData.get('slug') ?? '') || undefined,
          turnstileToken: turnstileToken || '',
        })
        if (submissionGeneration !== dialogGenerationRef.current) {
          return { success: false, ignored: true }
        }
        setSubmissionSuccess(result.url ? `PR 생성 요청이 접수되었습니다: ${result.url}` : 'PR 생성 요청이 접수되었습니다.')
        closeDialog()
        return { success: true }
      } catch (err: unknown) {
        if (submissionGeneration !== dialogGenerationRef.current) {
          return { success: false, ignored: true }
        }
        const errorMsg = err instanceof Error ? err.message : '일정 추가 요청에 실패했습니다.'
        setSubmissionError(errorMsg)
        setTurnstileToken(null)
        setTurnstileResetNonce((current) => current + 1)
        return { success: false, error: errorMsg }
      }
    },
    null
  )

  // React 19 Action State for editing event
  const [, editAction, editPending] = useActionState(
    async (_prevState: unknown, formData: FormData) => {
      if (!dialog || dialog.kind !== 'edit') return null

      const submissionGeneration = dialogGenerationRef.current
      setSubmissionError(null)
      try {
        const result = await submitEditRequest(submissionApiBaseUrl, {
          eventId: dialog.event.id,
          occurrenceId: dialog.occurrence?.id,
          message: String(formData.get('message') ?? ''),
          sourceUrl: String(formData.get('sourceUrl') ?? '') || undefined,
          turnstileToken: turnstileToken || '',
        })
        if (submissionGeneration !== dialogGenerationRef.current) {
          return { success: false, ignored: true }
        }
        setSubmissionSuccess(result.url ? `수정 요청 이슈가 생성되었습니다: ${result.url}` : '수정 요청 이슈가 생성되었습니다.')
        closeDialog()
        return { success: true }
      } catch (err: unknown) {
        if (submissionGeneration !== dialogGenerationRef.current) {
          return { success: false, ignored: true }
        }
        const errorMsg = err instanceof Error ? err.message : '수정 요청에 실패했습니다.'
        setSubmissionError(errorMsg)
        setTurnstileToken(null)
        setTurnstileResetNonce((current) => current + 1)
        return { success: false, error: errorMsg }
      }
    },
    null
  )

  const isSubmitting = addPending || editPending

  return (
    <Dialog
      ref={dialogRef}
      aria-label={dialog?.kind === 'edit' ? '이벤트 수정 요청' : '일정 추가'}
      isOpen={Boolean(dialog)}
      onOpenChange={(open) => {
        if (!open) closeDialog()
      }}
      purpose="form"
      width={540}
      className="event-dialog-backdrop"
    >
      {dialog ? (
        <div className="event-dialog" key={dialog.kind + (dialog.kind === 'edit' ? dialog.event.id : '')}>
          <DialogHeader
            title={dialog.kind === 'add' ? '일정 추가' : '수정 요청'}
            subtitle={session.authenticated ? `@${session.login ?? 'github-user'}` : 'GitHub 로그인 필요'}
            onOpenChange={closeDialog}
          />

          <div className="event-dialog-content mt-4">
            {submissionError ? (
              <div className="event-dialog-error" role="alert">
                <strong>요청을 제출하지 못했습니다.</strong>
                <p>{submissionError}</p>
                <p>보안 검증을 다시 완료한 뒤 재시도해 주세요.</p>
              </div>
            ) : null}
            {!session.authenticated ? (
              <EmptyState
                title="GitHub 로그인 필요"
                description="GitHub 로그인 후 요청을 제출할 수 있습니다."
                icon={<GitHubMarkIcon size={28} />}
                actions={
                  <Button
                    label="GitHub 로그인"
                    icon={<GitHubMarkIcon size={16} />}
                    onClick={openLogin}
                    variant="primary"
                  />
                }
              />
            ) : dialog.kind === 'add' ? (
              <form aria-label="일정 추가 요청" className="flex flex-col gap-4" action={addAction}>
                <TextInput
                  label="이벤트 제목"
                  value={addForm.title}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, title: val }))}
                  htmlName="title"
                  isRequired
                />
                <TextInput
                  label="영문 식별자 (URL ID / Slug)"
                  description="영문 소문자, 숫자, 하이픈(-)만 사용 가능하며 앞뒤 하이픈은 사용할 수 없습니다."
                  placeholder="예: magical-mirai-2026-hamamatsu"
                  value={addForm.slug}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, slug: val }))}
                  htmlName="slug"
                  isOptional
                />
                <Selector
                  label="종류"
                  options={eventTypeSelectorOptions}
                  value={addForm.type}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, type: val }))}
                  isRequired
                />
                <input type="hidden" name="type" value={addForm.type} />
                
                <div className="flex gap-4">
                  <div className="flex-1">
                    <TextInput
                      label="시작일"
                      type={"date" as "text"}
                      value={addForm.startDate}
                      onChange={(val) => setAddForm((prev) => ({ ...prev, startDate: val }))}
                      htmlName="startDate"
                      isRequired
                    />
                  </div>
                  <div className="flex-1">
                    <TextInput
                      label="시작 시간"
                      type={"time" as "text"}
                      value={addForm.startTime}
                      onChange={(val) => setAddForm((prev) => ({ ...prev, startTime: val }))}
                      htmlName="startTime"
                      isOptional
                    />
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <TextInput
                      label="종료일"
                      type={"date" as "text"}
                      value={addForm.endDate}
                      onChange={(val) => setAddForm((prev) => ({ ...prev, endDate: val }))}
                      htmlName="endDate"
                      isOptional
                    />
                  </div>
                  <div className="flex-1">
                    <TextInput
                      label="종료 시간"
                      type={"time" as "text"}
                      value={addForm.endTime}
                      onChange={(val) => setAddForm((prev) => ({ ...prev, endTime: val }))}
                      htmlName="endTime"
                      isOptional
                    />
                  </div>
                </div>

                <TextInput
                  label="타임존"
                  value={addForm.timezone}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, timezone: val }))}
                  htmlName="timezone"
                  isRequired
                  {...({ list: 'timezone-list' } as Record<string, string>)}
                />
                <datalist id="timezone-list">
                  {COMBINED_TIMEZONES.map((tz) => (
                    <option key={tz} value={tz} />
                  ))}
                </datalist>

                <TextInput
                  label="SNS 링크"
                  placeholder="https://x.com/..."
                  value={addForm.snsUrl}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, snsUrl: val }))}
                  htmlName="snsUrl"
                  isRequired
                />
                <TextInput
                  label="공식 홈페이지"
                  placeholder="https://..."
                  value={addForm.sourceUrl}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, sourceUrl: val }))}
                  htmlName="sourceUrl"
                  isOptional
                />
                <TextArea
                  label="메모"
                  value={addForm.note}
                  onChange={(val) => setAddForm((prev) => ({ ...prev, note: val }))}
                  htmlName="note"
                  isOptional
                  rows={4}
                />
                <div className="mt-4 flex flex-col gap-4">
                  <TurnstileWidget
                    action="event_submit"
                    onVerify={setTurnstileToken}
                    resetNonce={turnstileResetNonce}
                  />
                  <Button
                    label="PR 요청"
                    icon={<Send size={16} aria-hidden="true" />}
                    type="submit"
                    variant="primary"
                    isDisabled={isSubmitting || !turnstileToken}
                    isLoading={isSubmitting}
                  />
                </div>
              </form>
            ) : (
              <form aria-label="이벤트 수정 요청" className="flex flex-col gap-4" action={editAction}>
                <TextInput
                  label="대상 이벤트"
                  value={dialog.event.id}
                  onChange={() => {}}
                  isDisabled
                  htmlName="eventId"
                />
                <input type="hidden" name="eventId" value={dialog.event.id} />
                {dialog.occurrence?.id && (
                  <input type="hidden" name="occurrenceId" value={dialog.occurrence.id} />
                )}
                <TextArea
                  label="수정 요청 내용"
                  value={editForm.message}
                  onChange={(val) => setEditForm((prev) => ({ ...prev, message: val }))}
                  htmlName="message"
                  isRequired
                  rows={5}
                />
                <TextInput
                  label="공식 홈페이지"
                  placeholder="https://..."
                  value={editForm.sourceUrl}
                  onChange={(val) => setEditForm((prev) => ({ ...prev, sourceUrl: val }))}
                  htmlName="sourceUrl"
                  isOptional
                />
                <div className="mt-4 flex flex-col gap-4">
                  <TurnstileWidget
                    action="event_edit"
                    onVerify={setTurnstileToken}
                    resetNonce={turnstileResetNonce}
                  />
                  <Button
                    label="Issue 생성"
                    icon={<Send size={16} aria-hidden="true" />}
                    type="submit"
                    variant="primary"
                    isDisabled={isSubmitting || !turnstileToken}
                    isLoading={isSubmitting}
                  />
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}
