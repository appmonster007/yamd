/** Builds a query block from the choices made in the query builder. */
export interface QueryChoice {
  id: string;
  source: string;
  table: string;
  columns: string[];
  where?: string;
  orderBy?: string;
  limit?: number;
  view: 'table' | 'board' | 'chart';
  group?: string;
  x?: string;
  y?: string;
}

const quoteId = (name: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`);

export function queryBlock(c: QueryChoice): string {
  const attrs = [`id="${c.id}"`, `source="${c.source}"`, `view="${c.view}"`];
  if (c.view === 'board' && c.group) attrs.push(`group="${c.group}"`);
  if (c.view === 'chart' && c.x && c.y) attrs.push(`x="${c.x}"`, `y="${c.y}"`, 'type="bar"');
  const select = c.columns.length ? c.columns.map(quoteId).join(', ') : '*';
  const parts = [`SELECT ${select}`, `FROM ${quoteId(c.table)}`];
  if (c.where?.trim()) parts.push(`WHERE ${c.where.trim()}`);
  if (c.orderBy?.trim()) parts.push(`ORDER BY ${quoteId(c.orderBy.trim())}`);
  if (c.limit && c.limit > 0) parts.push(`LIMIT ${Math.floor(c.limit)}`);
  return ['```sql', `-- ${attrs.join(' ')}`, `${parts.join('\n')};`, '```'].join('\n');
}
