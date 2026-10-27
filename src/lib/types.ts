export type Statut = 'a_verifier' | 'verifie';
export type Format = 'fiche' | 'post';
export type Problem = {
  code: 'json' | 'schema' | 'lint' | 'katex' | 'overflow';
  message: string;
  path?: string;
};
export type Brief = {
  id: string; matiere: string; niveau: string; chapitre: string; sujet: string;
  format?: Format; contenu_obligatoire?: string[]; pieges?: string[]; exemples?: string[];
  nb_qcm?: number; themes_qcm?: string[]; exclure?: string[]; consignes?: string;
};
export type Block = { type: string; [k: string]: unknown };
export type Fiche = {
  schema_version: '1.0' | '1.1';
  meta: {
    titre: string; matiere: string; niveau: string; chapitre: string; statut: Statut;
    format?: Format; exemple?: boolean; brief?: Brief; tags?: string[]; sources?: string[];
  };
  pages: { titre_page?: string; blocks: Block[] }[];
};
