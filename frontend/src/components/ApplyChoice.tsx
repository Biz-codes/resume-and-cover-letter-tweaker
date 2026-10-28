// When changing a library item that resumes or cover letters in progress use, asks whether
// they get the change too. "No" (the default, which changes nothing) saves the change as a new
// version. Sent versions never change, so they aren't offered here
// (docs/FRONTEND_CHECKS.md, "Changing a role or project").
import type { Use } from '../api/usage'

export default function ApplyChoice({
  uses,
  apply,
  onChange,
}: {
  // The resumes and cover letters in progress (not sent) that use the item.
  uses: Use[]
  apply: boolean
  onChange: (apply: boolean) => void
}) {
  return (
    <fieldset className="choice">
      <legend>Apply this change to what's in progress? Used by: {uses.map((use) => use.name).join('; ')}.</legend>
      <label>
        <input type="radio" name="apply-to-unsent" checked={!apply} onChange={() => onChange(false)} />
        No, save it as a new version. They keep this one.
      </label>
      <label>
        <input type="radio" name="apply-to-unsent" checked={apply} onChange={() => onChange(true)} />
        Yes, change it for them too.
      </label>
    </fieldset>
  )
}
