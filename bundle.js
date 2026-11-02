/* テストプレイ用に、全ファイルを 1 枚の HTML にまとめる: node bundle.js [出力先] */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const out = process.argv[2] || path.join(ROOT, 'dist', 'yukigassen.html');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let html = read('index.html');
// </script> が中に入っていても途切れないように
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
html = html.replace('<link rel="stylesheet" href="./styles.css">', () => `<style>\n${read('styles.css')}\n</style>`);
html = html.replace(/<link rel="icon"[^>]*>\n?/, '');
for (const f of ['three.min.js', 'core.js', 'app.js']) {
  html = html.replace(`<script src="./${f}"></script>`, () => `<script>\n${safe(read(f))}\n</script>`);
}
if (/src="\.\//.test(html) || /href="\.\//.test(html)) throw new Error('まとめ損ねた読み込みがある');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)}KB)`);
