/**
 * One-off: extract text from Consolidated_Imperial_Assault_Rules.pdf
 * Run: node scripts/extract-pdf-rules.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(__dirname, '..', 'docs', 'Consolidated_Imperial_Assault_Rules.pdf');

const buf = fs.readFileSync(pdfPath);
const parser = new PDFParse({ data: new Uint8Array(buf) });
const result = await parser.getText();
await parser.destroy();
const text = result?.text || '';
const outPath = path.join(__dirname, '..', 'docs', 'consolidated-rules-raw.txt');
fs.writeFileSync(outPath, text, 'utf8');
console.log('Wrote', outPath, 'chars:', text.length);
