import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import SignOffItem from './SignOffItem'

describe('SignOffItem', () => {
  it('shows its text, and Cancel closes the dialog', async () => {
    stubApi({ 'GET /api/sign-offs': [{ status: 200, body: [{ sign_off_id: 1, text: 'Sincerely', used_by: [] }] }] })
    const host = await renderItem(<SignOffItem id={1} />)
    expect(screen.getByLabelText('Sign-off')).toHaveValue('Sincerely')
    await expectNoA11yViolations()
    fireEvent.click(screen.getByText('Cancel'))
    expect(host.close).toHaveBeenCalled()
  })
})
