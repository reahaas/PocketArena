---
name: add-playbook-feature
description: Checklist for changing the coach Playbook (editor, library, practice, scoring, video export, storage). Use for any playbook work.
---
# Playbook change checklist

Read `docs/playbook.md` first. Touch-points:

- Data model + validation: `src/networking/NetworkProtocol.ts` (`Play`, `PlaybookDraft`, `parseStep`/`parsePlay`/`parseDraft`). New fields must be optional or migrated so saved plays still load.
- Math: `src/game/PlaybookMath.ts` (`expectedPlaybookPosition`, `minimumPlaybookStepDurationMs`).
- Practice/scoring: `src/game/PlaybookPractice.ts`; HUD/panes in `src/ui/PlaybookPractice*.ts`.
- Editor/library UI: `src/ui/PlaybookEditor.ts`, `PlaybookPane.ts`, `PlaybookInstructions.ts` (update the instructions text when flow changes).
- Orchestration: `runPlaybookStudio` in `src/app/App.ts`; teardown via `cleanupPractice` etc.
- Storage: `src/storage/PlaybookStorage.ts` (autosaved draft + saved plays).
- Constants in `src/config/constants.ts`.
- Tests: `tests/playbookMath.test.ts`, `tests/playbookPractice.test.ts`, `tests/protocol.test.ts`, plus an `e2e/playbook-*.spec.ts` for UI flows.

Invariants: editor is offline and has no joystick; step duration >= minimum; practice has a 3s countdown and 2s grace after the play ends. Then run the `verify-change` skill.
