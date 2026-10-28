// Comparaison locale avec validate.py : même verdict OK/ERREUR par fichier. Jamais en CI.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../src/lib/schema/schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.json') ? [p] : [];
});
const dossier = process.argv[2];
if (!dossier) { console.error('usage : node scripts/parity.mjs <dossier>'); process.exit(2); }
let ko = 0;
for (const f of walk(dossier).sort()) {
  let ok = false, msgs = [];
  try { ok = validate(JSON.parse(readFileSync(f, 'utf8'))); msgs = (validate.errors ?? []).slice(0, 3).map((e) => `${e.instancePath} ${e.message}`); }
  catch (e) { msgs = [String(e.message)]; }
  console.log(`${ok ? 'OK     ' : 'ERREUR '} ${f}`);
  for (const m of msgs) console.log(`    ${m}`);
  if (!ok) ko++;
}
process.exit(ko ? 1 : 0);
