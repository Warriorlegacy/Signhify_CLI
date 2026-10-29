// Copy docs/*.md into site/docs/ so the vercel.json rewrite
// (/docs/:name -> /docs/:name.md) serves real files from the deploy output.
// Idempotent; runs in <1s. Recursively ships every top-level docs .md.
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'docs');
const outDir = join(root, 'site', 'docs');
mkdirSync(outDir, { recursive: true });

for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.md')) {
    copyFileSync(join(srcDir, entry.name), join(outDir, entry.name));
    console.log(`docs -> site/docs/${entry.name}`);
  } else if (entry.isDirectory()) {
    // research/ subdirectory keeps its path so links stay stable.
    const subOut = join(outDir, entry.name);
    mkdirSync(subOut, { recursive: true });
    for (const file of readdirSync(join(srcDir, entry.name), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.md')) {
        copyFileSync(join(srcDir, entry.name, file.name), join(subOut, file.name));
        console.log(`docs -> site/docs/${entry.name}/${file.name}`);
      }
    }
  }
}
