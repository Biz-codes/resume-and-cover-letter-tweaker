import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import SidePanel, { type PanelTab, type SideTab } from './SidePanel'

const TABS: PanelTab[] = [
  { key: 'chat', label: 'Chat with Claude', content: <p>The conversation</p> },
  { key: 'posting', label: 'Job posting', content: <p>The description</p> },
]

// Starts expanded unless `collapsed`; a collapsed button expands it on that tab.
function Panel({ tabs = TABS, collapsed = false, onClose = vi.fn() }: { tabs?: PanelTab[]; collapsed?: boolean; onClose?: () => void }) {
  const [selected, setSelected] = useState<SideTab>(tabs[0].key)
  const [open, setOpen] = useState(!collapsed)
  return (
    <SidePanel
      tabs={tabs}
      open={open}
      selected={selected}
      onOpen={(key) => {
        setSelected(key)
        setOpen(true)
      }}
      onSelect={setSelected}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
    />
  )
}

describe('SidePanel', () => {
  it('shows one tab at a time, keeping the other in the page', async () => {
    const onClose = vi.fn()
    render(<Panel onClose={onClose} />)
    const panel = screen.getByRole('complementary', { name: 'Chat with Claude and Job posting' })
    expect(panel).toBeInTheDocument()
    const chat = screen.getByRole('tab', { name: 'Chat with Claude' })
    const posting = screen.getByRole('tab', { name: 'Job posting' })
    expect(chat).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Chat with Claude' })).toHaveTextContent('The conversation')
    // One tab stop.
    expect(posting).toHaveAttribute('tabindex', '-1')
    await expectNoA11yViolations()
    fireEvent.click(posting)
    expect(posting).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Job posting' })).toHaveTextContent('The description')
    // The chat stays, hidden, so it keeps its place.
    expect(screen.getByText('The conversation')).not.toBeVisible()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Chat with Claude and Job posting' }))
    expect(onClose).toHaveBeenCalled()
  })

  it("says a tab's announcement outside the tabs, so it's heard while another tab shows", () => {
    const tabs = TABS
    const { rerender } = render(<SidePanel tabs={tabs} open selected="posting" onOpen={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} />)
    rerender(<SidePanel tabs={tabs} open selected="posting" onOpen={vi.fn()} onSelect={vi.fn()} onClose={vi.fn()} announcement="Claude: Hi." />)
    const region = screen.getByText('Claude: Hi.')
    expect(region).toHaveAttribute('aria-live', 'polite')
    // Not inside the hidden chat tab.
    expect(region.closest('[role="tabpanel"]')).toBeNull()
  })

  it('moves between tabs with the arrow keys, Home, and End', () => {
    render(<Panel />)
    const chat = screen.getByRole('tab', { name: 'Chat with Claude' })
    const posting = screen.getByRole('tab', { name: 'Job posting' })
    chat.focus()
    fireEvent.keyDown(chat, { key: 'ArrowRight' })
    expect(posting).toHaveFocus()
    expect(posting).toHaveAttribute('aria-selected', 'true')
    // Wraps around.
    fireEvent.keyDown(posting, { key: 'ArrowRight' })
    expect(chat).toHaveFocus()
    fireEvent.keyDown(chat, { key: 'ArrowLeft' })
    expect(posting).toHaveFocus()
    fireEvent.keyDown(posting, { key: 'Home' })
    expect(chat).toHaveFocus()
    fireEvent.keyDown(chat, { key: 'End' })
    expect(posting).toHaveFocus()
    // Other keys do nothing.
    fireEvent.keyDown(posting, { key: 'a' })
    expect(posting).toHaveFocus()
  })

  it("leaves out a tab's content until it's shown", () => {
    render(<Panel tabs={[TABS[1], { ...TABS[0], content: null }]} />)
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(1)
    expect(screen.queryByText('The conversation')).not.toBeInTheDocument()
  })

  it('is headed by its one tab, with no tabs, and closes by name', async () => {
    const onClose = vi.fn()
    render(<Panel tabs={[TABS[1]]} onClose={onClose} />)
    expect(screen.getByRole('complementary', { name: 'Job posting' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Job posting' })).toBeVisible()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('The description')).toBeVisible()
    await expectNoA11yViolations()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse job posting' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('collapses a chat on its own as "Collapse chat"', () => {
    render(<Panel tabs={[TABS[0]]} />)
    expect(screen.getByRole('button', { name: 'Collapse chat' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('starts collapsed to a button for each tab, which expands it on that tab', async () => {
    render(<Panel collapsed />)
    const panel = screen.getByRole('complementary', { name: 'Chat with Claude and Job posting' })
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('The conversation')).not.toBeInTheDocument()
    const posting = screen.getByRole('button', { name: 'Job posting' })
    expect(posting).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Chat with Claude' })).toHaveAttribute('aria-expanded', 'false')
    expect(panel).toContainElement(posting)
    await expectNoA11yViolations()
    fireEvent.click(posting)
    expect(screen.getByRole('tab', { name: 'Job posting' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Chat with Claude and Job posting' }))
    expect(screen.getByRole('button', { name: 'Job posting' })).toHaveAttribute('aria-expanded', 'false')
  })
})
