/*!
 * core.js — 雪合戦のロジック。DOM を触らないので node でテストできる。
 *
 * ブラウザでは <script> で読み込むと window.Core になり、node からは require() できる。
 *
 * 座標 (メートル):
 *   x … コートの横 (-5〜5)。z … コートの縦 (-18〜18)。y … 高さ。
 *   チーム0 (あお・自分たち) は z > 0 の側、チーム1 (あか) は z < 0 の側。
 *   画面では z の小さい方 (敵陣) が上に見える。
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.Core = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------ 決まった数
  const R = {
    HALF_W: 5,            // コート 10m
    HALF_L: 18,           // コート 36m
    FLAG_U: 17.2,         // フラッグは自陣エンドライン近く (自陣から見た u)
    FLAG_R: 0.75,         // フラッグに触れたとみなす距離
    PLAYER_R: 0.3,
    STAND_H: 1.7,
    CROUCH_H: 0.85,       // シェルター (0.9) より低い
    BALL_R: 0.11,
    G: 9.8,
    THROW_H: 17,          // 投げた球の水平の速さ (m/s)
    THROW_Y: 1.5,         // 手をはなす高さ
    RANGE: 22,            // 届く距離
    MIN_RANGE: 1.5,
    SPEED: 4.3,           // 走る速さ
    STAND_AFTER_THROW: 0.45, // 投げたあと立っている時間 (この間は隠れていても当たる)
    THROW_CD: 0.5,
    MAKE_TIME: 0.9,       // 1 個丸める時間
    MAX_CARRY: 5,
    START_CARRY: 3,
    BALLS_PER_SET: 90,    // 公式: 1 セット 90 球
    SET_TIME: 90,         // 公式は 3 分。スマホ向けに短くした
    SETS: 3,
    COUNTDOWN: 2.0,
    SET_OVER: 3.0,
    FORWARDS: 4,
    BACKS: 3
  };

  /** チームの陣地の向き: チーム0 は +1 (z>0)、チーム1 は -1 */
  function side(team) { return team === 0 ? 1 : -1; }

  // ------------------------------------------------------------ 乱数
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ------------------------------------------------------------ コート
  /**
   * シェルター 7 基 (各陣 キャッスル 1 + シェルター 2、中央 1)。
   * w: 横幅 (x)、d: 奥行き (z)、h: 高さ。
   */
  function makeShelters() {
    const list = [{ x: 0, z: 0, w: 1.8, d: 0.45, h: 0.9, kind: 'center', team: -1 }];
    for (const team of [0, 1]) {
      const s = side(team);
      list.push({ x: 0, z: s * 14.6, w: 2.6, d: 0.9, h: 1.0, kind: 'castle', team });
      list.push({ x: -2.6, z: s * 8, w: 1.3, d: 0.45, h: 0.9, kind: 'shelter', team });
      list.push({ x: 2.6, z: s * 8, w: 1.3, d: 0.45, h: 0.9, kind: 'shelter', team });
    }
    return list;
  }
  const SHELTERS = makeShelters();

  function flagPos(team) { return { x: 0, z: side(team) * R.FLAG_U }; }

  /**
   * 隠れる場所。シェルターの「そのチームの陣地側」のすぐ後ろ。
   * 敵は反対側から投げてくるので、しゃがめば守られる。
   */
  function coverSpots(team) {
    const s = side(team);
    const spots = [];
    SHELTERS.forEach((sh, i) => {
      const n = Math.max(1, Math.round(sh.w / 0.8));
      for (let k = 0; k < n; k++) {
        const x = sh.x - sh.w / 2 + sh.w * (k + 0.5) / n;
        const z = sh.z + s * (sh.d / 2 + R.PLAYER_R + 0.12);
        spots.push({ x, z, u: s * z, shelter: i });
      }
    });
    return spots;
  }
  const COVER = [coverSpots(0), coverSpots(1)];

  // ------------------------------------------------------------ 試合を作る
  /**
   * @param {object} opt
   *   seed, setTime, skill: [チーム0のAI, チーム1のAI] (0〜1), human: 操作する選手の id (null なら全員 AI)
   */
  function createMatch(opt) {
    opt = opt || {};
    const m = {
      seed: (opt.seed == null ? 1 : opt.seed) >>> 0,
      rng: null,
      setTime: opt.setTime || R.SET_TIME,
      skill: opt.skill || [0.55, 0.55],
      human: opt.human === undefined ? 0 : opt.human,
      setNo: 0,
      setWins: [0, 0],
      setResults: [],      // { winner: 0|1|-1, reason }
      phase: 'countdown',
      phaseTime: 0,
      time: 0,
      players: [],
      balls: [],
      stock: [0, 0],
      events: [],
      nextBallId: 1,
      winner: null
    };
    m.rng = mulberry32(m.seed);
    startSet(m);
    return m;
  }

  function startSet(m) {
    m.setNo++;
    m.phase = 'countdown';
    m.phaseTime = R.COUNTDOWN;
    m.time = m.setTime;
    m.balls = [];
    m.players = [];
    let id = 0;
    for (const team of [0, 1]) {
      const s = side(team);
      const fx = [-4.2, -2, 2, 4.2];
      const bx = [-3.4, 0, 3.4];
      for (let i = 0; i < R.FORWARDS; i++) m.players.push(newPlayer(id++, team, 'F', i + 1, fx[i] * s, s * 16.8));
      for (let i = 0; i < R.BACKS; i++) m.players.push(newPlayer(id++, team, 'B', R.FORWARDS + i + 1, bx[i] * s, s * 15.9));
    }
    m.stock = [R.BALLS_PER_SET - 7 * R.START_CARRY, R.BALLS_PER_SET - 7 * R.START_CARRY];
    // 前のセットで操作していた選手が退場していても、セットごとに全員そろう
    if (m.human != null && m.humanBase != null) m.human = m.humanBase;
    if (m.humanBase == null) m.humanBase = m.human;
    m.events.push({ type: 'setStart', setNo: m.setNo });
  }

  function newPlayer(id, team, role, num, x, z) {
    return {
      id, team, role, num, x, z, vx: 0, vz: 0,
      face: team === 0 ? Math.PI : 0, // 敵陣を向く (face は xz 平面での向き: 0 = +z)
      alive: true, outAt: 0,
      crouch: false, standT: 0,
      balls: R.START_CARRY, makeT: 0, cd: 0,
      ai: { think: 0, goal: null, spot: -1, holdT: 0, dodgeT: 0, dx: 0, dz: 0, seen: {}, rush: false }
    };
  }

  function playerHeight(p) {
    return (p.crouch && p.standT <= 0) ? R.CROUCH_H : R.STAND_H;
  }

  function isHuman(m, p) { return m.human != null && p.id === m.human; }

  // ------------------------------------------------------------ 投げる
  /**
   * (x,z) から地面の (tx,tz) に落ちる球の初速。水平の速さは一定。
   * 遠くへ投げるほど山なりになる。
   */
  function launch(x, z, tx, tz) {
    let dx = tx - x, dz = tz - z;
    let d = Math.hypot(dx, dz);
    if (d < 1e-6) { dx = 0; dz = -1; d = 1e-6; }
    const ux = dx / d, uz = dz / d;
    const dist = clamp(d, R.MIN_RANGE, R.RANGE);
    const t = dist / R.THROW_H;
    const vy = (-R.THROW_Y + 0.5 * R.G * t * t) / t;
    return { vx: ux * R.THROW_H, vz: uz * R.THROW_H, vy, ux, uz, dist, t };
  }

  function canThrow(p) { return p.alive && p.balls > 0 && p.cd <= 0; }

  function throwBall(m, p, tx, tz) {
    if (!canThrow(p) || m.phase !== 'play') return null;
    const L = launch(p.x, p.z, tx, tz);
    const b = {
      id: m.nextBallId++, team: p.team, owner: p.id,
      x: p.x + L.ux * (R.PLAYER_R + 0.05), z: p.z + L.uz * (R.PLAYER_R + 0.05), y: R.THROW_Y,
      vx: L.vx, vy: L.vy, vz: L.vz, age: 0
    };
    m.balls.push(b);
    p.balls--;
    p.cd = R.THROW_CD;
    p.standT = R.STAND_AFTER_THROW;
    p.makeT = 0;
    p.face = Math.atan2(L.ux, L.uz);
    m.events.push({ type: 'throw', player: p.id, ball: b.id });
    return b;
  }

  /**
   * 球を 1 歩進めたときに何に当たるか。
   * @returns {null | {kind:'ground'|'shelter'|'player'|'out', shelter?, player?}}
   */
  function ballCollide(b, players) {
    if (Math.abs(b.x) > R.HALF_W + 3 || Math.abs(b.z) > R.HALF_L + 4) return { kind: 'out' };
    if (b.y <= R.BALL_R) return { kind: 'ground' };
    for (let i = 0; i < SHELTERS.length; i++) {
      const s = SHELTERS[i];
      if (b.y <= s.h + R.BALL_R * 0.5 &&
          Math.abs(b.x - s.x) <= s.w / 2 + R.BALL_R &&
          Math.abs(b.z - s.z) <= s.d / 2 + R.BALL_R) return { kind: 'shelter', shelter: i };
    }
    if (players) {
      for (const p of players) {
        if (!p.alive || p.team === b.team) continue;
        const dx = b.x - p.x, dz = b.z - p.z;
        const rr = R.PLAYER_R + R.BALL_R;
        if (dx * dx + dz * dz <= rr * rr && b.y <= playerHeight(p) + R.BALL_R * 0.5) {
          return { kind: 'player', player: p };
        }
      }
    }
    return null;
  }

  /** 球の通り道 (画面の照準線と AI の見積もりに使う)。シェルターか地面で止まる。 */
  function trajectory(x, z, tx, tz, step) {
    const L = launch(x, z, tx, tz);
    const pts = [];
    const b = { x: x + L.ux * (R.PLAYER_R + 0.05), z: z + L.uz * (R.PLAYER_R + 0.05), y: R.THROW_Y, vx: L.vx, vy: L.vy, vz: L.vz, team: -9 };
    const dt = step || 0.02;
    let hit = null;
    for (let i = 0; i < 400; i++) {
      pts.push({ x: b.x, y: b.y, z: b.z });
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt - 0.5 * R.G * dt * dt; b.vy -= R.G * dt;
      hit = ballCollide(b, null);
      if (hit) { pts.push({ x: b.x, y: Math.max(b.y, 0), z: b.z }); break; }
    }
    return { points: pts, end: pts[pts.length - 1], hit: hit ? hit.kind : null, launch: L };
  }

  function stepBalls(m, dt) {
    const keep = [];
    for (const b of m.balls) {
      const speed = Math.hypot(b.vx, b.vy, b.vz);
      const n = Math.max(1, Math.ceil(speed * dt / 0.07));
      const h = dt / n;
      let hit = null;
      for (let k = 0; k < n && !hit; k++) {
        b.x += b.vx * h; b.z += b.vz * h;
        b.y += b.vy * h - 0.5 * R.G * h * h; b.vy -= R.G * h;
        hit = ballCollide(b, m.players);
      }
      b.age += dt;
      if (!hit) { keep.push(b); continue; }
      if (hit.kind === 'player') {
        const p = hit.player;
        p.alive = false;
        p.outAt = m.time;
        m.events.push({ type: 'hit', player: p.id, by: b.owner, x: b.x, y: b.y, z: b.z });
      } else if (hit.kind !== 'out') {
        m.events.push({ type: 'splat', on: hit.kind, x: b.x, y: Math.max(b.y, 0.02), z: b.z });
      }
    }
    m.balls = keep;
  }

  // ------------------------------------------------------------ 動く
  function pushOutOfShelters(p) {
    const r = R.PLAYER_R;
    for (const s of SHELTERS) {
      const hx = s.w / 2, hz = s.d / 2;
      const cx = clamp(p.x, s.x - hx, s.x + hx);
      const cz = clamp(p.z, s.z - hz, s.z + hz);
      let dx = p.x - cx, dz = p.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r; p.z = cz + dz / d * r;
      } else {
        // 中心が箱の中: 近い面から押し出す
        const ox = hx + r - Math.abs(p.x - s.x);
        const oz = hz + r - Math.abs(p.z - s.z);
        if (ox < oz) p.x += (p.x >= s.x ? ox : -ox);
        else p.z += (p.z >= s.z ? oz : -oz);
      }
    }
  }

  /** 選手が立ち入れる範囲。バックは自陣だけ。 */
  function limits(p) {
    const s = side(p.team);
    let zmin = -R.HALF_L + R.PLAYER_R, zmax = R.HALF_L - R.PLAYER_R;
    if (p.role === 'B') {
      if (s > 0) zmin = 0.3; else zmax = -0.3;
    }
    return { xmin: -R.HALF_W + R.PLAYER_R, xmax: R.HALF_W - R.PLAYER_R, zmin, zmax };
  }

  function movePlayer(p, input, dt) {
    const wantCrouch = !!input.crouch;
    let mx = input.mx || 0, mz = input.mz || 0;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    if (wantCrouch) { mx = 0; mz = 0; }
    p.crouch = wantCrouch;
    p.vx = mx * R.SPEED; p.vz = mz * R.SPEED;
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (len > 0.05 && !wantCrouch && p.standT <= 0) p.face = Math.atan2(mx, mz);
    pushOutOfShelters(p);
    const L = limits(p);
    p.x = clamp(p.x, L.xmin, L.xmax);
    p.z = clamp(p.z, L.zmin, L.zmax);
  }

  function separate(players) {
    const minD = R.PLAYER_R * 2;
    for (let i = 0; i < players.length; i++) {
      const a = players[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < players.length; j++) {
        const b = players[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minD * minD || d2 < 1e-9) continue;
        const d = Math.sqrt(d2);
        const push = (minD - d) / 2;
        a.x -= dx / d * push; a.z -= dz / d * push;
        b.x += dx / d * push; b.z += dz / d * push;
      }
    }
    for (const p of players) {
      if (!p.alive) continue;
      pushOutOfShelters(p);
      const L = limits(p);
      p.x = clamp(p.x, L.xmin, L.xmax);
      p.z = clamp(p.z, L.zmin, L.zmax);
    }
  }

  /** しゃがんでいると雪玉を丸める (チームの残り球から 1 個ずつ)。 */
  function makeBalls(m, p, dt) {
    if (!p.crouch || p.standT > 0 || p.balls >= R.MAX_CARRY || m.stock[p.team] <= 0) { p.makeT = 0; return; }
    p.makeT += dt;
    if (p.makeT >= R.MAKE_TIME) {
      p.makeT = 0;
      p.balls++;
      m.stock[p.team]--;
      m.events.push({ type: 'made', player: p.id });
    }
  }

  // ------------------------------------------------------------ AI
  function skillOf(m, p) { return m.skill[p.team]; }

  function enemiesOf(m, p) { return m.players.filter((q) => q.alive && q.team !== p.team); }

  /** 線分 (x0,z0)-(x1,z1) がシェルター (r だけ太らせた箱) を横切るなら、そのシェルター */
  function blockingShelter(x0, z0, x1, z1, r) {
    let best = null, bestT = 2;
    for (const s of SHELTERS) {
      const minx = s.x - s.w / 2 - r, maxx = s.x + s.w / 2 + r;
      const minz = s.z - s.d / 2 - r, maxz = s.z + s.d / 2 + r;
      let t0 = 0, t1 = 1;
      const dx = x1 - x0, dz = z1 - z0;
      let okk = true;
      for (const [p0, d, lo, hi] of [[x0, dx, minx, maxx], [z0, dz, minz, maxz]]) {
        if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) { okk = false; break; } continue; }
        let a = (lo - p0) / d, b = (hi - p0) / d;
        if (a > b) { const t = a; a = b; b = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) { okk = false; break; }
      }
      if (okk && t0 < bestT && t0 > 0) { bestT = t0; best = s; }
    }
    return best;
  }

  /** 目的地へ向かう向き。間にシェルターがあれば横へ回り込む。 */
  function steer(p, gx, gz) {
    const sh = blockingShelter(p.x, p.z, gx, gz, R.PLAYER_R + 0.08);
    let tx = gx, tz = gz;
    if (sh) {
      const margin = R.PLAYER_R + 0.25;
      const left = sh.x - sh.w / 2 - margin, right = sh.x + sh.w / 2 + margin;
      const goLeft = Math.abs(gx - left) + Math.abs(p.x - left) < Math.abs(gx - right) + Math.abs(p.x - right);
      tx = goLeft ? left : right;
      tz = p.z;
      if (Math.abs(p.x - tx) < 0.1) tz = gz;
    }
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return { mx: 0, mz: 0, d: Math.hypot(gx - p.x, gz - p.z) };
    const k = Math.min(1, d / 0.35);
    return { mx: dx / d * k, mz: dz / d * k, d: Math.hypot(gx - p.x, gz - p.z) };
  }

  function spotTaken(m, p, idx) {
    return m.players.some((q) => q !== p && q.alive && q.team === p.team && q.ai.spot === idx);
  }

  /** u は「自陣から見た位置」。大きいほど自陣の奥、小さいほど敵陣寄り。 */
  function uOf(p) { return side(p.team) * p.z; }

  function pickSpot(m, p, filter, score) {
    const spots = COVER[p.team];
    let best = -1, bestS = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      if (!filter(sp)) continue;
      if (spotTaken(m, p, i)) continue;
      if (p.role === 'B' && sp.u < 0.5) continue;
      const sc = score(sp);
      if (sc < bestS) { bestS = sc; best = i; }
    }
    return best;
  }

  /**
   * (x,z) から (tx,tz) へ投げたら、いまの位置のままの相手のだれに当たるか。
   * シェルターや地面に先に当たれば null。画面の照準と AI の両方が使う。
   */
  function predictHit(players, team, x, z, tx, tz) {
    const L = launch(x, z, tx, tz);
    const b = { x: x + L.ux * (R.PLAYER_R + 0.05), z: z + L.uz * (R.PLAYER_R + 0.05), y: R.THROW_Y, vx: L.vx, vy: L.vy, vz: L.vz, team };
    const dt = 0.01;
    for (let i = 0; i < 300; i++) {
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt - 0.5 * R.G * dt * dt; b.vy -= R.G * dt;
      const hit = ballCollide(b, players);
      if (hit) return hit.kind === 'player' ? hit.player : null;
    }
    return null;
  }

  /** 的に当たる着地点を探す。足もとが壁に隠れていれば、奥を狙って頭越しに落とす。 */
  function findAim(players, team, x, z, q, ax, az) {
    const dx = ax - x, dz = az - z;
    const d = Math.hypot(dx, dz) || 1;
    const ghost = [{ alive: true, team: q.team, x: ax, z: az, crouch: q.crouch, standT: q.standT }];
    for (const off of [0, 1.5, 3, 3.8, 4.6, 5.5]) {
      const tx = ax + dx / d * off, tz = az + dz / d * off;
      if (Math.hypot(tx - x, tz - z) > R.RANGE + 0.3) break;
      if (predictHit(ghost, team, x, z, tx, tz)) return { x: tx, z: tz, off };
    }
    return null;
  }

  function aiChooseThrow(m, p) {
    const s = skillOf(m, p);
    let best = null, bestScore = Infinity;
    for (const q of enemiesOf(m, p)) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > R.RANGE - 0.5) continue;
      const hidden = (q.crouch && q.standT <= 0);
      const t = launch(p.x, p.z, q.x, q.z).t;
      const lead = lerp(0.2, 0.95, s);
      const ax = q.x + q.vx * t * lead, az = q.z + q.vz * t * lead;
      const aim = findAim(m.players, p.team, p.x, p.z, q, ax, az);
      if (!aim) continue;
      const score = d + (hidden ? 5 : 0) + aim.off * 0.8 + (q.role === 'F' && Math.abs(q.z) < 8 ? -2 : 0);
      if (score < bestScore) { bestScore = score; best = { q, ax: aim.x, az: aim.z, d, mv: Math.hypot(q.vx, q.vz) * t }; }
    }
    if (!best) return null;
    // 走っている的ほど外れやすい (先読みしても、向きを変えられるとずれる)
    const err = lerp(1.7, 0.7, s) * (0.6 + best.d / R.RANGE) + best.mv * lerp(0.45, 0.25, s);
    return { x: best.ax + gauss(m.rng) * err, z: best.az + gauss(m.rng) * err };
  }

  /** 飛んでくる球が自分に当たりそうか (最初に当たる物まで先読み) */
  function threatOf(m, p) {
    const h = playerHeight(p);
    for (const b of m.balls) {
      if (b.team === p.team || p.ai.seen[b.id]) continue;
      const c = { x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz, team: b.team };
      const dt = 0.04;
      for (let i = 0; i < 30; i++) {
        c.x += c.vx * dt; c.z += c.vz * dt; c.y += c.vy * dt - 0.5 * R.G * dt * dt; c.vy -= R.G * dt;
        const hit = ballCollide(c, null);
        if (hit) break;
        const dx = c.x - p.x, dz = c.z - p.z;
        if (dx * dx + dz * dz < (R.PLAYER_R + R.BALL_R + 0.2) ** 2 && c.y < h + 0.1) return { b, t: i * dt };
      }
    }
    return null;
  }

  function aiInput(m, p, dt) {
    const ai = p.ai;
    const s = skillOf(m, p);
    const S = side(p.team);
    const input = { mx: 0, mz: 0, crouch: false, throwAt: null };

    // よける
    if (ai.dodgeT > 0) {
      ai.dodgeT -= dt;
      input.mx = ai.dx; input.mz = ai.dz;
      return input;
    }
    const th = threatOf(m, p);
    if (th) {
      ai.seen[th.b.id] = true;
      if (m.rng() < lerp(0.3, 0.75, s) && th.t > lerp(0.35, 0.15, s)) {
        // 球の進む向きに直角へ
        const bl = Math.hypot(th.b.vx, th.b.vz) || 1;
        let px = -th.b.vz / bl, pz = th.b.vx / bl;
        const rel = (p.x - th.b.x) * px + (p.z - th.b.z) * pz;
        if (rel < 0) { px = -px; pz = -pz; }
        if (Math.abs(p.x + px * 1.2) > R.HALF_W - 0.4) { px = -px; pz = -pz; }
        ai.dodgeT = 0.42; ai.dx = px; ai.dz = pz;
        input.mx = px; input.mz = pz;
        return input;
      }
    }

    ai.think -= dt;
    ai.holdT -= dt;
    if (ai.think <= 0) {
      ai.think = lerp(0.55, 0.25, s) * (0.7 + m.rng() * 0.6);
      aiDecide(m, p);
      // 投げる
      if (canThrow(p) && m.rng() < lerp(0.45, 0.85, s)) {
        const at = aiChooseThrow(m, p);
        if (at) input.throwAt = at;
      }
    }

    if (ai.goal) {
      const st = steer(p, ai.goal.x, ai.goal.z);
      if (st.d > 0.15) { input.mx = st.mx; input.mz = st.mz; }
      else if (!ai.rush) input.crouch = true;
    } else {
      input.crouch = true;
    }
    if (input.throwAt) input.crouch = false;
    void S;
    return input;
  }

  function aiDecide(m, p) {
    const ai = p.ai;
    const spots = COVER[p.team];
    const enemyFlag = flagPos(1 - p.team);
    const enemies = enemiesOf(m, p);
    const myU = uOf(p);
    const sk = skillOf(m, p);
    ai.rush = false;

    // フラッグを取りにいく: 守りが薄いとき
    if (p.role === 'F') {
      const defenders = enemies.filter((q) => Math.hypot(q.x - enemyFlag.x, q.z - enemyFlag.z) < 8).length;
      const dFlag = Math.hypot(p.x - enemyFlag.x, p.z - enemyFlag.z);
      const late = m.time < 20 && aliveCount(m, p.team) <= aliveCount(m, 1 - p.team);
      if (defenders === 0 || (defenders <= 1 && dFlag < 13) || (defenders <= 2 && dFlag < 11 && m.rng() < 0.5) || (late && dFlag < 18)) {
        ai.rush = true; ai.spot = -1;
        ai.goal = { x: enemyFlag.x, z: enemyFlag.z };
        return;
      }
    }

    const at = ai.spot >= 0 ? spots[ai.spot] : null;
    const atSpot = !!at && Math.hypot(p.x - at.x, p.z - at.z) < 0.3;
    if (atSpot && !ai.arrived) {
      ai.arrived = true;
      ai.holdT = lerp(5, 2.5, sk) + m.rng() * 3;
    }

    // 球がない: 近くのかくれ場所でしゃがんで丸める
    if (p.balls === 0) {
      if (at && Math.hypot(p.x - at.x, p.z - at.z) < 5) return;
      if (m.stock[p.team] > 0) {
        const i = pickSpot(m, p, (sp) => sp.u >= myU - 1, (sp) => Math.hypot(sp.x - p.x, sp.z - p.z));
        setSpot(ai, spots, i);
      }
      return;
    }

    const minU = p.role === 'B' ? 0.5 : -R.HALF_L;
    const inRange = (x, z) => enemies.some((q) => Math.hypot(q.x - x, q.z - z) < R.RANGE - 2);
    const idle = !inRange(p.x, p.z);

    if (!at) {
      // まず近くのかくれ場所へ (前寄り)
      const i = pickSpot(m, p, (sp) => sp.u >= minU && sp.u <= myU + 2,
        (sp) => Math.hypot(sp.x - p.x, sp.z - p.z) + (p.role === 'B' && sp.u < 6 ? 6 : 0));
      if (i >= 0) { setSpot(ai, spots, i); return; }
      if (idle) ai.goal = { x: p.x, z: side(p.team) * Math.max(minU, myU - 4) };
      return;
    }

    // かくれ場所で一息ついたら、前のかくれ場所へ
    if (!atSpot || ai.holdT > 0) return;
    const bold = p.role === 'F' ? (p.balls >= 2 && m.rng() < lerp(0.5, 0.8, sk)) : m.rng() < 0.25;
    if (!(idle || bold)) { ai.holdT = 1 + m.rng() * 2; return; }
    const i = pickSpot(m, p, (sp) => sp.u < at.u - 1.5 && sp.u >= minU,
      (sp) => (at.u - sp.u) + Math.abs(sp.x - p.x) * 0.6 + m.rng() * 1.5);
    if (i >= 0) setSpot(ai, spots, i);
    else if (idle) {
      ai.spot = -1; ai.arrived = false;
      ai.goal = { x: p.x, z: side(p.team) * Math.max(minU, myU - 4) };
    } else ai.holdT = 1 + m.rng() * 2;
  }

  function setSpot(ai, spots, i) {
    if (i < 0) return;
    if (ai.spot !== i) ai.arrived = false;
    ai.spot = i;
    ai.goal = { x: spots[i].x, z: spots[i].z };
  }

  // ------------------------------------------------------------ 勝ち負け
  function aliveCount(m, team) {
    let n = 0;
    for (const p of m.players) if (p.alive && p.team === team) n++;
    return n;
  }

  function checkSetEnd(m) {
    // フラッグ: 相手陣のフラッグに、生き残っているフォワードが触れた
    for (const p of m.players) {
      if (!p.alive || p.role !== 'F') continue;
      const f = flagPos(1 - p.team);
      if (Math.hypot(p.x - f.x, p.z - f.z) <= R.FLAG_R) return endSet(m, p.team, 'flag', p.id);
    }
    const a0 = aliveCount(m, 0), a1 = aliveCount(m, 1);
    if (a0 === 0 && a1 === 0) return endSet(m, -1, 'allout');
    if (a1 === 0) return endSet(m, 0, 'allout');
    if (a0 === 0) return endSet(m, 1, 'allout');
    if (m.time <= 0) {
      m.time = 0;
      if (a0 > a1) return endSet(m, 0, 'time');
      if (a1 > a0) return endSet(m, 1, 'time');
      return endSet(m, -1, 'time');
    }
    return false;
  }

  function endSet(m, winner, reason, by) {
    m.setResults.push({ winner, reason, alive: [aliveCount(m, 0), aliveCount(m, 1)] });
    if (winner >= 0) m.setWins[winner]++;
    m.phase = 'setOver';
    m.phaseTime = R.SET_OVER;
    m.balls = [];
    m.events.push({ type: 'setEnd', winner, reason, by: by == null ? null : by, setNo: m.setNo });
    // 2 セット先取、または 3 セット終わったら試合終了
    const need = Math.floor(R.SETS / 2) + 1;
    if (m.setWins[0] >= need || m.setWins[1] >= need || m.setNo >= R.SETS) {
      m.winner = m.setWins[0] > m.setWins[1] ? 0 : m.setWins[1] > m.setWins[0] ? 1 : -1;
    }
    return true;
  }

  /** 退場したら、操作を残っている仲間に移す (フォワード優先、近い順) */
  function handOver(m) {
    if (m.human == null) return;
    const me = m.players[m.human];
    if (me && me.alive) return;
    const mates = m.players.filter((q) => q.alive && q.team === me.team);
    if (!mates.length) return;
    mates.sort((a, b) => (a.role === b.role ? 0 : a.role === 'F' ? -1 : 1) ||
      (Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z)));
    m.human = mates[0].id;
    m.events.push({ type: 'handOver', player: m.human });
  }

  // ------------------------------------------------------------ 1 コマ進める
  /**
   * @param {object} m 試合
   * @param {number} dt 秒
   * @param {object} [input] 操作している選手への入力 { mx, mz, crouch, throwAt:{x,z}|null }
   */
  function step(m, dt, input) {
    if (!(dt > 0)) return m;
    dt = Math.min(dt, 0.05);

    if (m.phase === 'countdown') {
      m.phaseTime -= dt;
      if (m.phaseTime <= 0) { m.phase = 'play'; m.events.push({ type: 'go' }); }
      return m;
    }
    if (m.phase === 'setOver') {
      m.phaseTime -= dt;
      stepBalls(m, dt);
      if (m.phaseTime <= 0) {
        if (m.winner != null) { m.phase = 'matchOver'; m.events.push({ type: 'matchEnd', winner: m.winner }); }
        else startSet(m);
      }
      return m;
    }
    if (m.phase !== 'play') return m;

    m.time -= dt;

    for (const p of m.players) {
      if (!p.alive) continue;
      p.cd = Math.max(0, p.cd - dt);
      p.standT = Math.max(0, p.standT - dt);
      const inp = isHuman(m, p) ? (input || {}) : aiInput(m, p, dt);
      movePlayer(p, inp, dt);
      if (inp.throwAt) throwBall(m, p, inp.throwAt.x, inp.throwAt.z);
      makeBalls(m, p, dt);
    }
    separate(m.players);
    stepBalls(m, dt);
    handOver(m);
    checkSetEnd(m);
    return m;
  }

  /** 新しいできごとを取り出す (画面が効果音や演出に使う) */
  function drainEvents(m) {
    const e = m.events;
    m.events = [];
    return e;
  }

  return {
    R, SHELTERS, COVER,
    mulberry32, side, flagPos,
    createMatch, startSet, step, drainEvents,
    launch, trajectory, predictHit, findAim, throwBall, ballCollide, playerHeight,
    movePlayer, pushOutOfShelters, limits, aliveCount, steer, blockingShelter,
    aiInput, threatOf
  };
});
