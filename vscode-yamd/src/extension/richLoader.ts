/**
 * Loads syntax highlighting and math (`dist/rich.js`, built from `src/core/rich.ts`) the first time
 * a preview needs them. Keeping them out of `extension.js` makes activation read half as much code.
 */
import * as path from 'node:path';

type Rich = typeof import('../core/rich');
let loaded: Rich | undefined;

function rich(): Rich {
  // A computed path stays a runtime `require`, so the bundler leaves the file separate.
  return (loaded ??= require(path.join(__dirname, 'rich.js')) as Rich);
}

export const highlight: Rich['highlight'] = (code, lang) => rich().highlight(code, lang);
export const renderMath: Rich['renderMath'] = (tex, display) => rich().renderMath(tex, display);
