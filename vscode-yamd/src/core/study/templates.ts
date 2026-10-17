/** Built-in note templates for coursework (§6.3), with `{{@date}}`, `{{@title}}` and `{{@course}}` placeholders. */
export interface StudyTemplate {
  id: string;
  label: string;
  description: string;
  text: string;
}

const front = (extra = '') => `---\ntitle: {{@title}}\ncourse: {{@course}}\ndate: {{@date}}\n${extra}lang: en\n---\n\n`;

export const STUDY_TEMPLATES: StudyTemplate[] = [
  {
    id: 'lecture',
    label: 'Lecture notes',
    description: 'Objectives, notes, key terms, questions and a summary',
    text:
      front('tags: [lecture]\nreviewed: {{@date}}\n') +
      `# {{@title}}\n\n**Course:** {{@course}} · **Date:** {{@date}} · **Lecturer:**\n\n## Objectives\n\n- \n\n## Notes\n\n{{@cursor}}\n\n## Key terms\n\n:::definition {title="Term"}\nMeaning.\n:::\n\n## Questions\n\n:::question\nWhat did you not understand?\n:::\n\n## Review cards\n\n::card[Question]{a="Answer"}\n\n## Summary\n\n:::summary\nIn two or three sentences.\n:::\n\n## To do\n\n- [ ] Read the chapter {due={{@date:YYYY-MM-DD}}}\n`,
  },
  {
    id: 'lab-report',
    label: 'Lab report',
    description: 'Aim, method, results, discussion, conclusion and references',
    text:
      front('author:\nbibliography: refs.bib\ncitation-style: apa\ndue:\n') +
      `# {{@title}}\n\n## Aim\n\n{{@cursor}}\n\n## Background\n\n## Method\n\n### Materials\n\n- \n\n### Procedure\n\n1. \n\n## Results\n\n:::table {caption="Results" #tbl:results header=1}\n- - Trial\n  - Measurement\n- - 1\n  - \n:::\n\nSee [@tbl:results].\n\n## Discussion\n\n## Conclusion\n\n## References\n\n::bibliography\n`,
  },
  {
    id: 'exam-prep',
    label: 'Exam prep',
    description: 'Topics checklist, formulas, practice questions and a study plan',
    text:
      front('tags: [exam]\ndue:\n') +
      `# {{@title}}\n\n## Topics\n\n- [ ] Topic 1 {due={{@date:YYYY-MM-DD}}}\n- [ ] Topic 2\n\n## Key definitions and results\n\n:::definition {title="Name"}\n{{@cursor}}\n:::\n\n:::theorem\nStatement.\n:::\n\n## Practice questions\n\n:::question\nQuestion?\n:::\n\n## Flashcards\n\n::card[Question]{a="Answer"}\n\n## Study plan\n\n| Day | Topic | Done |\n| --- | ----- | ---- |\n|     |       |      |\n\n## Mistakes to avoid\n\n`,
  },
  {
    id: 'reading-note',
    label: 'Reading note',
    description: 'Source details, summary, quotes and your response',
    text:
      front('source:\ntags: [reading]\n') +
      `# {{@title}}\n\n**Source:** [@key]\n\n## Summary\n\n{{@cursor}}\n\n## Key points\n\n- \n\n## Quotes\n\n> Quote ([@key], p. )\n\n## My response\n\n## Questions\n\n`,
  },
];

export const READING_LIST_YDB = `# A reading list. Open it in the preview with ::db[reading-list]{view=board group=Status}.
yamdb: 0.1
name: Reading list

properties:
  Title: title
  Author: text
  Course: text
  Status:
    type: status
    options: [To read, Reading, Done]
  Pages: number
  Due: date

views:
  By status:
    type: board
    group: Status

rows:
  - id: r1
    Title: Example paper
    Author: A. Author
    Status: To read
`;

export interface Symbol {
  tex: string;
  name: string;
  category: string;
}

const sym = (category: string, items: [string, string][]): Symbol[] => items.map(([tex, name]) => ({ tex, name, category }));

/** Common math symbols for the picker, grouped by topic. */
export const MATH_SYMBOLS: Symbol[] = [
  ...sym('Greek', [['\\alpha', 'alpha α'], ['\\beta', 'beta β'], ['\\gamma', 'gamma γ'], ['\\delta', 'delta δ'], ['\\epsilon', 'epsilon ε'], ['\\theta', 'theta θ'], ['\\lambda', 'lambda λ'], ['\\mu', 'mu μ'], ['\\pi', 'pi π'], ['\\sigma', 'sigma σ'], ['\\phi', 'phi φ'], ['\\omega', 'omega ω'], ['\\Delta', 'Delta Δ'], ['\\Sigma', 'Sigma Σ'], ['\\Omega', 'Omega Ω']]),
  ...sym('Operators', [['\\sum_{i=1}^{n}', 'sum Σ'], ['\\prod_{i=1}^{n}', 'product Π'], ['\\int_{a}^{b} f(x)\\,dx', 'integral ∫'], ['\\frac{a}{b}', 'fraction'], ['\\sqrt{x}', 'square root √'], ['\\lim_{x \\to \\infty}', 'limit'], ['\\partial', 'partial ∂'], ['\\nabla', 'nabla ∇'], ['\\cdot', 'dot ·'], ['\\times', 'times ×'], ['\\pm', 'plus-minus ±']]),
  ...sym('Relations', [['\\leq', 'less or equal ≤'], ['\\geq', 'greater or equal ≥'], ['\\neq', 'not equal ≠'], ['\\approx', 'approximately ≈'], ['\\equiv', 'equivalent ≡'], ['\\propto', 'proportional ∝'], ['\\to', 'arrow →'], ['\\Rightarrow', 'implies ⇒'], ['\\iff', 'if and only if ⇔']]),
  ...sym('Sets and logic', [['\\in', 'element of ∈'], ['\\notin', 'not element of ∉'], ['\\subseteq', 'subset ⊆'], ['\\cup', 'union ∪'], ['\\cap', 'intersection ∩'], ['\\emptyset', 'empty set ∅'], ['\\forall', 'for all ∀'], ['\\exists', 'exists ∃'], ['\\neg', 'not ¬'], ['\\land', 'and ∧'], ['\\lor', 'or ∨'], ['\\mathbb{R}', 'real numbers ℝ'], ['\\mathbb{N}', 'natural numbers ℕ'], ['\\mathbb{Z}', 'integers ℤ']]),
  ...sym('Structures', [['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', 'matrix'], ['\\vec{v}', 'vector'], ['\\hat{x}', 'hat'], ['\\overline{x}', 'overline'], ['x^{2}', 'superscript'], ['x_{i}', 'subscript'], ['\\binom{n}{k}', 'binomial'], ['\\begin{cases} a & x > 0 \\\\ b & \\text{otherwise} \\end{cases}', 'cases']]),
];
