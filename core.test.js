const test = require('node:test');
const assert = require('node:assert');
const C = require('./core.js');
const R = C.R;

/** 試合を作り、すぐ「プレー中」にする。選手は全員どかしておける。 */
function playing(opt) {
  const m = C.createMatch(Object.assign({ seed: 1, human: 0 }, opt || {}));
  m.phase = 'play';
  C.drainEvents(m);
  return m;
}
/** 指定の選手以外をコートの端へ寄せ、動かないようにする */
function isolate(m, keep) {
  for (const p of m.players) {
    if (keep.includes(p.id)) continue;
    p.alive = false;
  }
}
function run(m, sec, input) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) C.step(m, 1 / 60, typeof input === 'function' ? input(i) : input);
}

test('同じ seed からは同じ並びが出る', () => {
  const a = C.mulberry32(42), b = C.mulberry32(42);
  for (let i = 0; i < 10; i++) assert.strictEqual(a(), b());
});

test('コートはシェルター 7 基、7 対 7 (フォワード 4・バック 3)', () => {
  assert.strictEqual(C.SHELTERS.length, 7);
  const m = C.createMatch({ seed: 1 });
  assert.strictEqual(m.players.length, 14);
  for (const team of [0, 1]) {
    const mine = m.players.filter((p) => p.team === team);
    assert.strictEqual(mine.filter((p) => p.role === 'F').length, 4);
    assert.strictEqual(mine.filter((p) => p.role === 'B').length, 3);
  }
  assert.deepStrictEqual(m.stock, [R.BALLS_PER_SET - 21, R.BALLS_PER_SET - 21], '1 セット 90 球から、持って出た 3 個ずつを引く');
});

test('狙った地面に落ちる (ずらした場所・斜めでも)', () => {
  for (const [x, z, tx, tz] of [[3, 12, -2, 3], [-4, -1, 4, -15], [1, 10, 1.5, 7.2]]) {
    // シェルターに当たらない所を選んでいる
    const tr = C.trajectory(x, z, tx, tz, 0.005);
    assert.strictEqual(tr.hit, 'ground', `${x},${z}→${tx},${tz}`);
    assert.ok(Math.hypot(tr.end.x - tx, tr.end.z - tz) < 0.35, `着地のずれ ${Math.hypot(tr.end.x - tx, tr.end.z - tz).toFixed(2)}m`);
  }
});

test('届く距離より遠くを狙うと、届く距離いっぱいに落ちる', () => {
  const tr = C.trajectory(0, 17, 0, -17, 0.005);
  const d = Math.hypot(tr.end.x, tr.end.z - 17);
  assert.ok(Math.abs(d - R.RANGE) < 0.5, `落ちた距離 ${d.toFixed(2)}`);
});

test('シェルターの陰でしゃがめば当たらない。立っていると当たる (山なりの玉)', () => {
  for (const crouch of [true, false]) {
    const m = playing();
    const thrower = m.players.find((p) => p.team === 1 && p.role === 'F');
    const target = m.players.find((p) => p.team === 0 && p.role === 'F');
    isolate(m, [thrower.id, target.id]);
    m.human = target.id;
    // 中央シェルター (z=0) のすぐ自陣側 (z>0) にしゃがむ
    target.x = 0.3; target.z = 0.225 + 0.32;
    thrower.x = 0.5; thrower.z = -9;
    // 足もとを狙うと壁に当たるので、奥 (4m 先) へ落として頭越しに当てる
    thrower.balls = 1; m.stock[1] = 0;
    C.throwBall(m, thrower, target.x, target.z + 4);
    run(m, 1.2, { crouch });
    const ev = C.drainEvents(m);
    assert.strictEqual(target.alive, crouch, crouch ? 'しゃがんでいれば無事' : '立っていれば当たる');
    assert.strictEqual(ev.some((e) => e.type === 'hit'), !crouch);
  }
});

