#!/usr/bin/env node
/**
 * Generate docs/crr-dashboard.html — a plain-English dashboard showing how
 * thoroughly the bot's rules implementation is tested. Written for a
 * non-developer reader: no file paths, no jargon, traffic-light status.
 *
 * Regenerate:  npm run dashboard
 * Open:        open docs/crr-dashboard.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const heatMap = JSON.parse(readFileSync(join(repoRoot, 'docs/crr-coverage-heat-map.json'), 'utf8'));
const status = JSON.parse(readFileSync(join(repoRoot, 'docs/crr-status.json'), 'utf8'));

// ── Plain-English translations ──────────────────────────────────────────────
const AREA = {
  D1: { title: 'Taking Actions', blurb: 'What a figure can do on its turn — move, attack, interact, use specials.' },
  D2: { title: 'Moving Figures', blurb: 'Walking across the map: distance, terrain, doors, large figures.' },
  D3: { title: 'Attacking & Combat', blurb: 'Dice rolls, line of sight, damage, surges, targeting.' },
  D4: { title: 'Status Effects & Tokens', blurb: 'Stun, Bleed, Hide, Focus, Strain and other conditions.' },
  D5: { title: 'Armies & Deployment', blurb: 'Building a squad, deploying figures, group lifecycle.' },
  D6: { title: 'Scoring & Objectives', blurb: 'Victory points, mission objectives, round-end scoring.' },
  D7: { title: 'Command Cards', blurb: 'When cards can be played, what they do, how they stack.' },
  D8: { title: 'Figure Abilities', blurb: 'Per-figure special abilities printed on deployment cards.' },
  D9: { title: 'Round Flow', blurb: 'The sequence of steps inside one round — start, activations, end.' },
  D10: { title: 'Map & Board', blurb: 'Map spaces, adjacency, walls, doors, terminals, shields.' },
};

const COVERAGE = {
  direct_oracle:     { label: 'Directly tested',    tier: 'strong', color: '#3fb950', blurb: 'A test pins this rule exactly.' },
  certification:     { label: 'Data validated',     tier: 'strong', color: '#39c5cf', blurb: 'The underlying data is audited every run.' },
  runtime_invariant: { label: 'Checked during play',tier: 'strong', color: '#d29922', blurb: 'Enforced while simulations run.' },
  unit_test:         { label: 'Covered by unit test',tier: 'strong',color: '#bc8cff', blurb: 'Pinned by a smaller, focused test.' },
  headless_selfplay: { label: 'Seen in simulation', tier: 'weak',   color: '#db6d28', blurb: 'Exercised by AI games but never asserted.' },
  inferred_only:     { label: 'Indirectly tested',  tier: 'weak',   color: '#f85149', blurb: 'Only implied by other tests — no direct check.' },
  uncovered:         { label: 'Not tested',         tier: 'missing',color: '#8b0000', blurb: 'No test or check touches this rule.' },
};

const BLAST = {
  critical: { label: 'Critical', color: '#f85149' },
  high:     { label: 'High',     color: '#db6d28' },
  medium:   { label: 'Medium',   color: '#d29922' },
  low:      { label: 'Low',      color: '#3fb950' },
};

// ── Aggregate ──────────────────────────────────────────────────────────────
const rules = heatMap.coverage || [];
const rulesByArea = {};
for (const r of rules) (rulesByArea[r.domain] ||= []).push(r);
const areaOrder = Object.keys(rulesByArea).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));

function areaHealth(rows) {
  const counts = { strong: 0, weak: 0, missing: 0 };
  for (const r of rows) {
    const tier = COVERAGE[r.current_coverage_type]?.tier || 'missing';
    counts[tier]++;
  }
  return counts;
}

const totalRules = rules.length;
const overall = { strong: 0, weak: 0, missing: 0 };
for (const r of rules) overall[COVERAGE[r.current_coverage_type]?.tier || 'missing']++;

const parityTotal = status.parityScoreboard?.totalScenarios || 0;
const parityAgree = status.parityScoreboard?.exactAgreementCount || 0;
const parityOpen = status.parityScoreboard?.openDivergenceCount || 0;
const openDivergences = status.parityScoreboard?.openDivergences || [];

// ── Plain-English parity-scenario descriptions ─────────────────────────────
const PARITY_PLAIN = {
  9:  { concept: 'I Must Go Alone', plain: 'A defensive ability that limits how far away an attacker can target a figure. The Discord bot enforces the distance cap; the simulation does not.' },
  10: { concept: 'Fire Mission',    plain: 'A group attack where line of sight can be traced from any figure in the group. The Discord bot checks every figure; the simulation only checks the attacker.' },
  11: { concept: 'Vanish',          plain: 'An ability that makes a figure untargetable until its next activation. The Discord bot enforces the immunity; the simulation does not.' },
};

// ── Version history (latest three, readable) ───────────────────────────────
const updateKeys = Object.keys(heatMap.metadata || {})
  .filter(k => /^v\d+(_\d+)?_update$/.test(k))
  .sort((a, b) => parseInt(b.match(/v(\d+)/)[1], 10) - parseInt(a.match(/v(\d+)/)[1], 10));

function humanizeUpdate(text) {
  // Strip the most code-specific fragments so the reader sees plain prose.
  return text
    .replace(/src\/[^\s()]+/g, 'the code')
    .replace(/tests\/[^\s()]+/g, 'the test suite')
    .replace(/docs\/[^\s()]+/g, 'the coverage map')
    .replace(/\([^)]*\.js[^)]*\)/g, '')
    .replace(/commit [a-f0-9]{7,}/g, 'a recent commit')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

// ── HTML ────────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const overallPct = Math.round((overall.strong / totalRules) * 100);
const headlineTone = overall.missing > 0 ? 'bad' : overall.weak > 0 ? 'warn' : 'good';
const headlineText = overall.missing > 0
  ? `${overall.missing} rule${overall.missing === 1 ? '' : 's'} still have no test coverage.`
  : overall.weak > 0
    ? `All rules have some coverage; ${overall.weak} rely on indirect testing only.`
    : `Every rule has a direct test or data check. Coverage is at its strongest state.`;

const parityTone = parityOpen === 0 ? 'good' : parityOpen <= 3 ? 'warn' : 'bad';
const parityHeadline = parityOpen === 0
  ? 'The Discord bot and the simulation agree on every measured scenario.'
  : `${parityOpen} scenario${parityOpen === 1 ? '' : 's'} where the Discord bot and the simulation still disagree.`;

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

function stackedBar(rows, height = 14) {
  // Build strong/weak/missing stack from a rule list
  const h = areaHealth(rows);
  const total = rows.length || 1;
  return `
    <div class="bar" title="${h.strong} well tested · ${h.weak} weakly tested · ${h.missing} not tested" style="height:${height}px;">
      <span class="seg-strong" style="width:${pct(h.strong, total)}%"></span>
      <span class="seg-weak"   style="width:${pct(h.weak, total)}%"></span>
      <span class="seg-missing"style="width:${pct(h.missing, total)}%"></span>
    </div>`;
}

function sectionArea(code, rows) {
  const meta = AREA[code] || { title: code, blurb: '' };
  const h = areaHealth(rows);
  const total = rows.length;
  const pctStrong = pct(h.strong, total);
  const tone = h.missing > 0 ? 'bad' : h.weak > 0 ? 'warn' : 'good';
  const statusLabel = tone === 'good' ? 'Fully covered' : tone === 'warn' ? 'Mostly covered' : 'Has gaps';
  return `
  <details class="area area-${tone}">
    <summary>
      <div class="area-head">
        <div>
          <div class="area-title">${esc(meta.title)}</div>
          <div class="area-blurb">${esc(meta.blurb)}</div>
        </div>
        <div class="area-stat">
          <div class="pill pill-${tone}">${statusLabel}</div>
          <div class="pct">${pctStrong}% <span class="fine">directly tested</span></div>
        </div>
      </div>
      ${stackedBar(rows, 8)}
    </summary>
    <div class="area-body">
      <table class="rules">
        <thead><tr><th style="width:22%;">Rule area</th><th>What is tested</th><th style="width:18%;">How it's tested</th><th style="width:10%;">Impact if broken</th></tr></thead>
        <tbody>
${rows.map(r => {
  const cov = COVERAGE[r.current_coverage_type] || COVERAGE.uncovered;
  const blast = BLAST[r.training_blast_radius] || { label: '—', color: '#555' };
  return `          <tr>
            <td><strong>${esc(r.subdomain)}</strong></td>
            <td>${esc(r.crr_rule_or_claim)}</td>
            <td><span class="cov" style="background:${cov.color}22;color:${cov.color};border:1px solid ${cov.color}55;">${cov.label}</span></td>
            <td><span class="blast" style="color:${blast.color};">${blast.label}</span></td>
          </tr>`;
}).join('\n')}
        </tbody>
      </table>
    </div>
  </details>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Rules Coverage — IACP Skirmish Bot</title>
<style>
  :root {
    --bg: #f7f8fa;
    --panel: #ffffff;
    --ink: #1d2229;
    --muted: #6a737d;
    --line: #e5e7eb;
    --accent: #0969da;
    --good: #2da44e;
    --warn: #bf8700;
    --bad:  #cf222e;
    --strong: #2da44e;
    --weak:   #d29922;
    --missing:#8b0000;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--ink); background: var(--bg); }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  header.hero { padding: 28px 32px 20px; background: var(--panel); border-bottom: 1px solid var(--line); }
  header.hero h1 { margin: 0 0 6px; font-size: 22px; font-weight: 700; }
  header.hero .sub { color: var(--muted); font-size: 13px; }

  nav.toc { padding: 10px 32px; background: #fafbfc; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 5; }
  nav.toc a { margin-right: 20px; font-size: 14px; color: var(--accent); }

  main { max-width: 1100px; margin: 0 auto; padding: 28px 32px 80px; }
  section { margin-bottom: 36px; }
  section > h2 { font-size: 18px; margin: 0 0 6px; }
  section > .section-blurb { color: var(--muted); font-size: 13px; margin-bottom: 16px; }

  .headline { display: flex; gap: 16px; padding: 20px 22px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); margin-bottom: 18px; align-items: center; }
  .headline.good { border-left: 5px solid var(--good); }
  .headline.warn { border-left: 5px solid var(--warn); }
  .headline.bad  { border-left: 5px solid var(--bad); }
  .headline .num { font-size: 34px; font-weight: 700; margin-right: 6px; }
  .headline.good .num { color: var(--good); }
  .headline.warn .num { color: var(--warn); }
  .headline.bad  .num { color: var(--bad); }
  .headline .txt { font-size: 15px; }
  .headline .txt .fine { color: var(--muted); font-size: 13px; display:block; margin-top: 4px; }

  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .kpi { padding: 16px 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
  .kpi .label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px; }
  .kpi .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
  .kpi .value small { font-size: 12px; color: var(--muted); font-weight: 400; }
  .kpi.good  .value { color: var(--good); }
  .kpi.warn  .value { color: var(--warn); }
  .kpi.bad   .value { color: var(--bad); }

  .bar { width: 100%; background: var(--line); border-radius: 2px; overflow: hidden; display: flex; height: 14px; }
  .bar span { display: block; height: 100%; }
  .seg-strong  { background: var(--strong); }
  .seg-weak    { background: var(--weak); }
  .seg-missing { background: var(--missing); }

  .legend { display: flex; gap: 18px; font-size: 12px; color: var(--muted); margin: 8px 0 18px; }
  .legend .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }

  details.area { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; margin-bottom: 10px; }
  details.area[open] { box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  details.area > summary { list-style: none; cursor: pointer; }
  details.area > summary::-webkit-details-marker { display: none; }

  .area-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 10px; }
  .area-title { font-size: 16px; font-weight: 700; }
  .area-blurb { color: var(--muted); font-size: 13px; margin-top: 2px; }
  .area-stat { text-align: right; white-space: nowrap; }
  .area-stat .pct { font-size: 13px; font-weight: 600; margin-top: 6px; color: var(--ink); }
  .area-stat .fine { font-weight: 400; color: var(--muted); }

  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; }
  .pill-good { background: #e8f5ee; color: var(--good); }
  .pill-warn { background: #fdf5d7; color: var(--warn); }
  .pill-bad  { background: #fce8ea; color: var(--bad); }

  .area-body { padding-top: 10px; }
  table.rules { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.rules th { text-align: left; padding: 8px 10px; background: #fafbfc; color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; border-bottom: 1px solid var(--line); }
  table.rules td { padding: 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  table.rules tr:last-child td { border-bottom: none; }

  .cov { display: inline-block; padding: 2px 10px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
  .blast { font-size: 12px; font-weight: 600; }

  .open-issue { padding: 14px 18px; background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--warn); border-radius: 6px; margin-bottom: 10px; }
  .open-issue .label { font-size: 11px; text-transform: uppercase; color: var(--warn); font-weight: 700; letter-spacing: 0.5px; }
  .open-issue .name { font-size: 15px; font-weight: 600; margin: 4px 0; }
  .open-issue .desc { font-size: 13px; color: var(--ink); }

  details.log { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px 16px; margin-bottom: 8px; }
  details.log summary { cursor: pointer; font-weight: 600; font-size: 14px; }
  details.log p { color: var(--muted); font-size: 13px; margin: 8px 0 0; }

  .foot { color: var(--muted); font-size: 12px; text-align: center; padding-top: 18px; border-top: 1px solid var(--line); }

  .overview-bar { margin: 6px 0 4px; }
  .filter { display: flex; gap: 10px; margin-bottom: 12px; }
  .filter input { flex: 1; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: 14px; }
</style>
</head>
<body>
<header class="hero">
  <h1>Rules Coverage Dashboard</h1>
  <div class="sub">How thoroughly the bot's rules are tested — plain-English view. Last updated ${esc(now)} UTC.</div>
</header>

<nav class="toc">
  <a href="#health">Health</a>
  <a href="#areas">Game Areas</a>
  <a href="#issues">Open Issues</a>
  <a href="#history">Recent Changes</a>
</nav>

<main>

<section id="health">
  <h2>At a glance</h2>
  <div class="section-blurb">A snapshot of how well the rulebook is covered by automated tests right now.</div>

  <div class="headline ${headlineTone}">
    <div class="num">${overallPct}%</div>
    <div class="txt">
      of rule areas are <strong>directly tested</strong>.
      <span class="fine">${headlineText}</span>
    </div>
  </div>

  <div class="headline ${parityTone}">
    <div class="num">${parityAgree}/${parityTotal}</div>
    <div class="txt">
      scenarios where the Discord bot and the internal simulation <strong>agree exactly</strong>.
      <span class="fine">${parityHeadline}</span>
    </div>
  </div>

  <div class="kpi-row">
    <div class="kpi good">
      <div class="label">Rules well tested</div>
      <div class="value">${overall.strong}<small> / ${totalRules}</small></div>
    </div>
    <div class="kpi ${overall.weak > 0 ? 'warn' : 'good'}">
      <div class="label">Rules weakly tested</div>
      <div class="value">${overall.weak}<small> need stronger tests</small></div>
    </div>
    <div class="kpi ${overall.missing > 0 ? 'bad' : 'good'}">
      <div class="label">Rules with no test</div>
      <div class="value">${overall.missing}</div>
    </div>
    <div class="kpi ${parityOpen > 0 ? 'warn' : 'good'}">
      <div class="label">Open bot-vs-simulation gaps</div>
      <div class="value">${parityOpen}<small> of ${parityTotal}</small></div>
    </div>
  </div>

  <h3 style="font-size:14px;margin:8px 0 4px;">Overall coverage mix</h3>
  <div class="overview-bar">${stackedBar(rules, 16)}</div>
  <div class="legend">
    <span><span class="dot seg-strong"></span>Well tested: ${overall.strong}</span>
    <span><span class="dot seg-weak"></span>Weakly tested: ${overall.weak}</span>
    <span><span class="dot seg-missing"></span>Not tested: ${overall.missing}</span>
  </div>
</section>

<section id="areas">
  <h2>Game areas</h2>
  <div class="section-blurb">Each area groups related rules. Click an area to see individual rules inside it.</div>
  <div class="filter">
    <input id="ruleFilter" type="text" placeholder="Search for a rule (e.g. “line of sight”, “surge”, “deployment”)…">
  </div>
${areaOrder.map(code => sectionArea(code, rulesByArea[code])).join('\n')}
</section>

<section id="issues">
  <h2>Open issues worth attention</h2>
  <div class="section-blurb">Places where tests already detect a disagreement between the Discord bot and the internal simulation. Each one is measured, not guessed.</div>
${openDivergences.length === 0
  ? `<div class="headline good"><div class="num">0</div><div class="txt">No open issues.<span class="fine">Every measured scenario currently agrees on both sides.</span></div></div>`
  : openDivergences.map(s => {
      const plain = PARITY_PLAIN[s.scenario];
      return `  <div class="open-issue">
    <div class="label">Bot ↔ Simulation disagreement</div>
    <div class="name">${esc(plain?.concept || s.name)}</div>
    <div class="desc">${esc(plain?.plain || s.name)}</div>
  </div>`;
    }).join('\n')}
</section>

<section id="history">
  <h2>Recent changes</h2>
  <div class="section-blurb">What was fixed or added lately. Newest first.</div>
${updateKeys.length === 0 ? '<p class="foot">No recent changes recorded.</p>' :
  updateKeys.slice(0, 6).map(k => {
    const note = heatMap.metadata[k];
    const plain = humanizeUpdate(note);
    const label = k.replace(/^v/, 'Version ').replace(/_update$/, '').replace(/_/g, '.');
    const shortDate = (plain.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
    return `  <details class="log" ${k === updateKeys[0] ? 'open' : ''}>
    <summary>${esc(label)}${shortDate ? ` — ${esc(shortDate)}` : ''}</summary>
    <p>${esc(plain)}</p>
  </details>`;
  }).join('\n')}
</section>

<div class="foot">
  Regenerate this page any time with <code>npm run dashboard</code>.
  ${rules.length} rules · ${parityTotal} parity scenarios · data refreshed ${esc(now)} UTC.
</div>

</main>

<script>
(function(){
  const input = document.getElementById('ruleFilter');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('details.area').forEach(area => {
      let anyMatch = false;
      area.querySelectorAll('table.rules tbody tr').forEach(row => {
        const match = !q || row.textContent.toLowerCase().includes(q);
        row.style.display = match ? '' : 'none';
        if (match) anyMatch = true;
      });
      area.style.display = (anyMatch || !q) ? '' : 'none';
      if (q) area.open = anyMatch;
    });
  });
})();
</script>
</body>
</html>`;

writeFileSync(join(repoRoot, 'docs/crr-dashboard.html'), html);
console.log(`Wrote docs/crr-dashboard.html (${(html.length / 1024).toFixed(1)} KB, ${totalRules} rules across ${areaOrder.length} game areas)`);
