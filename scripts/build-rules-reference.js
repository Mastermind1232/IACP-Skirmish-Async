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

// Regex for ALL CAPS section headers (same in both passes)
const sectionRe = /^[A-Z][A-Z0-9 \/&'-]+$/;

// Convert a section name to a markdown anchor (matches CommonMark/GitHub behavior)
function toAnchor(name) {
  return name.toLowerCase()
    .replace(/[^\w\s-]/g, '')   // remove non-word, non-space, non-hyphen
    .replace(/\s+/g, '-')       // spaces to hyphens
    .replace(/-+/g, '-')        // collapse multiple hyphens
    .replace(/^-|-$/g, '');     // trim leading/trailing hyphens
}

// --- First pass: build page → first section name map ---
const pageToSection = new Map();
let currentPage = 1;

for (const line of lines) {
  const trimmed = line.trim();
  const pageMatch = trimmed.match(/^-- (\d+) of 70 --$/);
  if (pageMatch) {
    currentPage = parseInt(pageMatch[1]);
    continue;
  }
  if (sectionRe.test(trimmed) && trimmed.length >= 2 && trimmed.length <= 55 && trimmed !== 'Related Topics') {
    if (!pageToSection.has(currentPage)) {
      pageToSection.set(currentPage, trimmed);
    }
  }
}

// Replace inline page references: p.N, p. N, page N, on page N
function replacePageRefs(text) {
  // p.N or p. N (with or without space, with or without surrounding parens)
  text = text.replace(/\bp\.\s?(\d+)\b/g, (match, num) => {
    const section = pageToSection.get(parseInt(num));
    return section ? `[p.${num}](#${toAnchor(section)})` : match;
  });
  // "on page N" or "page N"
  text = text.replace(/\b((?:on )?page\s+)(\d+)\b/gi, (match, prefix, num) => {
    const section = pageToSection.get(parseInt(num));
    return section ? `${prefix}[${num}](#${toAnchor(section)})` : match;
  });
  return text;
}

// Convert a full Related Topics line (possibly pre-joined from multiple raw lines) to linked version
function convertRelatedTopics(line) {
  const rest = line.replace(/^Related Topics:\s*/, '');
  const parts = rest.split(',').map(s => s.trim()).filter(Boolean);
  const linked = parts.map(part => {
    const m = part.match(/^(.+?)\s+(\d+)\.?$/);
    if (m) {
      const name = m[1].trim();
      return `[${name}](#${toAnchor(name)})`;
    }
    return part;
  });
  return 'Related Topics: ' + linked.join(', ');
}

// --- Second pass: build output ---
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

  // Glossary-style section title: standalone ALL CAPS line
  if (sectionRe.test(trimmed) && trimmed.length >= 2 && trimmed.length <= 55 && trimmed !== 'Related Topics') {
    out.push('');
    out.push('## ' + trimmed);
    out.push('');
    continue;
  }

  // Related Topics: join wrapped continuation lines.
  // Continue if line ends with comma (more items follow) OR doesn't end with a digit
  // (section name was split across lines, e.g. "Imperial\nUpgrade Stage 35").
  if (trimmed.startsWith('Related Topics')) {
    let full = trimmed;
    while (i + 1 < lines.length) {
      const t = full.trim();
      // Stop if line ends with a number (optionally followed by a period) — entry is complete
      if (!t.endsWith(',') && /\d\.?$/.test(t)) break;
      i++;
      full += ' ' + lines[i].trim();
    }
    out.push(convertRelatedTopics(full));
    continue;
  }

  if (trimmed.startsWith('•') || trimmed.startsWith('━')) {
    out.push(replacePageRefs(trimmed.replace(/^[•━]\s*/, '- ')));
    continue;
  }

  if (trimmed)
    out.push(replacePageRefs(trimmed));
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
