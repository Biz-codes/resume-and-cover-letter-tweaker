import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import { ItemHostContext, type ItemHost } from './items/itemHost'
import NameList from './NameList'

describe('NameList', () => {
  it('lists the names, open, with the count', () => {
    render(<NameList title="Sections that list it" names={['Experience', 'Freelance']} />)
    expect(screen.getByText('Sections that list it (2)')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Experience', 'Freelance'])
  })

  it('makes each item a button that shows it, inside a dialog', async () => {
    const host = { open: vi.fn() } as unknown as ItemHost
    const ref = { kind: 'section' as const, id: 3, title: 'Experience' }
    render(
      <ItemHostContext.Provider value={host}>
        <NameList title="Sections that list it" refs={[ref]} />
      </ItemHostContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Experience' }))
    expect(host.open).toHaveBeenCalledWith(ref)
    await expectNoA11yViolations()
  })

  it('shows names as text outside a dialog', () => {
    render(<NameList title="Sections that list it" refs={[{ kind: 'section', id: 3, title: 'Experience' }]} />)
    expect(screen.queryByRole('button', { name: 'Experience' })).not.toBeInTheDocument()
    expect(screen.getByText('Experience')).toBeInTheDocument()
  })

  it('says None when empty, closed', () => {
    const { container } = render(<NameList title="Projects" names={[]} />)
    expect(screen.getByText('Projects (0)')).toBeInTheDocument()
    expect(container.querySelector('details')).not.toHaveAttribute('open')
  })
})