test('壁の陰にいる相手の足もとを狙うと、壁に当たって止まる', () => {
  const m = playing();
  const thrower = m.players.find((p) => p.team === 1 && p.role === 'F');
  const target = m.players.find((p) => p.team === 0 && p.role === 'F');
  isolate(m, [thrower.id, target.id]);
  m.human = target.id;
  target.x = 0.3; target.z = 0.55;
  thrower.x = 0.5; thrower.z = -9;
  thrower.balls = 1; m.stock[1] = 0;
  C.throwBall(m, thrower, target.x, target.z);
  run(m, 1.2, {});
  assert.ok(target.alive);
  assert.ok(C.drainEvents(m).some((e) => e.type === 'splat' && e.on === 'shelter'));
});

test('投げた直後は頭が出る (しゃがんでいても当たる)', () => {
  const m = playing();
  const thrower = m.players.find((p) => p.team === 1 && p.role === 'F');
  const target = m.players.find((p) => p.team === 0 && p.role === 'F');
  isolate(m, [thrower.id, target.id]);
  m.human = target.id;
  target.x = 0.3; target.z = 0.55;
  thrower.x = 0.5; thrower.z = -9;
  target.crouch = true;
  thrower.balls = 1; m.stock[1] = 0;
  C.throwBall(m, thrower, target.x, target.z + 4);
  // 球が着く少し前に、こちらも投げ返す (投げると STAND_AFTER_THROW 秒は立つ)
  run(m, 1.2, (i) => ({ crouch: true, throwAt: i === 30 ? { x: 0, z: -9 } : null }));
  assert.strictEqual(target.alive, false);
});

test('当たったら退場。味方の玉では退場しない', () => {
  const m = playing();
  const a = m.players.find((p) => p.team === 0 && p.role === 'F');
  const mate = m.players.find((p) => p.team === 0 && p.role === 'B');
  const foe = m.players.find((p) => p.team === 1 && p.role === 'F');
  isolate(m, [a.id, mate.id, foe.id]);
  m.human = a.id;
  a.x = -4; a.z = 6;
  mate.x = -4; mate.z = 3;
  foe.x = -4; foe.z = -1;
  foe.balls = 0; m.stock[1] = 0;
  // 味方の頭上を越えて、相手の足もとへ
  C.throwBall(m, a, foe.x, foe.z);
  run(m, 1.0, {});
  assert.ok(mate.alive, '味方は無事');
  assert.ok(!foe.alive, '相手は退場');
  const hit = C.drainEvents(m).find((e) => e.type === 'hit');
  assert.ok(hit && hit.by === a.id && hit.player === foe.id);
});

test('バックはセンターラインを越えられない。フォワードは越えられる', () => {
  const m = playing();
  const back = m.players.find((p) => p.team === 0 && p.role === 'B');
  const fwd = m.players.find((p) => p.team === 0 && p.role === 'F');
  back.x = 4; back.z = 2; fwd.x = -4; fwd.z = 2;
  for (let i = 0; i < 120; i++) {
    C.movePlayer(back, { mz: -1 }, 1 / 60);
    C.movePlayer(fwd, { mz: -1 }, 1 / 60);
  }
  assert.ok(back.z >= 0.3 - 1e-9, `バック z=${back.z}`);
  assert.ok(fwd.z < -3, `フォワード z=${fwd.z}`);
  const red = m.players.find((p) => p.team === 1 && p.role === 'B');
  red.x = 4; red.z = -2;
  for (let i = 0; i < 120; i++) C.movePlayer(red, { mz: 1 }, 1 / 60);
  assert.ok(red.z <= -0.3 + 1e-9, `あかのバック z=${red.z}`);
});

