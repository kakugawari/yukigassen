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
html = html.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\n?/g, '');   // 仮ページではアイコンは Claude のものになる
// 絵は data: URI にして埋め込む (app.js は window.ASSETS があればそちらを読む)
const assets = {};
const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const images = ['players.webp', ...fs.readdirSync(ROOT).filter((f) => /^tex_.*\.jpg$/.test(f)).sort()];
for (const f of images) {
  assets[f] = `data:${MIME[path.extname(f)]};base64,` + fs.readFileSync(path.join(ROOT, f)).toString('base64');
}
html = html.replace('<script src="./core.js"></script>', () => `<script>window.ASSETS = ${JSON.stringify(assets)};</script>\n<script src="./core.js"></script>`);
for (const f of ['three.min.js', 'core.js', 'app.js']) {
  html = html.replace(`<script src="./${f}"></script>`, () => `<script>\n${safe(read(f))}\n</script>`);
}
// タイトルのロゴの絵も埋め込む
html = html.replace('src="./logo.webp"', () => `src="data:image/webp;base64,${fs.readFileSync(path.join(ROOT, 'logo.webp')).toString('base64')}"`);
if (/src="\.\//.test(html) || /href="\.\//.test(html)) throw new Error('まとめ損ねた読み込みがある');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)}KB)`);
