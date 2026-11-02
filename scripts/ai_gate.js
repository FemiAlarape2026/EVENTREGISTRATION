// Used by the pipeline. Reads what changed in the latest push, runs the rule checks,
// then asks the AI. Writes the decision for the next pipeline step.
const { execSync } = require("child_process");
const fs = require("fs");
const { checkFolder, REQUIRED } = require("./rule_checks");
const { gate } = require("./gate_lib");

const sh = (c) => execSync(c, { encoding: "utf8", maxBuffer: 20e6 });
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbd7d4a0";

function out(decision, text) {
  console.log(text);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `decision=${decision}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### AI deployment gate\n\n**Decision: ${decision.toUpperCase()}**\n\n${text}\n`);
}

(async () => {
  let base = process.argv[2] || "";
  if (!base || /^0+$/.test(base)) base = EMPTY_TREE;
  try { sh(`git cat-file -e ${base}`); } catch { base = EMPTY_TREE; }

  // 1. Fixed rule checks
  const rules = checkFolder(".");
  if (!rules.ok) return out("hold", "Rule checks failed, so the AI was not asked:\n- " + rules.problems.join("\n- "));

  // 2. What changed (only the website files)
  const changed = sh(`git diff --name-only ${base} HEAD`).split("\n").filter((f) => REQUIRED.includes(f));
  if (!changed.length) return out("deploy", "No website files changed. Nothing risky to review.");
  const diff = sh(`git diff ${base} HEAD -- ${changed.join(" ")}`);
  const files = {};
  for (const f of changed) files[f] = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;

  // 3. Ask the AI
  const r = await gate(diff, files);
  const text = `AI decision: ${r.decision} (risk: ${r.risk || "n/a"})\nReason: ${r.reason || r.error}`;
  out(r.decision, text);
})().catch((e) => { out("hold", "Gate error, so the change was held: " + e.message); });
