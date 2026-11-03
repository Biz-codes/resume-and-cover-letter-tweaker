import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Bullet } from '../../shared/api/bullets'
import type { Experience } from '../../shared/api/experience'
import { expectNoA11yViolations } from '../../test/axe'
import { loadedDialog } from '../../test/openCard'
import { stubApi } from '../../test/stubApi'
import { useItemDialogs } from './ItemDialogs'

const ROLE: Experience = {
  hidden: false,
  experience_id: 4,
  created_at: '2026-10-01T09:00:00',
  role_title: 'Engineer',
  organization: 'Acme',
  location: null,
  dates: null,
  bullets: [{ bullet_id: 10, content: 'Shipped it' }],
  sections: [],
  used_by: [],
}
const SHIPPED: Bullet = {
  hidden: false,
  bullet_id: 10,
  content: 'Shipped it',
  experience: [{ experience_id: 4, role_title: 'Engineer', organization: 'Acme', dates: null }],
  projects: [],
  sections: [],
  used_by: [],
}

// A page with one Edit button, as the library pages have.
function Page({ reload, notify }: { reload: () => Promise<void>; notify: (notice: string | null) => void }) {
  const dialogs = useItemDialogs({ reload, notify })
  return (
    <main>
      <button type="button" id="experience-4-edit" onClick={() => dialogs.open({ kind: 'experience', id: 4, title: 'Engineer, Acme' })}>
        Edit
      </button>
      {dialogs.dialog}
    </main>
  )
}

function renderPage() {
  stubApi({
    'GET /api/experience': [{ status: 200, body: [ROLE] }],
    'GET /api/bullet-points': [{ status: 200, body: [SHIPPED] }],
    'PUT /api/experience/4': [{ status: 200, body: ROLE }],
  })
  const props = { reload: vi.fn(() => Promise.resolve()), notify: vi.fn() }
  render(<Page {...props} />)
  const edit = screen.getByRole('button', { name: 'Edit' })
  edit.focus()
  fireEvent.click(edit)
  return { ...props, edit }
}

describe('useItemDialogs', () => {
  it('shows a name’s item in the same dialog, with Back to the one before', async () => {
    const { edit } = renderPage()
    const dialog = await loadedDialog()
    expect(dialog).toHaveAccessibleName('Engineer, Acme')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Shipped it' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(dialog).toHaveAccessibleName('Shipped it')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus()
    await loadedDialog()
    expect(within(dialog).getByLabelText('Bullet text')).toHaveValue('Shipped it')
    await expectNoA11yViolations()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Back to Engineer, Acme' }))
    expect(dialog).toHaveAccessibleName('Engineer, Acme')
    expect(within(dialog).getByRole('heading', { level: 2 })).toHaveFocus()
    expect(within(dialog).queryByRole('button', { name: /^Back to/ })).not.toBeInTheDocument()
    // Close, from any depth, returns focus to where the dialog was first opened.
    fireEvent.click(within(await loadedDialog()).getByRole('button', { name: 'Shipped it' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
  })

  it('closes on Escape from any depth, except while a bullet is being moved', async () => {
    const { edit } = renderPage()
    const dialog = await loadedDialog()
    const move = within(dialog).getByRole('button', { name: 'Move "Shipped it"' })
    fireEvent.click(move)
    fireEvent.keyDown(move, { key: 'Escape' })
    expect(move).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Shipped it' }))
    fireEvent.keyDown(within(dialog).getByRole('heading', { level: 2 }), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(edit).toHaveFocus()
  })

  it('closes on save, then tells the page and moves focus to the item’s Edit button', async () => {
    const { reload, notify, edit } = renderPage()
    fireEvent.click(within(await loadedDialog()).getByText('Save'))
    await vi.waitFor(() => expect(notify).toHaveBeenLastCalledWith('Saved.'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(reload).toHaveBeenCalled()
    await vi.waitFor(() => expect(edit).toHaveFocus())
  })
})
