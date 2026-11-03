import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import LibraryCard from './LibraryCard'

describe('LibraryCard', () => {
  it('shows the title, a summary, and a View and Edit button that names the item', async () => {
    const onEdit = vi.fn()
    render(
      <LibraryCard title="Engineer, Acme" editId="role-4-edit" editLabel='View and Edit "Engineer, Acme"' onEdit={onEdit}>
        <p>Remote | 2020 – 2022</p>
      </LibraryCard>,
    )
    expect(screen.getByRole('heading', { level: 4, name: 'Engineer, Acme' })).toBeInTheDocument()
    expect(screen.getByText('Remote | 2020 – 2022')).toBeInTheDocument()
    const edit = screen.getByRole('button', { name: 'View and Edit "Engineer, Acme"' })
    expect(edit).toHaveAttribute('id', 'role-4-edit')
    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalled()
    await expectNoA11yViolations()
  })

  it('can sit under the page heading, with tags read in its heading', async () => {
    render(
      <LibraryCard title="Skills" heading={3} tags={<span className="tag">built in</span>} editId="s" editLabel='View and Edit "Skills"' onEdit={() => {}} />,
    )
    expect(screen.getByRole('heading', { level: 3, name: /^Skills/ })).toContainElement(screen.getByText('built in'))
    await expectNoA11yViolations()
  })
})
