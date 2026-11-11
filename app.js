/*!
 * app.js — 画面まわり。three.js で描き、指の操作を Core へ渡す。
 */
(function () {
  'use strict';

  const C = window.Core;
  const R = C.R;
  const T = window.THREE;
  const VERSION = 'v23';
  const AI_SKILL = 0.5;      // 相手の強さ (前の「ふつう」)。強さのえらびはやめ、投げ方をえらぶ
  const AUTO_CROUCH = 0.2;
  const CANCEL = { out: 40, back: 18 };   // 投げるボタン: 40px 以上引っぱってから 18px 以内へ戻して離すと取り消し   // 止まってからしゃがむまで (秒)
  // カメラ: 自分の (h) 上・(back) 後ろから、(ahead) 先の地面を見る
  // ahead は 5 → 7: 5 だとスタート地点から相手のシェルター・バックラインが上の帯の下に隠れ、
  // 狙っている相手が見えなかった (自分は画面の 68% → 75% の高さへ下がる)
  // カメラ: 低め (8m 上・8m 後ろ、見下ろし約 24°)。臨場感を出すため 21m 上の見下ろしから下げた
  const CAM = { h: 8, back: 8, ahead: 7, fov: 58 };   // 自分は画面の 71% の高さ。届くいちばん遠い相手 (22m) とフラッグは帯の下に見える
  // 構えている間は、狙う相手の方へ寄る (自分の 5m 後ろ・4m 上から、自分と相手のあいだを見る)
  const AIM_CAM = { back: 5, up: 4, look: 0.55, rate: 8, holdMs: 150 };
  // 自分が当てた瞬間は、当てた相手へ寄る (0.75 秒。寄る量はいちばん寄って 65%)
  const HIT_CAM = { time: 0.75, dist: 6, up: 3.5, amount: 0.65, royale: 0.35 };

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('view'), game: $('game'),
    setsBlue: $('setsBlue'), setsRed: $('setsRed'), aliveBlue: $('aliveBlue'), aliveRed: $('aliveRed'),
    setNo: $('setNo'), time: $('time'), stockBlue: $('stockBlue'), stockRed: $('stockRed'),
    ptsBlue: $('ptsBlue'), ptsRed: $('ptsRed'), inEnemy: $('inEnemy'), warn: $('warn'),
    stickZone: $('stickZone'), stick: $('stick'), knob: $('knob'), moveHint: $('moveHint'),
    resultScore: $('resultScore'), confetti: $('confetti'), snow: document.querySelector('#vTitle .snow'),
    makeRing: $('makeRing'), throwPad: $('throwPad'), myBalls: $('myBalls'), pops: $('pops'), spGauge: $('spGauge'), padLabel: $('padLabel'),
    markLock: $('markLock'), markFlag: $('markFlag'), markFlagText: $('markFlagText'), score: document.querySelector('.score'),
    banner: $('banner'),
    vTitle: $('vTitle'), vPause: $('vPause'), vResult: $('vResult'),
    btnStart: $('btnStart'), btnPause: $('btnPause'), btnResume: $('btnResume'), btnQuit: $('btnQuit'),
    btnAgain: $('btnAgain'), btnToTitle: $('btnToTitle'), resultTitle: $('resultTitle'), resultSets: $('resultSets'),
    ver: $('ver'), tagLine: $('tagLine'),
    rAlive: $('rAlive'), rDots: $('rDots'), rTime: $('rTime'), rHp: $('rHp'), rKills: $('rKills'), rLabel: $('rLabel'), focus: $('focus')
  };

  // 0 あお・1 あか はチーム戦と同じ。2〜7 はバトルロイヤルの色 (絵は、あおの青い所を塗り替えて作る)
  const COLORS = {
    team: [0x2f6fe0, 0xe0413a, 0x3fae5a, 0xf2c230, 0x9b5fe0, 0xff7fb5, 0xff8a2a, 0x4fc3e8],
    teamDark: [0x1d4fb0, 0xa8251f, 0x23783a, 0xb88a10, 0x6a35b0, 0xc84f88, 0xc45a10, 0x2a8fb8],
    snow: 0xf4f8fd,
    court: 0xeaf3fc,
    shelter: [0x7fb4ef, 0xf09a92, 0xe8eef6]
  };

  const NAMES = ['あお', 'あか', 'みどり', 'きいろ', 'むらさき', 'もも', 'だいだい', 'みずいろ'];
  const RECOLOR = { 2: { h: 128 }, 3: { h: 46, v: 1.12 }, 4: { h: 276 }, 5: { h: 330, s: 0.62, v: 1.15 }, 6: { h: 24 }, 7: { h: 190, s: 0.75, v: 1.1 } };
  // バトルロイヤル: いちばん初めの高いカメラ (21m 上・10m 後ろ・5m 先、画角 52°)。前後左右に敵がいるので、低いカメラでは死角から当てられた。
// 決戦 (残り 2 人) では FINAL 倍まで寄る
const ROYALE_CAM = { h: 21, back: 10, ahead: 5, fov: 52, final: 0.72 };
  const teamHex = (t) => '#' + COLORS.team[t].toString(16).padStart(6, '0');

  // ------------------------------------------------------------ 状態
  const app = {
    match: null,
    aimMode: 'easy',
    gameMode: 'team',    // あそび方: 'team' = チーム戦 7対7 / 'royale' = バトルロイヤル (8 人・全員が敵)     // 投げ方: 'easy' = 押したらすぐ・玉が曲がる / 'hard' = 押さえて構え、離して投げる
    paused: false,
    running: false,
    acc: 0,
    last: 0,
    input: { mx: 0, mz: 0, crouch: false, throwAt: null },
    aim: null,           // { id, sx, sy, dx, dy, tx, tz }
    stickTouch: null,    // { id, ox, oy }
    idleT: 0,            // 移動の入力が無い時間 (AUTO_CROUCH 秒でしゃがむ)
    slowT: 0,            // ヒットストップの残り
    combo: { n: 0, t: 0 },
    shake: 0,
    hitShake: 0,
    frames: 0,
    hud: {},
    bannerT: 0
  };

  // ------------------------------------------------------------ three.js の場
  const renderer = new T.WebGLRenderer({ canvas: els.canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0xcfe3f5);
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xcfe3f5, 30, 70);
  const camera = new T.PerspectiveCamera(CAM.fov, 1, 0.5, 120);
  const camPos = new T.Vector3(0, 16, 30);
  const camLook = new T.Vector3(0, 0, 10);

  scene.add(new T.HemisphereLight(0xf2f8ff, 0x9fb4cc, 1.6));
  const sun = new T.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-6, 14, 8);
  scene.add(sun);

  const lambert = (c, extra) => new T.MeshLambertMaterial(Object.assign({ color: c }, extra || {}));

  // ------------------------------------------------------------ 地面と壁の絵 (tex_*.jpg)
  // art/make_court.py が作る。読めるまで (読めなかったら) は今までの色のまま
  const texLoader = new T.TextureLoader();
  app.tex = { loaded: 0, failed: 0, names: [] };
  // 絵は 1 回だけ読んで使い回す。会場を作り直すたびに読み直すと、前の絵が GPU に残り続けた
  // (バトルロイヤル ⇔ タイトルを 6 往復で 11 → 86 枚。1 往復で 8MB ほど)
  const texCache = new Map();
  function applyTex(mat, name, repeat, glow) {
    const url = (window.ASSETS && window.ASSETS[name]) || './' + name;
    const key = name + '|' + (repeat ? repeat.join(',') : '');
    const use = (t) => {
      mat.map = t;
      mat.color.setHex(0xffffff);
      if (glow) { mat.emissiveMap = t; mat.emissive.setScalar(glow); }
      mat.needsUpdate = true;
    };
    const hit = texCache.get(key);
    if (hit) { if (hit.tex) use(hit.tex); else hit.wait.push(use); return mat; }
    const entry = { tex: null, wait: [use] };
    texCache.set(key, entry);
    texLoader.load(url, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
      entry.tex = t;
      for (const f of entry.wait) f(t);
      entry.wait = [];
      app.tex.loaded++; app.tex.names.push(name);
    }, undefined, () => { app.tex.failed++; texCache.delete(key); });
    return mat;
  }
  // 決戦の柵 (4 本の細い箱。毎コマ、縮んだ会場の大きさに合わせる)
  const zoneMat = new T.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.6, depthWrite: false });
  const zone = new T.Group();
  for (let i = 0; i < 4; i++) {
    const g = i < 2 ? new T.BoxGeometry(1, 0.6, 0.12) : new T.BoxGeometry(0.12, 0.6, 1);
    zone.add(new T.Mesh(g, zoneMat));
  }
  // 柵の外の地面を赤く沈める (入れない所が分かるように)。4 枚の板: 北・南・西・東
  const outMat = new T.MeshBasicMaterial({ color: 0xc02818, transparent: true, opacity: 0.22, depthWrite: false });
  const outside = [];
  for (let i = 0; i < 4; i++) {
    const pl = new T.Mesh(new T.PlaneGeometry(1, 1), outMat);
    pl.rotation.x = -Math.PI / 2; pl.renderOrder = 1;
    zone.add(pl); outside.push(pl);
  }
  zone.visible = false;
  scene.add(zone);

  // 会場 (地面・線・壁・景色) は、モードが変わったら作り直す。作った物は全部 fieldRoot の下にまとめる
  const fieldRoot = new T.Group();
  function ensureField(mode) {
    if (app.fieldMode === mode) return;
    app.fieldMode = mode;
    for (const c of fieldRoot.children.slice()) {
      fieldRoot.remove(c);
      // 使い回している形 (影の板) は捨てない。材質は捨てる (絵は texCache が持ち続ける)
      c.traverse((o) => {
        if (o.geometry && o.geometry !== blobGeo) o.geometry.dispose();
        if (o.material) for (const mt of [].concat(o.material)) mt.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
    }
    const before = new Set(scene.children);
    buildField();
    for (const c of scene.children.slice()) if (!before.has(c) && c !== fieldRoot) fieldRoot.add(c);
    if (!fieldRoot.parent) scene.add(fieldRoot);
  }

  function buildField() {
    const HW = C.ARENA.hw, HL = C.ARENA.hl, royale = C.ARENA.mode === 'royale';
    // 雪面は 1 枚の絵が 6m 四方 (コートの中は 3.4m) になるように敷きつめる
    const ground = new T.Mesh(new T.PlaneGeometry(90, 120), applyTex(lambert(COLORS.snow), 'tex_ground.jpg', [15, 20]));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const court = new T.Mesh(new T.PlaneGeometry(HW * 2, HL * 2), applyTex(lambert(COLORS.court), 'tex_court.jpg', [HW * 0.3, HL * 0.294]));
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.005;
    scene.add(court);

    const lineMat = new T.MeshBasicMaterial({ color: 0x8fb6dc });
    const line = (w, d, x, z, mat) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, d), mat || lineMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z);
      scene.add(m);
    };
    line(HW * 2 + 0.12, 0.12, 0, HL);
    line(HW * 2 + 0.12, 0.12, 0, -HL);
    line(0.12, HL * 2, HW, 0);
    line(0.12, HL * 2, -HW, 0);
    app.centerLine = new T.MeshBasicMaterial({ color: 0xe86a62 });
    if (!royale) line(HW * 2, 0.16, 0, 0, app.centerLine);   // バトルロイヤルにはセンターライン・バックライン・フラッグが無い
    // バックライン: フォワードはここより後ろへ下がれない
    const backMat = new T.MeshBasicMaterial({ color: 0x8fb6dc });
    if (!royale) for (const sgn of [1, -1]) {
      for (let x = -HW + 0.25; x < HW; x += 0.9) line(0.5, 0.1, x, sgn * R.BACK_LINE_U, backMat);
    }

    // シェルターとシャトー (空気でふくらませた白い壁。チームの色の帯つき)。
    // 前と後ろの面に壁の絵、横の面にも同じ絵、上に上面の絵を貼る。絵には帯が描いてある
    const faceMat = {};
    const faceOf = (s) => {
      const key = s.kind === 'chateau' ? `tex_chateau_${s.team === 0 ? 'blue' : 'red'}.jpg`
        : `tex_shelter_${s.team < 0 ? 'center' : s.team === 0 ? 'blue' : 'red'}.jpg`;
      if (!faceMat[key]) faceMat[key] = applyTex(lambert(0xf3f7fc), key, null, 0.35);
      return faceMat[key];
    };
    const topMat = applyTex(lambert(0xf3f7fc), 'tex_walltop.jpg', null, 0.35);
    const bottomMat = lambert(0xdfe7f1);
    for (const s of C.SHELTERS) {
      const g = new T.Group();
      const face = faceOf(s);
      // BoxGeometry の面の順: +x, -x, +y (上), -y (下), +z, -z
      const body = new T.Mesh(new T.BoxGeometry(s.w, s.h, s.d), [face, face, topMat, bottomMat, face, face]);
      body.position.y = s.h / 2;
      g.add(body);
      g.position.set(s.x, 0, s.z);
      scene.add(g);
      const sh = blob(Math.max(s.w, s.d) * 0.62, 0.22);
      sh.scale.set(s.w / Math.max(s.w, s.d) * 1.15, 1, s.d / Math.max(s.w, s.d) * 1.6 + 0.3);
      sh.position.set(s.x + 0.15, 0.015, s.z - 0.1);
    }

    // フラッグ
    app.flags = (royale ? [] : [0, 1]).map((team) => {
      const f = C.flagPos(team);
      const g = new T.Group();
      const pole = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 2.2, 8), lambert(0x6b7380));
      pole.position.y = 1.1;
      g.add(pole);
      const clothGeo = new T.PlaneGeometry(0.9, 0.6, 8, 1);
      clothGeo.translate(0.45, 0, 0);
      const cloth = new T.Mesh(clothGeo, applyTex(lambert(COLORS.team[team], { side: T.DoubleSide }), team === 0 ? 'tex_flag_blue.jpg' : 'tex_flag_red.jpg'));
      cloth.position.y = 1.88;
      g.add(cloth);
      const base = new T.Mesh(new T.CylinderGeometry(0.28, 0.32, 0.12, 14), lambert(0x6b7380));
      base.position.y = 0.06;
      g.add(base);
      g.position.set(f.x, 0, f.z);
      scene.add(g);
      blob(0.5, 0.25).position.set(f.x, 0.015, f.z);
      const ring = new T.Mesh(new T.RingGeometry(R.FLAG_R - 0.06, R.FLAG_R, 32),
        new T.MeshBasicMaterial({ color: COLORS.team[team], transparent: true, opacity: 0.5 }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(f.x, 0.02, f.z);
      scene.add(ring);
      return { g, cloth, base: clothGeo.attributes.position.array.slice() };
    });

    buildScenery();
  }

  // ------------------------------------------------------------ まわりの景色 (会場)
  // エンドラインの後ろ: チーム色の低い板・旗・観客席と観客 (当てると、当てた側の観客が跳ねる)。
  // まわり: 段になった雪の木・雪だるま・雪の山。数が多い物は InstancedMesh で束ねる (1 種類 1 回で描く)。
  // 背の高い物はコートの外 2m 以上離して置く (カメラから見て、コートの上にかぶらない)
  const scenery = { fans: [], cheerT: [0, 0], bodies: null, heads: null, hats: null };
  function buildScenery() {
    const HW = C.ARENA.hw, HL = C.ARENA.hl;
    scenery.fans = []; scenery.cheerT = [0, 0];
    const rng = C.mulberry32(99);
    const o = new T.Object3D();
    const put = (mesh, i, x, y, z, sx, sy, sz, ry) => {
      o.position.set(x, y, z); o.rotation.set(0, ry || 0, 0); o.scale.set(sx, sy, sz == null ? sx : sz); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix);
    };
    const END = HL + 1.6;      // 板の位置 (エンドラインの 1.6m 外)

    // 木: 3 段の枝 (緑の円すい) に、それぞれ雪の帽子。幹
    const trees = [];
    const far = (x, z) => Math.abs(x) > HW + 2.5 || Math.abs(z) > END + 4.5;
    for (let i = 0; i < 400 && trees.length < 90; i++) {
      const x = (rng() * 2 - 1) * 26, z = (rng() * 2 - 1) * 46;
      if (!far(x, z)) continue;
      if (Math.abs(z) > END - 1 && Math.abs(z) < END + 4.5 && Math.abs(x) < 10.5) continue;   // 観客席の所はあける
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.2)) continue;
      trees.push({ x, z, h: 2.4 + rng() * 2.6 });
    }
    const tierGeo = new T.ConeGeometry(1, 1, 7, 1, true), snowGeo = new T.ConeGeometry(1, 1, 7, 1, true);   // 底は見えないので開けておく
    const tiers = new T.InstancedMesh(tierGeo, lambert(0x2f6b52), trees.length * 3);
    const snows = new T.InstancedMesh(snowGeo, lambert(0xffffff), trees.length * 3);
    const trunks = new T.InstancedMesh(new T.CylinderGeometry(0.13, 0.17, 1, 6), lambert(0x7a5a40), trees.length);
    trees.forEach((t, i) => {
      const r0 = t.h * 0.36;
      put(trunks, i, t.x, 0.3, t.z, 1, 0.6, 1);
      for (let k = 0; k < 3; k++) {
        const r = r0 * (1 - k * 0.27), hh = t.h * 0.42, y = 0.5 + t.h * 0.26 * k + hh / 2;
        put(tiers, i * 3 + k, t.x, y, t.z, r, hh, r, rng() * 6);
        put(snows, i * 3 + k, t.x, y + hh * 0.2, t.z, r * 0.72, hh * 0.62, r * 0.72, rng() * 6);
      }
    });
    scene.add(tiers, snows, trunks);

    // 雪の山 (低い)
    const NM = 26;
    const mounds = new T.InstancedMesh(new T.SphereGeometry(1, 9, 5), lambert(0xffffff), NM);
    for (let i = 0; i < NM; i++) {
      let x, z;
      do { x = (rng() * 2 - 1) * 20; z = (rng() * 2 - 1) * 40; } while (!(Math.abs(x) > HW + 1.8 || Math.abs(z) > END + 4.5));
      put(mounds, i, x, 0, z, 1.2 + rng() * 2, 0.35 + rng() * 0.45, 1.2 + rng() * 1.6, rng() * 3);
    }
    scene.add(mounds);

    // 雪だるま (コートの四すみの外)
    const white = lambert(0xffffff), coal = lambert(0x2a2f3a), carrot = lambert(0xff8a2a);
    const ball = new T.SphereGeometry(1, 14, 10), eye = new T.SphereGeometry(0.05, 6, 4), nose = new T.ConeGeometry(0.06, 0.3, 6);
    for (const [x, z, team] of [[-HW - 2.4, END - 0.4, 0], [HW + 2.4, END - 0.4, 0], [-HW - 2.4, -END + 0.4, 1], [HW + 2.4, -END + 0.4, 1]]) {
      const g = new T.Group();
      const b1 = new T.Mesh(ball, white); b1.scale.setScalar(0.55); b1.position.y = 0.5;
      const b2 = new T.Mesh(ball, white); b2.scale.setScalar(0.38); b2.position.y = 1.25;
      const face = z > 0 ? -1 : 1;     // コートの方を向く
      const e1 = new T.Mesh(eye, coal); e1.position.set(-0.12, 1.33, face * 0.34);
      const e2 = new T.Mesh(eye, coal); e2.position.set(0.12, 1.33, face * 0.34);
      const n = new T.Mesh(nose, carrot); n.rotation.x = face * Math.PI / 2; n.position.set(0, 1.25, face * 0.45);
      const scarf = new T.Mesh(new T.TorusGeometry(0.3, 0.07, 6, 16), lambert(COLORS.team[team])); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.0;
      const hat = new T.Mesh(new T.CylinderGeometry(0.22, 0.24, 0.3, 12), lambert(COLORS.teamDark[team])); hat.position.y = 1.68;
      g.add(b1, b2, e1, e2, n, scarf, hat);
      g.position.set(x, 0, z);
      scene.add(g);
    }

    // エンドラインの後ろ: チーム色の板・旗・観客席
    const N_ROW = 3, N_COL = 19, STEP = 0.78;
    const fanCount = 2 * N_ROW * N_COL;
    scenery.bodies = new T.InstancedMesh(new T.CylinderGeometry(0.2, 0.26, 0.62, 6, 1, true), lambert(0xffffff), fanCount);
    scenery.heads = new T.InstancedMesh(new T.SphereGeometry(0.19, 7, 5), lambert(0xffffff), fanCount);
    scenery.hats = new T.InstancedMesh(new T.SphereGeometry(0.2, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0xffffff), fanCount);
    const skin = new T.Color(0xf6d2b4), cTmp = new T.Color();
    const hatCols = [0xffffff, 0xffd34d, 0x6cc58a, 0xff9ec2];
    let fi = 0;
    for (const team of [0, 1]) {
      const sz = team === 0 ? 1 : -1;
      const z0 = sz * END;
      // 低い板 (チーム色) と、白い帯
      const board = new T.Mesh(new T.BoxGeometry(HW * 2 + 3, 0.7, 0.18), lambert(COLORS.team[team]));
      board.position.set(0, 0.35, z0); scene.add(board);
      const band = new T.Mesh(new T.BoxGeometry(HW * 2 + 3, 0.12, 0.19), lambert(0xffffff));
      band.position.set(0, 0.5, z0); scene.add(band);
      // 旗 (板の上に 5 本)
      for (let k = -2; k <= 2; k++) {
        const pole = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 1.9, 6), lambert(0xdde3ea));
        pole.position.set(k * 3, 0.95, z0 + sz * 0.25); scene.add(pole);
        const fl = new T.Mesh(new T.PlaneGeometry(0.8, 0.5), lambert(k % 2 ? 0xffffff : COLORS.team[team], { side: T.DoubleSide }));
        fl.position.set(k * 3 + 0.42, 1.62, z0 + sz * 0.25); scene.add(fl);
      }
      // 観客席 (段)
      for (let r = 0; r < N_ROW; r++) {
        const step = new T.Mesh(new T.BoxGeometry(N_COL * STEP + 0.6, 0.35 * (r + 1), 0.8), lambert(r % 2 ? 0xe4edf7 : 0xf4f8fd));
        step.position.set(0, 0.175 * (r + 1), z0 + sz * (1.1 + r * 0.8)); scene.add(step);
      }
      for (let r = 0; r < N_ROW; r++) {
        for (let c = 0; c < N_COL; c++) {
          const x = (c - (N_COL - 1) / 2) * STEP + (rng() - 0.5) * 0.18;
          const z = z0 + sz * (1.1 + r * 0.8);
          const base = 0.35 * (r + 1);
          // 服: 応援するチームの色が多め。ほかは明るい色をまぜる
          const coat = rng() < 0.7 ? COLORS.team[team] : [0xffb020, 0x5cc8c8, 0x9b7be0, 0xffffff][Math.floor(rng() * 4)];
          scenery.bodies.setColorAt(fi, cTmp.set(coat).offsetHSL(0, 0, (rng() - 0.5) * 0.12));
          scenery.heads.setColorAt(fi, skin);
          scenery.hats.setColorAt(fi, cTmp.set(hatCols[Math.floor(rng() * hatCols.length)]));
          scenery.fans.push({ x, z, base, team, ph: rng() * 6.28, sp: 0.8 + rng() * 0.6, jump: 0.25 + rng() * 0.2 });
          fi++;
        }
      }
    }
    scene.add(scenery.bodies, scenery.heads, scenery.hats);
    updateFans(0);
  }

  /**
   * 観客の動き: ふだんは小さく揺れる (1 秒に 10 回だけ書き換える)。当てた側 (cheerT) は跳ねる (毎コマ)。
   * 何もしていないときは書き換えない (遅い端末で毎コマ 342 個を書き換えると効いた)
   */
  function updateFans(t, dt) {
    if (!scenery.bodies) return;
    if (dt) for (const k of [0, 1]) scenery.cheerT[k] = Math.max(0, scenery.cheerT[k] - dt);
    const cheering = scenery.cheerT[0] > 0 || scenery.cheerT[1] > 0;
    if (dt && !cheering && !scenery.wasCheering && t - (scenery.lastIdle || 0) < 0.1) return;
    scenery.lastIdle = t; scenery.wasCheering = cheering;
    const o = updateFans.o || (updateFans.o = new T.Object3D());
    scenery.fans.forEach((f, i) => {
      const ch = scenery.cheerT[f.team];
      const y = f.base + (ch > 0 ? Math.abs(Math.sin(t * 9 * f.sp + f.ph)) * f.jump * Math.min(1, ch) : Math.max(0, Math.sin(t * 1.6 * f.sp + f.ph)) * 0.04);
      o.position.set(f.x, y + 0.31, f.z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); scenery.bodies.setMatrixAt(i, o.matrix);
      o.position.y = y + 0.8; o.updateMatrix(); scenery.heads.setMatrixAt(i, o.matrix);
      o.position.y = y + 0.86; o.updateMatrix(); scenery.hats.setMatrixAt(i, o.matrix);
    });
    scenery.bodies.instanceMatrix.needsUpdate = true;
    scenery.heads.instanceMatrix.needsUpdate = true;
    scenery.hats.instanceMatrix.needsUpdate = true;
  }

  // 影は丸い板 (影の計算をしないぶん軽い)
  const blobTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(40,70,110,0.55)');
    gr.addColorStop(1, 'rgba(40,70,110,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  })();
  const blobGeo = new T.PlaneGeometry(1, 1);
  function blob(size, opacity) {
    const m = new T.Mesh(blobGeo, new T.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: opacity == null ? 1 : opacity }));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(size * 2, size * 2, 1);
    m.renderOrder = 1;
    scene.add(m);
    return m;
  }

  // ------------------------------------------------------------ 選手
  const playerGeo = {
    body: new T.CylinderGeometry(0.24, 0.3, 0.78, 12),
    legs: new T.CylinderGeometry(0.22, 0.2, 0.5, 10),
    head: new T.SphereGeometry(0.2, 14, 10),
    helmet: new T.SphereGeometry(0.215, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    arm: new T.CylinderGeometry(0.07, 0.07, 0.55, 8),
    band: new T.CylinderGeometry(0.255, 0.27, 0.12, 12),
    eye: new T.SphereGeometry(0.03, 6, 4)
  };
  const skinMat = lambert(0xf3c9a4);
  const legMat = lambert(0x2c3446);
  const eyeMat = new T.MeshBasicMaterial({ color: 0x1b1b1b });
  const whiteMat = lambert(0xffffff);

  function makePlayerMesh(p) {
    const team = p.team;
    const mats = {
      body: lambert(COLORS.team[team]),
      helmet: lambert(COLORS.teamDark[team])
    };
    const root = new T.Group();
    const pose = new T.Group();       // しゃがむ・倒れる
    root.add(pose);
    const legs = new T.Mesh(playerGeo.legs, legMat); legs.position.y = 0.25;
    const body = new T.Mesh(playerGeo.body, mats.body); body.position.y = 0.88;
    const head = new T.Mesh(playerGeo.head, skinMat); head.position.y = 1.47;
    const helmet = new T.Mesh(playerGeo.helmet, mats.helmet); helmet.position.y = 1.49;
    const e1 = new T.Mesh(playerGeo.eye, eyeMat); e1.position.set(-0.07, 1.5, 0.18);
    const e2 = new T.Mesh(playerGeo.eye, eyeMat); e2.position.set(0.07, 1.5, 0.18);
    pose.add(legs, body, head, helmet, e1, e2);
    if (p.role === 'B') {
      const band = new T.Mesh(playerGeo.band, whiteMat); band.position.y = 0.95;
      pose.add(band);
    }
    const shoulder = new T.Group(); shoulder.position.set(0.3, 1.15, 0);
    const arm = new T.Mesh(playerGeo.arm, mats.body); arm.position.y = -0.24;
    const hand = new T.Mesh(new T.SphereGeometry(0.11, 8, 6), whiteMat); hand.position.y = -0.52;
    shoulder.add(arm, hand);
    pose.add(shoulder);
    const shoulder2 = new T.Group(); shoulder2.position.set(-0.3, 1.15, 0);
    const arm2 = new T.Mesh(playerGeo.arm, mats.body); arm2.position.y = -0.24;
    shoulder2.add(arm2);
    pose.add(shoulder2);
    scene.add(root);
    const shadow = blob(0.42, 0.9);
    // バックスの印: 足もとの白い輪
    let mark = null;
    if (p.role === 'B') {
      mark = new T.Mesh(backMarkGeo, backMarkMat);
      mark.rotation.x = -Math.PI / 2;
      mark.renderOrder = 1;
      scene.add(mark);
    }
    return { root, pose, shoulder, shoulder2, hand, shadow, mark, team, crouch: 0, throwT: 0, outT: -1, step: 0, mats };
  }

  const views = { players: [], balls: new Map(), puffs: [] };

  const meRing = new T.Mesh(new T.RingGeometry(0.42, 0.56, 32), new T.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.95, depthWrite: false }));
  meRing.rotation.x = -Math.PI / 2;
  meRing.renderOrder = 2;
  scene.add(meRing);
  const meArrow = new T.Mesh(new T.ConeGeometry(0.16, 0.32, 3), new T.MeshBasicMaterial({ color: 0xffcf3a }));
  meArrow.rotation.x = Math.PI;
  scene.add(meArrow);

  // ------------------------------------------------------------ 選手の絵 (players.webp)
  // art/make_sprites.py が作る 8 列 x 6 行の絵。行: あお 背中・正面・横 / あか 背中・正面・横。
  // 列: 0 立つ 1〜3 走る 4 しゃがむ 5 丸める 6 振りかぶり 7 振り抜き。
  // 絵は上から見下ろした形で描いてあるので、板は「縦に立てて、カメラの方へ向ける」。
  // 寝かせると (ふつうのスプライト) 板が後ろの壁にめりこみ、壁の手前にいる選手の頭が欠ける。
  // 縦の板は見下ろすと縮んで見えるので、そのぶん縦に伸ばしておく。
  const SPR = { cols: 8, rows: 6, cell: 192, base: 184, figure: 150 };
  const CAM_PITCH = Math.atan2(CAM.h, CAM.back + CAM.ahead);   // camTarget の見下ろす角度
  const SPR_W = 2.1;                               // 1 コマの横幅 (m)。立った姿が 1.65m ほどに見える (1.6 では小さいと言われた)
  const SPR_H = SPR_W / Math.cos(CAM_PITCH);       // 縦に立てた板の高さ
  const sprGeo = new T.PlaneGeometry(SPR_W, SPR_H);
  sprGeo.translate(0, SPR_H / 2 - (SPR.cell - SPR.base) / SPR.cell * SPR_H, 0);   // 足もとを原点に
  const sprites = { tex: null, failed: false };
  const SPR_K = SPR_W / 1.6;                       // 前の大きさ (1.6) からの倍率。影や輪も合わせる
  const SPR_FALL = SPR_W / SPR_H;                  // 倒れるとき、縦に伸ばしたぶんを戻す倍率
  const backMarkGeo = new T.RingGeometry(0.34 * SPR_K, 0.42 * SPR_K, 24);
  const backMarkMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });

  function loadSprites() {
    const url = (window.ASSETS && window.ASSETS['players.webp']) || './players.webp';
    new T.TextureLoader().load(url, (tex) => {
      tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = 4;
      sprites.tex = tex;
      if (app.match) app.match.players.forEach((p, i) => { if (views.players[i]) attachSprite(views.players[i]); });
    }, undefined, () => { sprites.failed = true; });   // 読めなければ、今までの 3D の体のまま
  }

  /**
   * バトルロイヤルの色 (2〜7) の絵: あおの行 (上の 3 行) の青い所だけ、色相を塗り替える
   * (art/make_sprites.py で、あかを作るのと同じ見分け方: 色相 205〜250°・彩度 0.62 より上・明るさ 0.3 より上)
   */
  function colorTex(team) {
    if (team <= 1 || !RECOLOR[team] || !sprites.tex) return sprites.tex;
    sprites.colors = sprites.colors || {};
    if (sprites.colors[team]) return sprites.colors[team];
    const img = sprites.tex.image;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    const H = Math.round(img.height / SPR.rows * 3);
    const d = g.getImageData(0, 0, img.width, H);
    const a = d.data, rc = RECOLOR[team];
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] < 8) continue;
      const r = a[i] / 255, gg = a[i + 1] / 255, b = a[i + 2] / 255;
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), c = mx - mn;
      if (mx < 0.3 || c / mx < 0.62) continue;
      let h = mx === r ? ((gg - b) / c) % 6 : mx === gg ? (b - r) / c + 2 : (r - gg) / c + 4;
      h *= 60; if (h < 0) h += 360;
      if (h < 205 || h > 250) continue;
      const sat = Math.min(1, (c / mx) * (rc.s || 1)), val = Math.min(1, mx * (rc.v || 1));
      const nh = (rc.h + (h - 225)) / 60, cc = val * sat, x = cc * (1 - Math.abs((nh % 2 + 2) % 2 - 1)), m0 = val - cc;
      const k = Math.floor(((nh % 6) + 6) % 6);
      const [r1, g1, b1] = [[cc, x, 0], [x, cc, 0], [0, cc, x], [0, x, cc], [x, 0, cc], [cc, 0, x]][k];
      a[i] = (r1 + m0) * 255; a[i + 1] = (g1 + m0) * 255; a[i + 2] = (b1 + m0) * 255;
    }
    g.putImageData(d, 0, 0);
    const t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    sprites.colors[team] = t;
    return t;
  }

  function attachSprite(v) {
    if (!sprites.tex || v.spr) return;
    const geo = sprGeo.clone();
    const mat = new T.MeshBasicMaterial({ map: colorTex(v.team || 0), transparent: true, alphaTest: 0.25 });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 3;
    scene.add(mesh);
    v.spr = { mesh, key: -1 };
    v.pose.visible = false;
    v.shadow.scale.set(0.84 * SPR_K, 0.84 * SPR_K, 1);
  }

  /**
   * どの絵を出すか。向き (カメラから見て 背中・正面・横) と動きで決める。
   * @param face   選手の向き (Core の face。0 = +z)
   * @param camSign カメラが +z 側から見ているなら 1、反対側 (ビクトリースローのあかの番) なら -1
   */
  function pickFrame(o) {
    const away = -Math.cos(o.face) * o.camSign;       // カメラから遠ざかる向きほど +
    const right = Math.sin(o.face) * o.camSign;       // 画面の右を向くほど +
    let row, flip = false;
    if (away > 0.45) row = 0;
    else if (away < -0.45) row = 1;
    else { row = 2; flip = right < 0; }
    let col = 0;
    if (o.throwT > 0) col = o.throwT > 0.23 ? 6 : 7;
    else if (o.crouch) col = o.making ? (Math.floor(o.t * 6) % 2 ? 5 : 4) : 4;
    else if (o.speed > 0.3) col = [1, 2, 3, 2][Math.floor(o.step / (Math.PI / 2)) % 4];
    return { row: row + (o.team === 1 ? 3 : 0), col, flip };
  }

  function setFrame(v, f) {
    const key = f.row * 32 + f.col * 2 + (f.flip ? 1 : 0);
    if (v.spr.key === key) return;
    v.spr.key = key;
    v.spr.frame = f;
    const u0 = f.col / SPR.cols, u1 = (f.col + 1) / SPR.cols;
    const vt = 1 - f.row / SPR.rows, vb = 1 - (f.row + 1) / SPR.rows;
    const a = f.flip ? u1 : u0, b = f.flip ? u0 : u1;
    const uv = v.spr.mesh.geometry.attributes.uv;
    uv.setXY(0, a, vt); uv.setXY(1, b, vt); uv.setXY(2, a, vb); uv.setXY(3, b, vb);
    uv.needsUpdate = true;
  }

  /** 頭の上の印を出す高さ */
  function headTop(p) {
    const crouched = C.playerHeight(p) < R.STAND_H;
    // 絵の上端 (縦に立てた板の上での高さ)。立ち 150px・しゃがみ 約 105px (1 コマ 192px、足もと 184px)
    if (sprites.tex) return (crouched ? 108 : 152) / SPR.cell * SPR_H;
    return C.playerHeight(p) + 0.6;
  }

  /**
   * 体力の絵 (ハート。残りは赤、減った所は暗い穴)。hp ごとに 1 枚。
   * 前は白い丸で、持っている雪玉 (白い丸) と見分けにくかった
   */
  const HEART = { w: 30, h: 32 };
  function heartPath(g, cx, cy, s) {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.9);
    g.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.85, cy - s * 1.15, cx, cy - s * 0.4);
    g.bezierCurveTo(cx + s * 0.85, cy - s * 1.15, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
    g.closePath();
  }
  const hpTexCache = {};
  function hpTex(hp) {
    if (hpTexCache[hp]) return hpTexCache[hp];
    const N = R.ROYALE.HP;
    const c = document.createElement('canvas'); c.width = HEART.w * N; c.height = HEART.h;
    const g = c.getContext('2d');
    for (let i = 0; i < N; i++) {
      heartPath(g, HEART.w * (i + 0.5), HEART.h / 2 + 1, 11);
      g.lineJoin = 'round';
      g.lineWidth = 5; g.strokeStyle = i < hp ? '#ffffff' : 'rgba(255,255,255,.55)'; g.stroke();
      g.fillStyle = i < hp ? (hp === 1 ? '#ff2a1a' : '#ff4f7a') : 'rgba(20,30,50,.6)'; g.fill();
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
    return (hpTexCache[hp] = t);
  }
  // 頭の上に出す大きさ (m)。ハート 1 つ 0.3m
  const HP_SPR = { w: 0.3 * R.ROYALE.HP, h: 0.32 };

  function resetPlayers() {
    for (const v of views.players) {
      scene.remove(v.root); scene.remove(v.shadow);
      if (v.spr) { scene.remove(v.spr.mesh); v.spr.mesh.geometry.dispose(); v.spr.mesh.material.dispose(); }
      if (v.mark) scene.remove(v.mark);
      if (v.hpSpr) { scene.remove(v.hpSpr); v.hpSpr.material.dispose(); }
    }
    views.players = app.match.players.map((p) => { const v = makePlayerMesh(p); v.team = p.team; return v; });
    views.players.forEach(attachSprite);
    // バトルロイヤル: 頭の上に体力 (雪玉 3 つ)
    if (app.match.mode === 'royale') views.players.forEach((v) => { v.hpSpr = new T.Sprite(new T.SpriteMaterial({ map: hpTex(R.ROYALE.HP), depthTest: false, transparent: true })); v.hpSpr.scale.set(HP_SPR.w, HP_SPR.h, 1); v.hpSpr.renderOrder = 7; scene.add(v.hpSpr); });
    for (const [, b] of views.balls) { scene.remove(b.mesh); scene.remove(b.shadow); }
    views.balls.clear();
  }

  // ------------------------------------------------------------ 雪玉と粉雪
  const ballGeo = new T.SphereGeometry(0.15, 12, 8);
  const ballMat = lambert(0xffffff, { emissive: 0x334455 });
  const bigBallMat = lambert(0xfff6d8, { emissive: 0x806020 });   // 大玉はうっすら金色に光る
  function ballView(b) {
    let v = views.balls.get(b.id);
    if (!v) {
      v = { mesh: new T.Mesh(ballGeo, b.big ? bigBallMat : ballMat), shadow: blob(b.big ? 0.5 : 0.16, 0.8) };
      if (b.big) v.mesh.scale.setScalar(R.BIG_R / R.BALL_R * 0.75);   // 大玉 (当たりの大きさに合わせる)
      scene.add(v.mesh);
      views.balls.set(b.id, v);
    }
    return v;
  }

  const puffGeo = new T.SphereGeometry(0.07, 6, 4);
  const puffMat = lambert(0xffffff);
  const puffMats = { blue: lambert(0x7cc4ff, { emissive: 0x2a5aa0 }), red: lambert(0xff6a5a, { emissive: 0x902020 }) };
  function puff(x, y, z, n, power, color) {
    for (let i = 0; i < n; i++) {
      let p = views.puffs.find((q) => q.life <= 0);
      if (!p) {
        if (views.puffs.length > 160) break;
        p = { mesh: new T.Mesh(puffGeo, puffMat), life: 0 };
        scene.add(p.mesh);
        views.puffs.push(p);
      }
      p.mesh.material = color ? puffMats[color] : puffMat;
      const a = Math.random() * Math.PI * 2;
      const sp = (0.8 + Math.random() * 2.2) * (power || 1);
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp; p.vy = 1 + Math.random() * 2.5 * (power || 1);
      p.mesh.position.set(x, y, z);
      p.life = 0.45 + Math.random() * 0.35;
      const s = 0.6 + Math.random() * 1.2;
      p.mesh.scale.set(s, s, s);
      p.mesh.visible = true;
    }
  }
  function stepPuffs(dt) {
    for (const p of views.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vy -= 9.8 * dt;
      const m = p.mesh.position;
      m.x += p.vx * dt; m.y = Math.max(0.03, m.y + p.vy * dt); m.z += p.vz * dt;
      if (p.life <= 0) p.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------ 照準
  const aimMax = 140;  // 指を引く長さ (px) の上限 → 届く距離いっぱい
  const aimGeo = new T.BufferGeometry();
  aimGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(3 * 200), 3));
  const aimLine = new T.Line(aimGeo, new T.LineDashedMaterial({ color: 0xffb020, dashSize: 0.35, gapSize: 0.22, depthTest: false, transparent: true }));
  aimLine.renderOrder = 5;
  aimLine.visible = false;
  scene.add(aimLine);
  const aimRing = new T.Mesh(new T.RingGeometry(0.32, 0.48, 28), new T.MeshBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true, opacity: 0.95 }));
  aimRing.rotation.x = -Math.PI / 2;
  aimRing.renderOrder = 6;
  aimRing.visible = false;
  scene.add(aimRing);

  const lockRing = new T.Mesh(new T.RingGeometry(0.46, 0.7, 28), new T.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true, opacity: 0.95 }));
  // 狙っている相手の頭の上の印 (壁の陰でも見えるように、奥行きを無視して描く)
  const lockMark = new T.Mesh(new T.ConeGeometry(0.2, 0.42, 4), new T.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true }));
  lockMark.rotation.x = Math.PI;
  lockMark.renderOrder = 7;
  lockMark.visible = false;
  scene.add(lockMark);
  lockRing.rotation.x = -Math.PI / 2;
  lockRing.renderOrder = 6;
  lockRing.visible = false;
  scene.add(lockRing);

  function me() { const m = app.match; return m && m.human != null ? m.players[m.human] : null; }

  /** 指を引いた量 → 地面の狙い位置。上へ引くと敵陣 (−z) の方。 */
  function aimTarget(dx, dy) {
    const p = me();
    const len = Math.hypot(dx, dy);
    const k = Math.min(len, aimMax) / aimMax * R.RANGE / Math.max(len, 1e-6);
    // 指は上へ引くことが多いので、そのまま「上 = 前」に対応させる
    return { x: p.x + dx * k, z: p.z + dy * k };
  }

  /**
   * いまの狙い。
   * - ふだん・タップ: 前方のいちばん狙いやすい相手を自動で選ぶ
   * - はじく (スライド): その向きにいる相手を選ぶ。40° 以内にだれもいなければ、指の量で地面を狙う
   * 相手を選んだときは、動きを先読みし、壁に隠れていれば奥へ落として頭越しに当てる (Core.assistAim)
   * - ビクトリースロー: 補助なし。指の量で地面を狙う
   */
  function currentAim() {
    const m = app.match, p = me();
    if (!m || !p || !p.alive) return null;
    const a = app.aim;
    const dragging = a && a.len >= 14;
    if (m.phase === 'vt') {
      if (!dragging) return null;
      const t = aimTarget(a.dx, a.dy);
      return { x: t.x, z: t.z, target: null, clear: C.predictVT(p.team, p.x, p.z, t.x, t.z), manual: true };
    }
    if (m.phase !== 'play') return null;
    const dir = dragging ? { x: a.dx, z: a.dy } : null;
    const q = C.pickTarget(m, p, dir);
    if (q) return C.assistAim(m, p, null, q);
    if (!dragging) return null;
    const t = aimTarget(a.dx, a.dy);
    return { x: t.x, z: t.z, target: null, clear: !!C.predictHit(m.players, p.team, p.x, p.z, t.x, t.z), manual: true };
  }

  function updateAim() {
    const p = me();
    const aim = currentAim();
    app.lock = aim;
    const easy = app.match.aimMode === 'easy';
    const steady = !!(p && (easy || app.match.phase === 'vt' || (app.aim && p.aimF >= 1)));
    const ready = !!(aim && aim.clear && p && p.balls > 0 && steady);
    if (ready && !app.hud.ready && app.aim && !easy && app.match.phase === 'play') sound.steady();
    if (app.hud.ready !== ready) { app.hud.ready = ready; els.throwPad.classList.toggle('ready', ready); }
    // 狙っている相手の足もとに輪 (当たるコースなら赤、壁に隠れていれば灰色)
    if (aim && aim.target != null) {
      const q = app.match.players[aim.target];
      lockRing.visible = true;
      lockRing.position.set(q.x, 0.03, q.z);
      // 構えるほど輪が締まる。締まりきって当たるコースなら赤、まだなら橙、壁に隠れていれば灰色
      const f = p ? p.aimF : 0;
      const col = !aim.clear ? 0x8d99ab : ready ? 0xff3b30 : 0xffa21f;
      lockRing.material.color.setHex(col);
      const s = (ready ? 1 + Math.sin(performance.now() / 120) * 0.08 : 1) * (1 + 1.5 * (1 - f));
      lockRing.scale.set(s, s, 1);
      lockMark.visible = true;
      lockMark.material.color.setHex(col);
      lockMark.position.set(q.x, headTop(q) + 0.15 + Math.sin(performance.now() / 160) * 0.08, q.z);
      lockMark.rotation.y = performance.now() / 400;
    } else if (aim && app.match.phase === 'vt' && aim.clear) {
      const f = C.flagPos(1 - p.team);
      lockRing.visible = true; lockRing.position.set(f.x, 0.03, f.z); lockRing.material.color.setHex(0xff3b30);
    } else lockRing.visible = false;
    if (!(aim && aim.target != null)) lockMark.visible = false;
    // 押している間だけ、球の通り道を出す
    if (!app.aim || !aim) { aimLine.visible = false; aimRing.visible = false; return; }
    const tr = C.trajectory(p.x, p.z, aim.x, aim.z, 0.025);
    const arr = aimGeo.attributes.position.array;
    const n = Math.min(tr.points.length, 200);
    for (let i = 0; i < n; i++) { arr[i * 3] = tr.points[i].x; arr[i * 3 + 1] = tr.points[i].y; arr[i * 3 + 2] = tr.points[i].z; }
    aimGeo.setDrawRange(0, n);
    aimGeo.attributes.position.needsUpdate = true;
    aimGeo.computeBoundingSphere();
    aimLine.computeLineDistances();
    aimLine.visible = true;
    aimRing.visible = true;
    aimRing.position.set(tr.end.x, Math.max(0.03, tr.end.y), tr.end.z);
    const col = aim.clear ? 0xff3b30 : tr.hit === 'shelter' ? 0x9aa6b8 : 0xffb020;
    aimRing.material.color.setHex(col);
    aimLine.material.color.setHex(col);
  }

  // ------------------------------------------------------------ 指の操作
  function bindControls() {
    // 移動: 左側のどこを押してもそこが中心
    els.stickZone.addEventListener('pointerdown', (e) => {
      if (app.stickTouch) return;
      e.preventDefault();
      capture(els.stickZone, e.pointerId);
      const r = els.stickZone.getBoundingClientRect();
      app.stickTouch = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      els.stick.style.left = (e.clientX - r.left) + 'px';
      els.stick.style.top = (e.clientY - r.top) + 'px';
      els.stick.classList.add('on');
      els.moveHint.hidden = true;
      setKnob(0, 0);
    });
    const moveStick = (e) => {
      const s = app.stickTouch;
      if (!s || s.id !== e.pointerId) return;
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const len = Math.hypot(dx, dy), max = 52;
      if (len > max) { dx = dx / len * max; dy = dy / len * max; }
      setKnob(dx, dy);
      const dead = 6;
      const k = len < dead ? 0 : 1 / max;
      app.input.mx = dx * k; app.input.mz = dy * k;
    };
    const endStick = (e) => {
      const s = app.stickTouch;
      if (!s || s.id !== e.pointerId) return;
      app.stickTouch = null;
      app.input.mx = 0; app.input.mz = 0;
      setKnob(0, 0);
      els.stick.classList.remove('on');
      els.stick.style.left = ''; els.stick.style.top = '';
    };
    els.stickZone.addEventListener('pointermove', moveStick);
    els.stickZone.addEventListener('pointerup', endStick);
    els.stickZone.addEventListener('pointercancel', endStick);

    // 投げる: 押さえて構え (輪が締まる)、離すと投げる。タップは前方の相手、はじくとその向きの相手
    els.throwPad.addEventListener('pointerdown', (e) => {
      if (app.aim) return;
      e.preventDefault();
      capture(els.throwPad, e.pointerId);
      app.aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, len: 0, t0: performance.now() };
      els.throwPad.classList.add('on');
      sound.unlock();
    });
    els.throwPad.addEventListener('pointermove', (e) => {
      const a = app.aim;
      if (!a || a.id !== e.pointerId) return;
      a.dx = e.clientX - a.sx; a.dy = e.clientY - a.sy;
      a.len = Math.hypot(a.dx, a.dy);
      a.maxLen = Math.max(a.maxLen || 0, a.len);
      // 一度引っぱってから真ん中へ戻すと「取り消し」 (離しても投げない)
      const cancel = a.maxLen >= CANCEL.out && a.len < CANCEL.back;
      if (cancel !== !!app.aimCancel) { app.aimCancel = cancel; els.throwPad.classList.toggle('cancel', cancel); }
    });
    const release = (e, cancel) => {
      const a = app.aim;
      if (!a || a.id !== e.pointerId) return;
      app.aim = null;
      els.throwPad.classList.remove('on');
      const wasCancel = !!app.aimCancel;
      app.aimCancel = false; els.throwPad.classList.remove('cancel');
      updateAim();
      if (cancel || wasCancel) return;     // 取り消し: 投げない (むずかしいなら構えも 0 に戻り、のぞいていれば戻る)
      const p = me();
      if (!p || !p.alive) return;
      // 離した瞬間の指で狙いを決める
      app.aim = a;
      const aim = currentAim();
      app.aim = null;
      if (aim) app.input.throwAt = { x: aim.x, z: aim.z, target: aim.target };
      else if (app.match.phase === 'play') app.input.throwAt = { x: p.x, z: p.z - C.side(p.team) * 12 };
    };
    els.throwPad.addEventListener('pointerup', (e) => release(e, false));
    els.throwPad.addEventListener('pointercancel', (e) => release(e, true));

    // パソコンで試すとき用のキー操作
    const keys = {};
    const applyKeys = () => {
      if (app.stickTouch) return;
      app.input.mx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
      app.input.mz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      keys[k] = true; applyKeys();
      if (k === ' ') { const aim = currentAim(); if (aim) app.input.throwAt = { x: aim.x, z: aim.z }; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; applyKeys(); });
  }

  // 合成したイベントや、すでに離れた指では失敗することがあるので包む
  function capture(el, id) { try { el.setPointerCapture(id); } catch (err) { /* 捕まえられなくても動く */ } }

  function setKnob(dx, dy) { els.knob.style.transform = `translate(${dx}px, ${dy}px)`; }

  // ------------------------------------------------------------ 音 (Web Audio で作る)
  const sound = (() => {
    let ctx = null, master = null, noise = null;
    function unlock() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function burst(dur, freq, q, vol, type) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.02);
    }
    function tone(freq, dur, vol, type, slide) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    /**
     * 効果音を音の出ない所で描き出して、大きさを測る (確かめ用)。最大と平均 (RMS) を返す。
     * 遅らせて鳴らす部分 (setTimeout) は入らない
     */
    async function measure(name, arg) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC) return null;
      const keep = [ctx, master, noise];
      const oc = new OAC(1, 44100 * 0.6, 44100);
      ctx = oc; master = oc.createGain(); master.gain.value = 0.5; master.connect(oc.destination);
      noise = oc.createBuffer(1, oc.sampleRate * 0.5, oc.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      try { api[name](arg); } finally { [ctx, master, noise] = keep; }
      const buf = await oc.startRendering();
      const x = buf.getChannelData(0);
      let peak = 0, sum = 0;
      for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; sum += x[i] * x[i]; }
      return { peak, rms: Math.sqrt(sum / x.length) };
    }
    // ---------------- BGM (バトルロイヤルだけ)。16 分音符の歩みで、少し先まで予約して鳴らす
    // 曲: 和音の根音 (midi) と長短、1 小節 16 歩。bass / arp / drum の作りは曲ごと
    const SONGS = {
      royale: { bpm: 124, roots: [45, 41, 48, 43], minor: [1, 0, 0, 0], vol: 1 },
      final: { bpm: 158, roots: [50, 46, 48, 45], minor: [1, 0, 0, 0], vol: 1 }
    };
    const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
    function vnote(ac, out, t, freq, dur, vol, type, cutoff) {
      const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let node = o;
      if (cutoff) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
      node.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.03);
    }
    function vnoise(ac, out, buf, t, dur, freq, type, vol) {
      const src = ac.createBufferSource(); src.buffer = buf;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(out);
      src.start(t); src.stop(t + dur + 0.02);
    }
    function kick(ac, out, t, vol) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
    }
    /** 曲 name の i 歩目を、時刻 t に予約する */
    function musicStep(ac, out, buf, name, i, t) {
      const S = SONGS[name], st = i % 16, bar = Math.floor(i / 16) % S.roots.length;
      const r = S.roots[bar], third = S.minor[bar] ? 3 : 4;
      const sp = 60 / S.bpm / 4;
      const chord = [0, third, 7, 12, 7, third];
      if (name === 'royale') {
        // 軽い: 8 分のベース (裏はオクターブ上)・三角波の分散和音・キックとハイハットは控えめ
        if (st % 2 === 0) vnote(ac, out, t, hz(r - 12 + (st % 4 === 2 ? 12 : 0)), sp * 1.8, 0.16, 'triangle');
        if (st % 2 === 0) vnote(ac, out, t, hz(r + 12 + chord[(st / 2) % chord.length]), sp * 1.6, 0.05, 'square', 2400);
        if (st % 8 === 0) kick(ac, out, t, 0.32);
        if (st % 4 === 2) vnoise(ac, out, buf, t, 0.04, 7000, 'highpass', 0.05);
      } else {
        // 決戦: 速く、16 分で刻むベース・のこぎり波の駆け上がり・4 つ打ちとスネア
        vnote(ac, out, t, hz(r - 12 + (st % 2 ? 12 : 0)), sp * 0.9, 0.12, 'sawtooth', 900);
        const run = [0, third, 7, 12, 15, 12, 7, third];
        if (st % 2 === 0) vnote(ac, out, t, hz(r + 12 + run[(st / 2) % run.length] + (bar === 3 && st >= 8 ? 2 : 0)), sp * 1.7, 0.045, 'square', 3200);
        if (st === 0) vnote(ac, out, t, hz(r + 24), sp * 7, 0.035, 'sawtooth', 2600);
        if (st % 4 === 0) kick(ac, out, t, 0.4);
        if (st === 4 || st === 12) vnoise(ac, out, buf, t, 0.12, 1800, 'bandpass', 0.22);
        if (st % 2 === 1) vnoise(ac, out, buf, t, 0.03, 8000, 'highpass', 0.06);
      }
    }
    const MUSIC_LEVEL = 0.75;   // 曲の平均 0.013〜0.018・最大 0.14〜0.16 (効果音のバシッ 0.30 より小さく、ずっと鳴るので控えめ)
    const mus = { name: null, bus: null, step: 0, nextT: 0, timer: null, muted: false };
    function music(name) {
      if (!ctx) return;
      if (mus.name === name) return;
      const now = ctx.currentTime;
      if (mus.bus) {
        // いまの大きさから落とす (値を読まない。読むと予約した値が見えず、バチッと鳴ることがある)
        const old = mus.bus;
        old.gain.cancelScheduledValues(now); old.gain.setTargetAtTime(0, now, 0.08);
        setTimeout(() => old.disconnect(), 800);
      }
      mus.name = name; mus.bus = null;
      if (!name) return;
      mus.bus = ctx.createGain();
      mus.bus.gain.value = mus.muted ? 0 : MUSIC_LEVEL;
      mus.bus.connect(master);
      mus.step = 0; mus.nextT = now + 0.06;
      if (!mus.timer) mus.timer = setInterval(pump, 40);
    }
    function pump() {
      if (!ctx || !mus.name || !mus.bus) return;
      const sp = 60 / SONGS[mus.name].bpm / 4;
      if (mus.nextT < ctx.currentTime - 0.5) mus.nextT = ctx.currentTime + 0.05;   // 止まっていた (裏へ回った) あとは追いつかせない
      while (mus.nextT < ctx.currentTime + 0.18) {
        musicStep(ctx, mus.bus, noise, mus.name, mus.step, mus.nextT);
        mus.step++; mus.nextT += sp;
      }
    }
    function musicMute(on) {
      mus.muted = on;
      if (!ctx || !mus.bus) return;
      const now = ctx.currentTime;
      mus.bus.gain.cancelScheduledValues(now); mus.bus.gain.setTargetAtTime(on ? 0 : MUSIC_LEVEL, now, 0.05);
    }
    /** 曲を音の出ない所で sec 秒描き出して、大きさを測る (確かめ用) */
    async function measureMusic(name, sec) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OAC || !SONGS[name]) return null;
      const oc = new OAC(1, Math.round(44100 * sec), 44100);
      const m0 = oc.createGain(); m0.gain.value = 0.5; m0.connect(oc.destination);
      const bus = oc.createGain(); bus.gain.value = MUSIC_LEVEL; bus.connect(m0);
      const nb = oc.createBuffer(1, oc.sampleRate * 0.5, oc.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const sp = 60 / SONGS[name].bpm / 4;
      for (let i = 0, t = 0.01; t < sec - 0.3; i++, t += sp) musicStep(oc, bus, nb, name, i, t);
      const buf = await oc.startRendering();
      const x = buf.getChannelData(0);
      let peak = 0, sum = 0;
      for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > peak) peak = v; sum += x[i] * x[i]; }
      return { peak, rms: Math.sqrt(sum / x.length) };
    }

    const api = {
      unlock, measure, music, musicMute, measureMusic,
      musicName: () => mus.name,
      /** ステージが縮む: 下がっていく警報 2 回 */
      shrink() { tone(880, 0.22, 0.14, 'square', 440); setTimeout(() => tone(880, 0.3, 0.14, 'square', 392), 240); },
      /** 決戦の始まり: 下から駆け上がる音と、高いシンバル */
      final() {
        [0, 4, 7, 12, 16].forEach((n, i) => setTimeout(() => tone(hz(62 + n), 0.16, 0.16, 'square'), i * 70));
        setTimeout(() => burst(0.6, 6000, 0.5, 0.3, 'highpass'), 360);
      },
      throw() { burst(0.16, 1400, 0.8, 0.25, 'bandpass'); },
      steady() { tone(1320, 0.07, 0.12, 'triangle'); },
      /** 大玉を投げた: 低くうなる音 */
      big() { tone(220, 0.35, 0.3, 'sawtooth', 90); burst(0.3, 600, 0.7, 0.3, 'lowpass'); },
      splat(near) { burst(0.12, 500, 0.7, near ? 0.5 : 0.22, 'lowpass'); },
      hit(combo) {
        burst(0.2, 700, 0.6, 0.6, 'lowpass');
        if (combo) {
          // 自分が当てた: 連続するほど高く
          const f = 660 * Math.pow(1.19, Math.min(combo, 6) - 1);
          tone(f, 0.12, 0.2, 'square'); setTimeout(() => tone(f * 1.5, 0.18, 0.18, 'square'), 70);
        } else tone(520, 0.18, 0.18, 'triangle', 260);
      },
      out() { tone(330, 0.35, 0.2, 'sawtooth', 120); },
      /** 当てたときの「バシッ!」: 低いドン (下がる正弦) + 中くらいの雪の粉 + 高いパチッ */
      bashi() {
        if (!ctx) return;
        tone(150, 0.16, 0.55, 'sine', 48);
        burst(0.16, 900, 0.9, 0.55, 'lowpass');
        burst(0.05, 3200, 1.4, 0.35, 'bandpass');
      },
      made() { tone(880, 0.06, 0.08, 'sine'); },
      whistle(long) { tone(2300, long ? 0.7 : 0.35, 0.12, 'sine'); tone(2340, long ? 0.7 : 0.35, 0.08, 'sine'); },
      win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.14, 'triangle'), i * 110)); }
    };
    return api;
  })();

  // ------------------------------------------------------------ 試合の流れ
  function startMatch() {
    sound.unlock();
    sound.music(null); sound.musicMute(false);
    app.match = newMatch((Math.random() * 4294967296) >>> 0);
    ensureField(app.match.mode);
    resetPlayers();
    app.hud = {};
    app.paused = false;
    app.running = true;
    app.acc = 0;
    app.input.throwAt = null;
    els.vTitle.hidden = true;
    els.vResult.hidden = true;
    els.vPause.hidden = true;
    app.outAt = 0;
    els.game.classList.toggle('royale-mode', app.match.mode === 'royale');
    snapCamera();
    handleEvents();
  }
  function newMatch(seed) {
    return app.gameMode === 'royale'
      ? C.createMatch({ mode: 'royale', seed, human: 0, aiSkill: AI_SKILL, aimMode: app.aimMode })
      : C.createMatch({ seed, skill: [0.55, AI_SKILL], human: 1, aimMode: app.aimMode });
  }

  /**
   * バトルロイヤルで自分が脱落したら、残りは見ずに先へ進めて結果を出す (描かずに試合を最後まで回す)。
   * 1 試合 180 秒 = 10800 歩。上限を置いて、終わらなければそこで止める
   */
  function finishRoyale() {
    const m = app.match;
    for (let i = 0; i < 20000 && m.phase !== 'matchOver'; i++) C.step(m, 1 / 60, {});
    C.drainEvents(m);
    if (m.phase === 'matchOver') showResult();
  }

  /** 3D の位置に、ぽんと浮かぶ文字 */
  /**
   * 自分が当てたとき: 画面の真ん中に「HIT!!」。斜めの太字・白に赤と黒の縁取り。
   * 0.08 秒で大きく飛び出し、少し縮みながら 0.5 秒で消える。連続ヒットは下に小さく添える
   */
  const HIT_SHAKE = { time: 0.2, amp: 0.22 };   // 揺れ: 0.2 秒、はじめ 0.22m (画面で 8px ほど) から 0 へ
  /**
   * 集中線: 画面のまわりから真ん中へ向かう線を、短いあいだ出す (まんがの「ここを見ろ」)。
   * 絵は CSS の 1 枚 (.focus) で、動かすのは透け具合と大きさ・回りだけ (塗り直さない)。カクカクと 6 段で動かす
   */
  const FOCUS = { white: '#ffffff', gold: '#ffe066', red: '#ff5a48', blue: '#9fd4ff' };
  function focusLines(color, dur, strength) {
    const el = els.focus;
    if (!el || !el.animate) return;
    const col = FOCUS[color] || FOCUS.white;
    if (app.focusCol !== col) { app.focusCol = col; el.style.setProperty('--fc', col); }
    const s = strength == null ? 0.85 : strength;
    if (app.focusAnim) app.focusAnim.cancel();
    app.focusAnim = el.animate([
      { opacity: 0, transform: 'scale(1.3) rotate(0deg)' },
      { opacity: s, transform: 'scale(1) rotate(4deg)', offset: 0.14 },
      { opacity: s * 0.85, transform: 'scale(1.06) rotate(-3deg)', offset: 0.6 },
      { opacity: 0, transform: 'scale(1.12) rotate(5deg)' }
    ], { duration: dur || 450, easing: 'steps(6, end)' });
    app.focusN = (app.focusN || 0) + 1;
  }

  function hitText(sub, main, dur) {
    dur = dur || 500;
    app.hitTextUntil = performance.now() + dur;
    return bigText([{ t: main || 'HIT!!', cls: 'l1' }, sub && { t: sub, cls: 'sub' }], 'red', dur, 'hit-text');
  }

  /**
   * 画面の真ん中に大きな字 (HIT!! と同じ作り: 斜めの太字、白い字にチーム色の縁・その外に黒い縁)。
   * lines: [{ t: 字, cls: 'l1' | 'l2' | 'sub' | 'info' }]。color: 'red' | 'blue' | 'gray'。
   * 飛び出して、持ちこたえ、少し縮みながら消える。HIT!! が出ている間は、それが消えてから出す
   */
  function bigText(lines, color, dur, extra) {
    const el = document.createElement('div');
    el.className = 'big-text ' + (color || 'red') + (extra ? ' ' + extra : '');
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    el.innerHTML = lines.filter(Boolean).map((l) => `<b class="${l.cls}" data-t="${esc(l.t)}">${esc(l.t)}</b>`).join('');
    const hold = dur <= 600 ? 0.55 : 0.85;
    const run = () => {
      els.pops.appendChild(el);
      const a = el.animate([
        { transform: 'translate(-50%, -50%) rotate(-8deg) skewX(-12deg) scale(1.9)', opacity: 0 },
        { transform: 'translate(-50%, -50%) rotate(-8deg) skewX(-12deg) scale(1)', opacity: 1, offset: Math.min(0.16, 80 / dur) },
        { transform: 'translate(-50%, -50%) rotate(-8deg) skewX(-12deg) scale(1.04)', opacity: 1, offset: hold },
        { transform: 'translate(-50%, -50%) rotate(-8deg) skewX(-12deg) scale(.72)', opacity: 0 }
      ], { duration: dur, easing: 'ease-out' });
      a.onfinish = () => el.remove();
    };
    const wait = extra === 'hit-text' ? 0 : Math.max(0, (app.hitTextUntil || 0) - performance.now());
    if (wait > 0) setTimeout(run, wait); else run();
    return el;
  }

  function popText(text, x, y, z, level) {
    const v = new T.Vector3(x, y, z).project(camera);
    const r = els.canvas.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'pop' + (level >= 2 ? ' big' : '');
    el.textContent = text;
    el.style.left = (r.left + (v.x + 1) / 2 * r.width) + 'px';
    el.style.top = (r.top + (1 - v.y) / 2 * r.height) + 'px';
    els.pops.appendChild(el);
    const a = el.animate([
      { transform: 'translate(-50%, -50%) scale(.4)', opacity: 0 },
      { transform: 'translate(-50%, -80%) scale(1.25)', opacity: 1, offset: 0.18 },
      { transform: 'translate(-50%, -90%) scale(1)', opacity: 1, offset: 0.6 },
      { transform: 'translate(-50%, -150%) scale(.9)', opacity: 0 }
    ], { duration: 1000, easing: 'ease-out' });
    a.onfinish = () => el.remove();
  }

  function showBanner(html, cls, sec) {
    els.banner.innerHTML = html;
    els.banner.className = 'banner' + (cls ? ' ' + cls : '');
    els.banner.hidden = false;
    app.bannerT = sec || 1.6;
  }

  const REASON = { flag: 'フラッグ奪取!', allout: '全員アウト', time: '時間切れ', over: '敵陣に4人目 (反則)' };
  const BIG_REASON = { flag: 'フラッグ奪取!', allout: '全員アウト!', time: '時間切れ', over: '4人目で反則!' };
  const DECIDED = { sets: 'セット数', points: 'ポイント合計', vt: 'ビクトリースロー' };

  function handleEvents() {
    const m = app.match;
    const mine = m.human;
    for (const e of C.drainEvents(m)) {
      switch (e.type) {
        case 'setStart':
          resetPlayers();
          snapCamera();
          if (e.royale) { showBanner('BATTLE ROYALE<small>8人全員が敵。最後の1人まで生き残れ</small>', '', R.COUNTDOWN); break; }
          showBanner(`SET ${e.setNo}<small>${e.setNo === 1 ? '敵陣のフラッグをめざせ' : 'よーい…'}</small>`, '', R.COUNTDOWN);
          break;
        case 'go':
          showBanner('スタート!', '', 0.8);
          sound.whistle(false);
          if (m.mode === 'royale') sound.music(m.final ? 'final' : 'royale');
          break;
        case 'final': {
          // 残り 2 人: 決戦。会場が縮み、カメラが寄り、曲が替わる
          els.banner.hidden = true;
          sound.final();
          if (m.human != null && m.players[m.human].alive) sound.music('final');
          const names = e.ids.map((id) => (id === mine ? 'あなた' : NAMES[m.players[id].team])).join(' vs ');
          bigText([{ t: 'FINAL', cls: 'l1' }, { t: 'BATTLE!!', cls: 'l1' }, { t: names, cls: 'info' }], 'red', 2400, 'final-text');
          focusLines('red', 2200, 0.9);
          break;
        }
        case 'shrink': {
          // 時間でステージが縮む: 赤い柵が出て、外にいると中へ押される
          if (m.final) break;                        // 決戦のお知らせと重ねない
          sound.shrink();
          showBanner(`ステージが縮む!<small>赤い柵の中へ (${e.stage}/${e.of})</small>`, 'red', 1.8);
          focusLines('blue', 900, 0.6);
          app.shake = Math.max(app.shake, 0.25);
          break;
        }
        case 'throw': {
          const v = views.players[e.player];
          if (v) v.throwT = 0.35;
          const p = m.players[e.player];
          if (p && Math.hypot(p.x - camLook.x, p.z - camLook.z) < 14) sound.throw();
          break;
        }
        case 'bigThrow': sound.big(); if (e.player === mine) focusLines('gold', 600, 0.8); break;
        case 'splash': {
          // 大玉が落ちた所: 大きな粉雪と、強めの揺れ
          puff(e.x, 0.3, e.z, 40, 2.4);
          if (e.by === mine) focusLines('gold', 500, 0.7);
          app.hitShake = HIT_SHAKE.time * 1.4; sound.bashi();
          break;
        }
        case 'duck': {
          // むずかしい: 狙われた相手がしゃがんだ (フェイントの合図)
          const q = m.players[e.player];
          if (q) popText('サッ', q.x, 2.4, q.z, 0);
          break;
        }
        case 'splat': {
          puff(e.x, e.y, e.z, e.on === 'shelter' ? 9 : 6, 0.8);
          const p = me();
          sound.splat(p && Math.hypot(e.x - p.x, e.z - p.z) < 3);
          break;
        }
        case 'hurt': {
          // バトルロイヤル: 体力が減った (青い雪。あと 1 回になったら赤い雪)。大玉は 2 減る
          puff(e.x, e.y, e.z, (e.hp <= 1 ? 26 : 20) + (e.big ? 14 : 0), 1.4, e.hp <= 1 ? 'red' : 'blue');
          const vq = views.players[e.player];
          if (vq) vq.hurtT = 0.35;
          if (e.player === mine) {
            app.shake = 0.35; sound.hit();
            showBanner(e.hp <= 1 ? 'あと1回で脱落!<small>ハート のこり 1</small>' : `当たった!<small>ハート のこり ${e.hp}</small>`, 'red', 1.1);
            focusLines('red', 380, 0.55);
          } else if (e.by === mine) {
            app.slowT = 0.12;
            app.hitShake = HIT_SHAKE.time;
            app.hitCam = { t: 0, x: e.x, z: e.z };
            const now = performance.now() / 1000;
            app.combo.n = now - app.combo.t < 6 ? app.combo.n + 1 : 1;
            app.combo.t = now;
            scenery.cheerT[0] = scenery.cheerT[1] = 1.6;
            sound.bashi(); sound.hit(app.combo.n);
            hitText(e.big ? `大玉! ハート -${e.dmg}` : e.hp <= 1 ? 'あと1回!' : '');
            focusLines(e.big ? 'gold' : 'white', 450, 0.85);
          } else sound.hit();
          break;
        }
        case 'block': {
          // 当たった直後の無敵の間: 玉ははじかれる
          puff(e.x, e.y, e.z, 5, 0.5);
          break;
        }
        case 'hit': {
          if (e.royale) {
            // バトルロイヤルの脱落 (体力 0)
            const v = views.players[e.player];
            if (v) { v.outT = 0; const l = Math.hypot(e.vx || 0, e.vz || 0) || 1; v.kb = { x: (e.vx || 0) / l, z: (e.vz || 0) / l }; }
            puff(e.x, e.y, e.z, 34, 2.0, 'red');
            if (e.player === mine) {
              app.shake = 0.6; sound.hit(); sound.out();
              app.combo.n = 0;
              els.banner.hidden = true;
              hitText(`${e.place}位`, 'OUT!!', 1400);
              focusLines('red', 1300, 0.9);
              app.outAt = performance.now();
              sound.music(null);
            } else if (e.by === mine) {
              app.slowT = 0.2;
              app.hitShake = HIT_SHAKE.time * 1.3;
              app.hitCam = { t: 0, x: e.x, z: e.z };
              scenery.cheerT[0] = scenery.cheerT[1] = 1.6;
              sound.bashi(); sound.out();
              const left = m.players.filter((q) => q.alive).length;
              hitText(`${NAMES[e.player]}を倒した! ・ のこり${left}人`, 'OUT!!', 900);
              focusLines('gold', 900, 0.95);
            } else {
              const q = m.players[e.player];
              if (q) popText(`${NAMES[e.player]} OUT`, q.x, 2.6, q.z, 1);
              sound.hit();
            }
            break;
          }
          { const q = app.match.players[e.player]; if (q) scenery.cheerT[1 - q.team] = 1.6; }   // 当てた側の観客が跳ねる
          const v = views.players[e.player];
          if (v) {
            v.outT = 0;
            // 玉の向きへ吹き飛ぶ
            const l = Math.hypot(e.vx || 0, e.vz || 0) || 1;
            v.kb = { x: (e.vx || 0) / l, z: (e.vz || 0) / l };
          }
          if (e.player === mine) {
            puff(e.x, e.y, e.z, 16, 1.3);
            app.shake = 0.5; sound.hit(); sound.out();
            app.combo.n = 0;
            showBanner('当たった!<small>仲間に交代</small>', 'red', 1.2);
          } else if (e.by === mine) {
            // 自分の一撃: ヒットストップ・大きな粉雪・OUT! の文字・連続ヒット
            puff(e.x, e.y, e.z, 30, 1.8);
            app.slowT = 0.16;
            app.hitShake = HIT_SHAKE.time;          // 画面を一瞬だけ揺らす (すぐ収まる)
            app.hitCam = { t: 0, x: e.x, z: e.z };    // 当てた相手へ寄る
            const now = performance.now() / 1000;
            app.combo.n = now - app.combo.t < 6 ? app.combo.n + 1 : 1;
            app.combo.t = now;
            sound.bashi(); sound.hit(app.combo.n);
            hitText(app.combo.n >= 2 ? (['', '', 'ダブル!', 'トリプル!'][app.combo.n] || `${app.combo.n}連続!`) : '');
            focusLines(e.big ? 'gold' : 'white', 450, 0.85);
          } else {
            puff(e.x, e.y, e.z, 16, 1.3);
            sound.hit();
          }
          break;
        }
        case 'made': if (e.player === m.human) sound.made(); break;
        case 'handOver': break;
        case 'setEnd': {
          sound.whistle(true);
          const who = e.winner === 0 ? 'あおの勝ち!' : e.winner === 1 ? 'あかの勝ち!' : '引き分け';
          // 決め手と勝ったチームを真ん中に大きく (縁は勝ったチームの色)。下に小さく点数
          els.banner.hidden = true;
          bigText([{ t: BIG_REASON[e.reason], cls: 'l1' }, { t: who, cls: 'l2' }, { t: `SET ${e.setNo} ・ ${e.points[0]} - ${e.points[1]} pt`, cls: 'info' }],
            e.winner === 0 ? 'blue' : e.winner === 1 ? 'red' : 'gray', (R.SET_OVER - 0.3) * 1000, 'result-text');
          focusLines(e.winner === 0 ? 'blue' : e.winner === 1 ? 'red' : 'white', 1600, e.winner === 0 ? 0.9 : 0.6);
          app.aim = null; els.throwPad.classList.remove('on');
          break;
        }
        case 'royaleEnd': {
          sound.music(null);
          sound.whistle(true);
          els.banner.hidden = true;
          const winMe = e.winner === mine;
          bigText([{ t: winMe ? '優勝!' : `${NAMES[e.winner]}の優勝`, cls: 'l1' }, { t: e.by === 'time' ? '時間切れ' : '最後の1人', cls: 'l2' }],
            winMe ? 'blue' : 'gray', (R.SET_OVER - 0.3) * 1000, 'result-text');
          if (winMe) focusLines('gold', 2200, 0.95);
          app.aim = null; els.throwPad.classList.remove('on');
          break;
        }
        case 'matchEnd':
          showResult();
          break;
        case 'vtStart':
          resetPlayers();
          for (let i = 0; i < m.players.length; i++) if (!m.players[i].alive) views.players[i].outT = 99;
          snapCamera();
          showBanner('ビクトリースロー<small>セットもポイントも同点。相手のフラッグに当てろ</small>', '', 2.4);
          sound.whistle(true);
          break;
        case 'vtThrow': {
          if (e.hit) { puff(e.x, e.y, e.z, 16, 1.2); sound.hit(); }
          else sound.splat(false);
          const mineTurn = e.team === 0;
          showBanner(`${e.hit ? '命中!' : 'はずれ'}<small>${mineTurn ? 'あお' : 'あか'} ${e.round}本目 ・ ${vtTally()}</small>`,
            e.hit ? (mineTurn ? 'blue' : 'red') : '', 1.0);
          break;
        }
        case 'vtRound':
          showBanner(`${e.round}本目<small>${vtTally()}</small>`, '', 1.0);
          break;
        case 'vtEnd':
          sound.whistle(true);
          els.banner.hidden = true;
          bigText([{ t: e.winner === 0 ? 'あおの勝ち!' : 'あかの勝ち!', cls: 'l1' }, { t: `ビクトリースロー ${vtTally()}`, cls: 'info' }],
            e.winner === 0 ? 'blue' : 'red', (R.SET_OVER - 0.3) * 1000, 'result-text');
          break;
      }
    }
  }

  /** ビクトリースローの当たり外れ: ●=命中 ○=はずれ */
  function vtTally() {
    const vt = app.match && app.match.vt;
    if (!vt) return '';
    const row = (h) => h.map((x) => (x ? '●' : '○')).join('');
    return `あお ${row(vt.hits[0]) || '-'} / あか ${row(vt.hits[1]) || '-'}`;
  }

  function showResult() {
    const m = app.match;
    app.running = false;
    sound.music(null);
    if (m.mode === 'royale') { showRoyaleResult(m); return; }
    const kind = m.winner === 0 ? 'win' : m.winner === 1 ? 'lose' : 'draw';
    const title = kind === 'win' ? '勝利!' : kind === 'lose' ? '負け…' : '引き分け';
    els.resultTitle.textContent = title;
    els.resultTitle.dataset.t = title;
    els.vResult.classList.remove('win', 'lose', 'draw');
    els.vResult.classList.add(kind);
    // あお n - n あか (取ったセットの数)
    els.resultScore.innerHTML = `<div class="t blue">あお<b>${m.setWins[0]}</b></div><div class="vs">SET</div><div class="t red">あか<b>${m.setWins[1]}</b></div>`;
    const ICON = { flag: '🚩', allout: '❄️', time: '⏱', over: '⚠️' };
    const rows = m.setResults.map((r, i) => {
      const who = r.winner === 0 ? 'あお' : r.winner === 1 ? 'あか' : '引き分け';
      return `<li class="w${r.winner}"><span class="no">SET ${i + 1}</span><span class="why">${ICON[r.reason] || ''} ${who} ・ ${REASON[r.reason]}</span><b class="pts">${r.points[0]} - ${r.points[1]}</b></li>`;
    });
    rows.push(`<li class="total">セット ${m.setWins[0]} - ${m.setWins[1]} ・ ポイント ${m.points[0]} - ${m.points[1]}</li>`);
    if (m.vt) rows.push(`<li class="total">ビクトリースロー ${vtTally()}</li>`);
    if (m.decidedBy) rows.push(`<li class="by">${DECIDED[m.decidedBy]}で決着</li>`);
    els.resultSets.innerHTML = rows.join('');
    els.vResult.hidden = false;
    confetti(kind);
    if (m.winner === 0) sound.win();
  }

  /** 勝ったら紙吹雪 (チームの色と金)。負けたら雪だけが降る */
  function confetti(kind) {
    const cf = els.confetti; cf.innerHTML = '';
    const cols = kind === 'win' ? ['#2f6fe0', '#ffd34d', '#ffffff', '#5cc8ff', '#ff8a4c'] : ['#ffffff'];
    const n = kind === 'win' ? 46 : 22;
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.style.left = (Math.random() * 100) + '%';
      el.style.background = cols[i % cols.length];
      if (kind !== 'win') { el.style.width = el.style.height = (3 + Math.random() * 4) + 'px'; el.style.borderRadius = '50%'; }
      el.style.setProperty('--dx', ((Math.random() - 0.5) * 160) + 'px');
      el.style.setProperty('--rot', (kind === 'win' ? 360 + Math.random() * 720 : 0) + 'deg');
      el.style.animationDuration = (2.4 + Math.random() * 2.6) + 's';
      el.style.animationDelay = (Math.random() * 1.6) + 's';
      cf.appendChild(el);
    }
  }

  /** バトルロイヤルの結果: 自分の順位を大きく、下に 8 人の順位 (色・名前・倒した数) */
  function showRoyaleResult(m) {
    const mine = m.human, place = m.players[mine].place || 8;
    const kind = place === 1 ? 'win' : place <= 3 ? 'draw' : 'lose';
    const title = place === 1 ? '優勝!' : `${place}位`;
    els.resultTitle.textContent = title;
    els.resultTitle.dataset.t = title;
    els.vResult.classList.remove('win', 'lose', 'draw');
    els.vResult.classList.add(kind);
    const me0 = m.players[mine];
    els.resultScore.innerHTML = `<div class="rank-big">${m.players.length}人中 ・ 倒した <b>${me0.kills}</b> 人</div>`;
    const rows = m.ranking.map((id, i) => {
      const q = m.players[id];
      const you = id === mine;
      return `<li class="rk p${i + 1}${you ? ' you' : ''}"><b class="pl">${i + 1}位</b><i class="chip" style="background:${teamHex(q.team)}"></i>` +
        `<span class="nm">${NAMES[q.team]}${you ? '<small>あなた</small>' : ''}</span><span class="kl">${q.alive ? `のこり体力 ${q.hp}` : '脱落'} ・ 倒した ${q.kills}</span></li>`;
    });
    rows.push(`<li class="by">${m.decidedBy === 'time' ? '時間切れ (残った人は体力の多い順)' : '最後の1人で決着'}</li>`);
    els.resultSets.innerHTML = rows.join('');
    els.vResult.hidden = false;
    confetti(kind);
    if (place === 1) sound.win();
  }

  // ------------------------------------------------------------ 描く
  /** カメラが追う選手。ビクトリースローでは、いま投げる番の選手 */
  function camSubject() {
    const m = app.match;
    if (m && m.phase === 'vt' && m.vt) return m.players[m.vt.ids[m.vt.turn]];
    return me();
  }

  function snapCamera() {
    const p = camSubject();
    const target = camTarget(p);
    camPos.copy(target.pos); camLook.copy(target.look);
  }

  /**
   * 寄りを重ねる。pos と look を書き換える。
   * - 構え: 投げるを押さえている間 (かんたんは 0.15 秒より長く押さえたとき)、狙う相手の方へ寄る。なめらかに出入りする
   * - 当てた瞬間: 当てた所へ寄って、0.75 秒で戻る (時間は実時間で進める。スローの間も同じ速さ)
   */
  function composeCam(dt, pos, look) {
    // タイトルの後ろ: コートのまわりをゆっくり回る (1 周 60 秒)
    if (!els.vTitle.hidden) {
      app.orbitT = (app.orbitT || 0) + dt;
      const a = app.orbitT * Math.PI * 2 / 60 + 0.3;
      pos.set(Math.sin(a) * 24, 10, Math.cos(a) * 24);
      look.set(0, 0.5, 0);
      return;
    }
    const m = app.match, p = me();
    const lockQ = app.lock && app.lock.target != null && m ? m.players[app.lock.target] : null;
    // バトルロイヤルでは構えても寄らない: 21m 上から 4m まで下がって相手の方へ回りこむので、
    // 見えている相手が 3 人 → 1 人に減り、相手が手前 (南) にいると画面の上下と移動の向きが逆になった
    const royale = !!(m && m.mode === 'royale');
    const wantAim = !royale && !!(app.aim && !app.aimCancel && m && m.phase === 'play' && p && p.alive && lockQ && lockQ.alive &&
      (m.aimMode === 'hard' || performance.now() - (app.aim.t0 || 0) > AIM_CAM.holdMs));
    app.aimZoom = lerpN(app.aimZoom || 0, wantAim ? 1 : 0, dt * AIM_CAM.rate);
    if (wantAim) app.aimCamQ = { x: lockQ.x, z: lockQ.z, px: p.x, pz: p.z };
    const aq = app.aimCamQ;
    if (app.aimZoom > 0.002 && aq) {
      const w = app.aimZoom * app.aimZoom * (3 - 2 * app.aimZoom);     // なめらかに
      let dx = aq.x - aq.px, dz = aq.z - aq.pz;
      const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      pos.lerp(new T.Vector3(aq.px - dx * AIM_CAM.back, AIM_CAM.up, aq.pz - dz * AIM_CAM.back), w);
      look.lerp(new T.Vector3(aq.px + (aq.x - aq.px) * AIM_CAM.look, 0.9, aq.pz + (aq.z - aq.pz) * AIM_CAM.look), w);
    }
    const hc = app.hitCam;
    if (hc) {
      hc.t += dt;
      const t = hc.t, T0 = 0.12, T1 = 0.45;
      // バトルロイヤルは寄りを浅く (まわりの敵を見失わないように)
      const w = (t < T0 ? t / T0 : t < T1 ? 1 : Math.max(0, 1 - (t - T1) / (HIT_CAM.time - T1))) * HIT_CAM.amount * (royale ? HIT_CAM.royale : 1);
      let vx = pos.x - hc.x, vz = pos.z - hc.z;
      const vl = Math.hypot(vx, vz) || 1; vx /= vl; vz /= vl;
      pos.lerp(new T.Vector3(hc.x + vx * HIT_CAM.dist, HIT_CAM.up, hc.z + vz * HIT_CAM.dist), w);
      look.lerp(new T.Vector3(hc.x, 0.9, hc.z), w);
      app.hitCamW = w;
      if (t >= HIT_CAM.time) { app.hitCam = null; app.hitCamW = 0; }
    }
  }

  /** カメラから見て、その選手が壁に隠れているか (カメラ → 体の真ん中 の線が壁の箱を通るか) */
  function hiddenByWall(p) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const tx = p.x, ty = C.playerHeight(p) * 0.55, tz = p.z;
    for (const s of C.SHELTERS) {
      let t0 = 0, t1 = 1, ok = true;
      for (const [a, b, lo, hi] of [[cx, tx, s.x - s.w / 2, s.x + s.w / 2], [cy, ty, 0, s.h], [cz, tz, s.z - s.d / 2, s.z + s.d / 2]]) {
        const d = b - a;
        if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) { ok = false; break; } continue; }
        let u = (lo - a) / d, v = (hi - a) / d;
        if (u > v) { const w = u; u = v; v = w; }
        t0 = Math.max(t0, u); t1 = Math.min(t1, v);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t1 < 0.999) return true;
    }
    return false;
  }

  function camTarget(p) {
    if (app.match && app.match.mode === 'royale') {
      // バトルロイヤル: 自分の真うしろ (南) の少し上から。会場が正方形なので横にも寄せて追う
      const m = app.match;
      // 決戦では寄る。見る所は自分と相手のまん中、高さは 2 人の離れ具合で決める (いちばん寄って FINAL 倍)
      const foe = m.final && p && p.alive ? m.players.find((q) => q.alive && q.id !== p.id) : null;
      if (foe) {
        // 縦長の画面なので、横の離れ具合で決まることが多い (寄り f のとき、地面で見える幅は左右 5.8f m・上下 11f m ほど)
        const dx = foe.x - p.x, dz = foe.z - p.z;
        const f = clampN(Math.max((Math.abs(dx) / 2 + 1.6) / 5.8, (Math.abs(dz) / 2 + 2) / 11), ROYALE_CAM.final, 1);
        // それでも入らないほど横に離れたら、自分が画面に残るように、まん中を自分の側へ寄せる
        const kx = Math.max(0, 5.8 * f - 1.6) * 2;
        const cx = p.x + clampN(dx, -kx, kx) / 2, cz = p.z + dz / 2;
        const back = (ROYALE_CAM.back + ROYALE_CAM.ahead) * f;
        return { pos: new T.Vector3(cx, ROYALE_CAM.h * f, cz + back), look: new T.Vector3(cx, 0, cz) };
      }
      const f = 1;
      const lim = Math.max(2, C.ARENA.hw - 3);       // 縮んだステージに合わせて、外を写しすぎない
      const x = p ? clampN(p.x, -lim, lim) : 0, z = p ? clampN(p.z, -lim - 1, lim + 1) : 0;
      return { pos: new T.Vector3(x, ROYALE_CAM.h * f, z + ROYALE_CAM.back * f), look: new T.Vector3(x, 0, z - ROYALE_CAM.ahead * f) };
    }
    const x = p ? p.x * 0.35 : 0;
    // あかの選手を追うとき (ビクトリースローのあかの番) は、反対側から見る
    const f = p && p.team === 1 && app.match && app.match.phase === 'vt' ? -1 : 1;
    const z = p ? (f > 0 ? clampN(p.z, -16, 17) : clampN(p.z, -17, 16)) : 12;
    return { pos: new T.Vector3(x, CAM.h, z + CAM.back * f), look: new T.Vector3(x, 0, z - CAM.ahead * f) };
  }
  function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }

  function render(dt) {
    const m = app.match;
    const t = performance.now() / 1000;
    if (m) {
      const mine = me();
      for (let i = 0; i < m.players.length; i++) {
        const p = m.players[i], v = views.players[i];
        if (!v) continue;
        // 退場: 倒れて消える
        if (!p.alive) {
          if (v.hpSpr) v.hpSpr.visible = false;
          if (v.outT < 0) v.outT = 0;
          v.outT += dt;
          v.pose.rotation.x = Math.min(1, v.outT * 4) * -1.35;
          const kb = v.kb ? (1 - Math.exp(-v.outT * 7)) * 1.3 : 0;
          v.root.position.set(p.x + (v.kb ? v.kb.x * kb : 0), Math.max(0, Math.sin(Math.min(1, v.outT * 3) * Math.PI) * 0.35), p.z + (v.kb ? v.kb.z * kb : 0));
          const k = Math.max(0, 1 - Math.max(0, v.outT - 0.8) / 0.6);
          v.root.visible = k > 0;
          v.shadow.visible = k > 0;
          v.root.scale.setScalar(0.4 + 0.6 * k);
          if (v.mark) v.mark.visible = false;
          if (v.spr) {
            // 倒れる: 縦に立てた板のまま傾けると、縦に伸ばしたぶんが斜めに出て細長く伸びて見える。
            // 倒れる間だけ板をカメラにまっすぐ向け、伸ばしたぶんを戻してから、画面の中で傾ける
            const sm = v.spr.mesh;
            const fade = Math.max(0, 1 - Math.max(0, v.outT - 0.9) / 0.3);   // 最後の 0.3 秒だけ薄くする
            sm.visible = fade > 0;
            sm.position.copy(v.root.position);
            sm.quaternion.copy(camera.quaternion);
            sm.rotateZ(Math.min(1, v.outT * 5) * (v.kb && v.kb.x < 0 ? 1.25 : -1.25));
            sm.scale.set(1, SPR_FALL, 1);
            sm.material.opacity = fade;
            // 横に倒した板の半分は雪面の下へもぐり、地面に隠れて上半分しか見えなかった。倒れている間は奥行きで隠さない
            sm.material.depthTest = false;
            sm.renderOrder = 4;
            if (fade <= 0 && !v.poofed) { v.poofed = true; puff(sm.position.x, 0.4, sm.position.z, 12, 0.7); }
            v.root.visible = false; v.shadow.visible = fade > 0;
          }
          continue;
        }
        v.root.visible = true; v.shadow.visible = true; v.root.scale.setScalar(1);
        v.pose.rotation.x = 0;
        const h = C.playerHeight(p);
        const cTarget = h < R.STAND_H ? 1 : 0;
        v.crouch += (cTarget - v.crouch) * Math.min(1, dt * 14);
        v.pose.scale.y = 1 - v.crouch * 0.4;
        v.root.position.set(p.x, 0, p.z);
        // 向きはなめらかに
        let dr = p.face - v.root.rotation.y;
        while (dr > Math.PI) dr -= Math.PI * 2;
        while (dr < -Math.PI) dr += Math.PI * 2;
        v.root.rotation.y += dr * Math.min(1, dt * 12);
        // 走る揺れ
        const sp = Math.hypot(p.vx, p.vz);
        v.step += sp * dt * 3.2;
        v.root.position.y = sp > 0.3 ? Math.abs(Math.sin(v.step)) * 0.08 : 0;
        // 腕: 投げる・丸める
        if (v.throwT > 0) {
          v.throwT -= dt;
          const k = 1 - v.throwT / 0.35;
          v.shoulder.rotation.x = k < 0.35 ? lerpN(0, 2.6, k / 0.35) : lerpN(2.6, -1.2, (k - 0.35) / 0.65);
        } else if (p.crouch && p.standT <= 0 && p.makeT > 0) {
          v.shoulder.rotation.x = -0.9 + Math.sin(t * 14) * 0.3;
          v.shoulder2.rotation.x = -0.9 - Math.sin(t * 14) * 0.3;
        } else {
          v.shoulder.rotation.x = Math.sin(v.step) * 0.6 * Math.min(1, sp);
          v.shoulder2.rotation.x = -Math.sin(v.step) * 0.6 * Math.min(1, sp);
        }
        v.hand.visible = p.balls > 0;
        v.shadow.position.set(p.x, 0.014, p.z);
        if (v.mark) { v.mark.visible = true; v.mark.position.set(p.x, 0.018, p.z); }
        if (v.spr) {
          const sm = v.spr.mesh;
          sm.visible = true;
          // 低いカメラでは壁に隠れやすい。自分と、狙っている相手だけは、壁に隠れたら透けて見せる
          const xray = (p.id === m.human || (app.lock && app.lock.target === p.id)) && hiddenByWall(p);
          // バトルロイヤル: 当たった直後の無敵の間は点滅、体力 1 は赤く脈うつ
          const blink = p.inv > 0 && Math.floor(t * 14) % 2 === 0;
          sm.material.opacity = xray ? 0.6 : blink ? 0.35 : 1;
          if (v.hpSpr) {
            const red = p.hp === 1 ? 0.5 + 0.5 * Math.sin(t * 10) : 0;
            sm.material.color.setRGB(1, 1 - red * 0.55, 1 - red * 0.6);
          }
          sm.material.depthTest = !xray;
          sm.renderOrder = xray ? 5 : 3;
          v.xray = xray;
          // 縦に伸ばす量は、その選手をカメラから見下ろす角度で決める。
          // 画面の上 (遠く) の選手ほど浅く見るので、決まった角度で伸ばすと遠くの選手が縦長になっていた (縦÷横 1.35)
          {
            const dx = camera.position.x - p.x, dz = camera.position.z - p.z, dy = camera.position.y - SPR_H * 0.3;
            const elev = Math.atan2(dy, Math.hypot(dx, dz));
            sm.scale.set(1, Math.cos(CAM_PITCH) / Math.max(0.2, Math.cos(elev)), 1);
          }
          sm.position.set(p.x, v.root.position.y, p.z);
          sm.rotation.set(0, Math.atan2(camera.position.x - p.x, camera.position.z - p.z), 0);
          setFrame(v, pickFrame({
            face: v.root.rotation.y, camSign: camera.position.z >= camLook.z ? 1 : -1, team: p.team,
            throwT: v.throwT, crouch: v.crouch > 0.5, making: p.makeT > 0, speed: sp, step: v.step, t
          }));
        }
      }

      // 球
      const seen = new Set();
      for (const b of m.balls) {
        const v = ballView(b);
        v.mesh.position.set(b.x, b.y, b.z);
        // 自分の玉には、うしろに粉雪の尾
        if (m.human != null && b.owner === m.human && (app.frames & 1)) puff(b.x, b.y, b.z, 1, 0.12);
        v.shadow.position.set(b.x, 0.016, b.z);
        const s = 1 / (1 + b.y * 0.25);
        v.shadow.scale.set(0.32 * s, 0.32 * s, 1);
        seen.add(b.id);
      }
      for (const [id, v] of views.balls) {
        if (seen.has(id)) continue;
        scene.remove(v.mesh); scene.remove(v.shadow);
        views.balls.delete(id);
      }

      // 頭の上の体力 (バトルロイヤル)。自分は矢印の上に出す
      for (let i = 0; i < m.players.length; i++) {
        const p = m.players[i], v = views.players[i];
        if (!v || !v.hpSpr || !p.alive) continue;
        v.hpSpr.visible = true;
        const tex = hpTex(Math.max(0, p.hp));
        if (v.hpSpr.material.map !== tex) { v.hpSpr.material.map = tex; v.hpSpr.material.needsUpdate = true; }
        const hurt = v.hurtT > 0 ? (v.hurtT -= dt, 1 + v.hurtT * 1.6) : 1;   // 減った瞬間に少しふくらむ
        v.hpSpr.scale.set(HP_SPR.w * hurt, HP_SPR.h * hurt, 1);
        // 絵の板は見下ろしで縮むぶん縦に伸ばしてあるので、頭の高さもその分だけ上げる
        const stretch = v.spr ? v.spr.mesh.scale.y : 1;
        v.hpSpr.position.set(p.x, headTop(p) * stretch + (p.id === m.human ? 0.85 : 0.4), p.z);
      }

      // 画角はあそび方で替える
      const fov = m.mode === 'royale' ? ROYALE_CAM.fov : CAM.fov;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      // 決戦: 縮んでいく会場のふちに赤い柵
      const showZone = m.mode === 'royale' && C.ARENA.hw < R.ROYALE.HALF - 0.01;   // 縮み始めたら柵を出す
      zone.visible = showZone;
      if (showZone) {
        const hw = C.ARENA.hw;
        const H = R.ROYALE.HALF + 0.2, w = H - hw;   // 柵から、もとの会場のふちまで
        zone.children.forEach((b, i) => {
          if (i >= 4) return;
          const along = i < 2;   // 0,1: 北と南 (x 方向に長い) / 2,3: 西と東
          const sgn = i % 2 ? 1 : -1;
          b.scale.set(along ? hw * 2 : 1, 1, along ? 1 : hw * 2);
          b.position.set(along ? 0 : sgn * hw, 0.3, along ? sgn * hw : 0);
        });
        outside.forEach((pl, i) => {
          const ns = i < 2, sgn = i % 2 ? 1 : -1;
          pl.visible = w > 0.05;
          pl.scale.set(ns ? H * 2 : w, ns ? w : hw * 2, 1);
          pl.position.set(ns ? 0 : sgn * (hw + w / 2), 0.03, ns ? sgn * (hw + w / 2) : 0);
        });
        zoneMat.opacity = 0.45 + 0.25 * Math.sin(t * 6);
      }

      // 自分の印
      if (mine && mine.alive) {
        meRing.visible = true; meArrow.visible = true;
        meRing.position.set(mine.x, 0.02, mine.z);
        meArrow.position.set(mine.x, headTop(mine) + 0.1 + Math.sin(t * 5) * 0.08, mine.z);
      } else { meRing.visible = false; meArrow.visible = false; }

      // カメラ: 自分を追う (斜め上から)
      const target = camTarget(camSubject());
      const k = Math.min(1, dt * 5);
      camPos.lerp(target.pos, k);
      camLook.lerp(target.look, k);
    }

    // 旗をなびかせる
    if (app.flags) {
      for (const f of app.flags) {
        const arr = f.cloth.geometry.attributes.position.array;
        for (let i = 0; i < arr.length; i += 3) {
          const x = f.base[i];
          arr[i + 2] = Math.sin(t * 6 + x * 5) * 0.08 * x;
        }
        f.cloth.geometry.attributes.position.needsUpdate = true;
      }
    }

    stepPuffs(dt);
    updateAim();

    // 追いかけるカメラ (camPos/camLook) に、構えたときと当てたときの寄りを重ねる
    camera.position.copy(camPos);
    const look = camLook.clone();
    composeCam(dt, camera.position, look);
    if (app.shake > 0) {
      app.shake -= dt;
      camera.position.x += (Math.random() - 0.5) * app.shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * app.shake * 0.6;
    }
    if (app.hitShake > 0) {
      // 当てた瞬間の揺れ: 左右と上下に、短い周期で、すぐ小さくなる
      app.hitShake = Math.max(0, app.hitShake - dt);
      const k = app.hitShake / HIT_SHAKE.time, a = HIT_SHAKE.amp * k * k, t = performance.now() / 1000;
      camera.position.x += Math.sin(t * 95) * a;
      camera.position.y += Math.cos(t * 77) * a * 0.7;
    }
    camera.lookAt(look);
    updateFans(performance.now() / 1000, Math.min(0.05, (performance.now() - (updateFans.last || performance.now())) / 1000)); updateFans.last = performance.now();
    renderer.render(scene, camera);
  }
  function lerpN(a, b, k) { return a + (b - a) * Math.max(0, Math.min(1, k)); }

  // ------------------------------------------------------------ 上の表示 (変わったときだけ書き換える)
  function setText(key, el, text) {
    if (app.hud[key] === text) return;
    app.hud[key] = text;
    el.textContent = text;
  }
  function setHTML(key, el, html) {
    if (app.hud[key] === html) return;
    app.hud[key] = html;
    el.innerHTML = html;
  }
  function dots(n, total, cls) {
    let s = '';
    for (let i = 0; i < total; i++) s += `<i class="${i < n ? cls : ''}"></i>`;
    return s;
  }

  /**
   * 画面の外や上の帯の下にある物を、帯のすぐ下の端に矢印で出す (狙っている相手・相手のフラッグ)。
   * 見えているときは出さない
   */
  function edgeMark(el, key, wx, wy, wz, label) {
    let show = false, x = 0;
    if (wx != null) {
      const v = new T.Vector3(wx, wy, wz).project(camera);
      const r = els.canvas.getBoundingClientRect();
      const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
      const top = app.hudBottom || 0;
      show = v.z > 1 || sy < top + 6 || sx < 0 || sx > r.width;
      x = Math.max(36, Math.min(r.width - 36, sx));
    }
    const st = app.hud[key] || {};
    if (st.show !== show) { el.hidden = !show; st.show = show; }
    if (show) {
      // 帯の下端にまたがせて置く (コートの奥、相手のバックスがいる所をなるべく隠さない)
      const tx = Math.round(x), ty = Math.round((app.hudBottom || 0) - 7);
      if (st.x !== tx || st.y !== ty) { el.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, 0)`; st.x = tx; st.y = ty; }
      if (label != null && st.label !== label) { el.lastChild.textContent = label; st.label = label; }
    }
    app.hud[key] = st;
  }

  function updateEdgeMarks() {
    const m = app.match, p = me();
    const playing = m && app.running && m.phase === 'play' && p && p.alive;
    if (playing && app.lock && app.lock.target != null) {
      const q = m.players[app.lock.target];
      edgeMark(els.markLock, 'mkLock', q.x, 1.0, q.z, `狙い ${Math.round(Math.hypot(q.x - p.x, q.z - p.z))}m`);
    } else edgeMark(els.markLock, 'mkLock', null);
    if (playing && m.mode !== 'royale') {
      const f = C.flagPos(1 - p.team);
      edgeMark(els.markFlag, 'mkFlag', f.x, 2.0, f.z, `フラッグ ${Math.round(Math.hypot(f.x - p.x, f.z - p.z))}m`);
    } else edgeMark(els.markFlag, 'mkFlag', null);
  }

  function updateHud() {
    const m = app.match;
    if (!m) return;
    if (m.mode === 'royale') updateRoyaleHud(m); else updateTeamHud(m);
    updatePadHud(m);
  }

  /** バトルロイヤルの帯: のこり人数 (色の点)・時間・自分の体力・倒した数 */
  function updateRoyaleHud(m) {
    const sec = Math.ceil(Math.max(0, m.time));
    setText('rt', els.rTime, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    const hurry = sec <= 10 && m.phase === 'play';
    if (app.hud.rhurry !== hurry) { app.hud.rhurry = hurry; els.rTime.classList.toggle('hurry', hurry); }
    const alive = m.players.filter((q) => q.alive).length;
    setText('ra', els.rAlive, String(alive));
    setHTML('rd', els.rDots, m.players.map((q) => `<i class="${q.alive ? '' : 'out'}" style="background:${teamHex(q.team)}"></i>`).join(''));
    const p = me();
    const hp = p && p.alive ? p.hp : 0;
    let hh = '';
    for (let i = 0; i < R.ROYALE.HP; i++) hh += `<i class="${i < hp ? '' : 'lost'}"></i>`;
    setHTML('rh', els.rHp, hh);
    const danger = hp === 1 && m.phase === 'play';
    if (app.hud.rdanger !== danger) { app.hud.rdanger = danger; els.rHp.classList.toggle('danger', danger); els.game.classList.toggle('hp-danger', danger); }
    setText('rk', els.rKills, `倒した ${p ? p.kills : 0}`);
    const fin = !!m.final;
    if (app.hud.rfin !== fin) { app.hud.rfin = fin; els.rLabel.textContent = fin ? 'FINAL BATTLE' : 'BATTLE ROYALE'; els.rLabel.classList.toggle('final', fin); }
  }

  function updateTeamHud(m) {
    const sec = Math.ceil(Math.max(0, m.time));
    setText('time', els.time, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
    const hurry = sec <= 10 && m.phase === 'play';
    if (app.hud.hurry !== hurry) { app.hud.hurry = hurry; els.time.classList.toggle('hurry', hurry); }
    setText('setNo', els.setNo, `SET ${m.setNo}`);
    const need = Math.floor(R.SETS / 2) + 1;
    setHTML('sb', els.setsBlue, dots(m.setWins[0], need, 'won'));
    setHTML('sr', els.setsRed, dots(m.setWins[1], need, 'won'));
    const a0 = C.aliveCount(m, 0), a1 = C.aliveCount(m, 1);
    setHTML('ab', els.aliveBlue, aliveDots(a0));
    setHTML('ar', els.aliveRed, aliveDots(a1));
    setText('stb', els.stockBlue, `雪玉 ${m.stock[0]}`);
    setText('str', els.stockRed, `雪玉 ${m.stock[1]}`);
    setText('pb', els.ptsBlue, `${m.points[0]}pt`);
    setText('pr', els.ptsRed, `${m.points[1]}pt`);
    // ビクトリースロー: 時計の所を VT にし、使わない表示と操作を隠す
    const vtMode = !!m.vt;
    if (app.hud.vt !== vtMode) { app.hud.vt = vtMode; els.game.classList.toggle('vt-mode', vtMode); }
    if (vtMode) {
      setText('time', els.time, 'VT');
      setText('setNo', els.setNo, `${m.vt.round}本目`);
    }
    // 相手コートに入っているあおの人数 (3 人まで。4 人目で反則負け)
    const inE = m.players.filter((q) => q.team === 0 && C.inEnemyCourt(q)).length;
    setText('ie', els.inEnemy, `敵陣 ${inE}/${R.MAX_IN_ENEMY}`);
    const full = inE >= R.MAX_IN_ENEMY;
    if (app.hud.full !== full) { app.hud.full = full; els.inEnemy.classList.toggle('full', full); }
    // 自分が 4 人目になりそうなら知らせる
    const me0 = me();
    const danger = !!(m.phase === 'play' && me0 && me0.alive && !C.inEnemyCourt(me0) && full && C.side(me0.team) * me0.z < 3);
    if (app.hud.danger !== danger) {
      app.hud.danger = danger;
      els.warn.hidden = !danger;
      app.centerLine.color.setHex(danger ? 0xff2a1a : 0xe86a62);
    }
  }

  /** 投げるボタンまわり (どちらのあそび方でも同じ) */
  function updatePadHud(m) {
    const p = me();
    const balls = p ? p.balls : 0;
    let bh = '';
    for (let i = 0; i < R.MAX_CARRY; i++) bh += `<i class="${i < balls ? '' : 'none'}"></i>`;
    setHTML('mb', els.myBalls, bh);
    // 必殺ゲージ (当てると貯まる。満タンなら次の 1 球が大玉)
    const sp = p ? m.sp[p.team] || 0 : 0;
    const spq = Math.round(sp * 12) / 12;
    if (app.hud.sp !== spq) { app.hud.sp = spq; els.spGauge.style.setProperty('--sp', spq); els.throwPad.classList.toggle('super', sp >= 1); els.padLabel.textContent = sp >= 1 ? '大玉!' : '投げる'; }
    const empty = balls === 0;
    if (app.hud.empty !== empty) { app.hud.empty = empty; els.throwPad.classList.toggle('empty', empty); }
    // 丸めている進み具合 (12段階に丸める。細かく書き換えると遅い端末でカクつく)
    // 投げた直後は構え直し (ボタンが沈み、ふちが灰色で戻っていく)
    const recover = !!(p && p.cd > 0 && balls > 0 && app.match.phase === 'play');
    if (app.hud.recover !== recover) { app.hud.recover = recover; els.throwPad.classList.toggle('recover', recover); }
    const aiming = !!(p && app.aim && app.match.phase === 'play' && app.match.aimMode !== 'easy') && !recover;
    if (app.hud.aiming !== aiming) { app.hud.aiming = aiming; els.throwPad.classList.toggle('aiming', aiming); }
    const prog = recover ? Math.round((1 - p.cd / R.THROW_CD) * 12) / 12
      : aiming ? Math.round(p.aimF * 12) / 12
      : p && p.makeT > 0 ? Math.round(p.makeT / R.MAKE_TIME * 12) / 12 : 0;
    if (app.hud.prog !== prog) { app.hud.prog = prog; els.makeRing.style.setProperty('--p', prog); }
  }
  function aliveDots(n) {
    let s = '';
    for (let i = 0; i < 7; i++) s += `<i class="${i < n ? '' : 'out'}"></i>`;
    return s;
  }

  // ------------------------------------------------------------ ループ
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - app.last) / 1000;
    app.last = now;
    if (!(dt > 0)) dt = 0;          // 1 コマ目や時計の巻き戻りで負になることがある
    dt = Math.min(dt, 0.05);
    app.frames++;

    if (app.match && app.running && !app.paused) {
      // 止まると自動でしゃがむ (しゃがむと雪玉を丸める)。動けば立つ
      const moving = Math.hypot(app.input.mx, app.input.mz) > 0.05;
      app.idleT = moving ? 0 : app.idleT + dt;
      app.input.crouch = app.idleT >= AUTO_CROUCH;
      // 当てた瞬間は一瞬だけゆっくりにする (ヒットストップ)
      let simDt = dt;
      if (app.slowT > 0) { app.slowT -= dt; simDt = dt * 0.2; }
      app.acc += simDt;
      const h = 1 / 60;
      let n = 0;
      while (app.acc >= h && n < 4) {
        const inp = {
          mx: app.input.mx, mz: app.input.mz, crouch: app.input.crouch,
          aiming: !!app.aim && !app.aimCancel && app.match.phase === 'play',   // 投げるを押さえている間は構える (立つ)。取り消しの位置では構えない
          aimTarget: app.lock && app.aim ? app.lock.target : null,
          throwAt: app.input.throwAt
        };
        app.input.throwAt = null;
        C.step(app.match, h, inp);
        app.acc -= h; n++;
      }
      if (n === 4) app.acc = 0;
      handleEvents();
      // バトルロイヤルで脱落したら、OUT!! を見せてから残りを先へ進めて結果へ
      if (app.running && app.outAt && performance.now() - app.outAt > 2600) { app.outAt = 0; finishRoyale(); }
    }
    if (app.bannerT > 0) {
      app.bannerT -= dt;
      if (app.bannerT <= 0) els.banner.hidden = true;
    }
    updateHud();
    updateBarColor();
    render(app.paused ? 0 : dt);
    updateEdgeMarks();
  }

  /**
   * 時計や電池の帯の色 (theme-color) を、いま出ている画面に合わせる。
   * 帯の下まで描けない開き方 (前に追加したホーム画面のアイコン・Safari) では、帯がこの色の板になる。
   * タイトルと結果は暗い幕なので暗く、試合中は空の色
   */
  const BAR = { dark: '#384660', game: '#cfe3f5' };   // dark はタイトルの幕のいちばん上の色 (実機の写真から読んだ)
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  function updateBarColor() {
    const col = (!els.vTitle.hidden || !els.vResult.hidden) ? BAR.dark : BAR.game;
    if (app.barCol === col) return;
    app.barCol = col;
    if (themeMeta) themeMeta.setAttribute('content', col);
    document.documentElement.style.background = col;      // 帯の色に html の背景を使う版もある
  }

  function resize() {
    const w = els.game.clientWidth, h = els.game.clientHeight;
    if (!(w >= 1 && h >= 1)) return;   // 回転中などに 0 が来ることがある
    renderer.setSize(w, h, false);
    app.hudBottom = els.score.getBoundingClientRect().bottom;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    els.ver.textContent = `${VERSION} 描ける${h} / 窓${window.innerHeight}`;
  }

  function pause(on) {
    if (!app.running) return;
    app.paused = on;
    els.vPause.hidden = !on;
    sound.musicMute(on);
    if (on) {
      app.aim = null; app.stickTouch = null;
      app.input.mx = app.input.mz = 0; app.input.crouch = false;
      els.throwPad.classList.remove('on'); els.stick.classList.remove('on');
      setKnob(0, 0);
    }
  }

  function toTitle() {
    app.running = false;
    sound.music(null); sound.musicMute(false);
    app.paused = false;
    els.vPause.hidden = true;
    els.vResult.hidden = true;
    els.vTitle.hidden = false;
    // 後ろに流すデモは、いつもチーム戦
    if (!app.match || app.match.mode !== 'team' || app.match.human != null) {
      app.match = C.createMatch({ seed: Date.now() >>> 0, human: null, skill: [0.55, 0.55] });
      ensureField('team');
      resetPlayers();
    }
    els.game.classList.remove('royale-mode', 'hp-danger');
    app.hud = {};
  }

  function main() {
    ensureField('team');
    loadSprites();
    bindControls();
    // 投げ方のえらび (前に選んだ方を覚えておく)
    try { const v = localStorage.getItem('yukigassen.aimMode'); if (v === 'easy' || v === 'hard') app.aimMode = v; } catch (err) { /* 覚えられなくても動く */ }
    const showMode = () => document.querySelectorAll('.diff button').forEach((x) => x.classList.toggle('on', x.dataset.mode === app.aimMode));
    document.querySelectorAll('.diff button').forEach((b) => {
      b.addEventListener('click', () => {
        app.aimMode = b.dataset.mode;
        try { localStorage.setItem('yukigassen.aimMode', app.aimMode); } catch (err) { /* 覚えられなくても動く */ }
        showMode();
      });
    });
    showMode();
    // あそび方のえらび (チーム戦 / バトルロイヤル)。これも覚えておく
    try { const v = localStorage.getItem('yukigassen.gameMode'); if (v === 'team' || v === 'royale') app.gameMode = v; } catch (err) { /* 覚えられなくても動く */ }
    const TAGS = { team: '7対7 ・ 2セット先取 ・ 当たったら退場', royale: '8人 ・ 全員が敵 ・ 3回当たったら脱落' };
    const showGMode = () => {
      document.querySelectorAll('.gmode button').forEach((x) => x.classList.toggle('on', x.dataset.gmode === app.gameMode));
      if (els.tagLine) els.tagLine.textContent = TAGS[app.gameMode];
    };
    document.querySelectorAll('.gmode button').forEach((b) => {
      b.addEventListener('click', () => {
        app.gameMode = b.dataset.gmode;
        try { localStorage.setItem('yukigassen.gameMode', app.gameMode); } catch (err) { /* 覚えられなくても動く */ }
        showGMode();
      });
    });
    showGMode();
    els.btnStart.addEventListener('click', startMatch);
    els.btnAgain.addEventListener('click', startMatch);
    els.btnPause.addEventListener('click', () => pause(true));
    els.btnResume.addEventListener('click', () => pause(false));
    els.btnQuit.addEventListener('click', toTitle);
    els.btnToTitle.addEventListener('click', toTitle);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
    window.addEventListener('resize', resize);

    // タイトルに降る雪 (CSS で transform だけを動かす)
    if (els.snow) {
      for (let i = 0; i < 34; i++) {
        const f = document.createElement('i');
        const r = 2 + Math.random() * 4;
        f.style.width = f.style.height = r + 'px';
        f.style.left = (Math.random() * 100) + '%';
        f.style.opacity = (0.4 + Math.random() * 0.5).toFixed(2);
        f.style.setProperty('--dx', ((Math.random() - 0.5) * 120) + 'px');
        f.style.animationDuration = (6 + Math.random() * 8) + 's';
        f.style.animationDelay = (-Math.random() * 14) + 's';
        els.snow.appendChild(f);
      }
    }

    // タイトルの後ろでは、全員 AI の試合を流しておく
    app.match = C.createMatch({ seed: 7, human: null, skill: [0.55, 0.55] });
    resetPlayers();
    app.demo = true;
    resize();
    snapCamera();
    app.last = performance.now();
    requestAnimationFrame(frame);
    setInterval(() => {
      // デモは止まらないように流し続ける
      if (!app.running && app.demo && app.match && app.match.human == null) {
        for (let i = 0; i < 2; i++) C.step(app.match, 1 / 60);
        if (app.match.phase === 'matchOver') { app.match = C.createMatch({ seed: Date.now() >>> 0, human: null }); resetPlayers(); }
        C.drainEvents(app.match);
      }
    }, 33);

    // 自動テストから中身をのぞくための入口
    window.__app = {
      version: VERSION,
      app,
      match: () => app.match,
      me,
      start: (mode, seed, gmode) => {
        if (mode != null) app.aimMode = mode;
        app.gameMode = gmode || 'team';
        startMatch();
        if (seed != null) {
          app.match = newMatch(seed);
          resetPlayers(); snapCamera(); handleEvents();
        }
      },
      hpSprite: (id) => { const v = views.players[id]; return v && v.hpSpr ? { visible: v.hpSpr.visible, hp: app.match.players[id].hp, y: +v.hpSpr.position.y.toFixed(2) } : null; },
      fieldMode: () => app.fieldMode,
      music: () => sound.musicName(),
      measureMusic: (name, sec) => sound.measureMusic(name, sec || 4),
      zone: () => ({ visible: zone.visible, hw: C.ARENA.hw }),
      focus: () => ({ n: app.focusN || 0, col: app.focusCol || null, opacity: +getComputedStyle(els.focus).opacity }),
      camPos: () => camera.position.toArray().map((v) => +v.toFixed(2)),
      fov: () => camera.fov,
      walls: () => C.SHELTERS.length,
      project: (x, y, z) => {
        const v = new T.Vector3(x, y, z).project(camera);
        const r = els.canvas.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
      },
      aimTarget,
      currentAim,
      setCam: (o) => { Object.assign(CAM, o); camera.fov = CAM.fov; camera.updateProjectionMatrix(); snapCamera(); },
      pickFrame,
      scenery: () => ({ fans: scenery.fans.length, cheer: scenery.cheerT.slice() }),
      scene: () => scene,
      sound: (name, arg) => sound.measure(name, arg),
      hitShake: () => app.hitShake,
      camInfo: () => ({ aimZoom: app.aimZoom || 0, hitCam: app.hitCamW || 0, pos: camera.position.toArray().map((v) => +v.toFixed(2)) }),
      xray: (id) => !!(views.players[id] && views.players[id].xray),
      cancelState: () => ({ cancel: !!app.aimCancel, cls: els.throwPad.classList.contains('cancel') }),
      sprites: () => ({ ready: !!sprites.tex, failed: sprites.failed }),
      hudBottom: () => app.hudBottom,
      textures: () => ({ loaded: app.tex.loaded, failed: app.tex.failed, names: app.tex.names.slice() }),
      frameOf: (id) => { const v = views.players[id]; return v && v.spr ? Object.assign({ visible: v.spr.mesh.visible }, v.spr.frame) : null; },
      // 選手の絵の板が、画面でどんな形に見えているか (横の辺と縦の辺の長さ、px)
      spriteShape: (id) => {
        const v = views.players[id];
        if (!v || !v.spr) return null;
        const sm = v.spr.mesh;
        sm.updateMatrixWorld(true);
        const pos = sm.geometry.attributes.position;
        const r = els.canvas.getBoundingClientRect();
        const pt = (i) => {
          const q = new T.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(sm.matrixWorld).project(camera);
          return { x: (q.x + 1) / 2 * r.width, y: (1 - q.y) / 2 * r.height };
        };
        const a = pt(0), b = pt(1), c = pt(2);   // 左上・右上・左下
        return { top: Math.hypot(b.x - a.x, b.y - a.y), side: Math.hypot(c.x - a.x, c.y - a.y), opacity: sm.material.opacity, visible: sm.visible, depthTest: sm.material.depthTest };
      },
      frames: () => app.frames,
      info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: renderer.getPixelRatio() }),
      mem: () => ({ textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries })
    };
  }

  main();
})();
