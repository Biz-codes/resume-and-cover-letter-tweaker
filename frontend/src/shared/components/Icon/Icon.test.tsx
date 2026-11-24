import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../../test/axe'
import Icon, { type IconName } from './Icon'

const NAMES: IconName[] = ['chevron', 'pencil', 'chat', 'remove', 'grip', 'close']

describe('Icon', () => {
  it('draws each icon hidden from screen readers, leaving the name to its button', async () => {
    render(
      <ul>
        {NAMES.map((name) => (
          <li key={name}>
            <button type="button" aria-label={`Icon ${name}`}>
              <Icon name={name} />
            </button>
          </li>
        ))}
      </ul>,
    )
    for (const name of NAMES) {
      const button = screen.getByRole('button', { name: `Icon ${name}` })
      const svg = button.querySelector('svg')!
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('focusable', 'false')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(svg.childElementCount).toBeGreaterThan(0)
    }
    await expectNoA11yViolations()
  })

  it('takes a size and a class of its own', () => {
    const { container } = render(<Icon name="chevron" size={16} className="disclosure-mark" />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('width', '16')
    expect(svg).toHaveClass('icon', 'disclosure-mark')
  })
})
