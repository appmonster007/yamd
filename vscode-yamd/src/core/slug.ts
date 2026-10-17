/** Generates a heading ID using the algorithm in yamd-spec.md section 10. */
export function slugify(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/\s+/gu, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Hands out unique IDs, appending `-2`, `-3`, ... on collisions. */
export class SlugRegistry {
  private readonly used = new Set<string>();
  /**
   * The next suffix to try for each base name (1 means the bare name). Every candidate below it is
   * already taken, so repeated headings cost one step each instead of counting up from `-2` every time.
   */
  private readonly next = new Map<string, number>();

  reserve(id: string): void {
    this.used.add(id);
  }

  unique(base: string): string {
    const root = base || 'section';
    let n = this.next.get(root) ?? 1;
    let id = n === 1 ? root : `${root}-${n}`;
    // Another heading or an explicit ID may already hold the candidate (`a-2` for a heading "A 2").
    while (this.used.has(id)) {
      n++;
      id = `${root}-${n}`;
    }
    this.used.add(id);
    this.next.set(root, n + 1);
    return id;
  }
}
