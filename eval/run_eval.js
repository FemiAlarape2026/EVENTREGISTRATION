// Runs every test change through: the real browser checks (the truth), the fixed rule checks,
// and the AI gate (several runs). Writes the results to eval/results/.
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");
const { checkFolder, REQUIRED } = require("../scripts/rule_checks");
const { gate } = require("../scripts/gate_lib");
const { runChecks } = require("./truth");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "results");
const RUNS = parseInt(process.env.EVAL_RUNS || "3", 10);
const PRICE_IN = 0.10 / 1e6, PRICE_OUT = 0.50 / 1e6;   // US$ per token (set to your model's prices)
const SKIP_AI = process.env.EVAL_SKIP_AI === "1";
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';

function makeVariant(c, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of REQUIRED) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  for (const e of c.edits) {
    const p = path.join(dir, e.file); let t = fs.readFileSync(p, "utf8");
    const eol = t.includes("\r\n") ? "\r\n" : "\n";            // Windows files use \r\n
    const fix = (x) => x.replace(/\r?\n/g, eol);
    if (e.append !== undefined) t += fix(e.append);
    else { const f = fix(e.find); if (t.split(f).length !== 2) throw new Error(`${c.id}: text to replace not found exactly once`); t = t.replace(f, () => fix(e.replace)); }
    fs.writeFileSync(p, t);
  }
}
function diffOf(dir) {
  let all = "";
  const changed = {};
  for (const f of REQUIRED) {
    const a = fs.readFileSync(path.join(ROOT, f), "utf8"), b = fs.readFileSync(path.join(dir, f), "utf8");
    if (a === b) continue;
    changed[f] = b;
    const r = spawnSync("diff", ["-u", "--label", "a/" + f, "--label", "b/" + f, path.join(ROOT, f), path.join(dir, f)], { encoding: "utf8" });
    all += `diff --git a/${f} b/${f}\n` + r.stdout;
  }
  return { diff: all, changed };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "cases.json"), "utf8"));
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "evalcases-"));
  const rows = [], runs = [];
  for (const c of cases) {
    const dir = path.join(tmp, c.id); makeVariant(c, dir);
    const { diff, changed } = diffOf(dir);
    const failed = await runChecks(dir);
    const truth = failed.length || c.plantedCredential ? "hold" : "deploy";   // "hold" = should NOT be published
    const rules = checkFolder(dir);
    const row = { id: c.id, title: c.title, truth, failed: failed.concat(c.plantedCredential ? ["planted credential"] : []).join("; "), rules: rules.ok ? "deploy" : "hold", rulesWhy: rules.problems.join("; ") };
    if (!SKIP_AI) for (let r = 1; r <= RUNS; r++) {
      const g = await gate(diff, changed);
      runs.push({ id: c.id, run: r, decision: g.decision, risk: g.risk, reason: g.reason, promptTokens: g.promptTokens, completionTokens: g.completionTokens, ms: g.ms, error: g.error });
    }
    rows.push(row);
    console.log(`${c.id} truth=${truth} rules=${row.rules}${SKIP_AI ? "" : " ai=" + runs.filter((x) => x.id === c.id).map((x) => x.decision[0]).join("")}  ${row.failed}`);
  }
  // ---- files
  fs.writeFileSync(path.join(OUT, "cases.csv"), "id,title,truth,failed_checks,rules_decision,rules_reason\n" + rows.map((r) => [r.id, r.title, r.truth, r.failed, r.rules, r.rulesWhy].map(csv).join(",")).join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "runs.csv"), "id,run,decision,risk,reason,prompt_tokens,completion_tokens,ms,error\n" + runs.map((r) => [r.id, r.run, r.decision, r.risk, r.reason, r.promptTokens, r.completionTokens, r.ms, r.error].map(csv).join(",")).join("\n") + "\n");
  // ---- summary
  const truthOf = Object.fromEntries(rows.map((r) => [r.id, r.truth]));
  const rulesOf = Object.fromEntries(rows.map((r) => [r.id, r.rules]));
  const score = (list) => {      // list of {truth, decision}
    const n = list.length, ok = list.filter((x) => x.truth === x.decision).length;
    return { n, correct: ok, pct: n ? +(100 * ok / n).toFixed(1) : 0,
      badLetThrough: list.filter((x) => x.truth === "hold" && x.decision === "deploy").length,
      goodBlocked: list.filter((x) => x.truth === "deploy" && x.decision === "hold").length };
  };
  const S = { cases: rows.length, faulty: rows.filter((r) => r.truth === "hold").length, safe: rows.filter((r) => r.truth === "deploy").length, runsPerCase: RUNS };
  S.alwaysDeploy = score(rows.map((r) => ({ truth: r.truth, decision: "deploy" })));
  S.rulesOnly = score(rows.map((r) => ({ truth: r.truth, decision: r.rules })));
  if (!SKIP_AI) {
    S.aiOnly = score(runs.map((x) => ({ truth: truthOf[x.id], decision: x.decision })));
    S.rulesPlusAi = score(runs.map((x) => ({ truth: truthOf[x.id], decision: rulesOf[x.id] === "hold" || x.decision === "hold" ? "hold" : "deploy" })));
    const byCase = {}; runs.forEach((x) => (byCase[x.id] = byCase[x.id] || []).push(x.decision));
    S.casesWhereRunsDisagree = Object.entries(byCase).filter(([, d]) => new Set(d).size > 1).map(([k]) => k);
    S.aiErrors = runs.filter((x) => x.error).length;
    const ms = runs.map((x) => x.ms).sort((a, b) => a - b);
    S.meanSeconds = +(ms.reduce((a, b) => a + b, 0) / ms.length / 1000).toFixed(2);
    S.p95Seconds = +(ms[Math.floor(0.95 * (ms.length - 1))] / 1000).toFixed(2);
    S.promptTokens = runs.reduce((a, x) => a + x.promptTokens, 0); S.completionTokens = runs.reduce((a, x) => a + x.completionTokens, 0);
    S.costUSD = +(S.promptTokens * PRICE_IN + S.completionTokens * PRICE_OUT).toFixed(4);
    S.costPer1000Changes = +(S.costUSD / runs.length * 1000).toFixed(3);
    S.wrongAiRuns = runs.filter((x) => x.decision !== truthOf[x.id]).map((x) => `${x.id} run${x.run}: ${x.decision} (truth ${truthOf[x.id]})`);
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(S, null, 2));
  const row = (n, s) => s ? `| ${n} | ${s.n} | ${s.correct} (${s.pct}%) | ${s.badLetThrough} | ${s.goodBlocked} |` : "";
  const md = ["# Evaluation summary", "", `Cases: ${S.cases} (${S.faulty} faulty, ${S.safe} safe). AI runs per case: ${RUNS}.`, "",
    "| Set-up | Decisions | Correct | Faulty changes let through | Safe changes blocked |", "|---|---|---|---|---|",
    row("Always publish", S.alwaysDeploy), row("Rule checks only", S.rulesOnly), row("AI gate only", S.aiOnly), row("Rule checks + AI gate", S.rulesPlusAi), ""].join("\n");
  fs.writeFileSync(path.join(OUT, "summary.md"), md + "\n\n```json\n" + JSON.stringify(S, null, 2) + "\n```\n");
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
})();
