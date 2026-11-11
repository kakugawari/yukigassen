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
/** 中央シェルター (z=0) のすぐ自陣側に立つ位置 (壁に押し返されない、いちばん近い所) */
const BEHIND = C.SHELTERS[0].d / 2 + R.PLAYER_R + 0.02;

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
    target.x = 0.3; target.z = BEHIND;
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
  target.x = 0.3; target.z = BEHIND;
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
  target.x = 0.3; target.z = BEHIND;
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
  mate.balls = 0; m.stock[0] = 0;   // 味方の AI が先に当ててしまわないように
  // 味方の頭上を越えて、相手の足もとへ (構えきってから)
  a.aimF = 1;
  const ball = C.throwBall(m, a, foe.x, foe.z);
  foe.ai.seen[ball.id] = true;      // 相手の AI がよけず、
  foe.ai.think = 99;                // 動きもしないように
  run(m, 1.0, {});
  assert.ok(mate.alive, '味方は無事');
  assert.ok(!foe.alive, '相手は退場');
  const hit = C.drainEvents(m).find((e) => e.type === 'hit');
  assert.ok(hit && hit.by === a.id && hit.player === foe.id);
});

test('フォワードは自陣のバックラインより後ろへ下がれない。バックスは相手コートにも入れる', () => {
  const m = playing();
  const fwd = m.players.find((p) => p.team === 0 && p.role === 'F');
  const back = m.players.find((p) => p.team === 0 && p.role === 'B');
  fwd.x = -4; fwd.z = 9;
  for (let i = 0; i < 120; i++) C.movePlayer(fwd, { mz: 1 }, 1 / 60);
  assert.ok(Math.abs(fwd.z - R.BACK_LINE_U) < 1e-9, `あおのフォワード z=${fwd.z}`);
  const red = m.players.find((p) => p.team === 1 && p.role === 'F');
  red.x = 4; red.z = -9;
  for (let i = 0; i < 120; i++) C.movePlayer(red, { mz: -1 }, 1 / 60);
  assert.ok(Math.abs(red.z + R.BACK_LINE_U) < 1e-9, `あかのフォワード z=${red.z}`);
  back.x = 4; back.z = 2;
  for (let i = 0; i < 60; i++) C.movePlayer(back, { mz: -1 }, 1 / 60);
  assert.ok(back.z < -1, `バックス z=${back.z}`);
});

test('相手コートに 4 人目が入ると、そのセットは負け (3 人までは続く)', () => {
  const m = playing({ human: null });
  m.players.forEach((p) => { p.balls = 0; });
  m.stock = [0, 0];
  const blues = m.players.filter((p) => p.team === 0);
  blues.slice(0, 3).forEach((p, i) => { p.x = -4 + i * 2; p.z = -3; });
  C.step(m, 1 / 60);
  assert.strictEqual(m.phase, 'play', '3 人までは続く');
  blues[3].x = 4; blues[3].z = -3;
  C.step(m, 1 / 60);
  assert.strictEqual(m.phase, 'setOver');
  assert.strictEqual(m.setResults[0].winner, 1);
  assert.strictEqual(m.setResults[0].reason, 'over');
});

test('AI は、人が操作する仲間が先に入っていても 4 人目にならない', () => {
  // 人 + AI のフォワード 2 人が相手コートにいる。相手は 1 人だけ (フラッグから離れている) なので、
  // 守りがいないフラッグへ、残りのフォワードも走りたくなる場面。だれも球を持たない
  for (let seed = 1; seed <= 6; seed++) {
    const m = C.createMatch({ seed, human: 1, skill: [0.9, 0.1] });
    m.phase = 'play';
    m.players.forEach((p) => { p.balls = 0; });
    m.stock = [0, 0];
    const fwds = m.players.filter((p) => p.team === 0 && p.role === 'F');
    const me = m.players[1];
    me.x = 4.5; me.z = -3;
    const others = fwds.filter((p) => p !== me);
    others[0].x = -4; others[0].z = -2;
    others[1].x = -2.5; others[1].z = -2;
    others[2].x = 0.5; others[2].z = 2;           // これが 4 人目になりうる
    m.players.filter((p) => p.team === 1).forEach((p, i) => { p.alive = i === 6; p.x = 4.5; p.z = -8.8; });
    let most = 0;
    for (let i = 0; i < 60 * 8 && m.phase === 'play'; i++) {
      C.step(m, 1 / 60, { crouch: true });
      most = Math.max(most, m.players.filter((p) => p.team === 0 && C.inEnemyCourt(p)).length);
    }
    assert.ok(most <= R.MAX_IN_ENEMY, `seed ${seed}: 相手コートに ${most} 人`);
    assert.ok(!m.setResults.some((r) => r.reason === 'over'), `seed ${seed}: 反則負けになった`);
  }
});

test('どこからでも、壁を回り込んで目的地に着く (400 通り)', () => {
  // 横へずらすだけの回り込みだと、縦に並んだ 2 つの壁 (シャトーとシェルター) のあいだで
  // 行ったり来たりして止まり、フラッグを取りに行けなかった
  const rng = C.mulberry32(5);
  let ng = 0;
  for (let k = 0; k < 400; k++) {
    const p = { x: (rng() * 2 - 1) * 4.6, z: (rng() * 2 - 1) * 17.6, team: 0, role: 'B', alive: true, crouch: false, standT: 0, vx: 0, vz: 0, face: 0 };
    C.pushOutOfShelters(p);
    const g = { x: (rng() * 2 - 1) * 4.5, z: (rng() * 2 - 1) * 17.5 };
    C.pushOutOfShelters(g);
    let i = 0;
    for (; i < 60 * 15; i++) { const st = C.steer(p, g.x, g.z); if (st.d < 0.2) break; C.movePlayer(p, st, 1 / 60); }
    if (i >= 60 * 15) ng++;
  }
  assert.strictEqual(ng, 0, `着かなかった ${ng} / 400`);
  // 前に止まっていた場所: 相手のシェルターの後ろからフラッグへ
  const p = { x: -1.7, z: -6.3, team: 0, role: 'F', alive: true, crouch: false, standT: 0, vx: 0, vz: 0, face: 0 };
  const f = C.flagPos(1);
  let t = 0;
  for (; t < 60 * 6; t++) { const st = C.steer(p, f.x, f.z); if (st.d < R.FLAG_R) break; C.movePlayer(p, st, 1 / 60); }
  assert.ok(t < 60 * 6, `フラッグまで ${(t / 60).toFixed(1)} 秒`);
});

test('ビクトリースローの照準: 当たる着地点は当たり、横へずらすと外れる', () => {
  const f = C.flagPos(1);
  const x = 0, z = f.z + R.VT_DIST;
  const aim = C.findAim([], 0, x, z, { team: 1, crouch: false, standT: 0 }, f.x, f.z);
  assert.ok(C.predictVT(0, x, z, aim.x, aim.z));
  assert.ok(!C.predictVT(0, x, z, aim.x + 1.5, aim.z));
});

