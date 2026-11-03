import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoA11yViolations } from '../../test/axe'
import { renderItem } from '../../test/renderItem'
import { stubApi } from '../../test/stubApi'
import ItemView from './ItemView'

describe('ItemView', () => {
  it('shows the view for the kind of item', async () => {
    stubApi({ 'GET /api/sign-offs': [{ status: 200, body: [{ sign_off_id: 1, text: 'Sincerely', used_by: [] }] }] })
    await renderItem(<ItemView kind="signOff" id={1} />)
    expect(screen.getByLabelText('Sign-off')).toHaveValue('Sincerely')
    await expectNoA11yViolations()
  })
})
