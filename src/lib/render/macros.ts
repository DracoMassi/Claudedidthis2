// Macros de la charte (identiques à template.html).
export const MACROS: Record<string, string> = {
  '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}', '\\Q': '\\mathbb{Q}',
  '\\C': '\\mathbb{C}', '\\K': '\\mathbb{K}',
  '\\dd': '\\,\\mathrm{d}', '\\e': '\\mathrm{e}', '\\i': '\\mathrm{i}',
  '\\abs': '\\left|#1\\right|', '\\norm': '\\left\\lVert #1\\right\\rVert',
  '\\ps': '\\left\\langle #1,#2\\right\\rangle', '\\ent': '\\left\\lfloor #1\\right\\rfloor',
  '\\inte': '\\llbracket #1,#2\\rrbracket', '\\card': '\\operatorname{Card}', '\\eps': '\\varepsilon',
};
