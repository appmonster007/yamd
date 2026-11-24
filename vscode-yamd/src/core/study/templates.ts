/** Built-in note templates for coursework (§6.3), with `{{@date}}`, `{{@title}}` and `{{@course}}` placeholders. */
interface StudyTemplate {
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
      `# {{@title}}\n\n**Course:** {{@course}} · **Date:** {{@date}} · **Lecturer:**\n\n## Objectives\n\n- \n\n## Notes\n\n{{@cursor}}\n\n## Key terms\n\n> [!definition] Term\n> Meaning.\n\n## Questions\n\n> [!question] What did you not understand?\n> \n\n## Review cards\n\n> [!card] Question\n> Answer\n\n## Summary\n\n> [!summary]\n> In two or three sentences.\n\n## To do\n\n- [ ] Read the chapter {due={{@date:YYYY-MM-DD}}}\n`,
  },
  {
    id: 'lab-report',
    label: 'Lab report',
    description: 'Aim, method, results, discussion, conclusion and references',
    text:
      front('author:\nbibliography: refs.bib\ncitation-style: apa\ndue:\n') +
      `# {{@title}}\n\n## Aim\n\n{{@cursor}}\n\n## Background\n\n## Method\n\n### Materials\n\n- \n\n### Procedure\n\n1. \n\n## Results\n\nTable: Results\n\n| Trial | Measurement |\n| ----- | ----------- |\n| 1     |             |\n\n^tbl-results\n\nSee [@tbl-results].\n\n## Discussion\n\n## Conclusion\n\n## References\n\n<!-- yamd:bibliography -->\n<!-- /yamd:bibliography -->\n`,
  },
  {
    id: 'exam-prep',
    label: 'Exam prep',
    description: 'Topics checklist, formulas, practice questions and a study plan',
    text:
      front('tags: [exam]\ndue:\n') +
      `# {{@title}}\n\n## Topics\n\n- [ ] Topic 1 {due={{@date:YYYY-MM-DD}}}\n- [ ] Topic 2\n\n## Key definitions and results\n\n> [!definition] Name\n> {{@cursor}}\n\n> [!theorem] Name\n> Statement.\n\n## Practice questions\n\n> [!question] Question?\n> \n\n## Flashcards\n\n> [!card] Question\n> Answer\n\n## Study plan\n\n| Day | Topic | Done |\n| --- | ----- | ---- |\n|     |       |      |\n\n## Mistakes to avoid\n\n`,
  },
  {
    id: 'reading-note',
    label: 'Reading note',
    description: 'Source details, summary, quotes and your response',
    text:
      front('source:\ntags: [reading]\nbibliography: refs.bib\n') +
      `# {{@title}}\n\n**Source:** [@key]\n\n## Summary\n\n{{@cursor}}\n\n## Key points\n\n- \n\n## Quotes\n\n> Quote ([@key], p. )\n\n## My response\n\n## Questions\n\n`,
  },
];

