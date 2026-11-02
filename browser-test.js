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
    ok(fit.hudHidden, 'タイトルの間は試合の表示と操作が隠れている');

    // ------------------------------------------------ 試合を始める
    section('試合');
    await phone.click('#btnStart');
    const started = await phone.evaluate(() => ({
      title: document.getElementById('vTitle').hidden,
      human: window.__app.match().human,
      hud: getComputedStyle(document.querySelector('.hud')).visibility
    }));
    ok(started.title && started.human != null && started.hud === 'visible', '試合開始でタイトルが消え、自分の選手が決まる');
    await phone.waitForFunction(() => window.__app.match().phase === 'play', null, { timeout: 15000 });
    ok(true, 'カウントダウンのあとプレーが始まる');

    // 実機の安全域 (上 59・下 34) を足しても、操作と表示が画面に収まる
    const rects = await phone.evaluate(() => ['.score', '#btnPause', '#btnCrouch', '#throwPad', '#stick'].map((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { sel, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }));
    for (const r of rects) {
      // 上の物は env(safe-area-inset-top)、下の物は env(safe-area-inset-bottom) の内側に置いてある。
      // ここ (安全域 0) で画面内なら、実機では安全域ぶん内側へずれるだけ
      ok(r.left >= 0 && r.right <= 430 && r.top >= 0 && r.bottom <= 932 && (r.top < 466 ? r.bottom + 59 <= 466 : r.top - 34 >= 466),
        `${r.sel} が安全域ぶんずれても画面内 (${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)})`);
    }

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

    // ---- 狙って投げる
    const pad = await center('#throwPad');
    const before = await phone.evaluate(() => ({ balls: window.__app.me().balls, id: window.__app.me().id, z: window.__app.me().z, x: window.__app.me().x }));
    await phone.mouse.move(pad.x, pad.y);
    await phone.mouse.down();
    await phone.mouse.move(pad.x - 30, pad.y - 90, { steps: 5 });
    await phone.waitForTimeout(80);
    const aiming = await phone.evaluate(() => {
      const a = window.__app.app.aim;
      return { on: !!a, tx: a && a.tx, tz: a && a.tz };
    });
    ok(aiming.on && aiming.tz < before.z - 5 && aiming.tx < before.x,
      `上へスライドすると前方に狙いが出る (自分 ${before.x.toFixed(1)},${before.z.toFixed(1)} → 狙い ${aiming.tx && aiming.tx.toFixed(1)},${aiming.tz && aiming.tz.toFixed(1)})`);
    await phone.mouse.up();
    await phone.waitForTimeout(100);
    const thrown = await phone.evaluate((id) => ({
      balls: window.__app.match().players[id].balls,
      mine: window.__app.match().balls.filter((b) => b.owner === id).map((b) => ({ vx: b.vx, vz: b.vz }))
    }), before.id);
    ok(thrown.balls === before.balls - 1, `離すと投げる (雪玉 ${before.balls} → ${thrown.balls})`);
    ok(thrown.mine.length === 1 && thrown.mine[0].vz < 0 && thrown.mine[0].vx < 0, '狙った向き (左前) へ飛んでいく');

    // タップは近くの相手へ
    await phone.waitForTimeout(600);
    const b2 = await phone.evaluate(() => ({ b: window.__app.me().balls, cd: window.__app.me().cd, id: window.__app.me().id }));
    await phone.mouse.click(pad.x, pad.y);
    await phone.waitForTimeout(100);
    const b3 = await phone.evaluate(() => ({ b: window.__app.me().balls, id: window.__app.me().id, alive: window.__app.me().alive }));
    ok(b3.b === b2.b - 1, `タップでも投げられる (${JSON.stringify(b2)} → ${JSON.stringify(b3)})`);

    // ---- しゃがむ・丸める
    const cr = await center('#btnCrouch');
    await phone.mouse.move(cr.x, cr.y);
    await phone.mouse.down();
    await phone.waitForTimeout(150);
    const crouching = await phone.evaluate(() => ({ c: window.__app.me().crouch, b: window.__app.me().balls }));
    await phone.waitForFunction((b) => window.__app.me().balls > b, crouching.b, { timeout: 8000 }).catch(() => {});
    const made = await phone.evaluate(() => window.__app.me().balls);
    await phone.mouse.up();
    await phone.waitForTimeout(80);
    const stood = await phone.evaluate(() => window.__app.me().crouch);
    ok(crouching.c, '押している間しゃがむ');
    ok(made > crouching.b, `しゃがんでいると雪玉が増える (${crouching.b} → ${made})`);
    ok(stood === false, '離すと立つ');

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
    await phone.click('#btnPause');
    const t1 = await phone.evaluate(() => window.__app.match().time);
    await phone.waitForTimeout(500);
    const t2 = await phone.evaluate(() => window.__app.match().time);
    ok(t1 === t2, '一時停止中は時間が止まる');
    await phone.click('#btnResume');
    await phone.waitForTimeout(500);
    const t3 = await phone.evaluate(() => window.__app.match().time);
    ok(t3 < t2, 'つづけると再開する');

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
    const ban = await phone.evaluate(() => {
      const b = document.getElementById('banner');
      const r = b.getBoundingClientRect();
      return { hidden: b.hidden, text: b.textContent, w: r.width, h: r.height };
    });
    ok(!ban.hidden && ban.text.includes('全員退場'), `セットの結果が出る (${ban.text})`);
    ok(ban.w > ban.h * 1.5, `帯が縦に潰れない (${Math.round(ban.w)}x${Math.round(ban.h)})`);
    await phone.waitForFunction(() => !document.getElementById('vResult').hidden, null, { timeout: 10000 });
    const res = await phone.evaluate(() => ({ t: document.getElementById('resultTitle').textContent, n: document.querySelectorAll('#resultSets li').length }));
    ok(res.t.includes('勝利'), `2 セット取ると試合終了の画面 (${res.t}, ${res.n} セット)`);
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
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
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
