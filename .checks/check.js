// upwind pre-push check. Run from the repo folder:  node .checks/check.js
// Looks for the mistakes that would break or embarrass the live site. Hidden folder, so GitHub Pages doesn't publish it.
// Exit code 1 means something must be fixed before pushing; warnings are worth a look but don't block.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const root = path.join(__dirname, "..");
const fails = [], warns = [], oks = [];
const fail = m => fails.push(m), warn = m => warns.push(m), ok = m => oks.push(m);
const read = f => fs.readFileSync(path.join(root, f), "utf8");

for (const file of ["index.html", "about.html"]) {
  let src; try { src = read(file); } catch (e) { fail(file + " is missing"); continue; }

  // 1. Every script parses (the JSON-LD block must be valid JSON)
  let n = 0;
  for (const m of src.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] || "", body = m[2];
    if (/\bsrc=/.test(attrs) || !body.trim()) continue;
    n++;
    if (/ld\+json/.test(attrs)) { try { JSON.parse(body); } catch (e) { fail(`${file}: structured data (JSON-LD) isn't valid JSON: ${e.message}`); } continue; }
    try { new Function(body); } catch (e) { fail(`${file}: script ${n} doesn't parse: ${e.message}`); }
  }
  ok(`${file}: ${n} scripts parse`);

  // 2. Styles: braces balance
  for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"]*"|'[^']*'/g, "");
    const o = (css.match(/{/g) || []).length, c = (css.match(/}/g) || []).length;
    if (o !== c) fail(`${file}: CSS braces don't balance (${o} open, ${c} close)`);
  }

  // 3. No duplicate ids in the markup
  const markup = src.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  const ids = {}; for (const m of markup.matchAll(/\sid="([^"]+)"/g)) ids[m[1]] = (ids[m[1]] || 0) + 1;
  const dup = Object.keys(ids).filter(k => ids[k] > 1); if (dup.length) fail(`${file}: duplicate ids: ${dup.join(", ")}`);

  // 4. Every getElementById("x") in the code has an element with that id somewhere (markup or code-built HTML)
  // Known and safe: season-row and xfer-cover are checked before use; scene-lbl is only in sceneLbl(), which returns at once.
  const KNOWN = { "season-row": 1, "xfer-cover": 1, "scene-lbl": 1 };
  const missing = [];
  for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) {
    const id = m[1]; if (KNOWN[id]) continue; if (!new RegExp(`id=\\\\?["']${id.replace(/[-]/g, "\\-")}\\\\?["']`).test(src) && !src.includes(`.id="${id}"`) && !src.includes(`.id = "${id}"`)) missing.push(id);
  }
  if (missing.length) warn(`${file}: code looks up ids with no matching element: ${[...new Set(missing)].join(", ")}`);
}

const idx = read("index.html");
// 5. Live settings: real relay, preview off, no test leftovers
if (!/var RELAY="https:\/\/upwind-relay\.maxpurwin\.workers\.dev"/.test(idx)) fail("index.html: RELAY isn't the live relay address");
if (!/var PREVIEW=false;/.test(idx)) fail("index.html: PREVIEW isn't false (sample data would show on the live site)");
if (/localhost:\d+/.test(idx)) fail("index.html: mentions a localhost address (a test leftover)");
if (/__skydbg|\bdebugger;/.test(idx)) fail("index.html: a debugging hook was left in");
for (const f of ["tv.html", "preview.html"]) if (fs.existsSync(path.join(root, f))) fail(`${f} is in the repo: it's a local test build with sample data and must not ship`);
if (fs.existsSync(path.join(root, ".claude"))) warn(".claude folder is in the repo (local preview settings); don't commit it");
for (const f of fs.readdirSync(root)) if (/relay/i.test(f) && /\.js$/.test(f)) fail(`${f}: relay code doesn't belong in the site repo (it would be published)`);

// 6. Size: the page is one big file; a big jump usually means data was pasted twice
const kb = Math.round(fs.statSync(path.join(root, "index.html")).size / 1024);
if (kb > 1400) fail(`index.html is ${kb} KB (over 1,400): check for duplicated data`); else ok(`index.html is ${kb} KB`);

// 7. Wording: phrases that read as flight advice (liability). Shown for a human look, not blocked.
const text = idx.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
for (const re of [/can i fly/i, /go\/no-go|no-go/i, /recommended runway/i, /safe to fly/i, /you should fly/i]) if (re.test(text)) warn(`page text contains "${text.match(re)[0]}": check it isn't flight advice`);
if (/runway in use/i.test(idx) && !/not an official runway in use/i.test(idx)) warn(`"runway in use" appears without "not an official runway in use"`);
if (!/For awareness only, not for flight planning/.test(idx)) fail(`the "For awareness only, not for flight planning." line is missing`);

// 8. What's about to go out, compared with the last commit
try {
  const st = cp.execSync("git status --short", { cwd: root }).toString().trim();
  const diff = cp.execSync("git diff --shortstat", { cwd: root }).toString().trim();
  ok("changes since last commit: " + (st ? st.split("\n").map(s => s.trim()).join(", ") + (diff ? " (" + diff + ")" : "") : "none"));
} catch (e) { warn("couldn't read git status"); }

console.log(oks.map(m => "  ok    " + m).join("\n"));
if (warns.length) console.log(warns.map(m => "  look  " + m).join("\n"));
if (fails.length) { console.log(fails.map(m => "  FIX   " + m).join("\n")); console.log("\nNot ready to push."); process.exit(1); }
console.log("\nReady to push" + (warns.length ? " (see the notes above)." : "."));
