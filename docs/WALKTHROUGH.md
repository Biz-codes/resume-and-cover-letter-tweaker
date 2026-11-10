# Walkthrough
The script for the 2 to 3 minute recording linked from the README, and the screenshots to take alongside it (see "Show the project early" in [BUILD_PLAN.md](BUILD_PLAN.md)). Everything shown comes from the demo data (`db/seed_demo.sql`, Riley Moreno, a made-up front end engineer), so no real applications appear.

## Before recording
1. Rebuild the demo database, so every take starts the same: `scripts/demo_db.sh --reset`
2. Start the API against it, from `backend/`: `DATABASE_URL=postgresql+psycopg://localhost:5433/resume_tweaker_demo .venv/bin/uvicorn app.main:app --reload`. It needs the Anthropic API key in `backend/.env`, since the take calls Claude twice (reading the posting, then tailoring the resume).
3. Start the front end, from `frontend/`: `npm run dev`, and open http://localhost:5173.
4. Set up the browser: a window about 1440 by 900, zoom at 100% or 110%, bookmarks bar and extensions hidden, and a private window so autofill doesn't show.
5. Copy the posting below to the clipboard.

Claude's replies take a while (tailoring the most). Keep talking over the wait, or cut it in editing. Claude's draft differs from take to take, so the narration in step 4 points at whatever it did rather than naming a bullet.

## The posting to paste
A made-up posting that fits Riley's library: the Leaflet map project, the Vite build bullet, and the mentoring bullet aren't in the base resume, so Claude has something to bring in from the library.

Link: `https://cedarlinetransit.example.com/jobs/front-end-engineer-maps`

```text
Front End Engineer, Trip Planner
Cedar Line Transit, Portland, OR (hybrid)

Cedar Line Transit runs bus and light rail service for 400,000 riders a day. Our trip planner is how most of them find their next ride, and many of our riders use screen readers, magnifiers, or keyboard navigation.

What you'll do
- Build new features for the trip planner in React and TypeScript
- Own the interactive route map (Leaflet), including keyboard and screen reader support
- Keep the planner fast on older phones and slow connections
- Write automated tests, including accessibility checks in CI
- Mentor newer engineers on the team

What we're looking for
- 3+ years building production React and TypeScript apps
- Hands-on experience with WCAG 2.2 AA and testing with assistive technology
- Experience with web maps (Leaflet, Mapbox, or similar)
- Familiarity with modern build tools such as Vite
- Comfort explaining technical tradeoffs to designers and planners

We offer a pension, transit pass, and 4 weeks of paid time off.
```

## The script
Times are a guide; the whole take should land between 2 and 3 minutes.

1. **What it is (0:00 to 0:15).** Start on Home. "Tailoring a resume in an AI chat works, but every version gets lost in old chats. This app keeps a library of everything I've written, has Claude tailor it to each posting, and saves every version so the next application starts from the best earlier one. Claude suggests and I decide."
2. **Paste in a posting (0:15 to 0:40).** Job postings, then "New job posting". Paste the link, then "Paste the description" and paste the posting. "Read posting." "Many job sites block automated requests, so I can paste the description in. Claude pulls out the organization, role title, and description, and I check them before anything is saved." Point at the filled-in fields, then "Save posting".
3. **The header (0:40 to 0:50).** The posting opens on its header, suggested from Riley's last one with the role title as the headline. "Use this header." "The headline is the job title, never the company's name."
4. **Claude tailors the resume (0:50 to 1:40).** "Start a resume", leave "Claude tailors one of your saved resumes" and "The best fit (Claude picks)", pick the Tech tone, "Start resume". While it works: "Claude picks the saved resume that fits best, swaps in better items from my library, and makes small wording changes for the posting's keywords, following my writing rules, which ban filler like 'leverage' and 'results-driven'."
   When the draft opens, show where Claude started from and why. Open a few rows:
   - a row badged **Library** (likely the Trailhead Finder map project or the Vite bullet): open "Rationale" for Claude's reason
   - a row badged **Claude** (a rewording): open "Rationale", show the original, "Use the original", then "Use Claude's wording" again
   - "Reject" on a Library row, then Undo
   - on a second Claude rewording, "Use the original", and leave it there (so step 5's dialog has something to list; it's skipped when the draft uses all of Claude's text)
   "Every suggestion comes with its reason, and nothing is saved until I approve it."
5. **Approve and finish (1:40 to 2:05).** "Approve first draft." The dialog, "Claude's text you didn't use", lists the wording left out: "Anything I didn't use, I can keep in the library for later or let go." Check it, then "Approve first draft". "Claude's wordings I kept are now new library items, and the originals are still there." Open "Preview and copy" and copy the whole resume. "Plain text, ready to paste into my own template or an application form."
6. **Every version is saved (2:05 to 2:40).** Open Job postings, then Marigold Health (applied to), then its resume. "Once I record the date I applied, that resume is locked as a record of what I sent." Then Library, Bullet points, and View and Edit on a bullet the new resume uses. Open "Used by": "One bullet, stored once, used by the base resume, the one I sent to Marigold, and the new one. Next time, Claude starts from all of these."
7. **Close (2:40 to 2:50).** "It's built with FastAPI, Postgres, React, and the Claude API, and it's accessible to WCAG 2.2 AA, checked in every test. The code and design docs are on GitHub."

## Screenshots
Take these in the same take, or after it, at the same window size. Save them as PNGs in `docs/images/` with these names, so the README's links work:
- `posting-read.png`: the new posting form filled in by Claude, before "Save posting"
- `draft-review.png`: the draft with one Library row and one Claude row, each with "Rationale" open, the original showing under the Claude row
- `approve-dialog.png`: the "Claude's text you didn't use" dialog
- `used-by.png`: a bullet's dialog with "Used by" open, listing more than one resume
- `walkthrough.gif` (optional): steps 4 and 5 sped up, under 10 MB so GitHub shows it inline
