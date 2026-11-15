// A chat box's keys, as people expect them: Enter sends, and Shift+Enter starts a new line. Enter
// while an input method is still composing (Japanese, Chinese) finishes that instead.
import type { KeyboardEvent } from 'react'

export const sendOnEnter = (send: () => void) => (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  send()
}
