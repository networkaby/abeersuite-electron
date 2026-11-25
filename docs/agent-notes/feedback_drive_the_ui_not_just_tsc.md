---
name: feedback-drive-the-ui-not-just-tsc
description: Type-check and lint pass while React state bugs survive; drive the real screen before claiming a UI works.
metadata:
  type: feedback
---

On the counter sign-in rebuild (2026-09-18), `tsc` and `eslint` were both clean while
two real bugs sat in the page: a `useCallback` dep change made an entry effect re-run on
every click and snap the screen back, and a keypad called its submit from inside a
`setState` updater — a render-phase update. Both only appeared when the screen was
actually clicked through.

**Why:** the owner tests on a real counter and reports with screenshots. A "types are
clean" claim that the screen then contradicts costs them a build cycle.

**How to apply:** for any UI change, drive the real component — dev server plus
`window.next.router.push` for a soft navigation that keeps injected stubs alive, or the
static-HTML harness for the Electron shell. Read the Next dev overlay through
`document.querySelector('nextjs-portal').shadowRoot`; console errors there do not show up
in `read_console_messages`. Check `document.hidden`: a hidden Browser pane defers React
renders and makes a working screen look dead. See [feedback_hidden_browser_pane_starves_effects](feedback_hidden_browser_pane_starves_effects.md).
