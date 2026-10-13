# Logic test trainer

A standalone practice page for abstract-reasoning matrix puzzles (3×3 grids with six answer options), served at `/logic-trainer/`. It is linked from the signed-out landing page and from the More hub. It opens in a new tab and needs no sign-in.

Everything runs in the browser: puzzles are generated client-side, and progress and run history are stored only in the visitor's `localStorage`. The Worker just serves static files, so the page uses no Worker CPU and no Supabase calls.

## Features

- **Timed test:** adaptive, up to 20 questions with 2 minutes each. It ends with an estimated 1–10 score and a percentile on the model's own bell curve (not a measured population norm). Scoring uses a 3-parameter IRT model, with the guessing parameter set to 1/6.
- **Untimed practice:** endless newly generated questions at a chosen difficulty, or three fixed 20-question sets. Each answer can be checked, with explanations.

Difficulty values are heuristic estimates and have not been calibrated against real test-takers.

## Files

| File | Purpose |
| --- | --- |
| `engine.js` | Procedural puzzle generator. Every item is determined by a family and a seed (ids look like `n:<family>:<seed>[:h]`). |
| `app.js` | UI, adaptive item selection and scoring. |
| `bank.json` | The 60 fixed questions behind the three fixed sets, as pre-rendered SVG markup. |
| `styles.css`, `index.html` | Page styles and shell. |
| `build.mjs` | Writes the served files to `../public/logic-trainer/`. |

## Building

The built files in `public/logic-trainer/` are committed. After editing anything here, run:

```sh
npm run build:logic-trainer --workspace @upgradr/web
```

`trainer.test.ts` fails if the committed output is stale. It also checks that the output contains no inline scripts, inline styles or `style=""` attributes, because the site's Content-Security-Policy (`worker/security.ts`) would block them. The page tests boot the built `trainer.js` in jsdom and cover recovery from corrupt saved state, the wall-clock question timer and the accessible answer buttons.