test('シェルターはすり抜けられない (どの向きからぶつかっても)', () => {
  const m = playing();
  const p = m.players[0];
  for (const s of C.SHELTERS) {
    for (let a = 0; a < 16; a++) {
      const ang = a / 16 * Math.PI * 2;
      p.x = s.x + Math.sin(ang) * 3; p.z = s.z + Math.cos(ang) * 3;
      for (let i = 0; i < 90; i++) C.movePlayer(p, { mx: -Math.sin(ang), mz: -Math.cos(ang) }, 1 / 60);
      const inside = Math.abs(p.x - s.x) < s.w / 2 + R.PLAYER_R - 0.01 && Math.abs(p.z - s.z) < s.d / 2 + R.PLAYER_R - 0.01;
      assert.ok(!inside, `${s.kind} (${s.x},${s.z}) 角度${a}: (${p.x.toFixed(2)},${p.z.toFixed(2)})`);
    }
  }
});

test('フォワードが相手のフラッグに触れたらセットの勝ち', () => {
  const m = playing();
  const f = m.players.find((p) => p.team === 0 && p.role === 'F');
  m.human = f.id;
  const flag = C.flagPos(1);
  f.x = flag.x + 0.4; f.z = flag.z + 2;
  run(m, 1, { mx: 0, mz: -1 });
  assert.strictEqual(m.phase, 'setOver');
  assert.deepStrictEqual(m.setResults[0].winner, 0);
  assert.strictEqual(m.setResults[0].reason, 'flag');
});

test('全員退場させたら勝ち。時間切れは残り人数で決まり、同じなら引き分け', () => {
  let m = playing();
  m.players.filter((p) => p.team === 1).forEach((p) => { p.alive = false; });
  C.step(m, 1 / 60, {});
  assert.deepStrictEqual(m.setResults[0], { winner: 0, reason: 'allout', alive: [7, 0] });

  m = playing({ human: null });
  m.players[8].alive = false;      // あかを 1 人減らす
  m.time = 0.001;
  for (const p of m.players) { p.balls = 0; }
  m.stock = [0, 0];
  C.step(m, 1 / 60);
  assert.strictEqual(m.setResults[0].winner, 0);
  assert.strictEqual(m.setResults[0].reason, 'time');

  m = playing({ human: null });
  m.time = 0.001;
  for (const p of m.players) { p.balls = 0; }
  C.step(m, 1 / 60);
  assert.strictEqual(m.setResults[0].winner, -1);
});

test('2 セット先取で試合終了。次のセットは全員そろって始まる', () => {
  const m = playing();
  m.players.filter((p) => p.team === 1).forEach((p) => { p.alive = false; });
  m.players[0].alive = false;
  C.step(m, 1 / 60, {});
  assert.strictEqual(m.phase, 'setOver');
  run(m, R.SET_OVER + 0.1, {});
  assert.strictEqual(m.setNo, 2);
  assert.strictEqual(m.phase, 'countdown');
  assert.strictEqual(C.aliveCount(m, 0) + C.aliveCount(m, 1), 14);
  assert.strictEqual(m.human, 0, '操作する選手も元に戻る');
  run(m, R.COUNTDOWN + 0.1, {});
  m.players.filter((p) => p.team === 1).forEach((p) => { p.alive = false; });
  C.step(m, 1 / 60, {});
  run(m, R.SET_OVER + 0.1, {});
  assert.strictEqual(m.phase, 'matchOver');
  assert.strictEqual(m.winner, 0);
  assert.deepStrictEqual(m.setWins, [2, 0]);
});

test('しゃがむと雪玉を丸める。チームの残りから引かれ、5 個まで', () => {
  const m = playing();
  const p = m.players[0];
  isolate(m, [p.id, 8]);
  m.players[8].x = 4; m.players[8].z = -17; m.players[8].alive = true;
  m.players[8].balls = 0;
  p.balls = 3;
  const before = m.stock[0];
  run(m, R.MAKE_TIME * 1.5, { crouch: true });
  assert.strictEqual(p.balls, 4);
  assert.strictEqual(m.stock[0], before - 1);
  run(m, R.MAKE_TIME * 5, { crouch: true });
  assert.strictEqual(p.balls, R.MAX_CARRY);
  assert.strictEqual(m.stock[0], before - 2);
  // 残りが 0 なら丸められない
  p.balls = 0; m.stock[0] = 0;
  run(m, R.MAKE_TIME * 2, { crouch: true });
  assert.strictEqual(p.balls, 0);
});

