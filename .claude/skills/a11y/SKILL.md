---
name: a11y
description: Review new or changed front end code for accessibility (WCAG 2.2 AA), fix what it finds, and add axe-core checks and behavior tests for every state the code renders. Use after adding or changing any component, page, CSS, or front end test in frontend/, when the Stop hook says front end files changed, or when the user asks about accessibility.
---

# Accessibility review for front end code

Every component and page is tested for accessibility from the start. Every test run (`npm test`, `vitest run`, a single file, or a watch-mode rerun) runs all the automated checks:

1. **Whole-front-end checks** (`frontend/a11yChecks.ts`, Vitest global setup) run before the tests and stop the run if any fail: every `.tsx` file has a sibling `.test.tsx`, oxlint's jsx-a11y rules pass, and the color pairs in `CONTRAST_PAIRS` meet 4.5:1. oxlint also runs on every edit through the PostToolUse hook.
2. **axe-core** (`frontend/src/test/axe.ts`) runs automatically after every test that rendered something (`src/test/setup.ts`), so every front end test is an accessibility test. Tests also call `expectNoA11yViolations()` themselves for each state they pass through before the end.
3. **This review** covers what tools can't: focus, keyboard flow, what a screen reader announces, and whether names make sense out of context. axe finds roughly a third of real problems, so this step is not optional.

## Steps

1. **Find what changed.** `git status --short frontend/` and `git diff HEAD -- frontend/` (plus untracked files). If the Stop hook listed files, start with those. Read each changed component or page in full, along with the shared components it uses.

2. **Review it against the checklist below.** For each problem, fix it in the component, unless the fix would change the design or how the UI looks or behaves in a way the user would notice. Then describe it and ask first.

3. **Write the tests,** in the component's sibling `.test.tsx`:
   - Reach every state the code renders: loading, loaded, empty, load error with Retry, form open, saving, validation error shown, delete confirm open, locked-version note shown. Each state is either where a test ends (checked automatically) or gets an explicit `await expectNoA11yViolations()` where the test passes through it. Use `{ page: true }` only for the app shell (`App.test.tsx`), and add each new route to its whole-page test.
   - Check loading and saving states with requests that never answer (`stubPendingApi()` in `src/test/stubApi.ts`, or a fetch mock that returns a pending promise), so the response can't arrive halfway through the axe check.
   - Add behavior tests for what axe can't see: where focus goes when a form or confirm opens and closes, that names are unique and descriptive (`getByRole('button', { name: 'Delete "Freelance"' })`), that status text lands in the live region.
   - Query by role and accessible name (`getByRole`, `getByLabelText`) rather than by text or class, so the tests fail when the accessible name breaks.

4. **Run the checks:** `cd frontend && node_modules/.bin/vitest run && node_modules/.bin/tsc -b`. The test run includes oxlint's jsx-a11y rules; run `node_modules/.bin/oxlint` too for the other lint rules. All must pass.

5. **Report:** what you reviewed, what you fixed, the tests you added, and anything left for the user to decide.

## Checklist

**Names and labels**
- Every input, select, and textarea has a visible `<label>` (wrapping the control, as `NameForm` does). Placeholder text is not a label.
- Buttons and links say what they do. When a card repeats the same button ("Rename", "Delete"), give each one an `aria-label` that names its item, starting with the visible text (WCAG 2.5.3, label in name): `aria-label={`Delete "${name}"`}`.
- Icon-only buttons (the ⠿ drag handle) have an `aria-label`.
- Anything that can be dragged also works by keyboard and by single clicks (WCAG 2.5.7); reuse `OrderedList` for reordering.
- Required fields carry `aria-required="true"` (the backend still validates).
- Fields for the user's own details have `autoComplete` (`name`, `email`, `tel`, `url`) (WCAG 1.3.5).

**Errors and status**
- An error tied to a field sets `aria-invalid` on it and links the message with `aria-describedby`, so it's read again when the field gets focus.
- Errors use `role="alert"`. Success and progress notices go in a `role="status"` element that is always rendered (empty when there's nothing to say), since a live region added together with its text often isn't announced.
- Don't rely on color alone: invalid fields also get the message, and "sent" uses a text tag.

**Focus and keyboard**
- Everything works with the keyboard alone, in a sensible tab order. Use real `<button>`, `<a>`, `<details>`, and form elements, never a `div` with a click handler.
- When something opens in place (a rename form, an edit form, a delete confirm), focus moves into it: the first field of a form, the Cancel button of a confirm.
- When it closes, focus goes back to the button that opened it, or to that item's new button if saving made a new version. After a delete, focus goes to the page heading (`tabIndex={-1}`), since the item is gone. Never leave focus on an element that was removed or disabled.
- Don't use `autoFocus` (jsx-a11y flags it). Focus from an effect or after the state change instead.
- Visible focus: never remove outlines without a replacement.

**Structure**
- One `h1` (the app shell), an `h2` per page, and headings that don't skip levels inside a page.
- Lists of items are `<ul>`/`<ol>`. Groups of related controls have a name (`role="group"` with `aria-label`, or `fieldset` with `legend`).
- Each page sets `document.title` (WCAG 2.4.2) through `usePageTitle`.
- The shell keeps `header`, `nav`, and `main` landmarks, with page content inside `main`.

**Color and motion**
- Text contrast is at least 4.5:1, or 3:1 for text at least 24px (or bold and at least 18.66px). Field borders, focus outlines, and other parts of controls are at least 3:1 (WCAG 1.4.11). When you add a text color or a background to `index.css`, add the pair to `CONTRAST_PAIRS` in `frontend/a11yChecks.ts`.
- Respect `prefers-reduced-motion` for any animation.

**Content**
- Collapsibles use `Collapsible` (native `<details>`), which keyboards and screen readers already handle.
- Text a screen reader hears out of context still makes sense ("Used by (2)", not "(2)").