test('狙いの補助: はじいた向きの相手を選ぶ。40° 以内にいなければ選ばない', () => {
  const m = playing({ human: 1 });
  const me = m.players[1];
  me.x = 0; me.z = 6;
  const reds = m.players.filter((p) => p.team === 1);
  reds.forEach((p) => { p.alive = false; });
  const L = reds[0], Rt = reds[1];
  L.alive = Rt.alive = true;
  L.x = -3.5; L.z = -3; Rt.x = 3.5; Rt.z = -3;
  assert.strictEqual(C.pickTarget(m, me, { x: 0.4, z: -0.7 }).id, Rt.id);
  assert.strictEqual(C.pickTarget(m, me, { x: -0.4, z: -0.7 }).id, L.id);
  assert.strictEqual(C.pickTarget(m, me, { x: 0, z: 1 }), null, '真後ろにはいない');
  assert.ok(C.pickTarget(m, me, null), 'はじかなければ前方のだれか');
});

test('狙いの補助: 走っている相手に当たる。壁のすぐ裏に立つ相手は狙わず、のぞいて出たら当たる', () => {
  // 走っている相手 (横へ 4.3m/s): 先読みして当たる
  let hits = 0;
  for (let k = 0; k < 10; k++) {
    const m = playing({ human: 1 });
    const me = m.players[1];
    isolate(m, [1, 7]);
    const q = m.players[7];
    me.x = 0; me.z = 8; me.balls = 1;
    q.x = -3 + k * 0.4; q.z = -4 + (k % 3);
    q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true });   // よけない
    const dir = k % 2 ? 1 : -1;
    q.vx = dir * R.SPEED; q.vz = 0;
    const aim = C.assistAim(m, me, null, q);
    me.aimF = 1;
    C.throwBall(m, me, aim.x, aim.z);
    for (let i = 0; i < 120 && q.alive; i++) {
      q.x += dir * R.SPEED / 60; q.vx = dir * R.SPEED;   // まっすぐ走り続ける
      C.step(m, 1 / 60, { crouch: true });
    }
    if (!q.alive) hits++;
  }
  assert.ok(hits >= 9, `走る相手に ${hits}/10`);
  // 中央シェルターのすぐ裏に立っている相手: 頭越しには狙わない (当たるコースにならない)
  const m = playing({ human: 1 });
  isolate(m, [1, 7]);
  const me = m.players[1], q = m.players[7];
  me.x = 0.5; me.z = 9; me.balls = 1;
  q.x = 0.3; q.z = -BEHIND; q.vx = q.vz = 0; q.standT = 9; q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true });   // 中央シェルターのすぐ裏に立ったまま
  assert.ok(!C.assistAim(m, me, null, q).clear, '壁のすぐ裏の相手は、当たるコースにならない');
  // 相手が壁の端から出る (のぞく) と、当たるコースになって当たる
  const cs = C.SHELTERS.find((s) => s.x === 0 && s.z === 0);
  q.x = -(cs.w / 2 + R.PLAYER_R + R.PEEK_OUT);
  const aim = C.assistAim(m, me, null, q);
  assert.ok(aim.clear, 'のぞいて出た相手は、当たるコースになる');
  me.aimF = 1;
  C.throwBall(m, me, aim.x, aim.z);
  run(m, 1.2, { crouch: true });
  assert.ok(!q.alive, 'のぞいて出た相手に当たる');
});

test('構え: 押さえて定まってから離すと当たり、すぐ離す (連打) と外れる', () => {
  // 立って止まっている相手へ 12m。押さえる長さだけを変えて 40 球ずつ
  function shoot(holdFrames, seed) {
    const m = playing({ human: 1, seed });
    isolate(m, [1, 7]);
    const me = m.players[1], q = m.players[7];
    me.x = 1; me.z = 6; me.balls = 1; me.cd = 0;
    q.x = 1; q.z = -6; q.vx = q.vz = 0; q.standT = 99;
    q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true });
    for (let i = 0; i < holdFrames; i++) C.step(m, 1 / 60, { aiming: true });
    const aim = C.assistAim(m, me, null, q);
    C.step(m, 1 / 60, { throwAt: { x: aim.x, z: aim.z } });
    for (let i = 0; i < 90 && q.alive; i++) C.step(m, 1 / 60, { crouch: true });
    return !q.alive;
  }
  let tap = 0, held = 0;
  for (let k = 0; k < 40; k++) { if (shoot(1, 100 + k)) tap++; if (shoot(Math.ceil(R.AIM_STEADY * 60) + 2, 100 + k)) held++; }
  assert.ok(held >= 38, `構えきって離す: ${held}/40`);
  assert.ok(tap <= 10, `すぐ離す: ${tap}/40`);
});

test('構え: 押さえている間だけ定まり、立つ。離すと 0 に戻る', () => {
  const m = playing({ human: 1 });
  isolate(m, [1, 7]);
  const me = m.players[1];
  me.x = 1; me.z = 6; me.balls = 2;
  run(m, 0.5, { crouch: true });
  assert.equal(me.aimF, 0, '押さえていなければ 0');
  assert.ok(me.crouch, 'しゃがんでいる');
  run(m, R.AIM_STEADY / 2, { crouch: true, aiming: true });
  assert.ok(me.aimF > 0.4 && me.aimF < 0.6, `半分 (${me.aimF.toFixed(2)})`);
  assert.ok(!me.crouch && C.playerHeight(me) === R.STAND_H, '構えている間は立つ');
  run(m, R.AIM_STEADY, { crouch: true, aiming: true, mx: 1 });
  assert.ok(me.aimF < 1, '走りながらは定まるのが遅い');
  run(m, 0.1, { crouch: true });
  assert.equal(me.aimF, 0, '離すと 0 に戻る');
  // 投げたあとは構え直し: THROW_CD 秒は投げられず、押さえていても構えが始まらない
  me.aimF = 1; me.cd = 0;
  run(m, 1 / 60, { throwAt: { x: me.x, z: me.z - 10 } });
  assert.equal(me.balls, 1, '1 個投げた');
  run(m, R.THROW_CD - 0.1, { aiming: true });
  assert.equal(me.aimF, 0, '構え直している間は構えが 0 のまま');
  run(m, 1 / 60, { throwAt: { x: me.x, z: me.z - 10 } });
  assert.equal(me.balls, 1, '構え直している間は投げられない');
  run(m, 0.2, { aiming: true });
  assert.ok(me.aimF > 0, '構え直しが終われば構えが始まる');
  // 構えきって投げると、狙ったところにそのまま落ちる
  me.aimF = 1;
  assert.equal(C.aimSpread(me, me.x, me.z - 12), 0);
  me.aimF = 0;
  assert.ok(C.aimSpread(me, me.x, me.z - 12) > 1.2, 'すぐ離すと 1m 以上ぶれる');
});

