// The panel beside a resume or cover letter (docs/APP_FLOW.md): the chat with Claude, and for a
// posting's document, the job posting too. It's always on the page: collapsed, it shows a button
// for each (named for what it opens, with aria-expanded), and expanded, it shows them as two tabs, so switching keeps the chat's place (each
// tab's content stays in the page while the other shows). With one tab (a base document, or the
// posting while Claude's draft is reviewed), it's headed by that tab's name, with no tabs. On large
// screens it's a column beside the document that stays in view while the page scrolls; below them
// it covers the page (DocumentPage hides the document while it's expanded), and Collapse goes back.
// Collapsed, it sits beside the document on large screens and above it below them.
//
// The tabs follow the ARIA tabs pattern: one tab stop, the arrow keys (and Home and End) move
// between them and show the one they move to, and each tab names its panel.
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import styles from './SidePanel.module.css'

export type SideTab = 'chat' | 'posting'

export interface PanelTab {
  key: SideTab
  label: string
  // What the tab shows, or null when it hasn't been opened yet (nothing to keep in place).
  content: ReactNode | null
}

export const SIDE_HEADING_ID = 'side-panel-heading'
export const sideTabId = (key: SideTab) => `side-tab-${key}`
// Each tab's button in the collapsed panel, where focus goes back when it collapses.
export const openButtonId = (key: SideTab) => `side-open-${key}`
const panelId = (key: SideTab) => `side-tabpanel-${key}`

// The Collapse button's text when the panel shows only that tab.
const COLLAPSE_ONE: Record<SideTab, string> = { chat: 'Collapse chat', posting: 'Collapse job posting' }

export default function SidePanel({
  tabs,
  open,
  selected,
  onOpen,
  onSelect,
  onClose,
  announcement = '',
}: {
  tabs: PanelTab[]
  // Expanded, showing `selected`; otherwise collapsed to its buttons.
  open: boolean
  selected: SideTab
  // A collapsed panel's button: expand it on that tab.
  onOpen: (key: SideTab) => void
  onSelect: (key: SideTab) => void
  onClose: () => void
  // What a tab says (the chat's "Claude is replying", then the reply), in a live region outside the
  // tabs, so it's heard whichever tab shows.
  announcement?: string
}) {
  const tabRefs = useRef(new Map<SideTab, HTMLButtonElement>())
  const single = tabs.length === 1
  const name = tabs.map((tab) => tab.label).join(' and ')

  function onKeyDown(event: KeyboardEvent) {
    const index = tabs.findIndex((tab) => tab.key === selected)
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    onSelect(tabs[next].key)
    tabRefs.current.get(tabs[next].key)?.focus()
  }

  if (!open) {
    return (
      <aside className={`${styles.panel} ${styles.collapsed}`} aria-labelledby={SIDE_HEADING_ID}>
        {/* For screen readers moving by heading or landmark; the buttons say the rest. */}
        <h3 id={SIDE_HEADING_ID} tabIndex={-1} className="visually-hidden">
          {name}
        </h3>
        <div className={styles.openButtons}>
          {tabs.map((tab) => (
            <button key={tab.key} type="button" id={openButtonId(tab.key)} aria-expanded="false" onClick={() => onOpen(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className={styles.panel} aria-labelledby={SIDE_HEADING_ID}>
      <div className={styles.top}>
        {/* With tabs, the heading is for screen readers moving by heading; the tabs say the rest. */}
        <h3 id={SIDE_HEADING_ID} tabIndex={-1} className={single ? undefined : 'visually-hidden'}>
          {name}
        </h3>
        {!single && (
          <div role="tablist" aria-label={name} className={styles.tabs}>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                ref={(element) => {
                  if (element) tabRefs.current.set(tab.key, element)
                  else tabRefs.current.delete(tab.key)
                }}
                type="button"
                role="tab"
                id={sideTabId(tab.key)}
                aria-selected={tab.key === selected}
                aria-controls={panelId(tab.key)}
                tabIndex={tab.key === selected ? 0 : -1}
                className={styles.tab}
                onClick={() => onSelect(tab.key)}
                onKeyDown={onKeyDown}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {/* Starts with its visible text, and names everything it collapses. */}
        <button type="button" aria-expanded="true" aria-label={single ? undefined : `Collapse ${name}`} onClick={onClose}>
          {single ? COLLAPSE_ONE[tabs[0].key] : 'Collapse'}
        </button>
      </div>
      {tabs.map((tab) =>
        single ? (
          <div key={tab.key}>{tab.content}</div>
        ) : (
          tab.content !== null && (
            <div
              key={tab.key}
              role="tabpanel"
              id={panelId(tab.key)}
              aria-labelledby={sideTabId(tab.key)}
              hidden={tab.key !== selected}
              className={styles.tabPanel}
            >
              {tab.content}
            </div>
          )
        ),
      )}
      {/* A plain live region rather than role="status", so the page's notices stay in AlertDialog. */}
      <p aria-live="polite" className="visually-hidden">
        {announcement}
      </p>
    </aside>
  )
}
