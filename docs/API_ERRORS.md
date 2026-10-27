# API Errors

How the backend reports errors and how the front end handles them. Rules that can fail are listed in [FRONTEND_CHECKS.md](FRONTEND_CHECKS.md) with the error code they return.

## Response shape
Every error response has an HTTP status and this body:

```json
{
  "error": {
    "code": "BUILT_IN_PROTECTED",
    "message": "\"Other\" is built in and can't be deleted.",
    "field": null
  }
}
```

- **`code`:** one of the fixed codes below. The front end branches on this, never on the message text.
- **`message`:** plain English, safe to show the user as is. It never includes stack traces, SQL, or API keys.
- **`field`:** for `VALIDATION_FAILED`, the input field that failed (e.g. `"title"`), so the front end can highlight it. Otherwise `null`.

## Error codes
| Code                   | HTTP status | When                                                                                                              |
|------------------------|-------------|-------------------------------------------------------------------------------------------------------------------|
| `BUILT_IN_PROTECTED`   | 409         | deleting or renaming a built-in section or the built-in "Other" skill category                                    |
| `NOT_FOUND`            | 404         | the item doesn't exist, or belongs to another account                                                             |
| `VALIDATION_FAILED`    | 422         | bad or missing input, or a link the app's rules don't allow (see FRONTEND_CHECKS.md)                              |
| `DUPLICATE`            | 409         | a value that must be unique already exists (e.g. a section title, or the same item picked twice under one parent) |
| `CROSS_ACCOUNT_LINK`   | 422         | linking items that belong to different accounts                                                                   |
| `VERSION_LOCKED`       | 409         | changing a resume or cover letter whose job posting has an `applied_on` date (a sent version)                     |
| `POSTING_FETCH_FAILED` | 502         | the job posting page couldn't be fetched or no job description was found on it                                    |
| `AI_UNAVAILABLE`       | 503         | the Claude API failed, timed out, or declined the request after the SDK's automatic retries                       |
| `INTERNAL_ERROR`       | 500         | anything unexpected                                                                                               |

`NOT_FOUND` also covers items from another account, so the API never reveals whether another account's item exists.

## Backend rules
- **Transactions:** every request that writes data runs in one database transaction. If any step fails, the whole request rolls back and nothing is changed. Error messages for multi-step changes say so (e.g. "Couldn't delete the category; nothing was changed.").
- **Database errors map to codes:**
  - a unique constraint violation → `DUPLICATE`
  - a foreign key violation → `NOT_FOUND`
  - the trigger that protects built-in rows (it raises SQLSTATE `RT001`) → `BUILT_IN_PROTECTED`
  - anything else → `INTERNAL_ERROR`
- **Check before writing:** validate rules in the backend before touching the database where possible, so the user gets a specific code and message. The database constraints and triggers are a backstop.
- **Framework errors** use the same shape: an unknown route → `NOT_FOUND`, any other 4xx (e.g. wrong HTTP method) → `VALIDATION_FAILED` with its own status.
- **Logging:** log every `INTERNAL_ERROR` and `AI_UNAVAILABLE` with full details on the server. Only the safe `message` goes to the front end.
- **Claude API:** the `anthropic` SDK retries rate limits, server errors, and connection errors twice on its own. If it still fails, or Claude declines the request, return `AI_UNAVAILABLE`.

## Front end rules
- **Keep the user's input.** An error never clears a form, an edit in progress, or a suggestion the user was reviewing.
- **Show the message** near what failed. For `VALIDATION_FAILED`, highlight the `field`.
- **Offer the next step:**
  - `POSTING_FETCH_FAILED`: show the box for pasting in the job description.
  - `VERSION_LOCKED`: shouldn't happen, since locked versions aren't editable in the UI. If it does, offer to make a copy (a new base version, or a version for another posting).
  - `AI_UNAVAILABLE`: offer a Retry button. The user can keep working on anything that doesn't need AI.
  - `BUILT_IN_PROTECTED`: shouldn't happen, since the option isn't offered. If it does, show the message.
  - `INTERNAL_ERROR`: say what failed and that nothing was changed, and offer Retry.
