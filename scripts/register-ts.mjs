// Entry for `node --import` in `npm run check`: Node type-stripping
// resolves `./x.ts` imports natively, but web sources use the repo-wide
// `./x.js` specifier convention (Vite + tsc). Map a failed sibling
// `.js` lookup to `.ts` before check.mjs static imports load.
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      const parent = context?.parentURL ?? '';
      if (parent.startsWith('file:') && specifier.endsWith('.js') && !specifier.includes('\0')) {
        const candidate = new URL(specifier.replace(/\.js$/, '.ts'), parent);
        if (candidate.protocol === 'file:' && existsSync(fileURLToPath(candidate))) {
          return { url: candidate.href, shortCircuit: true };
        }
      }
      throw err;
    }
  },
});