test('かんたん: 押してすぐ投げても当たり、玉が向きを変えた相手を追う', () => {
  // 相手は 13m 先を横へ走り、投げた直後に折り返す (先読みした所にはもういない)
  function shoot(mode, k) {
    const m = playing({ human: 1, aimMode: mode, seed: 300 + k });
    isolate(m, [1, 7]);
    const me = m.players[1], q = m.players[7];
    me.x = 0; me.z = 7; me.balls = 1; me.cd = 0;
    q.x = -2 + (k % 5) * 0.8; q.z = -6; q.standT = 99;
    q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true });
    let dir = k % 2 ? 1 : -1;
    q.vx = dir * R.SPEED; q.vz = 0;
    const aim = C.assistAim(m, me, null, q);
    C.step(m, 1 / 60, { throwAt: { x: aim.x, z: aim.z, target: q.id } });   // 押してすぐ離す (構えなし)
    const ball = m.balls[0];
    for (let i = 0; i < 120 && q.alive; i++) {
      if (i === 12) dir = -dir;                                           // 0.2 秒で折り返す
      q.x = Math.max(-4.6, Math.min(4.6, q.x + dir * R.SPEED / 60)); q.vx = dir * R.SPEED;
      C.step(m, 1 / 60, { crouch: true });
    }
    return { hit: !q.alive, home: ball && ball.home };
  }
  let easy = 0, hard = 0, homeId = null;
  for (let k = 0; k < 20; k++) {
    const e = shoot('easy', k); if (e.hit) easy++; if (k === 0) homeId = e.home;
    if (shoot('hard', k).hit) hard++;
  }
  assert.equal(homeId, 7, '玉は狙った相手を覚えている');
  assert.ok(easy >= 14, `かんたん: 折り返した相手に ${easy}/20`);
  assert.ok(hard <= 4, `むずかしい (すぐ離す): ${hard}/20`);
  // AI の玉は曲がらない
  const m = playing({ human: 1, aimMode: 'easy' });
  const ai = m.players[8];
  ai.balls = 1; ai.cd = 0;
  const b = C.throwBall(m, ai, 0, 5, 1);
  assert.equal(b.home, null, 'AI の玉は追わない');
});

test('のぞき投げ: 壁の裏で投げると、近い方の端から出て投げ、終わると元の所へ戻る', () => {
  for (const mode of ['easy', 'hard']) {
    const m = playing({ human: 1, aimMode: mode });
    isolate(m, [1, 7]);
    const me = m.players[1], q = m.players[7];
    // 自陣右のシェルターのすぐ裏 (中心より少し右)。相手はその先の正面
    const s = C.SHELTERS.find((w) => w.x > 0 && w.z > 0 && w.z < 10);
    me.x = s.x + 0.3; me.z = s.z + s.d / 2 + R.PLAYER_R + 0.02; me.balls = 2; me.cd = 0;
    q.x = s.x; q.z = -5; q.vx = q.vz = 0; q.standT = 99; q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true });
    const home = { x: me.x, z: me.z };
    assert.ok(C.coverWall(me, q.x, q.z) === s, '壁が投げる向きをふさいでいる');
    const aim = C.assistAim(m, me, null, q);
    // easy はタップ、hard は押さえて構えてから離す
    if (mode === 'hard') run(m, R.AIM_STEADY + 0.5, { aiming: true });
    let from = null;
    const tap = { throwAt: { x: aim.x, z: aim.z, target: q.id } };
    for (let i = 0; i < 120 && !from; i++) {
      C.step(m, 1 / 60, i === 0 ? tap : (mode === 'hard' ? {} : { crouch: true }));
      const e = C.drainEvents(m).find((ev) => ev.type === 'throw' && ev.player === me.id);
      if (e) from = { x: me.x, z: me.z, t: i / 60 };
    }
    assert.ok(from, `${mode}: 投げた`);
    assert.ok(from.x > s.x + s.w / 2 + R.PLAYER_R - 0.05, `${mode}: 近い方 (右) の端から出て投げた (x ${from.x.toFixed(2)} / 端 ${(s.x + s.w / 2).toFixed(2)})`);
    assert.ok(from.t < 0.6, `${mode}: 出るまで 0.6 秒以内 (${from.t.toFixed(2)})`);
    run(m, 1.6, { crouch: true });
    assert.ok(Math.hypot(me.x - home.x, me.z - home.z) < 0.2, `${mode}: 元の所へ戻った`);
    assert.equal(me.peek, null);
  }
});

test('のぞき投げ: 出ている途中で移動を入れると、やめてその場で動ける', () => {
  const m = playing({ human: 1, aimMode: 'easy' });
  isolate(m, [1, 7]);
  const me = m.players[1], q = m.players[7];
  const s = C.SHELTERS.find((w) => w.x > 0 && w.z > 0 && w.z < 10);
  me.x = s.x + 0.3; me.z = s.z + s.d / 2 + R.PLAYER_R + 0.02; me.balls = 2; me.cd = 0;
  q.x = s.x; q.z = -5; q.ai.think = 999;
  C.step(m, 1 / 60, { throwAt: { x: q.x, z: q.z, target: q.id } });
  assert.ok(me.peek, 'のぞき始めた');
  C.step(m, 1 / 60, { mx: 0, mz: 1 });
  assert.equal(me.peek, null, '移動を入れたら、のぞくのをやめる');
  assert.equal(me.balls, 2, '投げていない');
});

test('のぞき投げ: AI どうしで 6 試合、壁にふさがれたまま投げた球は 0', () => {
  let blocked = 0, thrown = 0, peeks = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const m = C.createMatch({ seed, human: null });
    let g = 0;
    const pos = {};
    while (m.phase !== 'matchOver' && g++ < 60 * 60 * 12) {
      C.step(m, 1 / 60);
      for (const e of C.drainEvents(m)) {
        if (e.type === 'peek') peeks++;
        if (e.type !== 'throw') continue;
        thrown++;
        const p = m.players[e.player], b = m.balls.find((x) => x.id === e.ball);
        if (!b) continue;
        // 投げた向きの、体のすぐ先に壁があったら「壁越し」
        const L = Math.hypot(b.vx, b.vz);
        const s = C.blockingShelter(p.x, p.z, p.x + b.vx / L * (R.PLAYER_R + R.PEEK_NEAR), p.z + b.vz / L * (R.PLAYER_R + R.PEEK_NEAR), 0);
        if (s) blocked++;
      }
    }
  }
  assert.ok(thrown > 500 && peeks > 50, `投げた ${thrown}・のぞいた ${peeks}`);
  assert.equal(blocked, 0, `壁にふさがれたまま投げた ${blocked}/${thrown}`);
});

