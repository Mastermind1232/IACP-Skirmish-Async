#!/usr/bin/env node
/**
 * DC/CC ability timing audit (alexanbv 2026-05-13).
 *
 * For each DC and CC in data/, extract `abilityText`, classify each
 * sentence by CRR trigger (Declare / Step 1+2 / Step 3 / Step 4 /
 * Step 5 / Step 6 / Step 7 / Step 8 / SoA / EoA / SoR / EoR /
 * Passive / Manual), grep the codebase for the implementation site,
 * and write a markdown audit report to
 * docs/dc-cc-timing-audit-2026-05-13.md.
 *
 * Run: node scripts/dc-cc-timing-audit.mjs
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DC_PATH = resolve(ROOT, 'data/dc-effects.json');
const CC_PATH = resolve(ROOT, 'data/cc-effects.json');
const OUT_PATH = resolve(ROOT, 'docs/dc-cc-timing-audit-2026-05-13.md');

const dcData = JSON.parse(readFileSync(DC_PATH, 'utf8'));
const ccData = JSON.parse(readFileSync(CC_PATH, 'utf8'));

// Recursively walk src/ collecting file contents for grep
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = resolve(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (p.endsWith('.js')) yield p;
  }
}
const SRC_FILES = [...walk(resolve(ROOT, 'src'))];
const SRC_INDEX = new Map();
for (const f of SRC_FILES) SRC_INDEX.set(f.replace(ROOT + '/', ''), readFileSync(f, 'utf8'));

function grepFor(needles) {
  const hits = [];
  for (const n of needles) {
    if (!n) continue;
    for (const [file, src] of SRC_INDEX) {
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(n)) hits.push(`${file}:${i + 1}`);
      }
    }
  }
  return [...new Set(hits)].slice(0, 4);
}

// Classify trigger from sentence text. Returns the CRR stage shorthand.
function classifyTiming(sentence) {
  const t = sentence.toLowerCase();
  const tags = new Set();
  if (/\bwhen you declare an attack\b|\bafter you declare an attack\b|\bbefore you declare an attack\b/.test(t)) tags.add('Declare');
  if (/\bafter resolving an attack\b|\bafter you resolve an attack\b|\bafter (?:the\s+)?attack (?:is\s+)?resolved?\b|\bafter (?:an\s+)?attack (?:targeting you\s+)?resolves?\b/.test(t)) tags.add('Step8');
  if (/\bwhile attacking\b/.test(t)) tags.add('Step3-4-atk');
  if (/\bwhile defending\b/.test(t)) tags.add('Step3-4-def');
  if (/\bsurge\s*:/.test(t)) tags.add('Step5-surge');
  if (/\bat the start of (?:your|the) activation\b/.test(t)) tags.add('SoA');
  if (/\bat the end of (?:your|the) activation\b/.test(t)) tags.add('EoA');
  if (/\bat the start of (?:each |the )?round\b/.test(t)) tags.add('SoR');
  if (/\bat the end of (?:each |the )?round\b/.test(t)) tags.add('EoR');
  if (/\bbefore you (?:perform|attack|reroll|move)\b/.test(t)) tags.add('Pre-action');
  if (/\bafter you (?:perform|move|interact)\b/.test(t)) tags.add('Post-action');
  if (/\bspecial action\b/.test(t)) tags.add('Special Action');
  if (/\bwhen .* is defeated\b|\bafter .* is defeated\b/.test(t)) tags.add('On-defeat');
  if (/\bwhen .* suffers (?:damage|strain)\b/.test(t)) tags.add('On-damage');
  if (/\bafter deployment\b/.test(t)) tags.add('Post-deploy');
  if (/\bafter setup\b/.test(t)) tags.add('Setup');
  if (/\bwhen .* plays a command card\b/.test(t)) tags.add('On-CC-play');
  if (/\bexhaust this card\b/.test(t)) tags.add('Exhaust');
  if (/\bdeplete this card\b/.test(t)) tags.add('Deplete');
  if (/\bpassive\b/.test(t)) tags.add('Passive');
  return tags.size > 0 ? [...tags].join(' / ') : 'Passive/Unclassified';
}

// Extract ability paragraphs from abilityText. Each paragraph is one ability.
function splitAbilities(abilityText) {
  if (!abilityText) return [];
  return abilityText.split(/\n\s*\n/).flatMap(p => p.split(/\n/)).map(s => s.trim()).filter(Boolean);
}

function abilityName(sentence) {
  const m = sentence.match(/^\*?\*?([A-Z][A-Za-z0-9' \-]+?(?:\([A-Za-z ]+\))?)(?:\*?\*?:|—)/);
  return m ? m[1].trim() : '';
}

function findHits(name, parentName) {
  if (!name) return [];
  // Try snake_case derivations
  const snake = name.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const parentSnake = parentName ? parentName.toLowerCase().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : null;
  const candidates = [snake];
  if (parentSnake) candidates.push(`${snake}_${parentSnake}`);
  // Add bare-name searches
  candidates.push(`'${name}'`);
  candidates.push(`"${name}"`);
  return grepFor(candidates);
}

function classifyFlag(timing, hits) {
  if (timing === 'Passive/Unclassified') return '—';
  if (hits.length === 0) return '— no impl';
  // No automatic mismatch detection — flag as ✓ found code, manual review.
  return '✓';
}

function processBucket(label, data) {
  const lines = [];
  lines.push(`## ${label}`, '');
  const cards = data.cards || {};
  const names = Object.keys(cards).sort((a, b) => a.localeCompare(b));
  for (const cardName of names) {
    const card = cards[cardName];
    const abilities = splitAbilities(card.abilityText || '');
    lines.push(`### ${cardName}`);
    if (abilities.length === 0) {
      lines.push(`- _no ability text_`);
      lines.push('');
      continue;
    }
    for (const ab of abilities) {
      const timing = classifyTiming(ab);
      const name = abilityName(ab);
      const hits = name ? findHits(name, cardName) : [];
      const flag = classifyFlag(timing, hits);
      const trimmed = ab.length > 220 ? ab.slice(0, 220) + '…' : ab;
      const hitsStr = hits.length > 0 ? hits.join(', ') : '(none)';
      lines.push(`- **${name || '(unnamed)'}** — _${timing}_ — ${flag} — impl: ${hitsStr}`);
      lines.push(`  > ${trimmed.replace(/\n/g, ' ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const header = [
  `# DC/CC Ability Timing Audit — 2026-05-13`,
  ``,
  `Auto-generated by \`scripts/dc-cc-timing-audit.mjs\`. For each named`,
  `ability in \`data/dc-effects.json\` and \`data/cc-effects.json\`, this`,
  `report extracts the card text, classifies the trigger by CRR stage`,
  `keywords, and lists any matching code-site references. Manual review`,
  `required to confirm whether the implementation site fires at the`,
  `correct stage. Use this as a starting point — search for ⚠️ or`,
  `\`— no impl\` entries to find suspect cards quickly.`,
  ``,
  `## Legend`,
  `- ✓ — ability text and a candidate impl site both exist; needs manual review`,
  `- — no impl — no code reference found (ability may not be wired, or named differently)`,
  `- — — passive trait / unclassified; not a trigger-timed ability`,
  ``,
  `## Trigger-stage abbreviations`,
  `- **Declare** — "When/Before/After you declare an attack" (CRR step 1+2)`,
  `- **Step3-4-atk** — "While attacking" (covers step-3 reroll + step-4 modifier)`,
  `- **Step3-4-def** — "While defending" (covers step-3 reroll + step-4 modifier)`,
  `- **Step5-surge** — Surge ability (step 5 surge spend)`,
  `- **Step8** — "After resolving an attack" (CRR step 8)`,
  `- **SoA/EoA** — Start/End of activation`,
  `- **SoR/EoR** — Start/End of round`,
  `- **Pre-action / Post-action** — "Before/After you perform [action]"`,
  `- **On-defeat / On-damage / On-CC-play** — Event-triggered`,
  `- **Special Action** — Activation action`,
  `- **Exhaust / Deplete** — Cost-bearing on use`,
  `- **Setup / Post-deploy** — One-time game-start triggers`,
  ``,
  ``,
].join('\n');

// Suspicious-pattern auto-flagger. Walks every ability and tags those
// that are likely to be wrong-stage / auto-use bugs based on text
// patterns the user has already corrected (Merciless, Trusted Ally,
// Illicit Arms, Doubt, etc.).
function buildSuspiciousReport(bucket, data) {
  const lines = [`## Suspicious — ${bucket}`, ''];
  const cards = data.cards || {};
  for (const [cardName, card] of Object.entries(cards)) {
    const abilities = splitAbilities(card.abilityText || '');
    for (const ab of abilities) {
      const t = ab.toLowerCase();
      const flags = [];
      // Pattern 1: "When you declare an attack" + active effect →
      // likely should be a player-controlled on-declare bucket button,
      // not auto-fire at handleAttackTarget.
      if (/when you declare an attack/.test(t) && /suffer|apply|gain|discard|exhaust|deplete|reroll|push|move/.test(t)) {
        flags.push('⚠️ on-declare active effect — should be player-controlled button, not auto');
      }
      // Pattern 2: "Exhaust this card while attacking/defending …" —
      // the exhaust must fire on USE, not registration.
      if (/exhaust this card while (attacking|defending)/.test(t)) {
        flags.push('⚠️ exhaust-on-use — verify lazy exhaust (exhaustAttachment payload), not auto');
      }
      // Pattern 3: "Deplete this card …" — deplete must fire on USE.
      if (/deplete this card/.test(t)) {
        flags.push('⚠️ deplete-on-use — verify lazy deplete (depleteDc payload), not auto');
      }
      // Pattern 4: "While attacking, apply +N Damage/Hit" — step-4
      // modifier. Verify impl fires at sendModsYn(attacker) or modifier-
      // window stage, not attack-roll detection.
      if (/while attacking, [^.]*\bapply\b/.test(t) && !/\breroll\b/.test(t)) {
        flags.push('⚠️ While-attacking modifier — confirm fires at step-4 (sendModsYn attacker), not attack-roll');
      }
      // Pattern 5: "While defending, apply +N" — step-4 defender mod
      // (Slippery, Defensible, etc.). Verify at sendModsYn(defender).
      if (/while defending, [^.]*\bapply\b/.test(t) && !/\breroll\b/.test(t)) {
        flags.push('⚠️ While-defending modifier — confirm fires at step-4 (sendModsYn defender)');
      }
      // Pattern 6: "Before you declare an attack" — pre-declare prompt.
      if (/before you declare an attack/.test(t)) {
        flags.push('⚠️ Pre-declare prompt — verify player-controlled attacker option');
      }
      // Pattern 7: "After resolving an attack" — step-8.
      if (/after (?:resolving |you resolve )an attack/.test(t)) {
        flags.push('ℹ️ Step-8 post-resolve — verify after-attack hook ordering');
      }
      // Pattern 8: "When a friendly … is defeated" — on-defeat hook.
      if (/when (?:a |an |another )?friendly[^.]*is defeated/.test(t)) {
        flags.push('ℹ️ Friendly-defeated hook — verify in WHEN_DEFEATED pipeline');
      }
      // Pattern 9: "At the start of your activation" + action choice.
      if (/at the start of your activation, you may/.test(t)) {
        flags.push('⚠️ SoA player-choice — verify prompt, not auto-fire');
      }
      // Pattern 10: "Limit once per …" — must enforce the limit.
      if (/limit (?:once|one|twice) per (?:round|attack|activation)/.test(t)) {
        flags.push('ℹ️ Per-X limit — verify guard flag exists');
      }
      if (flags.length === 0) continue;
      const trimmed = ab.length > 220 ? ab.slice(0, 220) + '…' : ab;
      lines.push(`- **${cardName}** — _${abilityName(ab) || '(unnamed)'}_`);
      for (const f of flags) lines.push(`  - ${f}`);
      lines.push(`  > ${trimmed.replace(/\n/g, ' ')}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

const suspiciousDC = buildSuspiciousReport('DCs', dcData);
const suspiciousCC = buildSuspiciousReport('CCs', ccData);

const out = header + '\n'
  + suspiciousDC + '\n'
  + suspiciousCC + '\n'
  + '---\n\n# Full ability listing\n\n'
  + processBucket('Deployment Cards (DCs)', dcData) + '\n'
  + processBucket('Command Cards (CCs)', ccData);
writeFileSync(OUT_PATH, out);
console.log(`Wrote ${OUT_PATH} (${out.length} chars)`);
