/*
 * ブラウザで実際に動かして確かめるテスト。
 *
 *   npm i -D playwright && npm run test:ui
 *
 * 画面まわりの不具合は node のテストでは捕まらない。ここでは本物の
 * ブラウザを立ち上げ、指の操作をそのまま再現して確かめる。
 *
 * ★ アプリを作ったら「ここにアプリごとの確認を足す」に書き足すこと。
 *   直した不具合には、かならず見張り役をここに置く。
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');

const PORT = Number(process.env.PORT || 8123);
const URL = `http://localhost:${PORT}/`;
const ROOT = __dirname;
const CHROMIUM = process.env.CHROMIUM_PATH;   // 手元の Chromium を使いたいとき

let passed = 0;
let failed = 0;

function ok(condition, message) {
  if (condition) {
    passed++;
    console.log('  \x1b[32m✓\x1b[0m ' + message);
  } else {
    failed++;
    console.log('  \x1b[31m✗ FAIL\x1b[0m ' + message);
  }
}

function skip(message) {
  console.log('  \x1b[90m- とばした: ' + message + '\x1b[0m');
}

function section(name) {
  console.log('\n' + name);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      http.get(URL, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() - started > 10000) reject(new Error('サーバーが起動しない'));
          else setTimeout(tick, 100);
        });
    };
    tick();
  });
}

/**
 * 何かした直後に、その要素が本来の場所からどれだけずれるかを
 * 1 フレームずつ測る。「置いた瞬間に一瞬とぶ」たぐいの不具合はこれで見つかる。
 *
 * @returns {Promise<number>} 最大のずれ (px)
 */
function _measureJump(page, selector, act) {
  return page.evaluate(async ({ sel, code }) => {
    const before = document.querySelector(sel).getBoundingClientRect();
    // eslint-disable-next-line no-new-func
    new Function(code)();
    let worst = 0;
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const el = document.querySelector(sel);
      if (!el) { worst = Infinity; break; }
      const now = el.getBoundingClientRect();
      worst = Math.max(worst, Math.abs(now.left - before.left), Math.abs(now.top - before.top));
    }
    return Math.round(worst);
  }, { sel: selector, code: act });
}