test('必殺: 人が 2 回当てるとゲージ満タン、次の 1 球は大玉で、まわりの相手もアウト (壁の陰は助かる)', () => {
  const m = playing({ human: 1, aimMode: 'easy' });
  const me = m.players[1];
  const foes = m.players.filter((p) => p.team === 1);
  isolate(m, [1, ...foes.map((p) => p.id)]);
  foes.forEach((q) => { q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true }); q.balls = 0; q.standT = 99; q.vx = q.vz = 0; });
  m.stock[1] = 0;
  // ふつうの玉を 2 回当てる
  for (const q of foes.slice(0, 2)) {
    q.x = 3.6; q.z = -3; me.x = 3.6; me.z = 4; me.balls = 1; me.cd = 0; me.aimF = 1;
    C.throwBall(m, me, q.x, q.z, q.id);
    run(m, 1.0, { crouch: true });
    assert.ok(!q.alive, 'ふつうの玉が当たった');
    foes.forEach((o) => { if (o !== q && o.alive) { o.x = -4.6; o.z = -17 + o.id * 0.4; } });
  }
  assert.equal(m.sp[me.team], 1, `2 回でゲージ満タン (${m.sp[me.team]})`);
  // 大玉: 狙った相手と、その 1.2m 横の相手がアウト。中央シェルターの裏 (1.6m 以内) の相手は助かる
  const [a, b2, c] = foes.slice(2, 5);
  me.x = 3.6; me.z = 4; me.balls = 1; me.cd = 0; me.aimF = 1;
  a.x = 3.6; a.z = -3; b2.x = 2.4; b2.z = -3; 
  const cs = C.SHELTERS.find((w) => w.x > 0 && w.z < 0 && w.z > -10);   // あか陣の右のシェルター
  c.x = cs.x; c.z = cs.z - cs.d / 2 - R.PLAYER_R - 0.02;                 // その裏
  const far = foes[5]; far.x = -4.5; far.z = -16;
  const ball = C.throwBall(m, me, a.x, a.z, a.id);
  assert.ok(ball.big && ball.r > R.BALL_R && m.sp[me.team] === 0, '大玉になり、ゲージは 0 に戻る');
  run(m, 1.2, { crouch: true });
  const evs = C.drainEvents(m);
  assert.ok(!a.alive && !b2.alive, '狙った相手と、まわりの相手がアウト');
  assert.ok(far.alive, '遠くの相手は無事');
  assert.ok(evs.some((e) => e.type === 'splash'), '大玉が弾けた');
  // 壁の陰: 大玉が落ちた所との間に壁があればアウトにならない
  const m2 = playing({ human: 1 });
  const me2 = m2.players[1], q1 = m2.players[7], q2 = m2.players[8];
  isolate(m2, [1, 7, 8]);
  [q1, q2].forEach((q) => { q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true }); q.balls = 0; q.standT = 99; });
  m2.stock[1] = 0; m2.sp[m2.players[1].team] = 1;
  q1.x = cs.x; q1.z = cs.z + cs.d / 2 + R.PLAYER_R + 0.15;         // シェルターの手前 (こちら側) で当たる
  q2.x = cs.x; q2.z = cs.z - cs.d / 2 - R.PLAYER_R - 0.02;         // シェルターの裏 (1.3m ほど離れている)
  assert.ok(Math.hypot(q1.x - q2.x, q1.z - q2.z) < R.SPLASH_R, '弾ける範囲の中にいる');
  me2.x = cs.x; me2.z = 5; me2.balls = 1; me2.cd = 0; me2.aimF = 1;
  C.throwBall(m2, me2, q1.x, q1.z, q1.id);
  run(m2, 1.2, { crouch: true });
  assert.ok(!q1.alive && q2.alive, '壁の陰の相手は助かる');
});

test('むずかしい: 長く狙われた AI は壁の陰にしゃがみ、立ち上がってからしばらくはしゃがまない (フェイント)', () => {
  let ducked = 0;
  for (let k = 0; k < 20; k++) {
    const m = playing({ human: 1, aimMode: 'hard', seed: 500 + k });
    isolate(m, [1, 7]);
    const me = m.players[1], q = m.players[7];
    me.x = 1; me.z = 6; me.balls = 2; me.cd = 0;
    q.x = 1; q.z = -6; q.ai.think = 999; q.ai.goal = null; q.balls = 0;
    run(m, R.AIM_STEADY, { aiming: true, aimTarget: q.id });
    if (q.ai.duckT > 0) {
      ducked++;
      assert.ok(q.crouch, 'しゃがんでいる');
      run(m, 0.1, {});                                  // 取り消し
      run(m, R.DUCK_TIME, {});                          // 立ち上がるまで待つ
      assert.ok(q.ai.calmT > 0 && q.ai.duckT <= 0, '立ち上がり、しばらくはしゃがまない');
      run(m, R.AIM_STEADY + 0.05, { aiming: true, aimTarget: q.id });
      assert.ok(!(q.ai.duckT > 0), 'すぐ狙い直すと、今度はしゃがまない');
    }
  }
  assert.ok(ducked >= 5 && ducked <= 18, `しゃがんだ ${ducked}/20 (毎回ではない)`);
  // かんたんでは、狙われてもしゃがまない
  const m = playing({ human: 1, aimMode: 'easy' });
  isolate(m, [1, 7]);
  const q = m.players[7]; q.ai.think = 999; q.balls = 0;
  run(m, 1.0, { aiming: true, aimTarget: q.id });
  assert.ok(!(q.ai.duckT > 0), 'かんたんではしゃがまない');
});

test('フラッグはバックスが抜いてもよい', () => {
  const m = playing({ human: null });
  m.players.forEach((p) => { p.balls = 0; });
  const back = m.players.find((p) => p.team === 0 && p.role === 'B');
  const f = C.flagPos(1);
  back.x = f.x + 0.3; back.z = f.z + 0.3;
  C.step(m, 1 / 60);
  assert.strictEqual(m.setResults[0].reason, 'flag');
  assert.strictEqual(m.setResults[0].winner, 0);
});

test('ポイント: 全員アウト・フラッグの勝ちは 10、負けは残り人数。時間切れは両方とも残り人数', () => {
  assert.deepStrictEqual(C.setPoints(0, 'flag', [5, 3]), [10, 3]);
  assert.deepStrictEqual(C.setPoints(1, 'allout', [0, 4]), [0, 10]);
  assert.deepStrictEqual(C.setPoints(0, 'time', [5, 3]), [5, 3]);
  assert.deepStrictEqual(C.setPoints(-1, 'time', [4, 4]), [4, 4]);
  assert.deepStrictEqual(C.setPoints(1, 'over', [7, 6]), [7, 10]);
});

/** セットの結果を作る: winner, reason, あおの残り, あかの残り */
function forceSet(m, winner, reason, a0, a1) {
  run(m, R.COUNTDOWN + 0.1, {});
  m.players.forEach((p) => { p.balls = 0; });
  m.stock = [0, 0];
  const kill = (team, n) => m.players.filter((p) => p.team === team).slice(n).forEach((p) => { p.alive = false; });
  kill(0, a0); kill(1, a1);
  if (reason === 'time') m.time = 0.001;
  if (reason === 'flag') { const w = m.players.find((p) => p.team === winner && p.alive); const f = C.flagPos(1 - winner); w.x = f.x; w.z = f.z; }
  C.step(m, 1 / 60, {});
  assert.strictEqual(m.setResults[m.setResults.length - 1].reason, reason);
  run(m, R.SET_OVER + 0.1, {});
}

