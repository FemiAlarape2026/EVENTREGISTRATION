// Simple, fixed checks. No AI here. Given a folder, it reports problems that a
// careful person would find with a quick look. Used by the pipeline and the evaluation.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const REQUIRED = ["index.html", "script.js", "style.css", "departments.json"];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(api[_-]?key|secret|passw(or)?d|token)\s*[:=]\s*["'][^"']{6,}["']/i,
];

function checkFolder(dir) {
  const problems = [];
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const has = (f) => fs.existsSync(path.join(dir, f));

  // 1. Required files exist
  for (const f of REQUIRED) if (!has(f)) problems.push(`Missing file: ${f}`);

  // 2. JavaScript has no syntax errors
  if (has("script.js")) {
    try { new vm.Script(read("script.js"), { filename: "script.js" }); }
    catch (e) { problems.push(`JavaScript syntax error: ${e.message}`); }
  }

  // 3. departments.json is valid JSON with a list called "departments"
  if (has("departments.json")) {
    try {
      const j = JSON.parse(read("departments.json"));
      if (!j || !Array.isArray(j.departments)) problems.push('departments.json has no "departments" list');
    } catch (e) { problems.push(`departments.json is not valid JSON: ${e.message}`); }
  }

  // 4. Files that the page points to really exist
  if (has("index.html")) {
    const html = read("index.html");
    const refs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g), ...html.matchAll(/<link[^>]+href=["']([^"']+)["']/g)].map((m) => m[1]);
    for (const r of refs) if (!/^(https?:)?\/\//.test(r) && !has(r)) problems.push(`index.html points to a file that does not exist: ${r}`);
  }
  if (has("script.js")) {
    for (const m of read("script.js").matchAll(/fetch\(\s*["']([^"']+)["']/g)) {
      if (!/^(https?:)?\/\//.test(m[1]) && !has(m[1])) problems.push(`script.js loads a file that does not exist: ${m[1]}`);
    }
  }

  // 5. No obvious passwords or keys left in the files
  for (const f of REQUIRED) {
    if (!has(f)) continue;
    const text = read(f);
    for (const p of SECRET_PATTERNS) if (p.test(text)) { problems.push(`Possible secret in ${f}`); break; }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { checkFolder, REQUIRED };

if (require.main === module) {
  const r = checkFolder(process.argv[2] || ".");
  if (r.ok) console.log("Rule checks: PASS");
  else { console.log("Rule checks: FAIL"); r.problems.forEach((p) => console.log(" - " + p)); }
  process.exit(r.ok ? 0 : 1);
}
