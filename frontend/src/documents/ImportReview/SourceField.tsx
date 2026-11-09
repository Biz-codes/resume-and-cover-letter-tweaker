// The user's own resume or cover letter for Claude to read: a PDF or Word file to upload, or its
// text pasted in (ImportReview shows what Claude read). The start forms show it for "Upload" and
// "Paste".
import type { ApiError } from '../../shared/api/client'
import { capitalize } from '../../shared/api/documents'
import { SOURCE_FIELD, type SourceHow } from '../../shared/api/imports'

export default function SourceField({
  how,
  singular,
  id,
  text,
  error,
  errorId,
  onFile,
  onText,
}: {
  how: SourceHow
  singular: string
  // The field's id, where focus goes when there's an error.
  id: string
  text: string
  error: ApiError | null
  errorId: string
  onFile: (file: File | null) => void
  onText: (text: string) => void
}) {
  const invalid = error?.field === SOURCE_FIELD[how]
  const describe = { 'aria-invalid': invalid, 'aria-describedby': invalid ? errorId : undefined }
  return how === 'upload' ? (
    <label>
      {capitalize(singular)} file, PDF or Word (required)
      <input
        id={id}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        aria-required="true"
        {...describe}
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
      />
    </label>
  ) : (
    <label>
      {capitalize(singular)} text (required)
      <textarea
        id={id}
        rows={10}
        value={text}
        aria-required="true"
        {...describe}
        onChange={(event) => onText(event.target.value)}
      />
    </label>
  )
}
