/**
 * Starting points for `YAMD: New Note`, and the sample note the walkthrough creates. Placeholders:
 * `{{@title}}`, `{{@date}}` and `{{@cursor}}`, filled once when the note is created.
 */
export interface NoteTemplate {
  id: string;
  label: string;
  description: string;
  text: string;
  /** Files the note needs next to it (for example the CSV a query reads), created only if missing. */
  files?: { name: string; text: string }[];
}

const front = `---\ntitle: {{@title}}\ndate: {{@date}}\n---\n\n`;

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'empty',
    label: 'Empty note',
    description: 'A title and a table of contents',
    text: `${front}# {{@title}}\n\n<!-- yamd:toc depth=3 -->\n<!-- /yamd:toc -->\n\n## Notes\n\n{{@cursor}}\n`,
  },
  {
    id: 'article',
    label: 'Article with references',
    description: 'A table of contents, a figure target and a bibliography with a .bib file',
    text: `---\ntitle: {{@title}}\ndate: {{@date}}\nbibliography: refs.bib\ncitation-style: apa\n---\n\n# {{@title}}\n\n<!-- yamd:toc depth=3 -->\n<!-- /yamd:toc -->\n\n## Introduction\n\n{{@cursor}}Cite a source like this [@example2026], then run **YAMD: Build**.\n\n## References\n\n<!-- yamd:bibliography -->\n<!-- /yamd:bibliography -->\n`,
    files: [{ name: 'refs.bib', text: '@book{example2026,\n  author    = {Example, Ada},\n  title     = {An Example Book},\n  publisher = {Example Press},\n  year      = {2026}\n}\n' }],
  },
  {
    id: 'project-board',
    label: 'Project board',
    description: 'A kanban board with Backlog, Doing and Done',
    text: `${front}# {{@title}}\n\nOpen the board with the link above it, then drag cards between columns.\n\n\`\`\`kanban board\n## Backlog\n- [ ] {{@cursor}}First idea\n\n## Doing\n\n## Done\n\`\`\`\n`,
  },
  {
    id: 'meeting',
    label: 'Meeting notes',
    description: 'Attendees, agenda, notes and an action board',
    text: `${front}# {{@title}}\n\n**Date:** {{@date}} · **Attendees:**\n\n## Agenda\n\n- {{@cursor}}\n\n## Notes\n\n## Actions\n\n\`\`\`kanban actions\n## To do\n- [ ] First action\n\n## Done\n\`\`\`\n`,
  },
  {
    id: 'reading-list',
    label: 'Reading list',
    description: 'A board for things to read, in progress and finished',
    text: `${front}# {{@title}}\n\n\`\`\`kanban reading\n## To read\n- [ ] {{@cursor}}First title\n\n## Reading\n\n## Finished\n\`\`\`\n\n## Notes\n`,
  },
  {
    id: 'weekly-plan',
    label: 'Weekly plan',
    description: 'A calendar and a task list',
    text: `${front}# {{@title}}\n\n\`\`\`calendar plan\n- [ ] Plan the week {due={{@date}}}\n\`\`\`\n\n## Tasks\n\n- [ ] {{@cursor}}\n`,
  },
  {
    id: 'data-note',
    label: 'Data note',
    description: 'A query over a CSV file next to the note',
    text: `${front}# {{@title}}\n\n\`\`\`sql\n-- id="all-rows" source="data.csv" view="table"\nSELECT * FROM data;\n\`\`\`\n\n{{@cursor}}\n`,
    files: [{ name: 'data.csv', text: 'name,value\nExample,1\nAnother,2\n' }],
  },
];

/** The note and data the walkthrough's first step creates. */
export const SAMPLE_NOTE: NoteTemplate = {
  id: 'sample',
  label: 'Welcome to YAMD',
  description: 'One of everything',
  text:
    `---\ntitle: Welcome to YAMD\ndate: {{@date}}\n---\n\n# Welcome to YAMD\n\nThis note uses each part of YAMD once. It is plain Markdown: without the extension, the widgets below are code blocks.\n\n<!-- yamd:toc depth=2 -->\n<!-- /yamd:toc -->\n\n` +
    `## A board\n\nClick **Open kanban: welcome-board** above the block, then drag a card to another column.\n\n\`\`\`kanban welcome-board\n## Todo\n- [ ] Open this board {due={{@date}}}\n- [ ] Rename a card by double-clicking it\n\n## Done\n- [x] Install YAMD\n\`\`\`\n\n` +
    `## A query\n\nA read-only SQL query over a file next to the note. Open it, then change the CSV and watch it refresh.\n\n\`\`\`sql\n-- id="open-tasks" source="yamd-sample-data.csv" view="table"\nSELECT task, owner FROM yamd_sample_data WHERE status = 'open';\n\`\`\`\n\n` +
    `## A callout\n\n> [!theorem] A short theorem ^thm-short\n> Callouts end at the first line that doesn't start with \`>\`.\n\nRefer to it as [@thm-short], then run **YAMD: Build** to turn that into a link.\n\n` +
    `## More to try\n\n- **YAMD: Record Audio and Add Link** records a voice note and links it.\n- **YAMD: Menu** lists everything in one place.\n\n{{@cursor}}\n`,
  files: [{ name: 'yamd-sample-data.csv', text: 'task,owner,status\nWrite the report,Ada,open\nReview the data,Grace,open\nShip it,Ada,done\n' }],
};
