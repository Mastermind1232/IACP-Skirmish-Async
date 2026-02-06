/**
 * Build docs/RULES_REFERENCE.md from Consolidated Rules raw text + IACP section.
 * Run: node scripts/build-rules-reference.js
 * Requires: docs/consolidated-rules-raw.txt (from extract-pdf-rules.js)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawPath = path.join(__dirname, '..', 'docs', 'consolidated-rules-raw.txt');
const outPath = path.join(__dirname, '..', 'docs', 'RULES_REFERENCE.md');

const raw = fs.readFileSync(rawPath, 'utf8');
const lines = raw.split(/\r?\n/);

const out = [];
let replacedTitle = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  if (/^Page \d+ \/ 70\s*$/.test(trimmed) || /^-- \d+ of 70 --\s*$/.test(trimmed))
    continue;

  if (!replacedTitle && /^THE CONSOLIDATED STAR WARS: IMPERIAL ASSAULT/.test(trimmed)) {
    out.push('# Star Wars: Imperial Assault — Rules Reference');
    out.push('');
    out.push('**Sources:** The Consolidated Star Wars: Imperial Assault™ Rules (Pasi, v1.4) and **IACP Official Changes (v10.2.2)**. When rules conflict, **IACP takes priority**.');
    out.push('');
    out.push('---');
    out.push('');
    replacedTitle = true;
    continue;
  }

  // Glossary-style section title: standalone ALL CAPS line (no lowercase, no colon)
  if (/^[A-Z][A-Z0-9 \/&'-]+$/.test(trimmed) && trimmed.length >= 2 && trimmed.length <= 55 && trimmed !== 'Related Topics') {
    out.push('');
    out.push('## ' + trimmed);
    out.push('');
    continue;
  }

  if (trimmed.startsWith('•') || trimmed.startsWith('━')) {
    out.push(trimmed.replace(/^[•━]\s*/, '- '));
    continue;
  }

  if (trimmed)
    out.push(trimmed);
  else
    out.push('');
}

let body = out.join('\n').replace(/\n{4,}/g, '\n\n\n');

const iacpSection = `

---

## IACP Changes and Additions

The following are from **IACP Official Changes** and override or supplement the Consolidated Rules when applicable to Skirmish.

### Deplete (Skirmish Upgrades)

When a Skirmish Upgrade card is **Depleted**, the card is **removed from the game** (no longer in play). It is not readied at end of round. Treat it as a one-time use; the card is not flipped face down for the mission—it is gone.

### Figure Size (for effects)

- **Default:** If a Deployment card does not explicitly have LARGE or MASSIVE, it is considered **SMALL** for all effects (command cards, abilities, etc.).
- **LARGE:** 1x2 or 2x2 footprint (or explicit Large keyword).
- **MASSIVE:** 2x3 footprint or explicit Massive keyword.
- **SMALL:** 1x1 footprint or unknown.

### Passives / Keywords (IACP)

- **Priority Target:** Figures do not block line of sight for this figure's attacks.

### Skirmish Upgrades and Squad Upgrades

Skirmish Upgrades include figureless upgrades and **Squad Upgrades** (e.g. [Flame Trooper]): a type of Skirmish upgrade that adds or replaces a figure in a deployment group. The Squad Upgrade figure uses its own cost, health, and card abilities (IACP). Skirmish upgrades can enable multi-affiliation in army building where allowed.
`;

fs.writeFileSync(outPath, body.trim() + iacpSection + '\n', 'utf8');
console.log('Wrote', outPath);