test('セット数が同じなら合計ポイントで決まる', () => {
  const m = C.createMatch({ seed: 2, human: 0 });
  forceSet(m, 0, 'flag', 6, 2);    // あお 10 - あか 2
  forceSet(m, 1, 'flag', 1, 7);    // あお 1 - あか 10
  forceSet(m, -1, 'time', 3, 3);   // 3 - 3
  assert.strictEqual(m.phase, 'matchOver');
  assert.deepStrictEqual(m.setWins, [1, 1]);
  assert.deepStrictEqual(m.points, [14, 15]);
  assert.strictEqual(m.winner, 1);
  assert.strictEqual(m.decidedBy, 'points');
});

test('セット数もポイントも同じならビクトリースローで決まる', () => {
  const m = C.createMatch({ seed: 3, human: 0 });
  forceSet(m, 0, 'flag', 5, 2);    // 10 - 2
  forceSet(m, 1, 'flag', 2, 5);    // 2 - 10
  forceSet(m, -1, 'time', 4, 4);   // 4 - 4
  assert.strictEqual(m.phase, 'vt');
  assert.deepStrictEqual(m.points, [16, 16]);
  const me = m.players[m.human];
  assert.ok(me.alive && me.team === 0, '自分が投げる');
  const f = C.flagPos(1);
  assert.ok(Math.abs(Math.hypot(me.x - f.x, me.z - f.z) - R.VT_DIST) < 1e-9, 'フラッグから 12m');
  // 自分は当たる所へ、毎回投げる
  const aim = C.findAim([], 0, me.x, me.z, { team: 1, crouch: false, standT: 0 }, f.x, f.z);
  assert.ok(aim, '当たる着地点がある');
  let guard = 0;
  while (m.phase === 'vt' && guard++ < 60 * 60) C.step(m, 1 / 60, { throwAt: aim });
  const ev = C.drainEvents(m);
  const mine = ev.filter((e) => e.type === 'vtThrow' && e.team === 0);
  assert.ok(mine.length >= 1 && mine.every((e) => e.hit), '狙った玉はフラッグに当たる');
  run(m, R.SET_OVER + 0.1, {});
  assert.strictEqual(m.phase, 'matchOver');
  assert.ok(m.winner === 0 || m.winner === 1);
  assert.strictEqual(m.decidedBy, 'vt');
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
  assert.deepStrictEqual(m.setResults[0], { winner: 0, reason: 'allout', alive: [7, 0], points: [10, 0] });

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

test('しゃがむと雪玉を丸める。チームの残りから引かれ、持てる数 (3 個) まで', () => {
  const m = playing();
  const p = m.players[0];
  isolate(m, [p.id, 8]);
  m.players[8].x = 4; m.players[8].z = -17; m.players[8].alive = true;
  m.players[8].balls = 0;
  p.balls = R.MAX_CARRY - 2;
  const before = m.stock[0];
  run(m, R.MAKE_TIME * 1.5, { crouch: true });
  assert.strictEqual(p.balls, R.MAX_CARRY - 1);
  assert.strictEqual(m.stock[0], before - 1);
  run(m, R.MAKE_TIME * 5, { crouch: true });
  assert.strictEqual(p.balls, R.MAX_CARRY, '持てる数で止まる');
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
      if (p.role === 'F' && C.side(p.team) * p.z > R.BACK_LINE_U + 1e-6) bad++;
    }
    for (const team of [0, 1]) {
      if (m.players.filter((p) => p.team === team && C.inEnemyCourt(p)).length > R.MAX_IN_ENEMY) bad++;
    }
    for (const e of C.drainEvents(m)) if (e.type === 'setEnd') reasons[e.reason] = (reasons[e.reason] || 0) + 1;
  }
  return { m, reasons, bad };
}

test('AI どうしで 60 試合: 必ず終わり、壁にめりこまず、フォワードはバックラインより前、相手コートは 3 人まで', () => {
  let w = [0, 0, 0];
  const all = {};
  for (let seed = 1; seed <= 60; seed++) {
    const { m, reasons, bad } = autoplay(seed, [0.55, 0.55]);
    assert.strictEqual(m.phase, 'matchOver', `seed ${seed} が終わらない`);
    assert.strictEqual(bad, 0, `seed ${seed}: おかしな位置 ${bad} 回`);
    w[m.winner < 0 ? 2 : m.winner]++;
    for (const k in reasons) all[k] = (all[k] || 0) + reasons[k];
  }
  // 同じ強さなら、どちらの陣地でも勝てる (向きの違いで偏らない)
  // 30 試合では振れが大きすぎた (1〜30 で 23:7、31〜60 で 16:14、100〜199 で 47:53)。60 試合で期待 30・3 標準偏差 = 18
  assert.ok(w[0] >= 18 && w[1] >= 18, `勝ち数 あお${w[0]} あか${w[1]} 分${w[2]}`);
  assert.ok(all.allout > 0 && all.time > 0, JSON.stringify(all));
  assert.ok(!all.over, `AI が 4 人目の反則をした: ${JSON.stringify(all)}`);
});

test('強い AI は弱い AI によく勝つ', () => {
  let strong = 0, weak = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const { m } = autoplay(seed, [0.85, 0.25]);
    if (m.winner === 0) strong++; else if (m.winner === 1) weak++;
  }
  assert.ok(strong > weak * 2, `強い${strong} 弱い${weak}`);
});

test('選手の絵 (players.webp): 8 列 x 6 行・1 コマ 192px。どのコマも足もとが同じ線で、はみ出していない', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const buf = fs.readFileSync(path.join(__dirname, 'players.webp'));
  assert.strictEqual(buf.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(buf.toString('ascii', 8, 12), 'WEBP');
  // 透明つきの WebP は VP8X の塊に全体の大きさを持つ
  assert.strictEqual(buf.toString('ascii', 12, 16), 'VP8X');
  const w = 1 + buf.readUIntLE(24, 3), h = 1 + buf.readUIntLE(27, 3);
  assert.deepStrictEqual([w, h], [192 * 8, 192 * 6]);
  assert.ok(buf.length < 400 * 1024, `大きさ ${Math.round(buf.length / 1024)}KB`);
  const rep = JSON.parse(fs.readFileSync(path.join(__dirname, 'art', 'sprites_report.json'), 'utf8'));
  const frames = Object.entries(rep.frames);
  assert.strictEqual(frames.length, 24);
  for (const [name, f] of frames) {
    const [x0, y0, x1, y1] = f.bbox;
    assert.ok(x0 > 0 && y0 > 0 && x1 < rep.cell, `${name} がはみ出している ${f.bbox}`);
    assert.ok(Math.abs(y1 - rep.base) <= 1, `${name} の足もと ${y1} (線は ${rep.base})`);
  }
  // 立ち (1 コマ目) はどの向きでも同じ高さ (向きを変えても大きさが変わらない)
  const idle = frames.filter(([n]) => n.endsWith('#1')).map(([, f]) => f.h);
  assert.ok(Math.max(...idle) - Math.min(...idle) <= 2, `立ちの高さ ${idle}`);
});

