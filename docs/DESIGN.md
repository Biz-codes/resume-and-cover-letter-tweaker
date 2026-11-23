# Design decisions

Before the app was restyled for release, each part of its look was mocked up as two or three options and chosen one at a time. The goal for every choice: as user-friendly as possible, cleanly laid out, and obvious where to click for what, while keeping WCAG 2.2 AA (every text color at least 4.5:1, every control edge and icon at least 3:1, and nothing told apart by color alone).

These are the mockups, not screenshots of the running app. They use made-up demo data (Riley Moreno, a front end engineer). The decisions are recorded in "Before release: the look" in [BUILD_PLAN.md](BUILD_PLAN.md).

## The palette: calm teal

<img src="images/design/palette-teal.png" width="420" alt="The teal palette's swatches, and a sample of the header, a posting card with an applied tag, the main, ordinary, and delete buttons, a text field, and a note">

Teal accent `#0f766e` on a soft gray-green page, white cards, and red kept for Delete and errors. Clear without being corporate.

<details><summary>Also considered</summary>

| Clear blue | Soft violet |
| --- | --- |
| <img src="images/design/palette-blue.png" width="300" alt="The same sample in a blue palette"> | <img src="images/design/palette-violet.png" width="300" alt="The same sample in a violet palette"> |

</details>

## Status colors: success in teal

<img src="images/design/status-teal.png" width="420" alt="An applied card and its success message in teal, a page-fit warning in amber, and a refused field with its error in red">

"It worked" uses the accent itself, so there's one fewer color to learn. Every message also says what happened in words.

<details><summary>Also considered</summary>

| Success in a separate green |
| --- |
| <img src="images/design/status-green.png" width="300" alt="The same messages with success in green"> |

</details>

## The header: name and navigation in one row

<img src="images/design/header-row.png" alt="A short white header bar with the app's name on the left and five links on the right, the current page tinted teal">

The most compact header, which leaves height for the document page. The current page is marked with a tint, color, and bold, not bold alone.

<details><summary>Also considered</summary>

| Name above the nav | Nav down the side |
| --- | --- |
| <img src="images/design/header-stacked.png" width="420" alt="The name on its own line with tab-style links below"> | <img src="images/design/header-side.png" width="420" alt="The name and links in a column on the left"> |

</details>

## Corners: rounded

<img src="images/design/corners-rounded.png" width="420" alt="A bullet's card with a tag, a field, a dropdown, and Save, Cancel, and Delete, with 8px corners">

8px corners on buttons and fields, 12px on cards: friendly, and buttons still read clearly as buttons. Buttons are at least 40px tall.

<details><summary>Also considered</summary>

| Slightly rounded | Pill buttons |
| --- | --- |
| <img src="images/design/corners-slight.png" width="300" alt="The same card with 4px corners"> | <img src="images/design/corners-pill.png" width="300" alt="The same card with fully rounded buttons"> |

</details>

## Density: comfortable

<img src="images/design/density-comfortable.png" width="520" alt="Part of a resume's tree with roomy rows and 40px buttons">

Roomy rows and 40px buttons everywhere, so the resume's text is easy to read and every control easy to hit.

<details><summary>Also considered</summary>

| Compact |
| --- |
| <img src="images/design/density-compact.png" width="420" alt="The same tree with tighter rows and 32px buttons"> |

</details>

## Row actions as quiet icons

<img src="images/design/icons-quiet.png" width="520" alt="The tree's rows with move, edit, Ask Claude, and remove icons and no outlines, one focused with its Ask Claude tooltip">

