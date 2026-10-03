---
applyTo: "src/ui/**,src/style.css,src/app/**"
---
- UI is plain DOM built with helpers in `src/ui/dom.ts` (`el`, `button`); no frameworks.
- Mobile-first: touch targets, bottom-docked controls, never cover the game field in editor flows.
- Always clean up listeners, animation frames and DOM in `destroy()`; App.ts tracks panes and must tear them down on cancel/finish.
- User-visible flows need a Playwright spec in `e2e/` (see `e2e/playbook-practice.spec.ts`).
