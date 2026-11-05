/** Names of the container and leaf directives the parser treats specially. */
export const KNOWN_CONTAINERS = new Set([
  'note',
  'tip',
  'warning',
  'danger',
  'details',
  'columns',
  'column',
  'figure',
  'table',
  'html',
  'kanban',
  'calendar',
  'timeline',
  'gallery',
  // Study blocks (§6.3) and flashcards (§6.4).
  'definition',
  'theorem',
  'lemma',
  'proof',
  'example',
  'question',
  'summary',
  'remark',
  'derivation',
  'card',
]);
export const KNOWN_LEAVES = new Set(['toc', 'pagebreak', 'embed', 'bibliography']);