test('地面と壁の絵 (tex_*.jpg) がそろっていて、重すぎない', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const want = ['ground', 'court', 'shelter_blue', 'shelter_red', 'shelter_center', 'chateau_blue', 'chateau_red', 'walltop', 'flag_blue', 'flag_red'];
  let total = 0;
  for (const n of want) {
    const f = path.join(__dirname, `tex_${n}.jpg`);
    assert.ok(fs.existsSync(f), `tex_${n}.jpg が無い`);
    const b = fs.readFileSync(f);
    assert.ok(b[0] === 0xff && b[1] === 0xd8, `tex_${n}.jpg が JPEG でない`);
    total += b.length;
  }
  assert.ok(total < 300 * 1024, `合計 ${Math.round(total / 1024)}KB`);
  // app.js が読む名前と、ファイルの名前が合っている
  const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  for (const n of ['ground', 'court', 'walltop', 'flag_blue', 'flag_red']) assert.ok(src.includes(`tex_${n}.jpg`), `app.js が tex_${n}.jpg を読んでいない`);
  assert.ok(src.includes('tex_shelter_${') && src.includes('tex_chateau_${'), 'app.js がシェルター・シャトーの絵を読んでいない');
});

// ------------------------------------------------------------ バトルロイヤル
/** バトルロイヤルを始め、keep 以外は脱落させておく (脱落した順にも入れる)。人は操作しない */
function royale(keep, opt) {
  const m = C.createMatch(Object.assign({ mode: 'royale', seed: 3, human: null }, opt || {}));
  m.phase = 'play';
  C.drainEvents(m);
  for (const p of m.players) if (!keep.includes(p.id)) { p.alive = false; m.out.push(p.id); }
  return m;
}
/** a が b へ投げ、玉が消えるまで進める (b は動かない)。起きたできごとを返す */
function throwAt(m, a, b) {
  const A = m.players[a], B = m.players[b];
  A.balls = 3; A.cd = 0; A.standT = 0;
  const ax = A.x, az = A.z, bx = B.x, bz = B.z;
  C.throwBall(m, A, B.x, B.z, b);
  const ev = [];
  for (let i = 0; i < 240 && m.balls.length; i++) {
    // AI どうしなので、動いたり投げ返したりしないように毎歩もとへ戻す
    A.balls = B.balls = 0; A.makeT = B.makeT = 0;
    C.step(m, 1 / 60, {});
    ev.push(...C.drainEvents(m));
    A.x = ax; A.z = az; B.x = bx; B.z = bz;
  }
  return ev;
}

test('バトルロイヤル: 8 人がばらばらのチーム・体力 5・広い正方形。チーム戦に戻すと壁と広さも戻る', () => {
  const m = C.createMatch({ mode: 'royale', seed: 1, human: 0 });
  assert.strictEqual(m.mode, 'royale');
  assert.strictEqual(m.players.length, 8);
  assert.strictEqual(new Set(m.players.map((p) => p.team)).size, 8);
  assert.strictEqual(R.ROYALE.HP, 5);
  assert.ok(m.players.every((p) => p.hp === R.ROYALE.HP && Math.abs(p.x) < R.ROYALE.HALF && Math.abs(p.z) < R.ROYALE.HALF));
  assert.strictEqual(m.setTime, 180);
  assert.strictEqual(C.ARENA.hw, R.ROYALE.HALF);
  const royaleWalls = C.SHELTERS.length;
  assert.ok(royaleWalls > 7);
  // 出発点はどれも壁の外
  for (const p of m.players) assert.ok(!C.SHELTERS.some((s) => Math.abs(p.x - s.x) < s.w / 2 + R.PLAYER_R && Math.abs(p.z - s.z) < s.d / 2 + R.PLAYER_R), `選手 ${p.id} が壁の中`);
  const t = C.createMatch({ seed: 1, human: 1 });
  assert.strictEqual(t.mode, 'team');
  assert.strictEqual(C.SHELTERS.length, 7);
  assert.strictEqual(C.ARENA.hw, R.HALF_W);
  // バトルロイヤルの試合を 1 歩進めると、また広い会場になる (2 つの試合をかわるがわる動かしても混ざらない)
  C.step(m, 1 / 60, {});
  assert.strictEqual(C.SHELTERS.length, royaleWalls);
});

test('バトルロイヤル: 体力ぶん (5 回) 当たると脱落。当たった直後 1 秒は当たらない。倒した数と順位がつく', () => {
  const HP = R.ROYALE.HP;
  const m = royale([0, 1]);
  const A = m.players[0], B = m.players[1];
  A.x = -3; A.z = 3; B.x = -3; B.z = 7;
  let ev = throwAt(m, 0, 1);
  const hurt = ev.find((e) => e.type === 'hurt');
  assert.ok(hurt, '1 回目は体力が減るだけ: ' + ev.map((e) => e.type).join(','));
  assert.strictEqual(B.hp, HP - 1);
  assert.ok(B.alive && B.inv > 0);
  // 無敵の間に当たった玉ははじかれる (体力は減らない)
  B.inv = 1;
  ev = throwAt(m, 0, 1);
  assert.ok(ev.some((e) => e.type === 'block'));
  assert.strictEqual(B.hp, HP - 1);
  for (let k = HP - 2; k >= 1; k--) { B.inv = 0; throwAt(m, 0, 1); assert.strictEqual(B.hp, k); assert.ok(B.alive); }
  B.inv = 0;
  ev = throwAt(m, 0, 1);
  const out = ev.find((e) => e.type === 'hit');
  assert.ok(out && out.royale && out.by === 0, '体力ぶん当たって脱落');
  assert.strictEqual(B.alive, false);
  assert.strictEqual(A.kills, 1);
  assert.strictEqual(A.hits, HP);
  // 残り 1 人で決着: 1 位は A、2 位は最後に脱落した B
  const end = ev.concat(C.drainEvents(m)).find((e) => e.type === 'royaleEnd');
  assert.ok(end, '残り 1 人で決着');
  assert.strictEqual(m.winner, 0);
  assert.strictEqual(m.ranking[0], 0);
  assert.strictEqual(m.ranking[1], 1);
  assert.strictEqual(B.place, 2);
  assert.strictEqual(m.decidedBy, 'last');
  for (let i = 0; i < 400 && m.phase !== 'matchOver'; i++) C.step(m, 1 / 60, {});
  assert.strictEqual(m.phase, 'matchOver');
});

