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

  reserve(id: string): void {
    this.used.add(id);
  }

  unique(base: string): string {
    const root = base || 'section';
    let id = root;
    for (let n = 2; this.used.has(id); n++) id = `${root}-${n}`;
    this.used.add(id);
    return id;
  }
}
