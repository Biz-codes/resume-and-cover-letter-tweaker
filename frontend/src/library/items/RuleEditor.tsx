import { useId, useState } from 'react'

// A new rule's text, inside a tone's form (ToneItem, and Claude's suggested tone in SuggestTone),
// so it has no form of its own: its button puts the text in the list. An empty rule says so
// instead.
export default function RuleEditor({
  label,
  text,
  applyLabel,
  onText,
  onApply,
}: {
  label: string
  text: string
  applyLabel: string
  onText: (text: string) => void
  onApply: () => void
}) {
  const [empty, setEmpty] = useState(false)
  const errorId = useId()

  return (
    <div className="stacked-form">
      <label>
        {label}
        <textarea
          rows={3}
          value={text}
          aria-invalid={empty}
          aria-describedby={empty ? errorId : undefined}
          onChange={(event) => {
            setEmpty(false)
            onText(event.target.value)
          }}
        />
      </label>
      {empty && (
        <p role="alert" id={errorId}>
          Type the rule.
        </p>
      )}
      <div className="actions">
        <button
          type="button"
          onClick={() => {
            if (!text.trim()) setEmpty(true)
            else onApply()
          }}
        >
          {applyLabel}
        </button>
      </div>
    </div>
  )
}
