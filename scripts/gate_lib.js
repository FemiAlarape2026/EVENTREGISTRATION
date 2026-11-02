// Talks to the AI model and turns its answer into a decision.
const SITE_SPEC = `The website is a two-step event registration form (HTML, CSS and JavaScript only). It must keep doing all of this:
1. The page loads without errors, and its CSS, JavaScript and departments.json files all load.
2. The Department list is filled from departments.json (a "Select Department" option, then each department).
3. Choosing Undergraduate (UG) shows the Hostel field; choosing Postgraduate (PG) shows the Previous Institution field.
4. "Continue" only moves to step 2 if the matric number matches UG<year><4 digits> (or PG<year><4 digits>) for the chosen level and the date of birth is valid: UG students must be below 25, PG students must be at least 22. Otherwise an error message is shown.
5. "Complete Registration" shows a success message, does not reload the page, and resets the form back to step 1.
6. No passwords, keys or other credentials may appear in the files.`;

const SYSTEM_V1 = `You are the release reviewer for a small website. A developer has pushed a change. Decide whether it is safe to publish to the live site automatically.
${SITE_SPEC}
Answer "hold" if the change would probably break something above, leaks a credential, or you cannot tell that it is safe. Answer "deploy" if it is harmless or clearly keeps the site working.
Judge only from the change and the file contents you are shown. Do not assume anything that is not shown.
Reply with JSON only, in exactly this form: {"decision":"deploy" or "hold","risk":"low" or "medium" or "high","reason":"one short sentence"}`;

const SITE_SPEC_V2 = SITE_SPEC.replace('4. "Continue" only moves', '4. The button that goes to step 2 only moves');
const SYSTEM_V2 = `You are the release reviewer for a small website. A developer has pushed a change. Decide whether it is safe to publish to the live site automatically.
${SITE_SPEC_V2}
You are shown the change and the COMPLETE current website files after the change. Only the lines in the change are new; judge whether the change itself would break any behaviour above or leak a credential. Do not hold a change because of problems that were already in the files before it, or because of wording, colour, text or style edits that cannot affect the behaviour above.
Answer "hold" if the change would probably break something above, leaks a credential, or you cannot tell from what you can see that it is safe. Answer "deploy" otherwise.
Reply with JSON only, in exactly this form: {"decision":"deploy" or "hold","risk":"low" or "medium" or "high","reason":"one short sentence"}`;

function buildMessages(diff, files, allFiles, version) {
  if (version === "v2") {
    let user = "PROPOSED CHANGE (unified diff):\n" + (diff.trim() || "(no changes)") + "\n\nCOMPLETE WEBSITE FILES AFTER THE CHANGE:\n";
    for (const n of Object.keys(allFiles)) user += `\n=== ${n} ===\n` + (allFiles[n] === null ? "(file missing)" : allFiles[n].slice(0, 20000)) + "\n";
    return [{ role: "system", content: SYSTEM_V2 }, { role: "user", content: user }];
  }
  let user = "PROPOSED CHANGE (unified diff):\n" + (diff.trim() || "(no changes)") + "\n\nFULL CONTENTS OF CHANGED FILES AFTER THE CHANGE:\n";
  const names = Object.keys(files);
  if (!names.length) user += "(none)\n";
  for (const n of names) {
    const c = files[n];
    user += `\n=== ${n} ===\n` + (c === null ? "(file deleted)" : c.slice(0, 20000)) + "\n";
  }
  return [{ role: "system", content: SYSTEM_V1 }, { role: "user", content: user }];
}

async function askModel(messages) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set");
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.OPENAI_MODEL || "gpt-6-luna";
  const body = { model, messages, response_format: { type: "json_object" } };
  const effort = process.env.OPENAI_REASONING_EFFORT === undefined ? "none" : process.env.OPENAI_REASONING_EFFORT;
  if (effort) body.reasoning_effort = effort;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {           // one retry
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);   // 30 second timeout
      const res = await fetch(base + "/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(body),
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data.choices[0].message.content;
      const j = JSON.parse(text);
      if (!["deploy", "hold"].includes(j.decision)) throw new Error("Unexpected decision: " + text.slice(0, 100));
      return {
        decision: j.decision, risk: String(j.risk || ""), reason: String(j.reason || ""),
        promptTokens: (data.usage || {}).prompt_tokens || 0, completionTokens: (data.usage || {}).completion_tokens || 0,
        ms: Date.now() - t0, error: "",
      };
    } catch (e) { lastErr = e; }
  }
  // If the AI cannot be reached, fail safe: hold.
  return { decision: "hold", risk: "", reason: "", promptTokens: 0, completionTokens: 0, ms: 0, error: String(lastErr && lastErr.message || lastErr) };
}

async function gate(diff, files, allFiles, version = "v2") { return askModel(buildMessages(diff, files, allFiles, version)); }

module.exports = { gate, buildMessages, SITE_SPEC };