Each row's four actions (Move, View and Edit, Ask Claude, Remove) are icons without outlines until hovered or focused, so the resume's text stands out. Screen readers still hear each button's full name ("Ask Claude about Front End Engineer"), and a tooltip of the app's own shows the short name on hover and on keyboard focus. Remove is a minus in a circle, not a trash can, since it only takes the item out of this resume; the library keeps it. The icons come from [Lucide](https://lucide.dev).

<details><summary>Also considered</summary>

| Outlined icon buttons | The Ask Claude icon |
| --- | --- |
| <img src="images/design/icons-outlined.png" width="420" alt="The same rows with an outline around every icon"> | <img src="images/design/ask-claude-icons.png" width="300" alt="Three Ask Claude icons: a speech bubble, a speech bubble with dots (chosen), and sparkles"> |

</details>

## The document page: a title bar and a toolbar

<img src="images/design/document-toolbar.png" alt="A resume's page: the title with a pencil and Copy and Delete, a toolbar with the page-fit note, the tone, and Undo and Redo, the tree, and the chat with Claude beside it">

The title shares a row with Copy and Delete, and one toolbar holds the page-fit note, the tone, and Undo and Redo, so the resume's tree starts high on the page.

<details><summary>Also considered</summary>

| The original order, restyled |
| --- |
| <img src="images/design/document-stacked.png" width="520" alt="The same page with each control on its own line under a Contents heading"> |

</details>

## The chat: named, with your messages on the right

<img src="images/design/chat-named.png" width="320" alt="The chat panel: your message on the right headed You, and Claude's reply on the left headed Claude, with a proposed change to apply or dismiss">

A combination of the two options: every message is headed "You" or "Claude", so who's speaking never depends on the side alone, while your messages sit on the right and Claude's use the full width, leaving room for its proposal cards.

<details><summary>Also considered</summary>

| Bubbles |
| --- |
| <img src="images/design/chat-bubbles.png" width="260" alt="The same chat as bubbles, without names"> |

</details>

## The library: its pages down the side

<img src="images/design/library-side.png" alt="The library's Experience page: eleven page links in a column on the left, and the roles as one card per row">

The library's eleven pages are listed in a column, so every one is visible at once and the list never wraps. Items are one card per row, so long text reads in full.

<details><summary>Also considered</summary>

| The pages in a row |
| --- |
| <img src="images/design/library-row.png" width="520" alt="The same page with the eleven links wrapping in a row above it"> |

</details>

## The item dialog: a side sheet

<img src="images/design/dialog-sheet.png" alt="A bullet's dialog as a full-height panel from the right over the dimmed resume">

Editing an item opens a full-height panel from the right, which fits more without scrolling and keeps the document in view. It's still a modal dialog: focus stays inside, and Escape closes it.

<details><summary>Also considered</summary>

| Centered |
| --- |
| <img src="images/design/dialog-centered.png" width="520" alt="The same dialog as a centered box"> |

</details>

## A job posting's page: tracking on the side

<img src="images/design/posting-two-columns.png" alt="A posting's page: the resume and cover letter, Review together, and the job description on the left, and application tracking on the right">

The work (the resume and cover letter, the review, the description) on the left, and where the application stands on the right, visible without scrolling.

<details><summary>Also considered</summary>

| One column |
| --- |
| <img src="images/design/posting-one-column.png" width="520" alt="The same page with everything in one column"> |

</details>

## Badges in Claude's draft: a tint for each

<img src="images/design/badges-tinted.png" width="420" alt="Draft rows badged Claude in violet, Original in gray, Library in teal, and Flagged in red">

Reviewing Claude's first draft is mostly spotting what Claude changed, so each badge has its own tint as well as its word.

<details><summary>Also considered</summary>

| Plain badges |
| --- |
| <img src="images/design/badges-plain.png" width="300" alt="The same rows with outlined badges and only Flagged in red"> |

</details>

## The favicon: a document and a pen

<img src="images/design/favicons.png" width="520" alt="Three favicon options at large and tab size: a document, the initials RT, and a document with a pen (chosen)">

A page with a pen over it, matching the pencil used throughout the app, and readable at tab size.

## Smaller choices

- **Home:** the four starting points as large cards in a 2-by-2 grid.
- **Job postings:** one card per posting, like the library.
- **Opening and closing a level:** a chevron before its title, pointing right or down.
- **Loading:** a small spinner beside "Loading…", which stops turning for people who ask for less motion.
- **Empty lists:** the same words in a box with a dashed edge, where the cards would be.
- **Dark mode** comes later; the colors are variables, so a second set can be added.
