import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { expectNoA11yViolations } from '../../test/axe'
import SourceField from './SourceField'

const props = { singular: 'resume', id: 'source', text: '', errorId: 'error', onFile: vi.fn(), onText: vi.fn() }

describe('SourceField', () => {
  it('takes a PDF or Word file', async () => {
    const onFile = vi.fn()
    render(<SourceField {...props} how="upload" error={null} onFile={onFile} />)
    const input = screen.getByLabelText('Resume file, PDF or Word (required)')
    expect(input).toHaveAttribute('accept', expect.stringContaining('.pdf,.docx'))
    expect(input).toHaveAttribute('aria-required', 'true')
    const file = new File(['%PDF'], 'me.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onFile).toHaveBeenCalledWith(file)
    await expectNoA11yViolations()
  })

  it('takes pasted text, with its error read with it', async () => {
    const onText = vi.fn()
    render(
      <>
        <SourceField
          {...props}
          how="paste"
          error={new ApiError('VALIDATION_FAILED', 'Claude found no resume in it.', 'text', 422)}
          onText={onText}
        />
        <p id="error">Claude found no resume in it.</p>
      </>,
    )
    const box = screen.getByRole('textbox', { name: 'Resume text (required)' })
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveAccessibleDescription('Claude found no resume in it.')
    fireEvent.change(box, { target: { value: 'Sam Rivera' } })
    expect(onText).toHaveBeenCalledWith('Sam Rivera')
    await expectNoA11yViolations()
  })
})
