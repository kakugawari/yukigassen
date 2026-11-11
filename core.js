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
    BACK_LINE_U: 11,      // バックライン (センターから 11m・エンドラインから 7m)。公式の図が無いので目安
    MAX_IN_ENEMY: 3,      // 相手コートに入れるのは 3 人まで。4 人目が入るとそのセット負け
    WIN_POINTS: 10,       // 全員アウト・フラッグで勝つと 10 ポイント
    VT_DIST: 12,          // ビクトリースロー: フラッグまでの距離
    PLAYER_R: 0.3,
    STAND_H: 2.1,         // 壁を大きくしたのに合わせて、人の高さも上げた (前は 1.7)
    CROUCH_H: 1.1,        // シェルター (1.2) より低い
    BALL_R: 0.11,
    G: 9.8,
    THROW_H: 17,          // 投げた球の水平の速さ (m/s)
    THROW_Y: 1.85,        // 手をはなす高さ
    RANGE: 22,            // 届く距離
    MIN_RANGE: 1.5,
    SPEED: 4.3,           // 走る速さ
    STAND_AFTER_THROW: 0.45, // 投げたあと立っている時間 (この間は隠れていても当たる)
    THROW_CD: 0.9,        // 投げたあと構え直す時間。この間は次を投げられず、構えも始まらない (連打できない)
    AIM_STEADY: 0.6,      // 人の構え: 投げるボタンを押さえてから狙いが定まるまで (秒)。走っていると 2 倍かかる
    AIM_SPREAD: 2.4,      // 構えが 0 のとき (すぐ離した) の狙いのぶれ (m、20m 先で)。連打すると当たらない
    SHADOW: 1.3,          // 壁のふちからこの距離までの裏にいる相手へは、頭越しに狙わない (のぞくのを待つ)
    PEEK_NEAR: 0.6,       // 壁からこれより近く (体のふちから) にいて、壁越しに投げるなら「のぞき投げ」
    PEEK_OUT: 0.25,       // のぞくとき、壁の端からさらに出る量 (体の半径に足す)
    PEEK_MAX: 2.5,        // のぞいたまま待つ上限 (秒)
    HOMING_TURN: 2.0,     // かんたん: 人の玉が相手へ曲がる速さ (rad/s、水平だけ)
    SP_PER_HIT: 0.5,      // 必殺ゲージ: 人が当てるたびに貯まる (2 回で満タン)
    BIG_R: 0.34,          // 必殺の大玉の半径 (ふつうは 0.11)。当たりやすい
    SPLASH_R: 1.6,        // 大玉が落ちた所から、この距離の相手もアウト (壁の陰は除く)
    DUCK_AT: 0.4,         // むずかしい: 人がこれ以上構えると、狙われた AI は壁の陰にしゃがむことがある
    DUCK_TIME: 1.0,       // しゃがんでいる時間 (秒)。そのあと DUCK_CALM 秒は、もうしゃがまない (フェイントの狙いどき)
    DUCK_CALM: 2.0,       // しゃがんだあと、もうしゃがまない時間 (秒)
    MAKE_TIME: 0.6,       // 1 個丸める時間 (0.9 秒では、生きている時間の 6 割が雪玉 0 個だった)
    MAX_CARRY: 3,         // 一度に持てる数。使い切ったら、しゃがんで丸め直す (その間は攻められない)
    START_CARRY: 3,
    BALLS_PER_SET: 90,    // 公式: 1 セット 90 球
    SET_TIME: 90,         // 公式は 3 分。スマホ向けに短くした
    SETS: 3,
    COUNTDOWN: 2.0,
    SET_OVER: 3.0,
    // バトルロイヤル (公式に無い別のモード): 8 人全員が敵。30m 四方。3 分。3 回当たると脱落
    ROYALE: { N: 8, HALF: 15, TIME: 180, HP: 5, INV: 1.0, SPAWN_R: 13.2,
      BIG_DMG: 2,           // 必殺の大玉は体力を 2 減らす (じかに当たっても、まわりに弾けても)
      // ステージは時間で縮む: 残り時間が at 秒になったら、half 四方の半分へ FINAL_SHRINK 秒かけて縮む。
      // 前は残り 2 人 (決戦) になるまで縮まず、縮むのを見る前に勝つかやられるかしていた
      SHRINK: [{ at: 150, half: 12 }, { at: 105, half: 10 }, { at: 60, half: 8 }],
      // 決戦 (残り 2 人): まだなら FINAL_HALF 四方まで縮める。残り時間は少なくとも FINAL_TIME 秒にする
      FINAL_HALF: 8, FINAL_SHRINK: 6, FINAL_TIME: 30,
      HOMING_TURN: 0.6 },   // かんたんの玉の曲がり (rad/s)。チーム戦は 2.0
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
   * 公式: シェルター 5 基 (中央 1 + 各陣 2) とシャトー 2 基 (各陣 1)。
   * w: 横幅 (x)、d: 奥行き (z)、h: 高さ。
   */
  function makeShelters() {
    // 大きさは、絵の選手 (しゃがんでも幅 1m ほどに見える) に対して壁が小さいと言われて 1.5 倍にした
    const list = [{ x: 0, z: 0, w: 2.7, d: 0.68, h: 1.2, kind: 'center', team: -1 }];
    for (const team of [0, 1]) {
      const s = side(team);
      list.push({ x: 0, z: s * 14.6, w: 3.9, d: 1.35, h: 1.3, kind: 'chateau', team });
      list.push({ x: -2.6, z: s * 8, w: 1.95, d: 0.68, h: 1.2, kind: 'shelter', team });
      list.push({ x: 2.6, z: s * 8, w: 1.95, d: 0.68, h: 1.2, kind: 'shelter', team });
    }
    return list;
  }
  /**
   * バトルロイヤルの会場: 真ん中に大きな壁、そのまわりに 2 重の壁。向きを縦・横まぜる。
   * 開始の位置 (半径 13.2 の円の上、22.5° ずつずらした 8 か所) には壁を置かない
   */
  function makeRoyaleShelters() {
    const L = [{ x: 0, z: 0, w: 3.9, d: 1.35, h: 1.3, kind: 'chateau', team: -1 }];
    const sh = (x, z, along) => L.push(along === 'z'
      ? { x, z, w: 0.68, d: 1.95, h: 1.2, kind: 'shelter', team: -1 }
      : { x, z, w: 1.95, d: 0.68, h: 1.2, kind: 'shelter', team: -1 });
    const long = (x, z, along) => L.push(along === 'z'
      ? { x, z, w: 0.68, d: 2.7, h: 1.2, kind: 'center', team: -1 }
      : { x, z, w: 2.7, d: 0.68, h: 1.2, kind: 'center', team: -1 });
    long(6.5, 0, 'z'); long(-6.5, 0, 'z'); long(0, 6.5, 'x'); long(0, -6.5, 'x');
    sh(5, 5, 'x'); sh(-5, -5, 'x'); sh(-5, 5, 'z'); sh(5, -5, 'z');
    for (const sx of [1, -1]) for (const sz of [1, -1]) { sh(sx * 10.5, sz * 3.2, 'z'); sh(sx * 3.2, sz * 10.5, 'x'); }
    return L;
  }
  const TEAM_SHELTERS = makeShelters();
  const ROYALE_SHELTERS = makeRoyaleShelters();
  // いま使っている会場。中身を入れ替えて使う (ほかの関数は SHELTERS と ARENA を見る)
  const SHELTERS = TEAM_SHELTERS.slice();
  const ARENA = { mode: 'team', hw: R.HALF_W, hl: R.HALF_L };
  function useArena(m) {
    const mode = m && m.mode === 'royale' ? 'royale' : 'team';
    if (mode === 'royale') ARENA.hw = ARENA.hl = royaleHalf(m);
    if (ARENA.mode === mode) return;
    ARENA.mode = mode;
    SHELTERS.length = 0;
    SHELTERS.push(...(mode === 'royale' ? ROYALE_SHELTERS : TEAM_SHELTERS));
    ARENA.hw = mode === 'royale' ? royaleHalf(m) : R.HALF_W;
    ARENA.hl = mode === 'royale' ? royaleHalf(m) : R.HALF_L;
  }
  /** バトルロイヤルの会場の半分の広さ。縮み始めると、from から to へなめらかに動く (m.zone) */
  function royaleHalf(m) {
    const z = m && m.zone;
    if (!z) return R.ROYALE.HALF;
    const k = Math.min(1, z.t / R.ROYALE.FINAL_SHRINK), e = k * k * (3 - 2 * k);
    return z.from + (z.to - z.from) * e;
  }
  /** 会場を half まで縮め始める (いまより広い指定は無視)。縮み始めたら true */
  function shrinkTo(m, half) {
    const z = m.zone;
    if (half >= z.to - 1e-9) return false;
    m.zone = { from: royaleHalf(m), to: half, t: 0, stage: z.stage };
    return true;
  }
  /** 時間で縮む: 残り時間が次の段の at を切ったら縮め始める (まとめて切ったら、いちばん狭い段へ) */
  function stepZone(m, dt) {
    const z = m.zone, S = R.ROYALE.SHRINK;
    z.t += dt;
    let hit = -1;
    while (z.stage < S.length && m.time <= S[z.stage].at) { hit = z.stage; z.stage++; }
    if (hit >= 0 && shrinkTo(m, S[hit].half)) m.events.push({ type: 'shrink', half: S[hit].half, stage: hit + 1, of: S.length });
  }

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
   *   aimMode: 人の投げ方。'easy' = 押したらすぐ投げ、玉が相手へ曲がっていく / 'hard' = 押さえて構え、離して投げる
   */
  function createMatch(opt) {
    opt = opt || {};
    const m = {
      seed: (opt.seed == null ? 1 : opt.seed) >>> 0,
      rng: null,
      setTime: opt.setTime || R.SET_TIME,
      skill: opt.skill || [0.55, 0.55],
      human: opt.human === undefined ? 0 : opt.human,
      aimMode: opt.aimMode === 'easy' ? 'easy' : 'hard',
      setNo: 0,
      setWins: [0, 0],
      setResults: [],      // { winner: 0|1|-1, reason, alive, points }
      points: [0, 0],      // 全セットの合計ポイント
      vt: null,            // ビクトリースロー
      phase: 'countdown',
      phaseTime: 0,
      time: 0,
      players: [],
      balls: [],
      stock: [0, 0],
      sp: [0, 0],          // 必殺ゲージ (0〜1)。人が当てると貯まる。試合を通して持ち越す
      humanAim: null,      // むずかしい: 人がいま構えている相手 { target, f }
      events: [],
      nextBallId: 1,
      winner: null
    };
    m.rng = mulberry32(m.seed);
    if (opt.mode === 'royale') {
      const N = R.ROYALE.N;
      m.mode = 'royale';
      m.setTime = opt.setTime || R.ROYALE.TIME;
      m.skill = new Array(N).fill(opt.aiSkill == null ? 0.5 : opt.aiSkill);
      m.stock = new Array(N).fill(1e9);     // 雪玉はチームで 90 個ではなく、ひとりずつ (いくらでも丸められる。持てるのは 3 個)
      m.sp = new Array(N).fill(0);
      m.human = opt.human === undefined ? 0 : opt.human;
      useArena(m);
      startRoyale(m);
      return m;
    }
    m.mode = 'team';
    useArena(m);
    startSet(m);
    return m;
  }

  /** バトルロイヤルを始める: 8 人を円の上に並べ、全員が真ん中を向く。1 回きり (セットは無い) */
  function startRoyale(m) {
    const N = R.ROYALE.N;
    m.setNo = 1;
    m.phase = 'countdown';
    m.phaseTime = R.COUNTDOWN;
    m.time = m.setTime;
    m.balls = [];
    m.players = [];
    m.out = [];          // 脱落した順
    m.final = null;      // 決戦 (残り 2 人) が始まったら { t: 経った秒, ids }
    m.zone = { from: R.ROYALE.HALF, to: R.ROYALE.HALF, t: 99, stage: 0 };   // ステージの広さ (半分)。時間と決戦で縮む
    for (let i = 0; i < N; i++) {
      const a = (i + 0.5) / N * Math.PI * 2;
      const p = newPlayer(i, i, 'F', i + 1, Math.sin(a) * R.ROYALE.SPAWN_R, Math.cos(a) * R.ROYALE.SPAWN_R);
      p.face = Math.atan2(-p.x, -p.z);
      p.hp = R.ROYALE.HP;
      m.players.push(p);
    }
    m.humanBase = m.human;
    m.events.push({ type: 'setStart', setNo: 1, royale: true });
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
      // フォワードはバックラインより前から
      for (let i = 0; i < R.FORWARDS; i++) m.players.push(newPlayer(id++, team, 'F', i + 1, fx[i] * s, s * (R.BACK_LINE_U - 0.5)));
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
      aimF: 0,                      // 構え (0..1)。人が投げるボタンを押さえている間だけ増える
      hp: 1, inv: 0, kills: 0, hits: 0,   // バトルロイヤル: 体力 (3)・当たった直後の無敵 (秒)・倒した数・当てた数
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

  /** 人の狙いのぶれ (標準偏差 m)。構えが定まるほど小さい。遠いほど大きい */
  function aimSpread(p, tx, tz) {
    const d = Math.min(Math.hypot(tx - p.x, tz - p.z), R.RANGE);
    return R.AIM_SPREAD * (1 - p.aimF) * (0.4 + 0.6 * d / 20);
  }

  /**
   * 構え: 投げるボタンを押さえている間 (input.aiming) だけ定まっていく。
   * 止まっていれば AIM_STEADY 秒、走っていればその倍。構えている間は立つ (隠れていても当たる)。
   * 離せば 0 に戻る。
   */
  function stepAim(m, p, input, dt) {
    if (m.aimMode === 'easy') { p.aimF = 1; return input; }    // かんたん: 構えは要らない (いつも定まっている)
    if (p.peek && p.peek.shot && p.peek.phase !== 'back') return input;   // のぞいている途中で離した: 構えはそのまま、出たら投げる
    if (!input.aiming || p.balls <= 0 || p.cd > 0) { p.aimF = 0; return input; }   // 構え直している間は 0 から
    const moving = Math.hypot(input.mx || 0, input.mz || 0) > 0.05;
    p.aimF = Math.min(1, p.aimF + dt / (R.AIM_STEADY * (moving ? 2 : 1)));
    return input.crouch ? Object.assign({}, input, { crouch: false }) : input;
  }

  function throwBall(m, p, tx, tz, target) {
    if (!canThrow(p) || m.phase !== 'play') return null;
    const human = isHuman(m, p);
    if (human && m.aimMode !== 'easy') {
      const e = aimSpread(p, tx, tz);
      if (e > 0) { tx += gauss(m.rng) * e; tz += gauss(m.rng) * e; }
      p.aimF = 0;
    }
    const L = launch(p.x, p.z, tx, tz);
    const b = {
      id: m.nextBallId++, team: p.team, owner: p.id,
      x: p.x + L.ux * (R.PLAYER_R + 0.05), z: p.z + L.uz * (R.PLAYER_R + 0.05), y: R.THROW_Y,
      vx: L.vx, vy: L.vy, vz: L.vz, age: 0,
      // かんたん: 狙った相手へ曲がっていく (ビクトリースローは除く)
      home: human && m.aimMode === 'easy' && target != null && m.phase === 'play' && !m.vt ? target : null,
      human
    };
    // 必殺ゲージが満タンなら、この 1 球は大玉 (ビクトリースローは除く)
    if (human && !m.vt && m.sp[p.team] >= 1) {
      b.big = true; b.r = R.BIG_R; m.sp[p.team] = 0;
      m.events.push({ type: 'bigThrow', player: p.id, ball: b.id });
    }
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
    // 大玉 (b.r) が大きいのは人への当たりだけ。地面と壁はふつうの玉と同じ (狙いの見積もりとずれないように)
    const br = b.r || R.BALL_R, wr = R.BALL_R;
    if (Math.abs(b.x) > ARENA.hw + 3 || Math.abs(b.z) > ARENA.hl + 4) return { kind: 'out' };
    if (b.y <= wr) return { kind: 'ground' };
    for (let i = 0; i < SHELTERS.length; i++) {
      const s = SHELTERS[i];
      if (b.y <= s.h + wr * 0.5 &&
          Math.abs(b.x - s.x) <= s.w / 2 + wr &&
          Math.abs(b.z - s.z) <= s.d / 2 + wr) return { kind: 'shelter', shelter: i };
    }
    if (players) {
      for (const p of players) {
        if (!p.alive || p.team === b.team) continue;
        const dx = b.x - p.x, dz = b.z - p.z;
        const rr = R.PLAYER_R + br;
        if (dx * dx + dz * dz <= rr * rr && b.y <= playerHeight(p) + br * 0.5) {
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

  /**
   * かんたんの玉: 狙った相手がいま走っている先へ、水平の向きだけを少しずつ曲げる。
   * 水平の速さは変えないので、落ちる時刻 (山なり) は投げたときのまま。
   */
  function homeBall(m, b, dt) {
    const q = m.players[b.home];
    if (!q || !q.alive) { b.home = null; return; }
    const sp = Math.hypot(b.vx, b.vz);
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (sp < 1e-6 || d < 0.3) return;
    const t = d / sp;
    const gx = q.x + q.vx * t - b.x, gz = q.z + q.vz * t - b.z;
    let da = Math.atan2(gx, gz) - Math.atan2(b.vx, b.vz);
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    if (Math.abs(da) > Math.PI / 2) { b.home = null; return; }   // 追い越したら曲げない
    // バトルロイヤルは曲がりを弱くする (チーム戦と同じ強さだと、動かずに投げるだけで 7 割勝てた)
    const turn = (m.mode === 'royale' ? R.ROYALE.HOMING_TURN : R.HOMING_TURN) * dt;
    const a = Math.atan2(b.vx, b.vz) + clamp(da, -turn, turn);
    b.vx = Math.sin(a) * sp; b.vz = Math.cos(a) * sp;
  }

  /** 線分が壁 (箱) を通るか (端も含む) */
  function segBlocked(x0, z0, x1, z1) {
    for (const s of SHELTERS) {
      let t0 = 0, t1 = 1, ok = true;
      for (const [p0, d, lo, hi] of [[x0, x1 - x0, s.x - s.w / 2, s.x + s.w / 2], [z0, z1 - z0, s.z - s.d / 2, s.z + s.d / 2]]) {
        if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) { ok = false; break; } continue; }
        let a = (lo - p0) / d, c = (hi - p0) / d;
        if (a > c) { const t = a; a = c; c = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  /** 大玉が落ちた (人に当たった) 所のまわり SPLASH_R の相手もアウト。間に壁があれば助かる */
  function splash(m, b, direct) {
    m.events.push({ type: 'splash', x: b.x, z: b.z, by: b.owner });
    for (const q of m.players) {
      if (!q.alive || q.team === b.team || q === direct) continue;   // 玉がじかに当たった相手は、もう数えてある
      if (Math.hypot(q.x - b.x, q.z - b.z) > R.SPLASH_R) continue;
      if (segBlocked(b.x, b.z, q.x, q.z)) continue;
      if (m.mode === 'royale') { hurtRoyale(m, q, b, { x: q.x, y: 1, z: q.z, vx: q.x - b.x, vz: q.z - b.z, splash: true }); continue; }
      q.alive = false; q.outAt = m.time;
      m.events.push({ type: 'hit', player: q.id, by: b.owner, x: q.x, y: 1, z: q.z, vx: q.x - b.x, vz: q.z - b.z, big: true, splash: true });
    }
  }

  /**
   * バトルロイヤル: 1 発ではアウトにならない。体力 3 を 1 つ減らし、少しのあいだ無敵 (囲まれて一度に削られないように)。
   * 無敵の間に当たった玉は、受け止めたことにする (玉は消える)。0 になったら脱落
   */
  function hurtRoyale(m, p, b, at) {
    if (p.inv > 0) { m.events.push({ type: 'block', player: p.id, x: at.x, y: at.y, z: at.z }); return false; }
    const owner = m.players[b.owner];
    const dmg = Math.min(p.hp, b.big ? R.ROYALE.BIG_DMG : 1);   // 大玉は 2
    p.hp -= dmg;
    p.inv = R.ROYALE.INV;
    if (owner) owner.hits++;
    if (b.human && !b.big) m.sp[b.team] = Math.min(1, m.sp[b.team] + R.SP_PER_HIT);
    if (p.hp > 0) {
      m.events.push(Object.assign({ type: 'hurt', player: p.id, hp: p.hp, dmg, by: b.owner, big: !!b.big }, at));
      return true;
    }
    p.alive = false;
    p.outAt = m.time;
    m.out.push(p.id);
    p.place = m.players.filter((q) => q.alive).length + 1;
    if (owner) owner.kills++;
    m.events.push(Object.assign({ type: 'hit', player: p.id, by: b.owner, big: !!b.big, royale: true, place: p.place }, at));
    return true;
  }

  function stepBalls(m, dt) {
    const keep = [];
    for (const b of m.balls) {
      if (b.home != null) homeBall(m, b, dt);
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
      if (hit.kind === 'player' && m.mode === 'royale') {
        hurtRoyale(m, hit.player, b, { x: b.x, y: b.y, z: b.z, vx: b.vx, vz: b.vz });
      } else if (hit.kind === 'player') {
        const p = hit.player;
        p.alive = false;
        p.outAt = m.time;
        m.events.push({ type: 'hit', player: p.id, by: b.owner, x: b.x, y: b.y, z: b.z, vx: b.vx, vz: b.vz, big: !!b.big });
        if (b.human && !b.big) m.sp[b.team] = Math.min(1, m.sp[b.team] + R.SP_PER_HIT);
      } else if (hit.kind !== 'out') {
        m.events.push({ type: 'splat', on: hit.kind, x: b.x, y: Math.max(b.y, 0.02), z: b.z, big: !!b.big });
      }
      if (b.big && hit.kind !== 'out' && hit.kind !== 'shelter') splash(m, b, hit.kind === 'player' ? hit.player : null);
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

  /**
   * 選手が立ち入れる範囲。フォワードは自陣のバックラインより後ろへ下がれない。
   * バックスはコート全体 (ただし相手コートに入れるのは全体で 3 人まで。これは反則として別に見る)。
   */
  function limits(p) {
    if (ARENA.mode === 'royale') {
      const h = ARENA.hw - R.PLAYER_R;
      return { xmin: -h, xmax: h, zmin: -h, zmax: h };
    }
    const s = side(p.team);
    let zmin = -R.HALF_L + R.PLAYER_R, zmax = R.HALF_L - R.PLAYER_R;
    if (p.role === 'F') {
      if (s > 0) zmax = R.BACK_LINE_U; else zmin = -R.BACK_LINE_U;
    }
    return { xmin: -R.HALF_W + R.PLAYER_R, xmax: R.HALF_W - R.PLAYER_R, zmin, zmax };
  }

  /**
   * 立ち入れる範囲に収める。決戦で会場が縮むとき、ふちが壁を通り過ぎる間は、
   * 外から押された選手が壁の中へ押し込まれていた (200 試合で 148 コマ、深さ 0.34m = 壁の真ん中)。
   * 収めたあと壁に重なっていたら、会場の内側へ壁の面まで出す
   */
  function keepInside(p) {
    const L = limits(p);
    p.x = clamp(p.x, L.xmin, L.xmax);
    p.z = clamp(p.z, L.zmin, L.zmax);
    if (ARENA.mode !== 'royale' || ARENA.hw >= R.ROYALE.HALF) return;
    const r = R.PLAYER_R;
    for (const s of SHELTERS) {
      const hx = s.w / 2 + r, hz = s.d / 2 + r;
      if (Math.abs(p.x - s.x) >= hx || Math.abs(p.z - s.z) >= hz) continue;
      // 内側 (真ん中の方) の面へ。x と z のうち、動く量が小さく、会場の中に残る方
      const nx = s.x - Math.sign(s.x || p.x || 1) * hx, nz = s.z - Math.sign(s.z || p.z || 1) * hz;
      const okx = nx >= L.xmin && nx <= L.xmax, okz = nz >= L.zmin && nz <= L.zmax;
      if (okx && (!okz || Math.abs(nx - p.x) <= Math.abs(nz - p.z))) p.x = nx;
      else if (okz) p.z = nz;
    }
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
    keepInside(p);
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
      keepInside(p);
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

  /**
   * 目的地へ向かう向き。間にシェルターがあれば、その角を回り込む。
   * 角は「そこまで真っすぐ行ける」ものだけから、遠回りが少ない順に選ぶ
   * (横へずらすだけだと、縦に並んだ 2 つの壁のあいだで行ったり来たりして止まっていた)。
   */
  function steer(p, gx, gz) {
    // 押し出される距離 (PLAYER_R) より少しだけ細く見る。太く見ると、壁ぎわに立った時点で
    // 「箱の中」になって、ふさがっていることに気づけない
    const r = R.PLAYER_R - 0.02;
    // 目的地が 1m 以内なら、まっすぐ向かう (壁に押し返されながら滑って着く)。
    // 壁の角にぴったり寄せた目的地は、まっすぐの線がいつも壁をかすめて、角の回り込みを繰り返していた
    const near = Math.hypot(gx - p.x, gz - p.z) < 1.0;
    const sh = near ? null : blockingShelter(p.x, p.z, gx, gz, r);
    let tx = gx, tz = gz;
    if (sh) {
      const mg = R.PLAYER_R + 0.3;
      const xs = [sh.x - sh.w / 2 - mg, sh.x + sh.w / 2 + mg];
      const zs = [sh.z - sh.d / 2 - mg, sh.z + sh.d / 2 + mg];
      let best = null, bestC = Infinity;
      for (const cx of xs) {
        for (const cz of zs) {
          if (Math.abs(cx) > ARENA.hw - R.PLAYER_R || Math.abs(cz) > ARENA.hl - R.PLAYER_R) continue;
          const d0 = Math.hypot(cx - p.x, cz - p.z);
          const key = cx.toFixed(2) + ',' + cz.toFixed(2);
          // もう着いた角へは戻らない (着いた角から少し離れると、また近い角を選んで行ったり来たりした)
          if (d0 < 0.12) { p._navDone = key; continue; }
          if (p._navDone === key) continue;
          const free = !blockingShelter(p.x, p.z, cx, cz, r);
          const cost = d0 + Math.hypot(gx - cx, gz - cz) + (free ? 0 : 50) +
            (blockingShelter(cx, cz, gx, gz, r) ? 1.5 : 0);
          if (cost < bestC) { bestC = cost; best = { x: cx, z: cz }; }
        }
      }
      if (best) { tx = best.x; tz = best.z; }
    }
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) return { mx: 0, mz: 0, d: Math.hypot(gx - p.x, gz - p.z) };
    const k = sh ? 1 : Math.min(1, d / 0.35);
    return { mx: dx / d * k, mz: dz / d * k, d: Math.hypot(gx - p.x, gz - p.z) };
  }

  function spotTaken(m, p, idx) {
    return m.players.some((q) => q !== p && q.alive && q.team === p.team && q.ai.spot === idx);
  }

  function inEnemyCourt(p) { return p.alive && side(p.team) * p.z < 0; }

  /** 相手コートにいる (または向かっている) 仲間の数 */
  function enemyCourtCount(m, team, except) {
    let n = 0;
    for (const q of m.players) {
      if (q === except || !q.alive || q.team !== team) continue;
      const heading = q.ai && q.ai.goal && side(q.team) * q.ai.goal.z < 0 && !isHuman(m, q);
      if (inEnemyCourt(q) || heading) n++;
    }
    return n;
  }
  /** この選手が相手コートへ入っても 3 人以内か */
  function mayEnter(m, p) { return inEnemyCourt(p) || enemyCourtCount(m, p.team, p) < R.MAX_IN_ENEMY; }

  /** u は「自陣から見た位置」。大きいほど自陣の奥、小さいほど敵陣寄り。 */
  function uOf(p) { return side(p.team) * p.z; }

  function pickSpot(m, p, filter, score) {
    const spots = COVER[p.team];
    let best = -1, bestS = Infinity;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      if (!filter(sp)) continue;
      if (spotTaken(m, p, i)) continue;
      if (p.role === 'B' && sp.u < 0.5) continue;           // AI のバックスは自陣で守る
      if (p.role === 'F' && sp.u > R.BACK_LINE_U) continue;  // フォワードはバックラインより後ろへ行けない
      if (sp.u < 0 && !mayEnter(m, p)) continue;            // 相手コートは 3 人まで
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

  /** 壁 (箱) のふちまでの水平の距離 */
  function boxDist(x, z, s) {
    const dx = Math.max(Math.abs(x - s.x) - s.w / 2, 0), dz = Math.max(Math.abs(z - s.z) - s.d / 2, 0);
    return Math.hypot(dx, dz);
  }

  /**
   * 的に当たる着地点を探す。足もとが壁に隠れていれば、奥を狙って頭越しに落とす。
   * ただし、壁のすぐ裏 (R.SHADOW 以内) にいる相手への頭越しはやめた (届かないことにする)。
   * 壁のすぐ裏の相手を当てるには、相手がのぞいて出てくるのを待つか、横から回り込む。
   */
  function findAim(players, team, x, z, q, ax, az) {
    const dx = ax - x, dz = az - z;
    const d = Math.hypot(dx, dz) || 1;
    const ghost = [{ alive: true, team: q.team, x: ax, z: az, crouch: q.crouch, standT: q.standT }];
    const wall = blockingShelter(x, z, ax, az, 0);
    const shadowed = !!wall && boxDist(ax, az, wall) < R.SHADOW;
    for (const off of [0, 1.5, 3, 3.8, 4.6, 5.5]) {
      if (off > 0 && shadowed) break;
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
      const score = d + (hidden ? 5 : 0) + aim.off * 0.8 +
        (m.mode === 'royale' ? -(R.ROYALE.HP - q.hp) * 4.5 / R.ROYALE.HP + (q.inv > 0.3 ? 6 : 0) : (q.role === 'F' && Math.abs(q.z) < 8 ? -2 : 0));
      if (score < bestScore) { bestScore = score; best = { q, ax: aim.x, az: aim.z, d, mv: Math.hypot(q.vx, q.vz) * t }; }
    }
    if (!best) return null;
    // 走っている的ほど外れやすい (先読みしても、向きを変えられるとずれる)
    const err = lerp(1.7, 0.7, s) * (0.6 + best.d / R.RANGE) + best.mv * lerp(0.45, 0.25, s);
    const ex = gauss(m.rng) * err, ez = gauss(m.rng) * err;
    return { x: best.ax + ex, z: best.az + ez, target: best.q.id, ex, ez };
  }

  /**
   * 人が投げるときの狙いの補助。
   * dir (向き {x,z}) を渡すと、その向きにいちばん近い相手を選ぶ。null なら前方のいちばん狙いやすい相手。
   * 選んだ相手の動きを先読みし、足もとが壁に隠れていれば奥へ落として頭越しに当てる。
   * @returns {null | {x, z, target, clear}}  clear: 壁に止められずに届く見込み
   */
  function pickTarget(m, p, dir) {
    let best = null, bestS = Infinity;
    const fx = dir ? dir.x : 0, fz = dir ? dir.z : -side(p.team);
    const fl = Math.hypot(fx, fz) || 1;
    for (const q of m.players) {
      if (!q.alive || q.team === p.team) continue;
      const dx = q.x - p.x, dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > R.RANGE + 1 || d < 0.5) continue;
      const cos = (dx * fx + dz * fz) / (d * fl);
      if (dir && cos < Math.cos(40 * Math.PI / 180)) continue;   // はじいた向きから 40° 以内
      const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
      const hidden = q.crouch && q.standT <= 0;
      // バトルロイヤルは前も後ろも敵なので、向きでは選ばない (近い順)
      const score = dir ? ang * 8 + d * 0.15 : d + (m.mode === 'royale' ? 0 : (cos < 0 ? 12 : 0)) + (hidden ? 4 : 0);
      if (score < bestS) { bestS = score; best = q; }
    }
    return best;
  }

  function assistAim(m, p, dir, target) {
    const q = target || pickTarget(m, p, dir);
    if (!q) return null;
    const t = launch(p.x, p.z, q.x, q.z).t;
    const ax = q.x + q.vx * t, az = q.z + q.vz * t;      // 今の動きのまま進んだ所
    const aim = findAim(m.players, p.team, p.x, p.z, q, ax, az);
    if (aim) return { x: aim.x, z: aim.z, target: q.id, clear: true };
    return { x: ax, z: az, target: q.id, clear: false };
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

  function aiInputRaw(m, p, dt) {
    const ai = p.ai;
    const s = skillOf(m, p);
    const input = { mx: 0, mz: 0, crouch: false, throwAt: null };

    // むずかしい: 人に長く狙われたら、壁の陰にしゃがむ (1 回しゃがんだら、しばらくは気にしない = フェイントの狙いどき)
    ai.calmT = Math.max(0, (ai.calmT || 0) - dt);
    if (ai.duckT > 0) {
      ai.duckT -= dt;
      if (ai.duckT <= 0) ai.calmT = R.DUCK_CALM;
      input.crouch = true;
      return input;
    }
    const ha = m.humanAim;
    if (ha && ha.target === p.id && ha.f >= R.DUCK_AT && ai.calmT <= 0 && !p.peek && !ai.rush) {
      if (!ai.duckRolled) { ai.duckRolled = true; if (m.rng() < lerp(0.35, 0.8, s)) { ai.duckT = R.DUCK_TIME; m.events.push({ type: 'duck', player: p.id }); input.crouch = true; return input; } }
    } else if (!ha || ha.target !== p.id) ai.duckRolled = false;

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
        if (Math.abs(p.x + px * 1.2) > ARENA.hw - 0.4 || Math.abs(p.z + pz * 1.2) > ARENA.hl - 0.4) { px = -px; pz = -pz; }
        ai.dodgeT = 0.42; ai.dx = px; ai.dz = pz;
        input.mx = px; input.mz = pz;
        return input;
      }
    }

    ai.think -= dt;
    ai.holdT -= dt;
    if (ai.think <= 0) {
      ai.think = lerp(0.55, 0.25, s) * (0.7 + m.rng() * 0.6);
      if (m.mode === 'royale') decideRoyale(m, p); else aiDecide(m, p);
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
    return input;
  }

  /**
   * AI の入力に、相手コートの人数の決まりをかぶせる。
   * センターラインをまたぐ直前に数え直す (よけた拍子や、人が操作する仲間が先に入ったとき)。
   */
  function aiInput(m, p, dt) {
    const input = aiInputRaw(m, p, dt);
    if (m.mode === 'royale') return input;      // 敵陣の人数の決まりは無い
    const S = side(p.team);
    if (!inEnemyCourt(p) && input.mz * S < 0 && S * p.z < 0.6 && enemyCourtCount(m, p.team, p) >= R.MAX_IN_ENEMY) {
      input.mz = 0;
      p.ai.dz = 0;
      const ai = p.ai;
      if (ai.goal && S * ai.goal.z < 0) { ai.goal = null; ai.spot = -1; ai.rush = false; }
    }
    return input;
  }

  // ------------------------------------------------------------ バトルロイヤルの AI と決着
  /** 隠れる場所: どの壁にも 4 つ (前後と左右)。会場が変わったら作り直す */
  let royaleSpotsCache = null;
  function royaleSpots() {
    if (royaleSpotsCache) return royaleSpotsCache;
    const g = R.PLAYER_R + 0.12, L = [];
    SHELTERS.forEach((s, i) => {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = s.x + dx * (s.w / 2 + g), z = s.z + dz * (s.d / 2 + g);
        if (Math.abs(x) > ARENA.hw - 0.5 || Math.abs(z) > ARENA.hl - 0.5) continue;
        L.push({ x, z, sh: i, nx: dx, nz: dz });
      }
    });
    royaleSpotsCache = L;
    return L;
  }

  /**
   * 行き先を選ぶ。壁の陰で、近い敵から隠れられる所。
   * 雪玉が無い・体力 1 のときは、敵から遠い所へ (逃げる)。それ以外は、敵から 8m ほどの所 (撃ち合える距離)。
   * 着いたらしばらくそこで粘り (しゃがんで丸め、出ては投げる)、敵がすぐそばへ来たら選び直す
   */
  function decideRoyale(m, p) {
    const ai = p.ai, s = skillOf(m, p);
    const enemies = enemiesOf(m, p);
    if (!enemies.length) return;
    const dist = (x, z, q) => Math.hypot(q.x - x, q.z - z);
    const nearest = (x, z) => enemies.reduce((a, q) => (dist(x, z, q) < dist(x, z, a) ? q : a), enemies[0]);
    const nq = nearest(p.x, p.z);
    const danger = dist(p.x, p.z, nq) < 3;
    const inZone = (x, z) => Math.abs(x) < ARENA.hw - 0.6 && Math.abs(z) < ARENA.hl - 0.6;
    if (ai.goal && !inZone(ai.goal.x, ai.goal.z)) ai.goal = null;     // 決戦で会場が縮んだ: 外になった行き先は選び直す
    if (ai.goal) {
      const there = Math.hypot(ai.goal.x - p.x, ai.goal.z - p.z) < 0.35;
      if (there && !ai.arrived) { ai.arrived = true; ai.holdT = (lerp(4, 2, s) + m.rng() * 2.5) * (m.final ? 0.5 : 1); }
      if (!danger && (!there || ai.holdT > 0)) return;
    }
    const scared = !m.final && (p.balls === 0 || p.hp <= 1);    // 一騎打ちでは逃げない
    let best = null, bestS = Infinity;
    for (const sp of royaleSpots()) {
      if (!inZone(sp.x, sp.z)) continue;
      const travel = Math.hypot(sp.x - p.x, sp.z - p.z);
      if (travel > 16) continue;
      const e = nearest(sp.x, sp.z);
      const de = dist(sp.x, sp.z, e);
      // 壁が、その場所と近くの敵のあいだにあるか (壁から見て、敵が反対側)
      let covered = 0, crowd = 0;
      for (const q of enemies) {
        const dq = dist(sp.x, sp.z, q);
        if (dq < 4) crowd++;
        if (dq < 15 && ((q.x - sp.x) * sp.nx + (q.z - sp.z) * sp.nz) < 0) covered++;
      }
      const taken = m.players.some((o) => o !== p && o.alive && Math.hypot(o.x - sp.x, o.z - sp.z) < 0.8);
      // 一騎打ちでは、撃ち合う距離を詰める (6m)。粘る時間も短くする (下の holdT)
      const want = m.final ? 6 : 8;
      const score = travel * 0.45 + (scared ? -Math.min(de, 16) * 0.7 : Math.abs(de - want) * 0.6) -
        covered * 1.6 + crowd * 3 + (taken ? 6 : 0) + m.rng() * 1.5;
      if (score < bestS) { bestS = score; best = sp; }
    }
    if (!best) return;
    ai.goal = { x: best.x, z: best.z };
    ai.arrived = false;
    ai.spot = -1;
    ai.rush = false;
  }

  /** 残り 1 人か時間切れで決着。順位: 残っている人 (体力・倒した数の順) → あとで脱落した人ほど上 */
  function checkRoyaleEnd(m) {
    const alive = m.players.filter((p) => p.alive);
    // 残り 2 人で決戦 (FINAL BATTLE): 会場が縮み、時間は少なくとも 30 秒残す
    if (alive.length === 2 && m.time > 0 && !m.final) {
      m.final = { t: 0, ids: alive.map((p) => p.id) };
      m.time = Math.max(m.time, R.ROYALE.FINAL_TIME);
      shrinkTo(m, R.ROYALE.FINAL_HALF);
      m.events.push({ type: 'final', ids: m.final.ids.slice() });
    }
    if (alive.length > 1 && m.time > 0) return;
    m.time = Math.max(0, m.time);
    // 体力 → 倒した数 → 当てた数。それも同じなら、くじ (前は番号の若い順で、人 (0 番) がいつも上になっていた)
    const lot = m.players.map(() => m.rng());
    alive.sort((a, b) => b.hp - a.hp || b.kills - a.kills || b.hits - a.hits || lot[a.id] - lot[b.id]);
    const ranking = alive.map((p) => p.id).concat(m.out.slice().reverse());
    ranking.forEach((id, i) => { m.players[id].place = i + 1; });
    m.ranking = ranking;
    m.winner = ranking[0];
    m.decidedBy = alive.length <= 1 ? 'last' : 'time';
    m.phase = 'setOver';
    m.phaseTime = R.SET_OVER;
    m.balls = [];
    m.events.push({ type: 'royaleEnd', ranking, winner: m.winner, by: m.decidedBy });
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
      if (mayEnter(m, p) && (defenders === 0 || (defenders <= 1 && dFlag < 10 && p.balls > 0) || (late && dFlag < 16))) {
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

    // バックスはフラッグの守り。相手が近く (センターの向こう 6m より手前) にいるうちはシャトーのあたりから離れない
    const guard = enemies.some((q) => side(p.team) * q.z > -6);
    const minU = p.role === 'B' ? (guard ? 12 : 0.5) : -R.HALF_L;
    const inRange = (x, z) => enemies.some((q) => Math.hypot(q.x - x, q.z - z) < R.RANGE - 2);
    const idle = !inRange(p.x, p.z);

    if (at && p.role === 'B' && at.u < minU) { ai.spot = -1; ai.goal = null; }   // 守りに戻る
    if (ai.spot < 0) {
      // まず近くのかくれ場所へ (前寄り)
      const i = pickSpot(m, p, (sp) => sp.u >= minU && sp.u <= myU + 2,
        (sp) => Math.hypot(sp.x - p.x, sp.z - p.z));
      if (i >= 0) { setSpot(ai, spots, i); return; }
      if (idle) ai.goal = { x: p.x, z: side(p.team) * Math.max(minU, myU - 4, mayEnter(m, p) ? -99 : 0.6) };
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
      ai.goal = { x: p.x, z: side(p.team) * Math.max(minU, myU - 4, mayEnter(m, p) ? -99 : 0.6) };
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
    // 相手コートに 4 人目が入ったチームは、そのセット負け
    for (const team of [0, 1]) {
      let n = 0;
      for (const p of m.players) if (p.team === team && inEnemyCourt(p)) n++;
      if (n > R.MAX_IN_ENEMY) return endSet(m, 1 - team, 'over');
    }
    // フラッグ: 相手のフラッグを抜いた (だれでもよい)
    for (const p of m.players) {
      if (!p.alive) continue;
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

  /**
   * セットのポイント。1 人 = 1 ポイント。
   * 全員アウト・フラッグ・(相手の 4 人目の反則) で勝ったチームは 10 ポイント、負けたチームは残っている人数。
   * 時間切れは、どちらもコート内の人数。
   */
  function setPoints(winner, reason, alive) {
    if (reason === 'time' || winner < 0) return alive.slice();
    const pts = alive.slice();
    pts[winner] = R.WIN_POINTS;
    return pts;
  }

  function endSet(m, winner, reason, by) {
    const alive = [aliveCount(m, 0), aliveCount(m, 1)];
    const points = setPoints(winner, reason, alive);
    m.setResults.push({ winner, reason, alive, points });
    m.points[0] += points[0]; m.points[1] += points[1];
    if (winner >= 0) m.setWins[winner]++;
    m.phase = 'setOver';
    m.phaseTime = R.SET_OVER;
    m.balls = [];
    m.events.push({ type: 'setEnd', winner, reason, by: by == null ? null : by, setNo: m.setNo, points });
    // 2 セット先取、または 3 セット終わったら試合終了。
    // セット数が同じならポイントの合計、それも同じならビクトリースロー
    const need = Math.floor(R.SETS / 2) + 1;
    if (m.setWins[0] >= need || m.setWins[1] >= need || m.setNo >= R.SETS) {
      if (m.setWins[0] !== m.setWins[1]) { m.winner = m.setWins[0] > m.setWins[1] ? 0 : 1; m.decidedBy = 'sets'; }
      else if (m.points[0] !== m.points[1]) { m.winner = m.points[0] > m.points[1] ? 0 : 1; m.decidedBy = 'points'; }
      else m.goVT = true;
    }
    return true;
  }

  // ------------------------------------------------------------ ビクトリースロー
  /**
   * セット数もポイントも同じとき。各チーム 1 人ずつ、相手のフラッグへ交互に 1 球ずつ投げる。
   * 当てた数で差がついた回で決まる (サドンデス)。
   */
  function startVT(m) {
    m.phase = 'vt';
    m.balls = [];
    const thrower = (team) => {
      const base = team === 0 && m.humanBase != null ? m.players[m.humanBase] : m.players.find((p) => p.team === team && p.role === 'F');
      const f = flagPos(1 - team);
      base.alive = true; base.crouch = false; base.standT = 0; base.cd = 0;
      base.x = 0; base.z = f.z + side(1 - team) * -R.VT_DIST;
      base.face = team === 0 ? Math.PI : 0;
      base.balls = 1;
      return base.id;
    };
    for (const p of m.players) p.alive = false;
    const ids = [thrower(0), thrower(1)];
    if (m.human != null) m.human = ids[0];
    m.vt = { round: 1, turn: 0, hits: [[], []], ids, wait: 1.2, flying: false };
    m.events.push({ type: 'vtStart' });
  }

  /** フラッグ (ポールと旗) を的にした当たり判定 */
  function hitsFlag(b, team) {
    const f = flagPos(team);
    return Math.hypot(b.x - f.x, b.z - f.z) <= 0.45 + R.BALL_R && b.y <= 2.25;
  }

  function stepVT(m, dt, input) {
    const vt = m.vt;
    const team = vt.turn;
    const p = m.players[vt.ids[team]];
    if (!vt.flying) {
      vt.wait -= dt;
      p.cd = Math.max(0, p.cd - dt);
      let at = null;
      if (isHuman(m, p)) { if (input && input.throwAt && vt.wait <= 0) at = input.throwAt; }
      else if (vt.wait <= 0) {
        // AI: フラッグに当たる着地点を探して、腕前ぶんぶれる
        const f = flagPos(1 - team);
        const aim = findAim([], team, p.x, p.z, { team: 1 - team, crouch: false, standT: 0 }, f.x, f.z) || { x: f.x, z: f.z + side(1 - team) * -0.0 };
        const err = lerp(1.1, 0.35, m.skill[team]);
        at = { x: aim.x + gauss(m.rng) * err, z: aim.z + gauss(m.rng) * err * 1.4 };
      }
      if (at) {
        p.balls = 1; p.cd = 0; p.aimF = 1;   // ビクトリースローは補助もぶれも無し (腕試し)
        m.phase = 'play';             // throwBall は play 中だけ受け付ける
        const b = throwBall(m, p, at.x, at.z);
        m.phase = 'vt';
        if (b) vt.flying = true;
      }
      return;
    }
    // 飛んでいる球
    const b = m.balls[0];
    let res = null;
    if (!b) res = 'miss';
    else {
      const n = Math.max(1, Math.ceil(Math.hypot(b.vx, b.vy, b.vz) * dt / 0.07));
      const h = dt / n;
      for (let k = 0; k < n && !res; k++) {
        b.x += b.vx * h; b.z += b.vz * h; b.y += b.vy * h - 0.5 * R.G * h * h; b.vy -= R.G * h;
        if (hitsFlag(b, 1 - team)) res = 'hit';
        else {
          const c = ballCollide(b, null);
          if (c) { res = 'miss'; if (c.kind !== 'out') m.events.push({ type: 'splat', on: c.kind, x: b.x, y: Math.max(b.y, 0.02), z: b.z }); }
        }
      }
    }
    if (!res) return;
    m.balls = [];
    vt.flying = false;
    vt.hits[team].push(res === 'hit');
    m.events.push({ type: 'vtThrow', team, hit: res === 'hit', round: vt.round, x: b ? b.x : 0, y: b ? b.y : 0, z: b ? b.z : 0 });
    if (team === 0) { vt.turn = 1; vt.wait = 1.0; return; }
    // 1 回ずつ投げ終わった
    const a = vt.hits[0][vt.round - 1], c = vt.hits[1][vt.round - 1];
    if (a !== c) { finishVT(m, a ? 0 : 1); return; }
    if (vt.round >= 10) { finishVT(m, m.rng() < 0.5 ? 0 : 1); return; } // 念のための打ち切り
    vt.round++; vt.turn = 0; vt.wait = 1.2;
    m.events.push({ type: 'vtRound', round: vt.round });
  }

  /** ビクトリースローで、(x,z) から (tx,tz) へ投げた球が相手のフラッグに当たるか (照準の色に使う) */
  function predictVT(team, x, z, tx, tz) {
    const L = launch(x, z, tx, tz);
    const b = { x: x + L.ux * (R.PLAYER_R + 0.05), z: z + L.uz * (R.PLAYER_R + 0.05), y: R.THROW_Y, vx: L.vx, vy: L.vy, vz: L.vz, team };
    const dt = 0.005;
    for (let i = 0; i < 600; i++) {
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt - 0.5 * R.G * dt * dt; b.vy -= R.G * dt;
      if (hitsFlag(b, 1 - team)) return true;
      if (ballCollide(b, null)) return false;
    }
    return false;
  }

  function finishVT(m, winner) {
    m.winner = winner;
    m.decidedBy = 'vt';
    m.phase = 'setOver';
    m.phaseTime = R.SET_OVER;
    m.events.push({ type: 'vtEnd', winner });
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

  // ------------------------------------------------------------ のぞき投げ
  /**
   * 壁のすぐ裏にいて、投げる向きを自分の壁がふさいでいれば、その壁を返す。
   * (壁の上を越えて投げるのではなく、横へ出て投げる)
   */
  function coverWall(p, tx, tz) {
    const dx = tx - p.x, dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) return null;
    const reach = R.PLAYER_R + R.PEEK_NEAR;
    const s = blockingShelter(p.x, p.z, p.x + dx / d * reach, p.z + dz / d * reach, 0);
    return s;
  }

  /**
   * 壁の端から出た所。そこから狙う所までが、どの壁にもふさがれない端を選ぶ (両方よければ近い方)。
   * どちらからも届かなければ null (のぞいても投げられない)。
   */
  function peekSpot(p, s, tx, tz) {
    // 壁の長い方の端から出る (バトルロイヤルには、縦に長い壁もある)
    if (s.d > s.w) {
      const half = s.d / 2 + R.PLAYER_R + R.PEEK_OUT;
      const ends = [s.z - half, s.z + half]
        .filter((z) => Math.abs(z) <= ARENA.hl - R.PLAYER_R)
        .sort((a, b) => Math.abs(a - p.z) - Math.abs(b - p.z));
      for (const z of ends) if (!coverWall({ x: p.x, z }, tx, tz)) return { x: p.x, z };
      return null;
    }
    const half = s.w / 2 + R.PLAYER_R + R.PEEK_OUT;
    const ends = [s.x - half, s.x + half]
      .filter((x) => Math.abs(x) <= ARENA.hw - R.PLAYER_R)
      .sort((a, b) => Math.abs(a - p.x) - Math.abs(b - p.x));
    for (const x of ends) if (!coverWall({ x, z: p.z }, tx, tz)) return { x, z: p.z };
    return null;
  }

  /** のぞき投げを始める。出られる端が無ければ false */
  function startPeek(m, p, shot) {
    const t = shot || (m.mode === 'royale' ? { x: p.x + Math.sin(p.face) * 10, z: p.z + Math.cos(p.face) * 10 } : { x: p.x, z: p.z - side(p.team) * 10 });
    const s = coverWall(p, t.x, t.z);
    if (!s) return false;
    const sp = peekSpot(p, s, t.x, t.z);
    if (!sp) { p.peek = null; return true; }     // ふさがれていて、どちらの端からも届かない: 投げない
    p.peek = { phase: 'out', sx: sp.x, sz: sp.z, hx: p.x, hz: p.z, shot: shot || null, t: 0 };
    m.events.push({ type: 'peek', player: p.id });
    return true;
  }

  /** のぞいた先で、狙い直す (相手を選んでいたなら、出た所から先読みし直す) */
  function reaim(m, p, shot) {
    const q = shot.target != null ? m.players[shot.target] : null;
    if (!q || !q.alive) return shot;
    const a = assistAim(m, p, null, q);
    if (!a) return shot;
    return { x: a.x + (shot.ex || 0), z: a.z + (shot.ez || 0), target: shot.target };
  }

  /**
   * のぞき投げを進める。input を書き換えて返す。
   *   out  : 壁の端へ出る (立っている。当たる)
   *   ready: 出た。投げる (むずかしいの人は、離すまで構えたまま待つ)
   *   back : 投げたあと、立っている時間 (STAND_AFTER_THROW) が過ぎたら元の所へ戻る
   * 人が移動を入れたら、そこでやめる。
   */
  function stepPeek(m, p, inp, dt) {
    const human = isHuman(m, p);
    let pk = p.peek;
    if (pk && human && Math.hypot(inp.mx || 0, inp.mz || 0) > 0.05) { p.peek = null; return inp; }
    if (!pk) {
      const wantThrow = inp.throwAt && canThrow(p);
      const wantAim = human && inp.aiming && p.balls > 0 && p.cd <= 0;
      if (!wantThrow && !wantAim) return inp;
      if (!startPeek(m, p, inp.throwAt)) return inp;
      if (!p.peek) return Object.assign({}, inp, { throwAt: null });
      pk = p.peek;
    }
    const out = { mx: 0, mz: 0, crouch: false, aiming: inp.aiming, throwAt: null };
    pk.t += dt;
    if (inp.throwAt && pk.phase !== 'back') pk.shot = inp.throwAt;     // むずかしい: 出ている途中で離した
    const go = (gx, gz) => {
      const dx = gx - p.x, dz = gz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.08) return true;
      const k = Math.min(1, d / (R.SPEED * dt)) / d;     // 行き過ぎない
      out.mx = dx * k; out.mz = dz * k;
      return false;
    };
    if (pk.phase === 'out' && (go(pk.sx, pk.sz) || pk.t > 1.2)) pk.phase = 'ready';
    if (pk.phase === 'ready') {
      if (pk.shot && canThrow(p)) {
        const shot = reaim(m, p, pk.shot);
        if (!coverWall(p, shot.x, shot.z)) out.throwAt = shot;   // 出た所からもふさがれていたら投げない (相手が動いた)
        pk.dir = Math.atan2(shot.x - p.x, shot.z - p.z);
        pk.phase = 'back'; pk.t = 0;
      } else if (!(human && inp.aiming && p.balls > 0) || pk.t > R.PEEK_MAX || (pk.shot && !canThrow(p))) {
        pk.phase = 'back'; pk.t = 0;
      }
    } else if (pk.phase === 'back' && p.standT <= 0 && !out.throwAt) {
      if (go(pk.hx, pk.hz) || pk.t > 2) {
        // 戻ったら相手の方を向く (戻る向きのままだと後ろを向いて見える)。
        // バトルロイヤルは敵が四方にいるので、投げた向きへ (前は「あお以外は全員 +z」を向いていた)
        if (m.mode === 'royale') { if (pk.dir != null) p.face = pk.dir; }
        else p.face = p.team === 0 ? Math.PI : 0;
        p.peek = null;
      }
    }
    return out;
  }

  // ------------------------------------------------------------ 1 コマ進める
  /**
   * @param {object} m 試合
   * @param {number} dt 秒
   * @param {object} [input] 操作している選手への入力 { mx, mz, crouch, throwAt:{x,z}|null }
   */
  function step(m, dt, input) {
    if (!(dt > 0)) return m;
    useArena(m);
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
        if (m.winner != null) { m.phase = 'matchOver'; m.events.push({ type: 'matchEnd', winner: m.winner, by: m.decidedBy }); }
        else if (m.goVT) { m.goVT = false; startVT(m); }
        else startSet(m);
      }
      return m;
    }
    if (m.phase === 'vt') { stepVT(m, dt, input); return m; }
    if (m.phase !== 'play') return m;

    m.time -= dt;

    for (const p of m.players) {
      if (!p.alive) continue;
      p.cd = Math.max(0, p.cd - dt);
      p.standT = Math.max(0, p.standT - dt);
      if (p.inv > 0) p.inv = Math.max(0, p.inv - dt);
      let inp = isHuman(m, p) ? (input || {}) : aiInput(m, p, dt);
      if (isHuman(m, p)) {
        m.humanAim = (inp.aiming && inp.aimTarget != null && m.aimMode !== 'easy') ? { target: inp.aimTarget, f: p.aimF } : null;
        const thr = inp.throwAt;     // 離した瞬間に投げる: そのコマまでの構えで決まる
        inp = stepAim(m, p, thr ? Object.assign({}, inp, { aiming: true }) : inp, thr ? 0 : dt);
      }
      inp = stepPeek(m, p, inp, dt);
      movePlayer(p, inp, dt);
      if (inp.throwAt) {
        // 動いた拍子に壁のすぐ裏へ入っていたら、投げずにのぞき投げに切り替える
        if (p.peek || !startPeek(m, p, inp.throwAt)) throwBall(m, p, inp.throwAt.x, inp.throwAt.z, inp.throwAt.target);
      }
      makeBalls(m, p, dt);
    }
    separate(m.players);
    stepBalls(m, dt);
    if (m.mode === 'royale') { if (m.final) m.final.t += dt; stepZone(m, dt); checkRoyaleEnd(m); }
    else { handOver(m); checkSetEnd(m); }
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
    aiInput, threatOf, inEnemyCourt, enemyCourtCount, setPoints, startVT, hitsFlag, predictVT, pickTarget, assistAim, aimSpread, coverWall, useArena, ARENA
  };
});
