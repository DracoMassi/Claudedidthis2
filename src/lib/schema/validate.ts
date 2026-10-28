import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import schema from './schema.json';
import type { Problem } from '../types';

const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schema);
const ID: string = schema.$id;
const validateAll = ajv.getSchema(ID) as ValidateFunction;

const BLOCK_TYPES = ['definition', 'theoreme', 'demonstration', 'methode', 'formule', 'piege', 'exemple', 'qcm', 'proprietes', 'figure'];
const blockValidators: Record<string, ValidateFunction> = {};
for (const t of BLOCK_TYPES) blockValidators[t] = ajv.getSchema(`${ID}#/$defs/b_${t}`) as ValidateFunction;

const pathOf = (e: ErrorObject, prefix = ''): string => {
  const p = prefix + e.instancePath;
  return e.keyword === 'required' ? `${p}/${(e.params as { missingProperty: string }).missingProperty}` : p;
};
const BLOCK_PATH = /^\/pages\/\d+\/blocks\/\d+/;

export function validateFiche(data: unknown): Problem[] {
  if (validateAll(data)) return [];
  const problems: Problem[] = [];
  for (const e of validateAll.errors ?? []) {
    if (BLOCK_PATH.test(e.instancePath)) continue; // traité bloc par bloc, plus précis
    problems.push({ code: 'schema', message: e.message ?? 'invalide', path: pathOf(e) });
  }
  const pages = (data as { pages?: unknown })?.pages;
  if (Array.isArray(pages)) {
    pages.forEach((pg, i) => {
      const blocks = (pg as { blocks?: unknown })?.blocks;
      if (!Array.isArray(blocks)) return;
      blocks.forEach((b, j) => {
        const base = `/pages/${i}/blocks/${j}`;
        const type = (b as { type?: unknown })?.type;
        const v = typeof type === 'string' ? blockValidators[type] : undefined;
        if (!v) {
          problems.push({ code: 'schema', message: 'type de bloc inconnu ou absent', path: base });
        } else if (!v(b)) {
          for (const e of v.errors ?? []) problems.push({ code: 'schema', message: e.message ?? 'invalide', path: pathOf(e, base) });
        }
      });
    });
  }
  if (problems.length === 0) problems.push({ code: 'schema', message: 'fiche invalide', path: '' });
  return problems;
}
