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
function allFilesOf(dir) { const o = {}; for (const f of REQUIRED) o[f] = fs.readFileSync(path.join(dir, f), "utf8"); return o; }
const VERSIONS = (process.env.EVAL_VERSIONS || "v1,v2").split(",");
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
    row.group = c.group || "original";
    const allFiles = allFilesOf(dir);
    if (!SKIP_AI) for (const version of VERSIONS) for (let r = 1; r <= RUNS; r++) {
      const g = await gate(diff, changed, allFiles, version);
      runs.push({ id: c.id, version, run: r, decision: g.decision, risk: g.risk, reason: g.reason, promptTokens: g.promptTokens, completionTokens: g.completionTokens, ms: g.ms, error: g.error });
    }
    rows.push(row);
    console.log(`${c.id} truth=${truth} rules=${row.rules}${SKIP_AI ? "" : VERSIONS.map((v) => " " + v + "=" + runs.filter((x) => x.id === c.id && x.version === v).map((x) => x.decision[0]).join("")).join("")}  ${row.failed}`);
  }
  // ---- files
  fs.writeFileSync(path.join(OUT, "cases.csv"), "id,group,title,truth,failed_checks,rules_decision,rules_reason\n" + rows.map((r) => [r.id, r.group, r.title, r.truth, r.failed, r.rules, r.rulesWhy].map(csv).join(",")).join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, "runs.csv"), "id,version,run,decision,risk,reason,prompt_tokens,completion_tokens,ms,error\n" + runs.map((r) => [r.id, r.version, r.run, r.decision, r.risk, r.reason, r.promptTokens, r.completionTokens, r.ms, r.error].map(csv).join(",")).join("\n") + "\n");
  // ---- summary
  const truthOf = Object.fromEntries(rows.map((r) => [r.id, r.truth]));
  const rulesOf = Object.fromEntries(rows.map((r) => [r.id, r.rules]));
  const groupOf = Object.fromEntries(rows.map((r) => [r.id, r.group]));
  const score = (list) => {      // list of {truth, decision}
    const n = list.length, ok = list.filter((x) => x.truth === x.decision).length;
    return { n, correct: ok, pct: n ? +(100 * ok / n).toFixed(1) : 0,
      badLetThrough: list.filter((x) => x.truth === "hold" && x.decision === "deploy").length,
      goodBlocked: list.filter((x) => x.truth === "deploy" && x.decision === "hold").length };
  };
  const groups = { all: () => true, original: (id) => groupOf[id] === "original", new: (id) => groupOf[id] === "new" };
  const S = { cases: rows.length, faulty: rows.filter((r) => r.truth === "hold").length, safe: rows.filter((r) => r.truth === "deploy").length, runsPerCase: RUNS, results: {} };
  for (const [g, f] of Object.entries(groups)) {
    const rs = rows.filter((r) => f(r.id));
    S.results[g] = { cases: rs.length, faulty: rs.filter((r) => r.truth === "hold").length,
      alwaysDeploy: score(rs.map((r) => ({ truth: r.truth, decision: "deploy" }))),
      rulesOnly: score(rs.map((r) => ({ truth: r.truth, decision: r.rules }))) };
    if (!SKIP_AI) for (const v of VERSIONS) {
      const rr = runs.filter((x) => x.version === v && f(x.id));
      S.results[g]["ai_" + v] = score(rr.map((x) => ({ truth: truthOf[x.id], decision: x.decision })));
      S.results[g]["rulesPlusAi_" + v] = score(rr.map((x) => ({ truth: truthOf[x.id], decision: rulesOf[x.id] === "hold" || x.decision === "hold" ? "hold" : "deploy" })));
    }
  }
  if (!SKIP_AI) {
    S.perVersion = {};
    for (const v of VERSIONS) {
      const rr = runs.filter((x) => x.version === v);
      const byCase = {}; rr.forEach((x) => (byCase[x.id] = byCase[x.id] || []).push(x.decision));
      const ms = rr.map((x) => x.ms).sort((a, b) => a - b);
      const pt = rr.reduce((a, x) => a + x.promptTokens, 0), ct = rr.reduce((a, x) => a + x.completionTokens, 0);
      S.perVersion[v] = { runs: rr.length, casesWhereRunsDisagree: Object.entries(byCase).filter(([, d]) => new Set(d).size > 1).map(([k]) => k),
        aiErrors: rr.filter((x) => x.error).length, meanSeconds: +(ms.reduce((a, b) => a + b, 0) / ms.length / 1000).toFixed(2),
        p95Seconds: +(ms[Math.floor(0.95 * (ms.length - 1))] / 1000).toFixed(2), promptTokens: pt, completionTokens: ct,
        costUSD: +(pt * PRICE_IN + ct * PRICE_OUT).toFixed(4), costPer1000Changes: +((pt * PRICE_IN + ct * PRICE_OUT) / rr.length * 1000).toFixed(3),
        wrongRuns: rr.filter((x) => x.decision !== truthOf[x.id]).map((x) => `${x.id} run${x.run}: ${x.decision} (truth ${truthOf[x.id]})`) };
    }
  }
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(S, null, 2));
  const row = (n, s) => s ? `| ${n} | ${s.n} | ${s.correct} (${s.pct}%) | ${s.badLetThrough} | ${s.goodBlocked} |` : "";
  let md = `# Evaluation summary\n\nCases: ${S.cases} (${S.faulty} faulty, ${S.safe} safe). AI runs per case and version: ${RUNS}.\n`;
  for (const [g, R] of Object.entries(S.results)) {
    md += `\n## ${g} cases (${R.cases}, of which ${R.faulty} faulty)\n\n| Set-up | Decisions | Correct | Faulty changes let through | Safe changes blocked |\n|---|---|---|---|---|\n`;
    md += [row("Always publish", R.alwaysDeploy), row("Rule checks only", R.rulesOnly), ...VERSIONS.flatMap((v) => SKIP_AI ? [] : [row("AI gate " + v, R["ai_" + v]), row("Rule checks + AI gate " + v, R["rulesPlusAi_" + v])])].join("\n") + "\n";
  }
  fs.writeFileSync(path.join(OUT, "summary.md"), md + "\n```json\n" + JSON.stringify(S.perVersion || {}, null, 2) + "\n```\n");
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
})();
