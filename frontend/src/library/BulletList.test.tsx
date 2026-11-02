import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { expectNoA11yViolations } from '../test/axe'
import BulletList from './BulletList'

const SHIPPED = { bullet_id: 1, content: 'Shipped the new checkout flow to every customer in one quarter' }
const TESTED = { bullet_id: 2, content: 'Tested it' }

describe('BulletList', () => {
  it('names long bullets by their start in button labels', async () => {
    render(
      <BulletList owner="Engineer, Acme" bullets={[SHIPPED]} allBullets={[SHIPPED, TESTED]} onChange={vi.fn()} onWrite={vi.fn()} />,
    )
    expect(screen.getByText('Bullets (1)')).toBeInTheDocument()
    expect(screen.getByText(SHIPPED.content)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove "Shipped the new checkout flow to…"' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Tested it' })).toBeInTheDocument()
    await expectNoA11yViolations()
  })

  it('writes a new bullet in a text area', async () => {
    const onWrite = vi.fn(() => Promise.resolve())
    render(<BulletList owner="Engineer, Acme" bullets={[]} allBullets={[]} onChange={vi.fn()} onWrite={onWrite} />)
    expect(screen.getByText('No bullets yet.')).toBeInTheDocument()
    const field = screen.getByLabelText('New bullet for Engineer, Acme')
    expect(field.tagName).toBe('TEXTAREA')
    fireEvent.change(field, { target: { value: 'Led it' } })
    fireEvent.click(screen.getByText('Add bullet'))
    expect(onWrite).toHaveBeenCalledWith('Led it')
    await vi.waitFor(() => expect(field).toHaveValue(''))
  })
})
