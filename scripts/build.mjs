import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = name => readFile(join(root, name), 'utf8');
const [template, style, layout, game] = await Promise.all([
  read('index.html'), read('style.css'), read('layout.js'), read('game.js')
]);

const art = {};
const assets = (await readdir(join(root, 'assets'))).filter(name => name.endsWith('.png')).sort();
for (const name of assets) {
  const image = await readFile(join(root, 'assets', name));
  art[`assets/${name}`] = `data:image/png;base64,${image.toString('base64')}`;
}

function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2) {
    throw new Error(`Expected one occurrence of ${JSON.stringify(from)}; update the build script to match the source.`);
  }
  return text.replace(from, () => to);
}

let page = replaceOnce(template, '<link rel="stylesheet" href="style.css">', `<style>\n${style}\n</style>`);
for (const name of ['layout.js', 'game.js']) {
  page = replaceOnce(page, `<script src="${name}" defer></script>`, '');
}
const bundledGame = replaceOnce(game, 'bitmap.src = src;', 'bitmap.src = embeddedArt[src];');
const script = `${layout}\nconst embeddedArt = ${JSON.stringify(art)};\n${bundledGame}`;
page = replaceOnce(page, '</body>', `<script>\n${script}\n</script>\n</body>`);

const outputDir = join(root, 'dist');
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'shanghai-1930.html'), page, 'utf8');
console.log(`Built dist/shanghai-1930.html (${Buffer.byteLength(page).toLocaleString('en-US')} bytes, ${assets.length} embedded images).`);