test('しゃがんでいる間は動けない', () => {
  const m = playing();
  const p = m.players[0];
  const x = p.x, z = p.z;
  run(m, 0.5, { mx: 1, mz: -1, crouch: true });
  assert.strictEqual(p.x, x); assert.strictEqual(p.z, z);
});

test('操作している選手が退場したら、残っている仲間に交代 (フォワード優先)', () => {
  const m = playing();
  const me = m.players[0];
  me.alive = false;
  C.step(m, 1 / 60, {});
  const now = m.players[m.human];
  assert.ok(now.alive && now.team === 0 && now.role === 'F' && now.id !== 0);
  assert.ok(C.drainEvents(m).some((e) => e.type === 'handOver'));
});

test('コマの間隔が負や NaN でも壊れない', () => {
  const m = playing();
  const snap = JSON.stringify(m.players.map((p) => [p.x, p.z]));
  C.step(m, -4.04, {});
  C.step(m, NaN, {});
  C.step(m, 0, {});
  assert.strictEqual(JSON.stringify(m.players.map((p) => [p.x, p.z])), snap);
});

/** AI どうしで最後まで遊ばせる */
function autoplay(seed, skill) {
  const m = C.createMatch({ seed, human: null, skill });
  const reasons = {};
  let steps = 0, bad = 0;
  while (m.phase !== 'matchOver' && steps < 60 * 60 * 15) {
    C.step(m, 1 / 60);
    steps++;
    for (const p of m.players) {
      if (!p.alive) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) bad++;
      for (const s of C.SHELTERS) {
        // 円と箱の距離 (角は丸く測る)
        const cx = Math.max(s.x - s.w / 2, Math.min(p.x, s.x + s.w / 2));
        const cz = Math.max(s.z - s.d / 2, Math.min(p.z, s.z + s.d / 2));
        if (Math.hypot(p.x - cx, p.z - cz) < R.PLAYER_R - 0.05) bad++;
      }
      if (p.role === 'B' && C.side(p.team) * p.z < 0.3 - 1e-6) bad++;
    }
    for (const e of C.drainEvents(m)) if (e.type === 'setEnd') reasons[e.reason] = (reasons[e.reason] || 0) + 1;
  }
  return { m, reasons, bad };
}

test('AI どうしで 30 試合: 必ず終わり、選手が壁にめりこまず、バックは自陣にいる', () => {
  let w = [0, 0, 0];
  const all = {};
  for (let seed = 1; seed <= 30; seed++) {
    const { m, reasons, bad } = autoplay(seed, [0.55, 0.55]);
    assert.strictEqual(m.phase, 'matchOver', `seed ${seed} が終わらない`);
    assert.strictEqual(bad, 0, `seed ${seed}: おかしな位置 ${bad} 回`);
    w[m.winner < 0 ? 2 : m.winner]++;
    for (const k in reasons) all[k] = (all[k] || 0) + reasons[k];
  }
  // 同じ強さなら、どちらの陣地でも勝てる (向きの違いで偏らない)
  assert.ok(w[0] >= 8 && w[1] >= 8, `勝ち数 あお${w[0]} あか${w[1]} 分${w[2]}`);
  assert.ok(all.allout > 0 && all.time > 0, JSON.stringify(all));
});

test('強い AI は弱い AI によく勝つ', () => {
  let strong = 0, weak = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const { m } = autoplay(seed, [0.85, 0.25]);
    if (m.winner === 0) strong++; else if (m.winner === 1) weak++;
  }
  assert.ok(strong > weak * 2, `強い${strong} 弱い${weak}`);
});
