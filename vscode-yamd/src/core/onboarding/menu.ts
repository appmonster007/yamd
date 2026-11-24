/** The items of `YAMD: Menu`, grouped. Every command named here must exist in package.json. */
export interface MenuItem {
  label: string;
  description?: string;
  command: string;
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuGroup[] = [
  {
    title: 'Write',
    items: [
      { label: '$(add) Insert widget', description: 'board, calendar, timeline, gallery or query', command: 'yamd.insertWidget' },
      { label: '$(comment) Insert callout', description: 'note, theorem, definition, card…', command: 'yamd.insertCallout' },
      { label: '$(file-media) Insert figure or table', description: 'with an id to refer to', command: 'yamd.insertTarget' },
      { label: '$(quote) Insert citation', description: 'from your .bib file', command: 'yamd.insertCitation' },
      { label: '$(mic) Record audio and add link', command: 'yamd.recordAudio' },
      { label: '$(comment) Transcribe a recording', description: 'needs a speech-to-text tool', command: 'yamd.transcribeAudio' },
      { label: '$(list-tree) Insert table of contents', command: 'yamd.insertToc' },
      { label: '$(book) Insert bibliography', command: 'yamd.insertBibliography' },
      { label: '$(sync) Build', description: 'refresh references, contents and bibliography', command: 'yamd.build' },
    ],
  },
  {
    title: 'Widgets and data',
    items: [
      { label: '$(layout) Open widget', command: 'yamd.openWidget' },
      { label: '$(plus) Add card', description: 'to a board', command: 'yamd.addCard' },
      { label: '$(calendar) Add event', description: 'to a calendar', command: 'yamd.addEvent' },
      { label: '$(table) Insert query…', description: 'pick a file, columns and a view', command: 'yamd.insertQuery' },
      { label: '$(play) Run query', command: 'yamd.runQuery' },
      { label: '$(edit) Edit the query\'s data file', description: 'CSV, SQLite or JSON in its editor', command: 'yamd.openSource' },
      { label: '$(play-circle) Run all queries in this note', command: 'yamd.runAllQueries' },
      { label: '$(arrow-swap) Turn selection into a widget', command: 'yamd.selectionToWidget' },
    ],
  },
  {
    title: 'Notes',
    items: [
      { label: '$(new-file) New note…', description: 'from a template', command: 'yamd.newNote' },
      { label: '$(mortar-board) New study note…', command: 'yamd.newStudyNote' },
      { label: '$(link) Show backlinks', command: 'yamd.showBacklinks' },
      { label: '$(type-hierarchy) Show note graph', command: 'yamd.showGraph' },
      { label: '$(checklist) Check this note', description: 'everything that is wrong, in one list', command: 'yamd.checkNote' },
    ],
  },
  {
    title: 'Study',
    items: [
      { label: '$(sparkle) Study this note', description: 'make review cards from its callouts', command: 'yamd.studyThisNote' },
      { label: '$(play) Review cards', command: 'yamd.reviewCards' },
      { label: '$(graph) Study dashboard', command: 'yamd.openDashboard' },
      { label: '$(watch) Start study timer', command: 'yamd.startStudyTimer' },
    ],
  },
  {
    title: 'Share',
    items: [
      { label: '$(globe) Export HTML', command: 'yamd.exportHtml' },
      { label: '$(play-circle) Export slides', command: 'yamd.exportSlides' },
      { label: '$(markdown) Export as one Markdown file', description: 'images and query results inlined', command: 'yamd.exportMarkdown' },
      { label: '$(layout) Export one widget as HTML', command: 'yamd.exportWidget' },
    ],
  },
  { title: 'Help', items: [{ label: '$(rocket) Welcome walkthrough', command: 'yamd.openWalkthrough' }, { label: '$(gear) YAMD settings', command: 'yamd.openSettings' }] },
];