async function run() {
  let chromium;
  let devices;
  try {
    ({ chromium, devices } = require('playwright'));
  } catch (e) {
    console.error('playwright が必要です:  npm i -D playwright');
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, 'serve.js'), String(PORT)], {
    stdio: 'ignore'
  });
  await waitForServer();

  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];

  try {
    // ------------------------------------------------ スマホで開く
    section('スマホで開く (iPhone 16 Plus: 430 x 932)');
    // 端末名を決め打ちすると、入っている playwright が知らないときに全部止まる。同じ大きさの控えを使う
    const base = devices['iPhone 16 Plus'] || devices['iPhone 15 Plus'] || devices['iPhone 14 Pro Max'] || devices['iPhone 13'];
    const context = await browser.newContext({ ...base, viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push('スマホ: ' + e.message));
    phone.on('console', (m) => { if (m.type() === 'error') errors.push('スマホ: ' + m.text()); });
    await phone.goto(URL);
    await phone.waitForFunction(() => window.__app);
    await phone.bringToFront();
    ok(true, 'ページが開いて、画面のしくみが立ち上がる');

    const fit = await phone.evaluate(() => ({
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      title: document.querySelector('h1').textContent.trim(),
      hudHidden: getComputedStyle(document.querySelector('.hud')).visibility === 'hidden'
    }));
    ok(fit.wide <= 1, '横スクロールが出ない');
    ok(fit.title.includes('雪合戦'), `タイトルが出ている (${fit.title})`);
    // ホーム画面のアイコン: iOS は SVG を使えないので PNG (180x180)。読めて、大きさが合っている
    const icon = await phone.evaluate(async () => {
      const l = document.querySelector('link[rel="apple-touch-icon"]');
      if (!l) return null;
      const img = new Image(); img.src = l.href;
      await img.decode().catch(() => {});
      return { href: l.getAttribute('href'), w: img.naturalWidth, h: img.naturalHeight };
    });
    ok(icon && /\.png$/.test(icon.href) && icon.w === 180 && icon.h === 180, `ホーム画面のアイコンは PNG 180x180 で読める (${JSON.stringify(icon)})`);
    ok(fit.hudHidden, 'タイトルの間は試合の表示と操作が隠れている');

    // ------------------------------------------------ 試合を始める
    section('試合');
    const modes = await phone.evaluate(() => [...document.querySelectorAll('.diff button')].map((b) => ({ mode: b.dataset.mode, on: b.classList.contains('on') })));
    ok(modes.length === 2 && modes[0].mode === 'easy' && modes[0].on && !modes[1].on, `投げ方は 2 つで、はじめは かんたん (${JSON.stringify(modes)})`);
    // ここから先の操作の確かめは むずかしい (押さえて構える) で行う。かんたんは下で別に確かめる
    await phone.click('.diff button[data-mode="hard"]');
    await phone.click('#btnStart');
    ok(await phone.evaluate(() => window.__app.match().aimMode === 'hard'), 'むずかしい を選ぶと、その投げ方で試合が始まる');
    const started = await phone.evaluate(() => ({
      title: document.getElementById('vTitle').hidden,
      human: window.__app.match().human,
      hud: getComputedStyle(document.querySelector('.hud')).visibility
    }));
    ok(started.title && started.human != null && started.hud === 'visible', '試合開始でタイトルが消え、自分の選手が決まる');
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    ok(true, 'カウントダウンのあとプレーが始まる');

    // 実機の安全域 (上 59・下 34) を足しても、操作と表示が画面に収まる
    const rects = await phone.evaluate(() => ['.score', '#btnPause', '#throwPad', '#stick'].map((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { sel, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }));
    for (const r of rects) {
      // 上の物は env(safe-area-inset-top)、下の物は env(safe-area-inset-bottom) の内側に置いてある。
      // ここ (安全域 0) で画面内なら、実機では安全域ぶん内側へずれるだけ
      ok(r.left >= 0 && r.right <= 430 && r.top >= 0 && r.bottom <= 932 && (r.top < 466 ? r.bottom + 59 <= 466 : r.top - 34 >= 466),
        `${r.sel} が安全域ぶんずれても画面内 (${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)})`);
    }

    // ---- 見える範囲: スタート地点から、相手のシェルターとバックラインが上の帯に隠れない
    // (帯は実機では安全域 59 だけ下へずれる。3D は画面いっぱいに描くので、そちらはずれない)
    const view = await phone.evaluate(async () => {
      const A = window.__app, C = window.Core, me = A.me();
      me.x = -2; me.z = C.R.BACK_LINE_U - 0.5;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 400));   // カメラが追いつくのを待つ
      const bar = A.hudBottom() + 59;
      const y = (x, z, h) => A.project(x, h, z).y;
      return { bar: Math.round(bar), shelter: Math.round(y(-2.6, -8, 1.2)), back: Math.round(y(0, -C.R.BACK_LINE_U, 0)), meY: Math.round(y(me.x, me.z, 0)) };
    });
    ok(view.shelter > view.bar && view.back > view.bar,
      `スタート地点から相手のシェルター (y${view.shelter})・バックライン (y${view.back}) が帯 (下端 y${view.bar}) に隠れない`);
    ok(view.meY > 932 * 0.64 && view.meY < 932 * 0.78, `自分は画面の下寄りで、投げるボタンに隠れない (y${view.meY} = ${Math.round(view.meY / 9.32)}%)`);

    // ---- 移動
    const center = async (sel) => phone.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, sel);
    // 敵に邪魔されないよう、あかは球を持たせない
    await phone.evaluate(() => {
      const m = window.__app.match();
      m.players.filter((p) => p.team === 1).forEach((p) => { p.balls = 0; });
      m.stock[1] = 0;
    });
    const z0 = await phone.evaluate(() => window.__app.me().z);
    await phone.mouse.move(100, 760);
    await phone.mouse.down();
    await phone.mouse.move(100, 700, { steps: 4 });
    await phone.waitForFunction((z) => window.__app.me().z < z - 1, z0, { timeout: 8000 }).catch(() => {});
    const z1 = await phone.evaluate(() => window.__app.me().z);
    // 指を移動ゾーンの外 (上) まで滑らせても、離すまでは捕まえておく
    await phone.mouse.move(100, 300, { steps: 4 });
    const held = await phone.evaluate(() => window.__app.app.input.mz);
    await phone.mouse.up();
    const after = await phone.evaluate(() => window.__app.app.input.mz);
    ok(z1 < z0 - 1, `左側を上へなぞると前へ進む (z ${z0.toFixed(2)} → ${z1.toFixed(2)})`);
    ok(held < -0.9, `指がゾーンの外へ出ても進み続ける (mz ${held.toFixed(2)})`);
    ok(after === 0, '指を離すと止まる');

    // ---- 狙って投げる (はじいた向きの相手を自動で狙う)
    // あかを 2 人だけ、自分の左前と右前に止めておく。仲間は投げない
    const setup = await phone.evaluate(() => {
      const m = window.__app.match(), me = window.__app.me();
      me.x = 0; me.z = 6; me.balls = 5;
      m.skill[1] = 0;
      // 仲間は投げず、動かない (守りのいないフラッグへ走って、確かめの途中でセットを終わらせないように)
      m.players.filter((p) => p.team === 0 && p !== me).forEach((p) => { p.balls = 0; p.ai.think = 999; p.ai.goal = null; });
      m.stock[0] = 0;     // 仲間が丸めて当ててしまわないように
      const reds = m.players.filter((p) => p.team === 1);
      reds.forEach((p, i) => { p.alive = i < 2; p.ai.think = 999; p.ai.goal = null; p.balls = 0; });
      reds[0].x = -3.5; reds[0].z = -3;
      reds[1].x = 3.5; reds[1].z = -3;
      return { me: me.id, left: reds[0].id, right: reds[1].id };
    });
    await phone.waitForTimeout(300);
    const pad = await center('#throwPad');
    const lockIdle = await phone.evaluate(() => window.__app.app.lock && window.__app.app.lock.target);
    ok(lockIdle === setup.left || lockIdle === setup.right, `触っていなくても、狙う相手に輪が出ている (相手 ${lockIdle})`);
    // 右前の相手の方へはじく
    const flick = async (dx, dy) => {
      await phone.mouse.move(pad.x, pad.y);
      await phone.mouse.down();
      await phone.mouse.move(pad.x + dx, pad.y + dy, { steps: 4 });
      await phone.waitForTimeout(80);
      const during = await phone.evaluate(() => ({ lock: window.__app.app.lock, line: true }));
      await phone.mouse.up();
      await phone.waitForTimeout(60);
      // 向きだけ確かめたいので、当たってセットが終わらないよう玉は片づける
      const flew = await phone.evaluate(() => {
        const m = window.__app.match();
        const out = m.balls.filter((b) => b.owner === m.human).map((b) => ({ vx: b.vx, vz: b.vz }));
        m.balls = [];
        return out;
      });
      return Object.assign({}, during.lock, { flew });
    };
    const ballsBefore = await phone.evaluate(() => window.__app.me().balls);
    const lockR = await flick(40, -70);
    const flewR = lockR.flew;
    ok(lockR && lockR.target === setup.right && lockR.clear, `右前へはじくと右の相手を狙い、当たるコースになる`);
    ok(flewR.length === 1 && flewR[0].vx > 0 && flewR[0].vz < 0, `右前へ飛んでいく`);
    await phone.waitForFunction(() => window.__app.me().cd <= 0, null, { timeout: 3000 });   // 構え直しが終わるまで
    const lockL = await flick(-40, -70);
    ok(lockL && lockL.target === setup.left, '左前へはじくと左の相手を狙う');
    const ballsAfter = await phone.evaluate(() => window.__app.me().balls);
    ok(ballsAfter === ballsBefore - 2, `はじくたびに 1 個投げる (${ballsBefore} → ${ballsAfter})`);
    // だれもいない向き (真後ろ) へはじくと、指の量で地面を狙う
    await phone.waitForFunction(() => window.__app.me().cd <= 0, null, { timeout: 3000 });
    const lockB = await flick(0, 80);
    ok(lockB && lockB.manual && lockB.target == null && lockB.z > 6, `だれもいない向きへはじくと、その向きの地面を狙う (z ${lockB && lockB.z.toFixed(1)})`);

    // ---- 構え: 押さえている間に輪が締まり、締まりきると赤。離すと投げて 0 に戻る
    await phone.waitForFunction(() => window.__app.me().cd <= 0, null, { timeout: 3000 });
    await phone.evaluate(() => { const me = window.__app.me(); me.balls = 5; me.cd = 0; window.__app.match().balls = []; });
    await phone.mouse.move(pad.x, pad.y);
    await phone.mouse.down();
    await phone.waitForTimeout(150);
    const h1 = await phone.evaluate(() => ({ f: window.__app.me().aimF, crouch: window.__app.me().crouch,
      aiming: document.getElementById('throwPad').classList.contains('aiming'), ready: document.getElementById('throwPad').classList.contains('ready') }));
    await phone.waitForFunction(() => window.__app.me().aimF >= 1, null, { timeout: 3000 });
    await phone.waitForTimeout(100);
    const h2 = await phone.evaluate(() => ({ f: window.__app.me().aimF, crouch: window.__app.me().crouch,
      ready: document.getElementById('throwPad').classList.contains('ready'), cam: window.__app.camInfo() }));
    await phone.mouse.up();
    await phone.waitForTimeout(60);
    const h3 = await phone.evaluate(() => { const m = window.__app.match(); const n = m.balls.filter((b) => b.owner === m.human).length; m.balls = []; return { n, f: window.__app.me().aimF, rec: document.getElementById('throwPad').classList.contains('recover') }; });
    await phone.waitForFunction(() => window.__app.me().cd <= 0, null, { timeout: 3000 });
    await phone.waitForTimeout(80);
    const recEnd = await phone.evaluate(() => document.getElementById('throwPad').classList.contains('recover'));
    ok(h3.rec && !recEnd, '投げた直後はボタンが沈んで構え直し、終わると戻る');
    ok(h1.aiming && h1.f > 0.05 && h1.f < 0.8 && !h1.ready, `押さえ始めは構えの途中で、まだ赤くない (${h1.f.toFixed(2)})`);
    ok(h2.f === 1 && h2.ready, '押さえ続けると構えが定まり、投げるボタンが赤くなる');
    ok(h2.cam.aimZoom > 0.8 && h2.cam.pos[1] < 5, `構えている間は、カメラが狙う相手の方へ寄る (寄り ${h2.cam.aimZoom.toFixed(2)}・高さ ${h2.cam.pos[1]}m)`);
    await phone.waitForFunction(() => window.__app.camInfo().aimZoom < 0.05, null, { timeout: 6000 }).catch(() => {});
    const camBack = await phone.evaluate(() => window.__app.camInfo());
    ok(camBack.aimZoom < 0.05 && camBack.pos[1] > 7, `離すと、いつものカメラへ戻る (寄り ${camBack.aimZoom.toFixed(2)}・高さ ${camBack.pos[1]}m)`);
    ok(h1.crouch === false && h2.crouch === false, '構えている間は立つ');
    ok(h3.n === 1 && h3.f === 0, `離すと 1 個投げ、構えは 0 に戻る (投げた ${h3.n})`);

    // ---- 取り消し: 押さえたまま外へ引っぱり、真ん中へ戻して離すと投げない
    await phone.waitForFunction(() => window.__app.me().cd <= 0, null, { timeout: 12000 });
    await phone.evaluate(() => { const me = window.__app.me(); me.balls = 3; window.__app.match().balls = []; });
    await phone.mouse.move(pad.x, pad.y);
    await phone.mouse.down();
    await phone.mouse.move(pad.x - 70, pad.y - 30, { steps: 5 });
    await phone.mouse.move(pad.x + 4, pad.y + 3, { steps: 5 });
    await phone.waitForTimeout(80);
    const cst = await phone.evaluate(() => ({ s: window.__app.cancelState(), label: getComputedStyle(document.querySelector('#throwPad .label'), '::after').content }));
    await phone.mouse.up();
    await phone.waitForTimeout(120);
    const cAfter = await phone.evaluate(() => ({ balls: window.__app.me().balls, flying: window.__app.match().balls.filter((b) => b.owner === window.__app.match().human).length, cls: document.getElementById('throwPad').classList.contains('cancel'), f: window.__app.me().aimF }));
    ok(cst.s.cancel && cst.s.cls && /やめる/.test(cst.label), `引っぱって真ん中へ戻すと「やめる」になる (${cst.label})`);
    ok(cAfter.balls === 3 && cAfter.flying === 0 && !cAfter.cls && cAfter.f === 0, `そこで離すと投げない (雪玉 ${cAfter.balls}・飛んでいる ${cAfter.flying}・構え ${cAfter.f})`);

    // ---- 必殺ゲージ: 満タンで投げるボタンが金色の「大玉!」になり、投げると大玉が飛ぶ
    await phone.evaluate(() => { window.__app.match().sp[0] = 1; });
    await phone.waitForTimeout(150);
    const sup = await phone.evaluate(() => ({ cls: document.getElementById('throwPad').classList.contains('super'), label: document.getElementById('padLabel').textContent }));
    await phone.mouse.move(pad.x, pad.y);
    await phone.mouse.down();
    await phone.waitForFunction(() => window.__app.me().aimF >= 1, null, { timeout: 12000 });
    await phone.mouse.up();
    await phone.waitForFunction(() => window.__app.match().balls.some((b) => b.big) || window.__app.match().sp[0] === 0, null, { timeout: 5000 }).catch(() => {});
    const supAfter = await phone.evaluate(() => { const m = window.__app.match(); const big = m.balls.some((b) => b.big); m.balls = []; return { big, sp: m.sp[0] }; });
    await phone.waitForTimeout(150);
    const supLabel = await phone.evaluate(() => ({ cls: document.getElementById('throwPad').classList.contains('super'), label: document.getElementById('padLabel').textContent }));
    ok(sup.cls && sup.label === '大玉!', `ゲージ満タンで投げるボタンが「大玉!」 (${sup.label})`);
    ok(supAfter.big && supAfter.sp === 0 && !supLabel.cls && supLabel.label === '投げる', `投げると大玉が飛び、ゲージとボタンが戻る (大玉 ${supAfter.big}・ゲージ ${supAfter.sp}・${supLabel.label})`);

    // ---- 隠れている物の印: 狙っている相手が帯の下・画面の外なら、帯の下端に矢印。見えていれば出さない
    const marks = await phone.evaluate(async (ids) => {
      const A = window.__app, m = A.match(), me = A.me();
      const reds = m.players.filter((p) => p.team === 1 && p.alive);
      const q = m.players[ids.left];
      const wait = () => new Promise((r) => setTimeout(r, 250));
      const shown = (id) => !document.getElementById(id).hidden;
      // 実機の上の安全域 (59) を帯に足して測る (このブラウザでは 0 なので、帯が 59 だけ上にある)
      const style = document.createElement('style');
      style.textContent = '.hud { padding-top: 65px !important; }';
      document.head.appendChild(style);
      window.dispatchEvent(new Event('resize'));
      // 見える所 (自分の少し前)
      reds.forEach((p) => { if (p !== q) { p.x = 4.6; p.z = 30; p.alive = false; } });
      me.x = 0; me.z = 8; q.x = 0; q.z = 2; q.ai.goal = null;
      await wait();
      const near = { lock: shown('markLock'), target: A.app.lock && A.app.lock.target };
      // 画面の上の外 (相手のエンドラインのそば)
      // 届くいちばん遠い所 (22m 先) の相手でも、帯の下に見えている (だから矢印は出ない)
      me.x = 0; me.z = 10.5; q.x = 0; q.z = 10.5 - window.Core.R.RANGE;
      await wait();
      const bar = A.hudBottom();
      const far = { lock: shown('markLock'), target: A.app.lock && A.app.lock.target, y: Math.round(A.project(q.x, 1.0, q.z).y), bar: Math.round(bar) };
      // フラッグ: 隠れているときだけ印。低いカメラでは遠くからも見えるので、隠れる場面は前の高いカメラで作る
      A.setCam({ h: 21, back: 10, ahead: 7, fov: 52 });
      me.z = 10.5; await wait(); await wait();
      const flagFar = shown('markFlag');
      A.setCam({ h: 8, back: 8, ahead: 7, fov: 58 });
      me.x = 0; me.z = 10.5; await wait(); await wait();
      const flagStartLow = { shown: shown('markFlag'), y: Math.round(A.project(0, 1.5, -window.Core.R.FLAG_U).y), bar: Math.round(A.hudBottom()) };
      me.x = 2; me.z = -9; await wait();
      const flagNear = shown('markFlag');
      me.x = 0; me.z = 8;
      reds.forEach((p) => { p.alive = true; });
      style.remove();
      window.dispatchEvent(new Event('resize'));
      return { near, far, flagFar, flagNear, flagStartLow };
    }, setup);
    ok(marks.near.target === setup.left && !marks.near.lock, '狙っている相手が見えていれば、矢印は出さない');
    ok(marks.far.target === setup.left && marks.far.y > marks.far.bar && !marks.far.lock,
      `届くいちばん遠い相手 (22m) も帯の下に見える (相手 y${marks.far.y} / 帯 y${marks.far.bar})`);
    ok(marks.flagFar && !marks.flagNear, `相手のフラッグは、隠れているときだけ印を出す (遠く ${marks.flagFar} / そば ${marks.flagNear})`);
    ok(!marks.flagStartLow.shown && marks.flagStartLow.y > marks.flagStartLow.bar, `低いカメラでは、スタート地点から相手のフラッグが帯の下に見えている (y${marks.flagStartLow.y} / 帯 ${marks.flagStartLow.bar})`);

    // ---- 壁に隠れた「狙っている相手」は透けて見える (低いカメラでは壁に隠れやすい)。狙っていない相手は透けない
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    const xr = await phone.evaluate(async () => {
      const A = window.__app, C = window.Core, m = A.match(), me = A.me();
      const w = C.SHELTERS.find((x) => x.x > 0 && x.z < 0 && x.z > -10);         // あか陣の右のシェルター
      const reds = m.players.filter((p) => p.team === 1 && p.alive);
      const q = reds[0], other = reds[1];
      reds.forEach((p) => { p.ai.think = 999; p.ai.goal = null; p.balls = 0; p.vx = p.vz = 0; if (p !== q && p !== other) { p.x = -4.5; p.z = -17; } });
      me.x = w.x; me.z = 3;
      q.x = w.x - 0.3; q.z = w.z - w.d / 2 - C.R.PLAYER_R - 0.05; q.standT = 0;    // 壁のすぐ裏にしゃがむ (狙う相手。立っていると胸から上は壁の上に見えている)
      other.x = -4.6; other.z = 9.5;                                               // 自陣の奥 (狙いの外)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(900);
      const locked = A.app.lock && A.app.lock.target;
      // 狙いの外の相手も、壁の裏へ置いて比べる
      other.x = w.x + 0.6; other.z = q.z;
      await wait(400);
      return { locked, q: q.id, xq: A.xray(q.id), xo: A.app.lock && A.app.lock.target === other.id ? null : A.xray(other.id) };
    });
    ok(xr.locked === xr.q && xr.xq === true, `狙っている相手が壁に隠れると、透けて見える (狙い ${xr.locked})`);
    ok(xr.xo === false || xr.xo === null, `狙っていない相手は、壁に隠れても透けない (${xr.xo})`);

    // ---- 当てたときの手応え: 目の前で止まっている相手に、構えてから当てる
    // (上ではじいた玉が当たってセットが終わっていることがあるので、プレー中に戻るのを待つ)
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    const victim = await phone.evaluate(() => {
      const m = window.__app.match(), me = window.__app.me();
      me.x = 0; me.z = 6; me.balls = 3; me.cd = 0;
      m.skill[1] = 0;
      m.players.filter((p) => p.team === 0 && p !== me).forEach((p) => { p.balls = 0; });
      m.stock = [0, 0];
      const reds = m.players.filter((p) => p.team === 1);
      // 3 人残す (このあとの確かめで 1 人退場させても、セットが終わらないように)
      reds.forEach((p, i) => { p.alive = i < 3; p.ai.think = 999; p.ai.goal = null; p.balls = 0; });
      reds[0].x = 0; reds[0].z = 2;          // 4m 先。よける間が無い
      reds[1].x = 4.5; reds[1].z = -16;
      reds[2].x = -4.5; reds[2].z = -16;
      return reds[0].id;
    });
    await phone.waitForTimeout(100);
    await phone.mouse.move(pad.x, pad.y);
    await phone.mouse.down();
    await phone.waitForFunction(() => window.__app.me().aimF >= 1, null, { timeout: 3000 });
    await phone.mouse.up();
    await phone.waitForFunction((id) => !window.__app.match().players[id].alive, victim, { timeout: 5000 }).catch(() => {});
    await phone.waitForTimeout(50);
    const juice = await phone.evaluate((id) => ({
      out: !window.__app.match().players[id].alive,
      pop: [...document.querySelectorAll('#pops .hit-text b')].map((e) => e.textContent),
      center: (() => { const e = document.querySelector('#pops .hit-text'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })(),
      shake: window.__app.hitShake(),
      hitCam: window.__app.camInfo().hitCam,
      combo: window.__app.app.combo.n
    }), victim);
    await phone.waitForFunction(() => !document.querySelector('#pops .hit-text'), null, { timeout: 3000 }).catch(() => {});
    await phone.waitForFunction(() => window.__app.camInfo().hitCam === 0, null, { timeout: 6000 }).catch(() => {});
    const hitGone = await phone.evaluate(() => ({ left: document.querySelectorAll('#pops .hit-text').length, shake: window.__app.hitShake(), hitCam: window.__app.camInfo().hitCam }));
    const bashi = await phone.evaluate(() => window.__app.sound('bashi'));
    // (直前のはじく確かめで当たっていれば、連続ヒットの言葉になる)
    const fans = await phone.evaluate(() => window.__app.scenery());
    ok(fans.fans >= 100 && fans.cheer[0] > 0 && fans.cheer[1] === 0, `当てると、当てた側 (あお) の観客が跳ねる (観客 ${fans.fans} 人 / 跳ねる ${fans.cheer.map((v) => v.toFixed(1))})`);
    ok(juice.out && juice.pop.includes('HIT!!'), `構えて当てると HIT!! が出る (${juice.pop.join(',')})`);
    ok(juice.center && Math.abs(juice.center.x - 215) < 30 && juice.center.y > 300 && juice.center.y < 560 && juice.center.w > 200, `HIT!! は画面の真ん中に大きく出る (${juice.center && Math.round(juice.center.x)}, ${juice.center && Math.round(juice.center.y)} / 幅 ${juice.center && Math.round(juice.center.w)})`);
    ok(juice.shake > 0 && hitGone.shake === 0, `当てた瞬間だけ画面が揺れ、すぐ収まる (${juice.shake.toFixed(2)} → ${hitGone.shake})`);
    ok(hitGone.left === 0, 'HIT!! は消える (残らない)');
    ok(juice.hitCam > 0 && hitGone.hitCam === 0, `当てた瞬間はカメラが当てた相手へ寄り、すぐ戻る (${juice.hitCam.toFixed(2)} → ${hitGone.hitCam})`);
    // セットの決着も真ん中に大きく。縁は勝ったチームの色。HIT!! が出ている間は、それが消えてから出す
    const setRes = await phone.evaluate(async () => {
      const A = window.__app, m = A.match();
      const q = m.players.find((p) => p.team === 1 && p.alive);
      m.events.push({ type: 'hit', player: q.id, by: m.human, x: q.x, y: 1, z: q.z, vx: 0, vz: -1 });
      m.events.push({ type: 'setEnd', reason: 'flag', winner: 0, setNo: 1, points: [10, 5] });
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      await wait(150);
      const during = { hit: !!document.querySelector('#pops .hit-text'), result: !!document.querySelector('#pops .result-text') };
      await wait(700);
      const e = document.querySelector('#pops .result-text');
      const r = e && e.getBoundingClientRect();
      const out = { during, lines: e ? [...e.querySelectorAll('b')].map((b) => b.textContent) : [], blue: !!e && e.classList.contains('blue'),
        inside: !!r && r.left >= 0 && r.right <= 430, banner: document.getElementById('banner').hidden };
      document.querySelectorAll('#pops .big-text').forEach((x) => x.remove());
      q.alive = true;
      return out;
    });
    ok(setRes.during.hit && !setRes.during.result, 'HIT!! と決着が重なるときは、HIT!! が先 (決着の字はまだ出ない)');
    ok(setRes.lines[0] === 'フラッグ奪取!' && setRes.lines[1] === 'あおの勝ち!' && setRes.blue && setRes.inside && setRes.banner,
      `セットの決着は真ん中に大きく、勝ったチームの色の縁で、画面に収まる (${setRes.lines.join(' / ')})`);
    ok(bashi && bashi.peak > 0.2 && bashi.peak < 0.9, `「バシッ!」の大きさ: いちばん大きい所 ${bashi && bashi.peak.toFixed(2)} (0.2〜0.9) / 平均 ${bashi && bashi.rms.toFixed(3)}`);

    // ---- 止まるとしゃがんで丸める
    await phone.evaluate(() => { const m = window.__app.match(); m.stock[0] = 30; window.__app.me().balls = 1; });
    await phone.waitForTimeout(400);
    const crouching = await phone.evaluate(() => ({ c: window.__app.me().crouch, b: window.__app.me().balls }));
    await phone.waitForFunction((b) => window.__app.me().balls > b, crouching.b, { timeout: 8000 }).catch(() => {});
    const made = await phone.evaluate(() => window.__app.me().balls);
    await phone.mouse.move(100, 780);
    await phone.mouse.down();
    await phone.mouse.move(160, 780, { steps: 3 });
    await phone.waitForTimeout(150);
    const stood = await phone.evaluate(() => window.__app.me().crouch);
    await phone.mouse.up();
    ok(crouching.c, '止まると自動でしゃがむ');
    ok(made > crouching.b, `しゃがんでいると雪玉が増える (${crouching.b} → ${made})`);
    ok(stood === false, '動くと立つ');
    // このあとの確かめのために、だれも丸められないよう戻しておく
    await phone.evaluate(() => { const m = window.__app.match(); m.stock = [0, 0]; m.players.forEach((p) => { if (p.team === 0 && p.id !== m.human) p.balls = 0; }); });

    // ---- 2 本指: 移動しながら狙う
    const multi = await phone.evaluate(async () => {
      const fire = (el, type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 11 }));
      const zone = document.getElementById('stickZone');
      const pad = document.getElementById('throwPad');
      const pr = pad.getBoundingClientRect();
      const px = pr.left + pr.width / 2, py = pr.top + pr.height / 2;
      fire(zone, 'pointerdown', 11, 100, 780);
      fire(zone, 'pointermove', 11, 160, 780);
      fire(pad, 'pointerdown', 12, px, py);
      fire(pad, 'pointermove', 12, px, py - 80);
      await new Promise((r) => setTimeout(r, 120));
      const res = { mx: window.__app.app.input.mx, aim: !!window.__app.app.aim };
      fire(zone, 'pointerup', 11, 160, 780);
      res.mxAfter = window.__app.app.input.mx;
      res.aimAfterStickUp = !!window.__app.app.aim;
      fire(pad, 'pointercancel', 12, px, py - 80);
      return res;
    });
    ok(multi.mx > 0.9 && multi.aim, '移動と狙いを同時にできる');
    ok(multi.mxAfter === 0 && multi.aimAfterStickUp, '片方の指を離しても、もう片方は続く');

    // ---- 狙いの色: 当たるコースなら赤
    const lock = await phone.evaluate(() => {
      const m = window.__app.match();
      const me = window.__app.me();
      const foe = m.players.find((p) => p.team === 1 && p.alive);
      foe.x = me.x; foe.z = me.z - 8; foe.crouch = false;
      const hit = window.Core.predictHit(m.players, me.team, me.x, me.z, foe.x, foe.z);
      const miss = window.Core.predictHit(m.players, me.team, me.x, me.z, foe.x + 3, foe.z);
      return { hit: hit && hit.id === foe.id, miss: miss === null };
    });
    ok(lock.hit && lock.miss, '当たるコースの判定: 正面の相手には当たり、3m 横には当たらない');

    // ---- 上の表示
    await phone.evaluate(() => {
      const red = window.__app.match().players.find((p) => p.team === 1 && p.alive);
      red.alive = false;
    });
    await phone.waitForTimeout(150);
    const hud2 = await phone.evaluate(() => ({
      out: document.querySelectorAll('#aliveRed i.out').length,
      alive: window.Core.aliveCount(window.__app.match(), 1)
    }));
    ok(hud2.out === 7 - hud2.alive && hud2.alive < 7, `退場すると上の表示が減る (あか 残り${hud2.alive} / 消えた印 ${hud2.out})`);

    // ---- 一時停止
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    await phone.click('#btnPause');
    const t1 = await phone.evaluate(() => window.__app.match().time);
    await phone.waitForTimeout(500);
    const t2 = await phone.evaluate(() => window.__app.match().time);
    ok(t1 === t2, '一時停止中は時間が止まる');
    await phone.click('#btnResume');
    await phone.waitForTimeout(500);
    const t3 = await phone.evaluate(() => window.__app.match().time);
    ok(t3 < t2, 'つづけると再開する');

    // ---- 相手コートは 3 人まで
    section('相手コートは 3 人まで');
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    const crowd = await phone.evaluate(async () => {
      const m = window.__app.match();
      const me = window.__app.me();
      // あかを全員そろえて奥で止め、だれも投げないようにする (前の確かめで減っていることがある)。
      // あおの AI 3 人を相手コートへ
      m.players.filter((p) => p.team === 1).forEach((p, i) => { p.alive = true; p.x = -4 + (i % 4) * 2.6; p.z = -16 - (i >> 2); p.balls = 0; p.ai.think = 999; p.ai.goal = null; });
      m.players.filter((p) => p.team === 0).forEach((p) => { p.balls = 0; });
      m.stock = [0, 0];
      const mates = m.players.filter((p) => p.team === 0 && p.alive && p !== me);
      mates.slice(0, 3).forEach((p, i) => { p.x = -4 + i * 1.6; p.z = -2; p.ai.think = 999; p.ai.goal = { x: p.x, z: -2 }; p.balls = 0; });
      mates.slice(3).forEach((p) => { p.ai.think = 999; p.ai.goal = null; });
      me.x = 4.3; me.z = 1.5;
      await new Promise((r) => setTimeout(r, 300));
      return {
        badge: document.getElementById('inEnemy').textContent,
        full: document.getElementById('inEnemy').classList.contains('full'),
        warn: !document.getElementById('warn').hidden
      };
    });
    ok(crowd.badge === '敵陣 3/3' && crowd.full, `敵陣の人数が出る (${crowd.badge})`);
    ok(crowd.warn, '3 人入っているときにセンターラインへ近づくと、反則の注意が出る');
    // 自分が 4 人目として入る (左側をなぞって前へ)
    await phone.mouse.move(100, 780);
    await phone.mouse.down();
    await phone.mouse.move(100, 700, { steps: 4 });
    await phone.waitForFunction(() => window.__app.match().phase !== 'play', null, { timeout: 8000 }).catch(() => {});
    await phone.mouse.up();
    const foul = await phone.evaluate(() => ({ r: window.__app.match().setResults.slice(-1)[0], ban: document.getElementById('banner').textContent }));
    ok(foul.r && foul.r.reason === 'over' && foul.r.winner === 1, `4 人目が入るとセット負け (${foul.ban})`);
    // 前の確かめでセットが終わっていると、ここで試合が決まることがある。そのときは新しい試合で続ける
    await phone.waitForFunction(() => window.__app.match().phase === 'play' || !document.getElementById('vResult').hidden, null, { timeout: 10000 });
    if (await phone.evaluate(() => !document.getElementById('vResult').hidden)) {
      await phone.click('#btnAgain');
      await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 10000 });
    }

    // ---- ビクトリースロー
    section('ビクトリースロー');
    await phone.evaluate(() => { window.Core.startVT(window.__app.match()); });
    await phone.waitForTimeout(200);
    const vt0 = await phone.evaluate(() => {
      const m = window.__app.match();
      return { phase: m.phase, alive: m.players.filter((p) => p.alive).length, me: window.__app.me().id === m.vt.ids[0], ban: document.getElementById('banner').textContent, time: document.getElementById('time').textContent };
    });
    ok(vt0.phase === 'vt' && vt0.alive === 2 && vt0.me, `投げる 2 人だけが残り、自分が投げる (${vt0.ban})`);
    ok(vt0.time === 'VT', '時計の所が VT になる');
    const vtHide = await phone.evaluate(() => ['.stockline', '#inEnemy', '#stickZone'].map((q) => getComputedStyle(document.querySelector(q)).visibility));
    ok(vtHide.every((v) => v === 'hidden'), `VT では使わない表示と操作を隠す (${vtHide.join(',')})`);
    // フラッグに当たる着地点を、投げるボタンのスライドで狙う
    await phone.waitForFunction(() => window.__app.match().vt.wait <= 0, null, { timeout: 5000 });
    const drag = await phone.evaluate(() => {
      const C = window.Core, me = window.__app.me(), f = C.flagPos(1);
      const aim = C.findAim([], 0, me.x, me.z, { team: 1, crouch: false, standT: 0 }, f.x, f.z);
      const k = C.R.RANGE / 140;   // app.js の aimMax
      return { dx: (aim.x - me.x) / k, dy: (aim.z - me.z) / k };
    });
    const pad2 = await center('#throwPad');
    await phone.mouse.move(pad2.x, pad2.y);
    await phone.mouse.down();
    await phone.mouse.move(pad2.x + drag.dx, pad2.y + drag.dy, { steps: 6 });
    await phone.waitForTimeout(120);
    await phone.mouse.up();
    await phone.waitForFunction(() => window.__app.match().vt.hits[0].length === 1, null, { timeout: 8000 }).catch(() => {});
    const vt1 = await phone.evaluate(() => window.__app.match().vt.hits[0]);
    ok(vt1.length === 1 && vt1[0] === true, `狙ってスライドして投げると、フラッグに当たる (${JSON.stringify(vt1)})`);
    await phone.waitForFunction(() => window.__app.match().vt.hits[1].length >= 1 || window.__app.match().phase !== 'vt', null, { timeout: 10000 }).catch(() => {});
    const vt2 = await phone.evaluate(() => ({ phase: window.__app.match().phase, hits: window.__app.match().vt.hits }));
    ok(vt2.hits[1].length >= 1, `あかも投げる (${JSON.stringify(vt2.hits)})`);
    await phone.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 60000 }).catch(() => {});
    // 勝負がつかない回は自分も投げ続ける必要があるので、つくまで当て続ける
    for (let i = 0; i < 9 && (await phone.evaluate(() => document.getElementById('vResult').hidden)); i++) {
      await phone.evaluate(() => {
        const C = window.Core, me = window.__app.me(), f = C.flagPos(1);
        window.__app.app.input.throwAt = C.findAim([], 0, me.x, me.z, { team: 1, crouch: false, standT: 0 }, f.x, f.z);
      });
      await phone.waitForTimeout(3000);
    }
    const vtRes = await phone.evaluate(() => ({ hidden: document.getElementById('vResult').hidden, text: document.getElementById('resultSets').textContent, by: window.__app.match().decidedBy }));
    ok(!vtRes.hidden && vtRes.by === 'vt' && vtRes.text.includes('ビクトリースロー'), `ビクトリースローで決着し、結果に出る (${vtRes.text.slice(-40)})`);
    await phone.click('#btnAgain');
    await phone.waitForTimeout(200);
    const startBan = await phone.evaluate(() => { const b = document.getElementById('banner'); const r = b.getBoundingClientRect(); return { hidden: b.hidden, text: b.textContent, w: r.width, h: r.height }; });
    ok(!startBan.hidden && startBan.w > startBan.h * 1.5, `始まりの帯 (${startBan.text}) が縦に潰れない (${Math.round(startBan.w)}x${Math.round(startBan.h)})`);
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 10000 });
    const back = await phone.evaluate(() => getComputedStyle(document.querySelector('#stickZone')).visibility);
    ok(back === 'visible', '次の試合では操作が戻る');

    // ---- 試合の終わり
    section('試合の終わり');
    await phone.evaluate(() => {
      const m = window.__app.match();
      m.setWins = [1, 0];
      m.setNo = 2;
      m.players.filter((p) => p.team === 1).forEach((p) => { p.alive = false; });
    });
    await phone.waitForFunction(() => window.__app.match().phase === 'setOver', null, { timeout: 5000 });
    await phone.waitForTimeout(60);
    await phone.waitForFunction(() => document.querySelector('#pops .result-text'), null, { timeout: 3000 }).catch(() => {});
    const ban = await phone.evaluate(() => {
      const b = document.querySelector('#pops .result-text');
      const r = b ? b.getBoundingClientRect() : { width: 0, height: 0 };
      return { shown: !!b, text: b ? [...b.querySelectorAll('b')].map((x) => x.textContent).join(' / ') : '', w: r.width, h: r.height };
    });
    ok(ban.shown && ban.text.includes('全員アウト') && ban.text.includes('あおの勝ち') && ban.text.includes('10 - 0 pt'), `セットの結果とポイントが真ん中に大きく出る (${ban.text})`);
    ok(ban.w > 250 && ban.w <= 430, `決着の字が画面の幅に収まる (${Math.round(ban.w)}x${Math.round(ban.h)})`);
    await phone.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 10000 });
    const res = await phone.evaluate(() => ({ t: document.getElementById('resultTitle').textContent, n: document.querySelectorAll('#resultSets li').length }));
    ok(res.t.includes('勝利'), `2 セット取ると試合終了の画面 (${res.t}, ${res.n} 行)`);
    const totals = await phone.evaluate(() => document.getElementById('resultSets').textContent);
    ok(/ポイント \d+ - \d+/.test(totals) && totals.includes('セット数で決着'), `結果にポイント合計と決め手が出る`);
    await phone.click('#btnAgain');
    await phone.waitForTimeout(150);
    const again = await phone.evaluate(() => ({ hidden: document.getElementById('vResult').hidden, set: window.__app.match().setNo, wins: window.__app.match().setWins.join('-') }));
    ok(again.hidden && again.set === 1 && again.wins === '0-0', 'もう一度で新しい試合になる');

    // ---- 見えていない間は止まる (ヘッドレスでは visibilitychange が来ないので自分で送る)
    await phone.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const paused = await phone.evaluate(() => ({ p: window.__app.app.paused, v: !document.getElementById('vPause').hidden }));
    ok(paused.p && paused.v, 'アプリを切り替えると一時停止する');
    await phone.evaluate(() => { delete document.hidden; });
    await phone.click('#btnResume');

    // ------------------------------------------------ 選手の絵
    section('選手の絵');
    await phone.waitForFunction(() => window.__app.sprites().ready, null, { timeout: 10000 });
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    // 向きと動きで、どのコマを出すか
    const pf = await phone.evaluate(() => {
      const f = window.__app.pickFrame;
      const base = { camSign: 1, team: 0, throwT: 0, crouch: false, making: false, speed: 0, step: 0, t: 0 };
      return {
        away: f(Object.assign({}, base, { face: Math.PI })),                 // -z へ向く = カメラから遠ざかる
        toward: f(Object.assign({}, base, { face: 0, team: 1 })),             // あかが +z へ向く = こちらを向く
        right: f(Object.assign({}, base, { face: Math.PI / 2 })),
        left: f(Object.assign({}, base, { face: -Math.PI / 2 })),
        run: [0, 1, 2, 3].map((k) => f(Object.assign({}, base, { face: Math.PI, speed: 4, step: k * Math.PI / 2 + 0.1 })).col),
        crouch: f(Object.assign({}, base, { face: Math.PI, crouch: true })).col,
        windup: f(Object.assign({}, base, { face: Math.PI, throwT: 0.3 })).col,
        release: f(Object.assign({}, base, { face: Math.PI, throwT: 0.1 })).col,
        vtRed: f(Object.assign({}, base, { face: 0, team: 1, camSign: -1 })).row   // ビクトリースローのあかの番: +z へ投げる選手を、-z 側のカメラから見る
      };
    });
    ok(pf.away.row === 0 && pf.toward.row === 4, `遠ざかる向きは背中 (行 ${pf.away.row})、こちらを向くあかは正面 (行 ${pf.toward.row})`);
    ok(pf.right.row === 2 && !pf.right.flip && pf.left.row === 2 && pf.left.flip, '横向きは右がそのまま、左は反転');
    ok(pf.run.join() === '1,2,3,2' && pf.crouch === 4 && pf.windup === 6 && pf.release === 7, `走る ${pf.run} / しゃがむ ${pf.crouch} / 振りかぶり ${pf.windup} / 振り抜き ${pf.release}`);
    ok(pf.vtRed === 3, 'カメラが反対側から見ると、あかの背中になる');
    // 実際の試合で: 自分を前へ走らせると背中の走る絵、止まるとしゃがむ絵
    // だれも雪玉を持たない (走っている最中に当てられて、投げたばかりの仲間に交代すると、投げる絵になる)
    await phone.evaluate(() => {
      const m = window.__app.match(), me = window.__app.me();
      m.players.forEach((p) => { if (p !== me) p.balls = 0; });
      m.balls = []; m.stock = [0, 0];
      me.x = 0; me.z = 9;
    });
    await phone.waitForTimeout(500);   // 直前に投げた絵 (0.35 秒) が終わるのを待つ
    await phone.mouse.move(100, 780); await phone.mouse.down(); await phone.mouse.move(100, 720, { steps: 3 });
    await phone.waitForTimeout(400);
    const runF = await phone.evaluate(() => window.__app.frameOf(window.__app.me().id));
    await phone.mouse.up();
    await phone.waitForTimeout(700);
    const stopF = await phone.evaluate(() => window.__app.frameOf(window.__app.me().id));
    ok(runF && runF.visible && runF.row === 0 && [1, 2, 3].includes(runF.col), `前へ走ると背中の走る絵 (行 ${runF && runF.row} 列 ${runF && runF.col})`);
    ok(stopF && [4, 5].includes(stopF.col), `止まるとしゃがむ絵 (列 ${stopF && stopF.col})`);

    // 倒れるとき: 絵が細長く伸びない (画面での縦横の比が、立っているときと同じ)。消えるまでは薄くならない
    const fall = await phone.evaluate(async () => {
      const m = window.__app.match();
      const q = m.players.find((p) => p.team === 1 && p.alive);
      const stand = window.__app.spriteShape(q.id);
      q.alive = false;
      await new Promise((r) => setTimeout(r, 450));
      const mid = window.__app.spriteShape(q.id);
      // 倒れる動きは 1 コマの時間 (上限 0.05 秒) で進むので、遅い描画では実時間より遅れる。消えるまで待つ
      let end = window.__app.spriteShape(q.id);
      for (let i = 0; i < 80 && end.visible; i++) { await new Promise((r) => setTimeout(r, 100)); end = window.__app.spriteShape(q.id); }
      return { stand, mid, end };
    });
    const ratio = (o) => o.side / o.top;
    // 立っているときも、近くでも遠くでも絵の縦横の比は 1 (1 コマは正方形)
    const near = await phone.evaluate(() => window.__app.spriteShape(window.__app.me().id));
    ok(Math.abs(ratio(near) - 1) < 0.08 && Math.abs(ratio(fall.stand) - 1) < 0.08,
      `立っている絵が縦に伸びない (縦÷横 近く ${ratio(near).toFixed(2)} / 遠く ${ratio(fall.stand).toFixed(2)})`);
    ok(Math.abs(ratio(fall.mid) / ratio(fall.stand) - 1) < 0.1,
      `倒れても絵が伸びない (縦÷横 立ち ${ratio(fall.stand).toFixed(2)} → 倒れる途中 ${ratio(fall.mid).toFixed(2)})`);
    ok(fall.mid.opacity === 1 && fall.mid.visible, `倒れている途中は薄くならない (濃さ ${fall.mid.opacity})`);
    ok(fall.mid.depthTest === false, '倒れている板は、雪面に隠されない (半分もぐって上半分しか見えなかった)');
    ok(!fall.end.visible, '倒れたあと消える');
    ok(fall.stand.top > 60, `選手が大きく見える (板の横幅 ${fall.stand.top.toFixed(0)}px)`);

    // 地面と壁の絵が全部読めている (シェルター 3 色・シャトー 2 色・雪面 2・上面・旗 2)
    await phone.waitForFunction(() => window.__app.textures().loaded >= 10, null, { timeout: 10000 }).catch(() => {});
    const texs = await phone.evaluate(() => window.__app.textures());
    ok(texs.loaded === 10 && texs.failed === 0, `地面と壁の絵 ${texs.loaded} 枚読めた (失敗 ${texs.failed})`);

    // かんたん: 押すとすぐ投げ、玉が狙った相手へ曲がっていく。選んだ投げ方は開き直しても残る
    const ezCtx = await browser.newContext({ ...base, viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, hasTouch: true });
    const ez = await ezCtx.newPage();
    ez.on('pageerror', (e) => errors.push('かんたん: ' + e.message));
    await ez.goto(URL);
    await ez.bringToFront();      // 後ろの画面は requestAnimationFrame が止まり、時間が進まない
    await ez.waitForFunction(() => window.__app && window.__app.sprites().ready, null, { timeout: 10000 }).catch(() => {});
    await ez.click('#btnStart');
    await ez.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 10000 });
    const ezSet = await ez.evaluate(() => {
      const m = window.__app.match(), me = window.__app.me();
      me.x = 0; me.z = 6; me.balls = 3; me.cd = 0;
      m.players.forEach((p) => { if (p !== me) { p.balls = 0; p.ai.think = 999; p.ai.goal = null; } });
      m.stock = [0, 0];
      const reds = m.players.filter((p) => p.team === 1);
      reds.forEach((p, i) => { p.alive = i < 2; });
      reds[0].x = 0; reds[0].z = -2; reds[1].x = 4.5; reds[1].z = -16;
      return { mode: m.aimMode, foe: reds[0].id };
    });
    await ez.waitForTimeout(150);
    const ezPadClass = await ez.evaluate(() => document.getElementById('throwPad').classList.contains('ready'));
    const ezPad = await ez.evaluate(() => { const r = document.getElementById('throwPad').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await ez.mouse.click(ezPad.x, ezPad.y);
    await ez.waitForTimeout(40);
    const ezBall = await ez.evaluate(() => { const m = window.__app.match(); return m.balls.filter((b) => b.owner === m.human).map((b) => b.home); });
    ok(ezSet.mode === 'easy' && ezPadClass, 'かんたん: 押さえなくても、当たるコースなら投げるボタンが赤い');
    ok(ezBall.length === 1 && ezBall[0] === ezSet.foe, `かんたん: すぐ離しても投げ、玉が狙った相手を追う (${JSON.stringify(ezBall)})`);
    // (この機械は絵をソフトで描くので 7 コマ/秒ほどしか出ず、試合の時間が実時間の半分ほどで進む。待つ上限は長めに)
    // のぞき投げ: 自陣のシェルターのすぐ裏でタップすると、端から出て投げ、元の所へ戻る
    await ez.waitForFunction(() => window.__app.me().cd <= 0, null, { timeout: 12000 });
    const pkSet = await ez.evaluate(() => {
      const m = window.__app.match(), me = window.__app.me(), C = window.Core;
      m.balls = [];
      const w = C.SHELTERS.find((x) => x.x > 0 && x.z > 0 && x.z < 10);
      me.x = w.x + 0.3; me.z = w.z + w.d / 2 + C.R.PLAYER_R + 0.02; me.balls = 3; me.cd = 0;
      const foe = m.players.find((p) => p.team === 1 && p.alive);
      foe.x = w.x; foe.z = -5; foe.vx = foe.vz = 0;
      return { hx: me.x, hz: me.z, edge: w.x + w.w / 2 };
    });
    await ez.waitForTimeout(100);
    await ez.mouse.click(ezPad.x, ezPad.y);
    await ez.waitForFunction(() => { const m = window.__app.match(); return m.balls.some((b) => b.owner === m.human); }, null, { timeout: 12000 }).catch(() => {});
    const pkThrow = await ez.evaluate(() => { const me = window.__app.me(); window.__app.match().balls = []; return { x: me.x, peek: !!me.peek }; });
    await ez.waitForFunction(() => !window.__app.me().peek, null, { timeout: 15000 }).catch(() => {});
    const pkBack = await ez.evaluate(() => { const me = window.__app.me(); return { x: me.x, z: me.z, peek: !!me.peek }; });
    ok(pkThrow.peek && pkThrow.x > pkSet.edge, `壁の裏でタップすると、壁の端から出て投げる (投げた x ${pkThrow.x.toFixed(2)} / 壁の端 ${pkSet.edge.toFixed(2)})`);
    ok(!pkBack.peek && Math.hypot(pkBack.x - pkSet.hx, pkBack.z - pkSet.hz) < 0.25, '投げ終わると、元の所 (壁の裏) へ戻る');
    await ez.click('#btnPause'); await ez.click('#btnQuit');
    await ez.click('.diff button[data-mode="hard"]');
    await ez.reload();
    await ez.waitForFunction(() => window.__app, null, { timeout: 10000 });
    const kept = await ez.evaluate(() => document.querySelector('.diff button.on').dataset.mode);
    ok(kept === 'hard', `選んだ投げ方は開き直しても残る (${kept})`);
    await ezCtx.close();
    await phone.bringToFront();

    // 絵が読めないときは、今までの 3D の体のまま遊べる
    const noImg = await browser.newContext({ ...base, viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 });
    const np = await noImg.newPage();
    np.on('pageerror', (e) => errors.push('絵なし: ' + e.message));
    await np.route('**/players.webp', (r) => r.abort());
    await np.goto(URL);
    await np.waitForFunction(() => window.__app && window.__app.sprites().failed, null, { timeout: 10000 });
    await np.click('#btnStart');
    await np.waitForTimeout(300);
    const fb = await np.evaluate(() => ({ frame: window.__app.frameOf(1), started: !document.getElementById('vTitle').hidden === false }));
    ok(fb.frame === null && fb.started, '絵が読めなくても、3D の体で試合が始まる');
    await noImg.close();
    await phone.bringToFront();

    // ------------------------------------------------ 遅い端末
    section('遅い端末 (CPU 4 倍遅)');
    const cdp = await context.newCDPSession(phone);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const perf = await phone.evaluate(() => {
      // 描画 (GPU) をのぞいた、1 コマぶんのロジックの時間 (14 人の AI が全員動く)
      const C = window.Core;
      const m = C.createMatch({ seed: 3, human: null });
      m.phase = 'play';
      const t0 = performance.now();
      for (let i = 0; i < 600; i++) C.step(m, 1 / 60);
      return (performance.now() - t0) / 600;
    });
    // 狙いの補助は毎コマ計算する (相手選び + 先読み + 壁越しの着地点探し)。
    // いちばん重いのは、狙う相手が壁の陰にいて、着地点を何通りも試すとき
    const aimCost = await phone.evaluate(() => {
      const C = window.Core;
      const m = C.createMatch({ seed: 4, human: 1 });
      m.phase = 'play';
      const me = m.players[1];
      me.x = 0; me.z = 3;
      const q = m.players.find((p) => p.team === 1);
      q.x = 0.3; q.z = -0.55; q.crouch = true;      // 中央シェルターの陰
      const t0 = performance.now();
      let n = 0;
      for (let i = 0; i < 200; i++) if (C.assistAim(m, me, null, q)) n++;
      return { ms: (performance.now() - t0) / 200, n };
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    ok(aimCost.n === 200 && aimCost.ms < 3, `狙いの補助 1 コマ ${aimCost.ms.toFixed(2)}ms (壁の陰の相手)`);
    ok(perf < 4, `ロジック 1 コマ ${perf.toFixed(2)}ms (16.7ms の枠に十分収まる)`);
    const info = await phone.evaluate(() => window.__app.info());
    ok(info.calls < 260, `描画の呼び出し ${info.calls} 回 / 三角形 ${info.tris}`);

    // ------------------------------------------------ アイコン (用意していれば)
    section('アイコン');
    const desk = await browser.newPage();
    await desk.goto(URL);
    const apple = await desk.evaluate(() =>
      document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'));
    if (!apple) {
      skip('ホーム画面用のアイコンはまだ無い (PWA にするときに用意する)');
    } else {
      // iOS は SVG のアイコンを使えない
      ok(apple.endsWith('.png'), `ホーム画面用アイコンが PNG (${apple})`);
      const res = await desk.request.get(URL + apple.replace('./', ''));
      ok(res.ok(), `${apple} が配信される`);
    }

    // ------------------------------------------------ 更新とオフライン (sw.js があれば)
    section('更新とオフライン');
    if (!fs.existsSync(path.join(ROOT, 'sw.js'))) {
      skip('サービスワーカーはまだ無い (オフライン対応するときに用意する)');
    } else {
      const swCtx = await browser.newContext();
      const swPage = await swCtx.newPage();
      await swPage.goto(URL);
      await swPage.waitForFunction(() => window.__app);
      ok(await swPage.evaluate(() => navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false)),
        'サービスワーカーが動く');
      await swPage.waitForTimeout(800);

      // 直したものが 1 回のリロードで出るか (キャッシュ優先だと古い画面が出る)
      const indexPath = path.join(ROOT, 'index.html');
      const original = fs.readFileSync(indexPath, 'utf8');
      const marker = original.match(/<h1[^>]*>([^<]*)<\/h1>/);
      fs.writeFileSync(indexPath, original.replace(marker[1], 'こうしんかくにん'));
      await swPage.reload();
      await swPage.waitForTimeout(400);
      const title = await swPage.textContent('h1');
      fs.writeFileSync(indexPath, original);
      ok(title.trim() === 'こうしんかくにん', `直したものが 1 回のリロードで出る (${title.trim()})`);

      await swPage.reload();
      await swPage.waitForTimeout(500);
      await swCtx.setOffline(true);
      await swPage.reload().catch(() => {});
      await swPage.waitForTimeout(400);
      ok(await swPage.evaluate(() => !!window.__app).catch(() => false),
        'ネットにつながらなくても開ける');
      await swCtx.setOffline(false);
    }

    section('エラー');
    ok(errors.length === 0, errors.length ? '画面のエラー: ' + errors.join(' / ') : 'JS エラーなし');
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n${passed} 件合格 / ${failed} 件失敗`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
