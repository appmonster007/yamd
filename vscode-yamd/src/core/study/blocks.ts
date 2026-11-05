/**
 * Study-aid blocks (§6.3): `:::definition`, `:::theorem` and friends. They are numbered per kind,
 * can be cross-referenced, and can be collected from every note into a cheat sheet.
 */

interface StudyKind {
  name: string;
  label: string;
  /** Numbered blocks can be cross-referenced as `[@id]`. */
  numbered: boolean;
}

const STUDY_KINDS: StudyKind[] = [
  { name: 'definition', label: 'Definition', numbered: true },
  { name: 'theorem', label: 'Theorem', numbered: true },
  { name: 'lemma', label: 'Lemma', numbered: true },
  { name: 'proof', label: 'Proof', numbered: false },
  { name: 'example', label: 'Example', numbered: true },
  { name: 'question', label: 'Question', numbered: true },
  { name: 'remark', label: 'Remark', numbered: false },
  { name: 'summary', label: 'Summary', numbered: false },
];

export const STUDY_BY_NAME = new Map(STUDY_KINDS.map((k) => [k.name, k]));
