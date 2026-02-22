// Script to fix broken dc-images.json entries
const fs = require('fs');
const path = require('path');
const { existsSync } = fs;

const rootDir = path.join(__dirname, '..');
const dataPath = path.join(rootDir, 'data', 'dc-images.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const di = data.dcImages;
const base = 'vassal_extracted/images/dc-figures/';

// Group 1: IACP bracket files — update to actual bracket filename on disk
di['4-LOM'] = base + '4-LOM [IACP].png';
di['Boba Fett'] = base + 'Boba Fett [IACP].png';
di['Dengar'] = base + 'Dengar [IACP].png';
di['Ahsoka Tano'] = base + 'Ahsoka Tano [IACP].png';
di['Cal Kestis'] = base + 'Cal Kestis [IACP].png';

// Group 2: Wrong filename — update to actual filename on disk
di['AT-DP'] = base + 'AT-DP [Elite].png';
di['Heavy Stormtrooper (Elite)'] = base + 'Heavy Stormtrooper (Elite).png';
di['Bantha Rider'] = base + 'Bantha Rider [Elite].png';
di['Clawdite Shapeshifter (Elite)'] = base + 'Clawdite Shapeshifter [Elite].png';
di['Alliance Ranger (Elite)'] = base + 'Alliance Ranger [Elite].png';
di['Alliance Smuggler (Elite)'] = base + 'Alliance Smuggler [Elite].png';
di['AT-RT'] = base + 'AT-RT [Elite] [IACP].png';
di['C1-10P "Chopper"'] = base + 'C1-10P.png';
di['Chewbacca'] = base + 'Chewbacca (1).png';

// Group 3: Add missing IACP DC entries (files exist on disk, not yet in dc-images.json)
di['Moff Gideon'] = base + 'Moff Gideon [IACP].png';
di['Paz Vizsla'] = base + 'Paz Vizsla [IACP].png';
di['74-Z Speeder Bike (Elite)'] = base + '74-Z Speeder Bike [Elite] [IACP].png';
di['Tauntaun Rider (Elite)'] = base + 'Tauntaun Rider [Elite] [IACP].png';

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log('dc-images.json updated.\n');

// Verify all fixed entries exist on disk
const toCheck = [
  '4-LOM', 'Boba Fett', 'Dengar', 'Ahsoka Tano', 'Cal Kestis',
  'AT-DP', 'Heavy Stormtrooper (Elite)', 'Bantha Rider',
  'Clawdite Shapeshifter (Elite)', 'Alliance Ranger (Elite)',
  'Alliance Smuggler (Elite)', 'AT-RT', 'C1-10P "Chopper"', 'Chewbacca',
  'Moff Gideon', 'Paz Vizsla', '74-Z Speeder Bike (Elite)', 'Tauntaun Rider (Elite)',
];

let allGood = true;
toCheck.forEach(k => {
  const relPath = data.dcImages[k];
  const exists = existsSync(path.join(rootDir, relPath));
  console.log(exists ? '✅' : '❌ MISSING', k, '->', relPath);
  if (!exists) allGood = false;
});

console.log('\n' + (allGood ? 'All fixed entries verified on disk.' : 'WARNING: Some entries still missing.'));