test('バトルロイヤル: 時間切れは、残った人の体力の多い順', () => {
  const m = royale([2, 5, 6]);
  m.players[2].hp = 1; m.players[5].hp = 3; m.players[6].hp = 2;
  m.time = 0.01;
  C.step(m, 1 / 60, {});
  assert.strictEqual(m.decidedBy, 'time');
  assert.deepStrictEqual(m.ranking.slice(0, 3), [5, 6, 2]);
  assert.strictEqual(m.ranking.length, 8);
  assert.strictEqual(new Set(m.ranking).size, 8);
});

test('バトルロイヤル: AI だけで 12 試合。必ず終わり、壁にめりこまず、会場から出ず、だれかは当てる', () => {
  let outs = 0;
  for (let s = 0; s < 12; s++) {
    const m = C.createMatch({ mode: 'royale', seed: 100 + s, human: null });
    let bad = 0;
    for (let i = 0; i < 60 * 240 && m.phase !== 'matchOver'; i++) {
      C.step(m, 1 / 60, {});
      C.drainEvents(m);
      if ((i & 15) === 0) {
        for (const p of m.players) {
          if (!p.alive) continue;
          if (Math.abs(p.x) > R.ROYALE.HALF + 0.01 || Math.abs(p.z) > R.ROYALE.HALF + 0.01) bad++;
          if (C.SHELTERS.some((w) => Math.abs(p.x - w.x) < w.w / 2 - 0.05 && Math.abs(p.z - w.z) < w.d / 2 - 0.05)) bad++;
        }
      }
    }
    assert.strictEqual(m.phase, 'matchOver', `seed ${100 + s} が終わらない`);
    assert.strictEqual(bad, 0, `seed ${100 + s}: 壁の中か会場の外 ${bad}`);
    outs += m.out.length;
  }
  assert.ok(outs >= 12 * 3, `脱落が少なすぎる (${outs})`);
});

