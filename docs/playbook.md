# Playbook

A coach builds a **Play** offline from the home screen (no room needed), saves it locally, then runs it with a team or practices it solo.

## Data model (`NetworkProtocol.ts`)
- `Play`: name, sport (optional), `durationMs`, `assignments[]` (per team + jersey number, ordered `steps`), optional metadata.
- `PlaybookStep`: `startMs`, `durationMs`, `fromX/fromY`, `toX/toY`.
- `PlaybookDraft`: autosaved editor state (name, timestamp, `sourcePlayId` when editing an existing play).
- Parsers validate everything from storage, import and network.

## Rules
- Step duration >= `minimumPlaybookStepDurationMs(from, to)` = travel time at `PLAYER_SPEED`, rounded up to 10 ms. Default new step: `DEFAULT_STEP_DURATION_MS` (500 ms). Users may lengthen, never shorten.
- Between steps a player holds at the last known position (`expectedPlaybookPosition`).
- Sport/field type: soccer, basketball, water polo; stored per play.

## Editor / library
- Bottom-docked editor so the field stays fully visible; joystick disabled; add/remove players per team (e.g. 6:6 or 2:0); instructions popup.
- Library: Practice, Run, Load (edit), Export, Delete. Saving a loaded play updates it by id. Drafts autosave and can be resumed.
- Video/GIF-style export via canvas `MediaRecorder` (`src/media/PlaybookVideoExport.ts`).

## Practice (solo)
- Pick one role; other roles are ghosts (`showOtherGhosts`). 3 s countdown (`PLAYBOOK_PRACTICE_COUNTDOWN_MS`), play runs, then 2 s grace (`PLAYBOOK_PRACTICE_GRACE_MS`).
- Score: position accuracy (mean distance error sampled every 200 ms) 70% + arrival timing 30%. Client-only; multiplayer grading in `NetworkHost.finalizePlaybook` is position-only.
- Results pane offers Share (Web Share with video file, fallback download/clipboard).

## Tests
`tests/playbookMath.test.ts`, `tests/playbookPractice.test.ts`, `tests/protocol.test.ts`, `e2e/playbook-practice.spec.ts`, `e2e/playbook-duration.spec.ts`.
