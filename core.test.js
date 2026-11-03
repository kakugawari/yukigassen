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
  mate.balls = 0; m.stock[0] = 0;   // 味方の AI が先に当ててしまわないように
  // 味方の頭上を越えて、相手の足もとへ
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

test('狙いの補助: 走っている相手にも、壁の陰に立つ相手にも当たる', () => {
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
    C.throwBall(m, me, aim.x, aim.z);
    for (let i = 0; i < 120 && q.alive; i++) {
      q.x += dir * R.SPEED / 60; q.vx = dir * R.SPEED;   // まっすぐ走り続ける
      C.step(m, 1 / 60, { crouch: true });
    }
    if (!q.alive) hits++;
  }
  assert.ok(hits >= 9, `走る相手に ${hits}/10`);
  // 中央シェルターの陰に立っている相手: 足もとは壁に止まるので、奥へ落として頭越しに
  const m = playing({ human: 1 });
  isolate(m, [1, 7]);
  const me = m.players[1], q = m.players[7];
  me.x = 0.5; me.z = 9; me.balls = 1;
  q.x = 0.3; q.z = -0.55; q.vx = q.vz = 0; q.ai.think = 999; q.ai.seen = new Proxy({}, { get: () => true });
  const aim = C.assistAim(m, me, null, q);
  assert.ok(aim.clear, '当たるコースが見つかる');
  assert.ok(aim.z < q.z - 1, `相手より奥へ落とす (着地 z=${aim.z.toFixed(2)})`);
  C.throwBall(m, me, aim.x, aim.z);
  run(m, 1.2, { crouch: true });
  assert.ok(!q.alive, '頭越しに当たる');
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
      if (p.role === 'F' && C.side(p.team) * p.z > R.BACK_LINE_U + 1e-6) bad++;
    }
    for (const team of [0, 1]) {
      if (m.players.filter((p) => p.team === team && C.inEnemyCourt(p)).length > R.MAX_IN_ENEMY) bad++;
    }
    for (const e of C.drainEvents(m)) if (e.type === 'setEnd') reasons[e.reason] = (reasons[e.reason] || 0) + 1;
  }
  return { m, reasons, bad };
}

test('AI どうしで 30 試合: 必ず終わり、壁にめりこまず、フォワードはバックラインより前、相手コートは 3 人まで', () => {
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