test('バトルロイヤル: 残り 2 人で決戦。会場が縮んで、2 人とも真ん中の 8m 四方に入る。時間は 30 秒は残る', () => {
  const m = royale([0, 5]);
  const A = m.players[0], B = m.players[5];
  A.x = -13; A.z = 13; B.x = 13; B.z = -12;
  m.time = 5;
  C.step(m, 1 / 60, {});
  const ev = C.drainEvents(m);
  assert.ok(ev.some((e) => e.type === 'final'), '決戦のできごと');
  assert.ok(m.final && m.time >= 29.9, `時間は 30 秒残る (${m.time.toFixed(1)})`);
  for (let i = 0; i < 60 * (R.ROYALE.FINAL_SHRINK + 0.5); i++) { C.step(m, 1 / 60, {}); C.drainEvents(m); }
  assert.ok(Math.abs(C.ARENA.hw - R.ROYALE.FINAL_HALF) < 1e-6, `会場が縮む (${C.ARENA.hw})`);
  for (const p of [A, B]) if (p.alive) assert.ok(Math.abs(p.x) <= R.ROYALE.FINAL_HALF && Math.abs(p.z) <= R.ROYALE.FINAL_HALF, `選手 ${p.id} が真ん中に入る (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
  // 決戦が 1 回だけ
  assert.ok(!C.drainEvents(m).some((e) => e.type === 'final'));
});

test('バトルロイヤル: AI だけで 12 試合。決戦になったら、2 人とも縮んだ会場の中で、壁にめりこまない', () => {
  let finals = 0;
  for (let s = 0; s < 12; s++) {
    const m = C.createMatch({ mode: 'royale', seed: 300 + s, human: null });
    let bad = 0;
    for (let i = 0; i < 60 * 240 && m.phase !== 'matchOver'; i++) {
      C.step(m, 1 / 60, {});
      C.drainEvents(m);
      // 縮んでいる最中も見る: ふちが壁を通り過ぎる間、外から押された選手が壁の中へ押し込まれていた
      if (m.final && m.phase === 'play') {
        for (const p of m.players) {
          if (!p.alive) continue;
          if (m.final.t > R.ROYALE.FINAL_SHRINK && (Math.abs(p.x) > R.ROYALE.FINAL_HALF + 0.01 || Math.abs(p.z) > R.ROYALE.FINAL_HALF + 0.01)) bad++;
          if (C.SHELTERS.some((w) => Math.abs(p.x - w.x) < w.w / 2 - 0.05 && Math.abs(p.z - w.z) < w.d / 2 - 0.05)) bad++;
        }
      }
    }
    if (m.final) finals++;
    assert.strictEqual(m.phase, 'matchOver');
    assert.strictEqual(bad, 0, `seed ${300 + s}`);
  }
  assert.ok(finals >= 3, `決戦になった試合 ${finals}/12`);
});

test('バトルロイヤル: 決戦で会場のふちが壁を通り過ぎても、外にいた選手は壁の中に入らない', () => {
  // 外側の壁 (x = 10.5) のすぐ外に立たせて、決戦を始める
  for (const [x, z] of [[11.2, 3.2], [-11.2, -3.2], [3.2, 11.2], [-3.2, -11.2], [10.5, 4.6], [14, 14]]) {
    const m = royale([0, 5]);
    const A = m.players[0], B = m.players[5];
    A.x = x; A.z = z; B.x = 0; B.z = 3;
    let deep = 0;
    for (let i = 0; i < 60 * 8; i++) {
      A.balls = B.balls = 0; A.inv = B.inv = 9;
      C.step(m, 1 / 60, {}); C.drainEvents(m);
      for (const w of C.SHELTERS) deep = Math.max(deep, Math.min(w.w / 2 - Math.abs(A.x - w.x), w.d / 2 - Math.abs(A.z - w.z)));
    }
    assert.ok(deep < 0.02, `(${x}, ${z}) から: 壁の中へ ${deep.toFixed(2)}m`);
    assert.ok(Math.abs(A.x) <= R.ROYALE.FINAL_HALF && Math.abs(A.z) <= R.ROYALE.FINAL_HALF);
  }
});

test('バトルロイヤル: 時間切れで体力も倒した数も当てた数も同じなら、番号の若い人がいつも上にはならない', () => {
  let first0 = 0;
  for (let s = 0; s < 40; s++) {
    const m = royale([0, 5], { seed: 700 + s });
    m.players[0].inv = m.players[5].inv = 99;
    m.time = 0.01;
    C.step(m, 1 / 60, {});
    assert.strictEqual(m.decidedBy, 'time');
    if (m.ranking[0] === 0) first0++;
  }
  assert.ok(first0 >= 8 && first0 <= 32, `0 番が 1 位になったのは 40 回中 ${first0} 回`);
});

test('バトルロイヤル: のぞき投げから戻ったら、投げた向きを向く (南の相手に投げて北を向かない)', () => {
  const m = royale([0, 3], { human: 0, aimMode: 'easy' });
  const A = m.players[0], B = m.players[3];
  const w = C.SHELTERS.find((s) => s.x === 0 && s.z === 6.5);      // 横に長い壁
  A.x = w.x; A.z = w.z - w.d / 2 - R.PLAYER_R - 0.05;              // 壁の北側のすぐ裏
  B.x = 0; B.z = 12;                                                // 相手は南
  let peeked = false, threw = false;
  for (let i = 0; i < 60 * 4; i++) {
    B.balls = 0; B.inv = 9; B.x = 0; B.z = 12;
    const inp = i === 2 ? { throwAt: { x: B.x, z: B.z, target: 3 } } : {};
    C.step(m, 1 / 60, inp);
    for (const e of C.drainEvents(m)) { if (e.type === 'peek') peeked = true; if (e.type === 'throw' && e.player === 0) threw = true; }
    if (peeked && threw && !A.peek) break;
  }
  assert.ok(peeked && threw && !A.peek, `のぞいて投げて戻る (peek ${peeked} throw ${threw})`);
  assert.ok(Math.cos(A.face) > 0.5, `南 (+z) を向く (face ${A.face.toFixed(2)})`);
});

test('バトルロイヤル: かんたんの玉の曲がりは、チーム戦より弱い (0.6 rad/s。チーム戦は 2.0)', () => {
  // 横へ走る相手へ投げ、0.3 秒のあいだに玉の向きが何 rad 変わったかを見る
  const turned = (mode) => {
    const m = mode === 'royale' ? royale([0, 3], { human: 0, aimMode: 'easy' })
      : (() => { const t = playing({ human: 0, aimMode: 'easy' }); isolate(t, [0, 7]); return t; })();
    const A = m.players[0], B = m.players[mode === 'royale' ? 3 : 7];
    A.x = -3; A.z = 3; A.balls = 3; A.cd = 0;
    B.x = -3; B.z = -9; B.inv = 9;
    C.step(m, 1 / 60, { throwAt: { x: B.x, z: B.z, target: B.id } });
    const b = m.balls[0];
    assert.ok(b && b.home === B.id, '相手を追う玉');
    const a0 = Math.atan2(b.vx, b.vz);
    for (let i = 0; i < 18; i++) { B.x += 4.3 / 60; B.vx = 4.3; B.vz = 0; B.balls = 0; A.balls = 0; C.step(m, 1 / 60, {}); B.z = -9; }
    return Math.abs(Math.atan2(b.vx, b.vz) - a0);
  };
  const r = turned('royale'), t = turned('team');
  assert.ok(r > 0.02 && r <= R.ROYALE.HOMING_TURN * 0.3 + 0.01, `バトルロイヤル: 0.3 秒で ${r.toFixed(3)} rad (上限 ${(R.ROYALE.HOMING_TURN * 0.3).toFixed(2)})`);
  assert.ok(t > r * 1.3, `チーム戦の方がよく曲がる (${t.toFixed(3)} > ${r.toFixed(3)})`);
  assert.strictEqual(R.HOMING_TURN, 2.0);
});

test('バトルロイヤル: 必殺の大玉は体力を 2 減らす (じかに当たっても、まわりに弾けても)。残り 1 なら脱落', () => {
  const m = royale([0, 1, 2], { human: 0, aimMode: 'easy' });
  const A = m.players[0], B = m.players[1], D = m.players[2];
  A.x = -3; A.z = 3; B.x = -3; B.z = 7; D.x = -2.2; D.z = 7.6;       // D は B のすぐそば (1.6m 以内)
  const big = () => {
    m.sp[0] = 1; A.balls = 3; A.cd = 0; A.standT = 0; B.inv = D.inv = 0;
    B.balls = D.balls = 0;      // 相手 (AI) が先に投げ合うと、当たった直後の無敵で大玉がはじかれる
    const ev = [];
    C.step(m, 1 / 60, { throwAt: { x: B.x, z: B.z, target: 1 } });
    for (let i = 0; i < 200 && (m.balls.length || i < 2); i++) {
      ev.push(...C.drainEvents(m));
      B.balls = D.balls = A.balls = 0; C.step(m, 1 / 60, {});
      A.x = -3; A.z = 3; if (B.alive) { B.x = -3; B.z = 7; } if (D.alive) { D.x = -2.2; D.z = 7.6; }
    }
    ev.push(...C.drainEvents(m));
    return ev;
  };
  let ev = big();
  assert.ok(ev.some((e) => e.type === 'bigThrow'), '大玉を投げた: ' + ev.map((e) => e.type).join(','));
  assert.strictEqual(B.hp, R.ROYALE.HP - 2, 'じかに当たった相手は 2 減る');
  assert.strictEqual(D.hp, R.ROYALE.HP - 2, 'まわりの相手も 2 減る');
  const h = ev.find((e) => e.type === 'hurt' && e.player === 1);
  assert.ok(h && h.dmg === 2 && h.big);
  assert.ok(!ev.some((e) => e.type === 'block' && e.player === 1), 'じかに当たった相手に、はじいた印を重ねて出さない');
  // ふつうの玉は 1
  m.sp[0] = 0; B.inv = 0;
  throwAt(m, 0, 1);
  assert.strictEqual(B.hp, R.ROYALE.HP - 3);
  // 残り 1 の相手に大玉: 0 で止まって脱落 (マイナスにならない)
  B.hp = 1; D.hp = 5;
  ev = big();
  assert.strictEqual(B.hp, 0);
  assert.strictEqual(B.alive, false);
});

test('バトルロイヤル: ステージは時間で 3 回縮む (残り 150・105・60 秒で 12・10・8m)。縮む間も選手は中にいる', () => {
  const m = royale([0, 3, 5], { human: null });
  for (const id of [0, 3, 5]) m.players[id].inv = 9999;
  m.players[0].x = 14; m.players[0].z = 14; m.players[3].x = -14; m.players[3].z = 0; m.players[5].x = 0; m.players[5].z = -14;
  const seen = [];
  let out = 0, inWall = 0;
  for (let i = 0; i < 60 * 130 && m.phase === 'play'; i++) {
    for (const p of m.players) { p.balls = 0; p.makeT = 0; }
    C.step(m, 1 / 60, {});
    for (const e of C.drainEvents(m)) if (e.type === 'shrink') seen.push([Math.round(m.time), e.half, e.stage]);
    for (const p of m.players) {
      if (!p.alive) continue;
      if (Math.abs(p.x) > C.ARENA.hw + 0.01 || Math.abs(p.z) > C.ARENA.hw + 0.01) out++;
      if (C.SHELTERS.some((w) => Math.abs(p.x - w.x) < w.w / 2 - 0.05 && Math.abs(p.z - w.z) < w.d / 2 - 0.05)) inWall++;
    }
  }
  assert.deepStrictEqual(seen, [[150, 12, 1], [105, 10, 2], [60, 8, 3]]);
  assert.ok(Math.abs(C.ARENA.hw - 8) < 1e-6, `最後は 16m 四方 (${C.ARENA.hw})`);
  assert.strictEqual(out, 0, '縮むふちの外に残った選手');
  assert.strictEqual(inWall, 0, '壁の中に入った選手');
});
