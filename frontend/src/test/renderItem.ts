import { render, screen, waitFor } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { expect, vi } from 'vitest'
import { ItemHostContext, type ItemHost } from '../library/items/itemHost'

// A view from library/items rendered with a stand-in for the dialog around it, so a test can
// check what it asks the dialog to do. Resolves once the item has loaded.
export async function renderItem(view: ReactElement) {
  const host = {
    open: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    saved: vi.fn(() => Promise.resolve()),
    deleted: vi.fn(() => Promise.resolve()),
    say: vi.fn(),
    close: vi.fn(),
  } satisfies ItemHost
  render(createElement('main', null, createElement(ItemHostContext.Provider, { value: host }, view)))
  await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  return host
}
