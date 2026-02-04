/**
 * Scrapes Command Card data from Vassal card images using OCR.
 * Run: node scripts/scrape-cc-data.js
 * Requires: npm install tesseract.js sharp
 * Outputs: data/cc-scraped.json (merge into cc-effects.json via review tool)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWorker } from 'tesseract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const buildFile = join(rootDir, 'vassal_extracted', 'buildFile.xml');
const imagesDir = join(rootDir, 'vassal_extracted', 'images');
const ccDir = join(imagesDir, 'cc'); // CCs nested under cc/
const outputFile = join(rootDir, 'data', 'cc-scraped.json');

function findImagePath(filename) {
  const inCc = join(ccDir, filename);
  if (existsSync(inCc)) return filename;
  const inRoot = join(imagesDir, filename);
  if (existsSync(inRoot)) return filename;
  return null;
}

// Known playable-by phrases (from card center)
const PLAYABLE_BY_PHRASES = [
  'Any Figure', 'Hunter', 'Boba Fett', 'Luke Skywalker', 'Darth Vader',
  'Emperor Palpatine', 'Han Solo', 'Chewbacca', 'Royal Guard', 'Ranger',
  'Leader', 'Trooper', 'Wookiee', 'Scum', 'Rebel', 'Imperial', 'Mercenary',
];

function extractCcCardsFromBuildFile() {
  const xml = readFileSync(buildFile, 'utf8');
  const ccStart = xml.indexOf('entryName="Command Cards"');
  if (ccStart === -1) throw new Error('Command Cards section not found');
  const sectionStart = xml.lastIndexOf('<VASSAL.build.widget.TabWidget', ccStart);
  const sectionEnd = xml.indexOf('</VASSAL.build.widget.TabWidget>', sectionStart) + '</VASSAL.build.widget.TabWidget>'.length;
  const ccSection = xml.slice(sectionStart, sectionEnd);

  const cards = [];
  const slotRe = /<VASSAL\.build\.widget\.PieceSlot\s+entryName="([^"]+)"[^>]*>([^<]+)</g;
  const imgRe = /piece;;;([^;]+?\.(?:jpg|png))/gi;
  const seen = new Set();

  let m;
  while ((m = slotRe.exec(ccSection)) !== null) {
    const name = m[1].trim();
    if (!name || seen.has(name) || /^--|^---$/.test(name) || name.length < 2) continue;
    if (!m[2].includes('Command Card')) continue;

    const content = m[2];
    const imgMatches = [...content.matchAll(imgRe)];
    let imagePath = null;
    for (const im of imgMatches) {
      const fn = im[1].trim();
      if (!/card|Card/i.test(fn)) continue;
      imagePath = findImagePath(fn);
      if (imagePath) break;
      const alt = fn.replace(/^IACP\d*_?\s*/, '').replace(/\.png$/i, '.jpg').replace(/\.jpg$/i, '.png');
      imagePath = findImagePath(alt);
      if (imagePath) break;
    }
    if (!imagePath) {
      const candidates = [
        `C card--${name}.jpg`,
        `C card--${name}.png`,
        `IACP_C card--${name}.png`,
        `IACP_C card--${name}.jpg`,
      ];
      for (const c of candidates) {
        imagePath = findImagePath(c);
        if (imagePath) break;
      }
    }
    seen.add(name);
    cards.push({ name, imagePath });
  }

  return cards.sort((a, b) => a.name.localeCompare(b.name));
}

function resolveImagePath(name, imagePath) {
  if (imagePath) {
    const inCc = join(ccDir, imagePath);
    if (existsSync(inCc)) return inCc;
    const inRoot = join(imagesDir, imagePath);
    if (existsSync(inRoot)) return inRoot;
  }
  const tries = [
    `C card--${name}.jpg`,
    `C card--${name}.png`,
    `IACP_C card--${name}.png`,
    `IACP11_C card--${name}.png`,
  ];
  for (const t of tries) {
    const p = join(ccDir, t);
    if (existsSync(p)) return p;
    const pRoot = join(imagesDir, t);
    if (existsSync(pRoot)) return pRoot;
  }
  return null;
}

function parseOcrResult(text) {
  const lines = (text || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let cost = null;
  let playableBy = 'Any Figure';
  const effectLines = [];

  const costMatch = text.match(/\b([0-3])\b/g);
  if (costMatch) {
    const last = costMatch[costMatch.length - 1];
    cost = parseInt(last, 10);
  }

  for (const phrase of PLAYABLE_BY_PHRASES) {
    if (text.includes(phrase)) {
      playableBy = phrase;
      break;
    }
  }

  const playableIdx = lines.findIndex((l) => PLAYABLE_BY_PHRASES.some((p) => l.includes(p)));
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) continue;
    if (playableIdx >= 0 && i === playableIdx) continue;
    if (/^[0-3]$/.test(lines[i]) && lines[i].length === 1) continue;
    if (lines[i].length > 3) effectLines.push(lines[i]);
  }

  return {
    cost,
    playableBy,
    effect: effectLines.join(' ').replace(/\s+/g, ' ').trim() || null,
  };
}

async function main() {
  const limit = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10) : 0;
  const cards = extractCcCardsFromBuildFile();
  const toProcess = limit > 0 ? cards.slice(0, limit) : cards;
  console.log(`Found ${cards.length} command cards. Processing ${toProcess.length}...`);

  const worker = await createWorker('eng');
  const results = {};
  let done = 0;

  for (const { name, imagePath } of toProcess) {
    const fullPath = resolveImagePath(name, imagePath);
    if (!fullPath) {
      results[name] = { cost: null, playableBy: 'Any Figure', effect: null, imagePath: null, _note: 'image not found' };
      done++;
      if (done % 50 === 0) process.stdout.write(`\r${done}/${cards.length}`);
      continue;
    }

    try {
      const { data } = await worker.recognize(fullPath);
      const parsed = parseOcrResult(data.text);
      results[name] = {
        cost: parsed.cost,
        playableBy: parsed.playableBy,
        effect: parsed.effect,
        effectType: 'manual',
        imagePath: imagePath,
      };
    } catch (err) {
      results[name] = { cost: null, playableBy: 'Any Figure', effect: null, _note: err.message };
    }
    done++;
    if (done % 20 === 0) process.stdout.write(`\r${done}/${toProcess.length}`);
  }

  await worker.terminate();
  console.log(`\r${toProcess.length}/${toProcess.length} done.`);

  for (const { name } of cards) {
    if (!(name in results)) {
      results[name] = { cost: null, playableBy: 'Any Figure', effect: null, effectType: 'manual', imagePath: null };
    }
  }

  mkdirSync(join(rootDir, 'data'), { recursive: true });
  const output = {
    source: 'OCR scrape from Vassal card images',
    scrapedAt: new Date().toISOString(),
    cards: results,
  };
  writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
  console.log(`Wrote ${outputFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
