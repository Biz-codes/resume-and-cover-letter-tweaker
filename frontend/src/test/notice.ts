import { fireEvent, screen, within } from '@testing-library/react'
import { expect } from 'vitest'

// A page's notice shows in an AlertDialog. Checks its message and closes it with OK, as a person
// would, so the test goes on with the page reachable again and focus where the change sent it.
export async function expectNotice(text: string | RegExp) {
  const alert = await screen.findByRole('alertdialog')
  expect(alert).toHaveTextContent(text)
  fireEvent.click(within(alert).getByRole('button', { name: 'OK' }))
}
