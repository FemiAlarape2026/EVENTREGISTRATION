# Event Registration: AI-Gated Deployment

A small event registration website (HTML, CSS, JavaScript) with an automatic publishing pipeline.
Every time a change is pushed, the pipeline decides whether the change is safe to publish.

## How it works
1. **Push** a change to the `main` branch on GitHub.
2. **Rule checks** (`scripts/rule_checks.js`) run first. They are fixed checks: do the files exist,
   does the JavaScript have errors, is `departments.json` valid, do the files the page points to exist,
   and are there any obvious passwords or keys.
3. **AI review** (`scripts/ai_gate.js`) sends the change and the complete website files to an AI model (gate version 2; version 1 saw only the changed files), which answers
   `deploy` or `hold` with a short reason. If the AI cannot be reached, the answer is `hold`.
4. If the answer is `deploy`, the site is published to GitHub Pages automatically.

## How we test the gate
`eval/cases.json` holds 40 small test changes (20 harmless, 20 that break something): 30 from round 1 and 10 new ones added in round 2.
`eval/truth.js` opens each changed site in a real browser and checks that the form still works. This gives
the true answer for every change. `eval/run_eval.js` then compares four set-ups against that truth:
always publish, rule checks only, AI only, and rule checks + AI.
Results are written to `eval/results/`.

## Files
| File | Purpose |
|---|---|
| `index.html`, `style.css`, `script.js`, `departments.json` | The website |
| `scripts/rule_checks.js` | Fixed checks (no AI) |
| `scripts/gate_lib.js` | The instructions given to the AI and the call to the AI service |
| `scripts/ai_gate.js` | Runs the review in the pipeline |
| `eval/` | The 30 test changes, the browser tests and the evaluation script |
| `.github/workflows/deploy.yml` | The pipeline |
| `.github/workflows/evaluate.yml` | Runs the evaluation on GitHub |

The OpenAI key is stored only in GitHub (Settings > Secrets and variables > Actions), never in the code.
