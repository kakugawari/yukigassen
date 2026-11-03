/*!
 * app.js — 画面まわり。three.js で描き、指の操作を Core へ渡す。
 */
(function () {
  'use strict';

  const C = window.Core;
  const R = C.R;
  const T = window.THREE;
  const VERSION = 'v8';
  const AUTO_CROUCH = 0.2;   // 止まってからしゃがむまで (秒)
  // カメラ: 自分の (h) 上・(back) 後ろから、(ahead) 先の地面を見る
  // ahead は 5 → 7: 5 だとスタート地点から相手のシェルター・バックラインが上の帯の下に隠れ、
  // 狙っている相手が見えなかった (自分は画面の 68% → 75% の高さへ下がる)
  const CAM = { h: 21, back: 10, ahead: 7, fov: 52 };

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('view'), game: $('game'),
    setsBlue: $('setsBlue'), setsRed: $('setsRed'), aliveBlue: $('aliveBlue'), aliveRed: $('aliveRed'),
    setNo: $('setNo'), time: $('time'), stockBlue: $('stockBlue'), stockRed: $('stockRed'),
    ptsBlue: $('ptsBlue'), ptsRed: $('ptsRed'), inEnemy: $('inEnemy'), warn: $('warn'),
    stickZone: $('stickZone'), stick: $('stick'), knob: $('knob'), moveHint: $('moveHint'),
    makeRing: $('makeRing'), throwPad: $('throwPad'), myBalls: $('myBalls'), pops: $('pops'),
    markLock: $('markLock'), markFlag: $('markFlag'), markFlagText: $('markFlagText'), score: document.querySelector('.score'),
    banner: $('banner'),
    vTitle: $('vTitle'), vPause: $('vPause'), vResult: $('vResult'),
    btnStart: $('btnStart'), btnPause: $('btnPause'), btnResume: $('btnResume'), btnQuit: $('btnQuit'),
    btnAgain: $('btnAgain'), btnToTitle: $('btnToTitle'), resultTitle: $('resultTitle'), resultSets: $('resultSets'),
    ver: $('ver')
  };

  const COLORS = {
    team: [0x2f6fe0, 0xe0413a],
    teamDark: [0x1d4fb0, 0xa8251f],
    snow: 0xf4f8fd,
    court: 0xeaf3fc,
    shelter: [0x7fb4ef, 0xf09a92, 0xe8eef6]
  };

  // ------------------------------------------------------------ 状態
  const app = {
    match: null,
    diff: 0.5,
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
  function applyTex(mat, name, repeat, glow) {
    const url = (window.ASSETS && window.ASSETS[name]) || './' + name;
    texLoader.load(url, (t) => {
      t.colorSpace = T.SRGBColorSpace;
      t.anisotropy = 4;
      if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
      mat.map = t;
      mat.color.setHex(0xffffff);
      // 白い壁は光の当たり方で灰色に沈んで見えたので、同じ絵を少し光らせて明るさを足す (模様は残る)
      if (glow) { mat.emissiveMap = t; mat.emissive.setScalar(glow); }
      mat.needsUpdate = true;
      app.tex.loaded++; app.tex.names.push(name);
    }, undefined, () => { app.tex.failed++; });
    return mat;
  }

  function buildField() {
    // 雪面は 1 枚の絵が 6m 四方 (コートの中は 3.4m) になるように敷きつめる
    const ground = new T.Mesh(new T.PlaneGeometry(90, 120), applyTex(lambert(COLORS.snow), 'tex_ground.jpg', [15, 20]));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const court = new T.Mesh(new T.PlaneGeometry(R.HALF_W * 2, R.HALF_L * 2), applyTex(lambert(COLORS.court), 'tex_court.jpg', [3, 10.6]));
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.005;
    scene.add(court);

    const lineMat = new T.MeshBasicMaterial({ color: 0x8fb6dc });
    const line = (w, d, x, z, mat) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, d), mat || lineMat);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z);
      scene.add(m);
    };
    line(R.HALF_W * 2 + 0.12, 0.12, 0, R.HALF_L);
    line(R.HALF_W * 2 + 0.12, 0.12, 0, -R.HALF_L);
    line(0.12, R.HALF_L * 2, R.HALF_W, 0);
    line(0.12, R.HALF_L * 2, -R.HALF_W, 0);
    app.centerLine = new T.MeshBasicMaterial({ color: 0xe86a62 });
    line(R.HALF_W * 2, 0.16, 0, 0, app.centerLine);
    // バックライン: フォワードはここより後ろへ下がれない
    const backMat = new T.MeshBasicMaterial({ color: 0x8fb6dc });
    for (const sgn of [1, -1]) {
      for (let x = -R.HALF_W + 0.25; x < R.HALF_W; x += 0.9) line(0.5, 0.1, x, sgn * R.BACK_LINE_U, backMat);
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
    app.flags = [0, 1].map((team) => {
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

    // まわりの雪山と木 (遠くの飾り)。数が多いので InstancedMesh で 1 回ずつに束ねる
    const rng = C.mulberry32(99);
    const NT = 46, NM = 24;
    const cones = new T.InstancedMesh(new T.ConeGeometry(0.33, 1, 7), lambert(0x3f7a5a), NT);
    const caps = new T.InstancedMesh(new T.ConeGeometry(0.18, 0.38, 7), lambert(0xffffff), NT);
    const trunks = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.15, 0.7, 6), lambert(0x7a5a40), NT);
    const mounds = new T.InstancedMesh(new T.SphereGeometry(1, 10, 6), lambert(0xffffff), NM);
    const o = new T.Object3D();
    for (let i = 0; i < NT; i++) {
      const x = (rng() < 0.5 ? -1 : 1) * (8 + rng() * 22);
      const z = -45 + rng() * 85;
      const h = 2.5 + rng() * 3;
      o.position.set(x, h / 2 + 0.6, z); o.scale.set(h, h, h); o.updateMatrix(); cones.setMatrixAt(i, o.matrix);
      o.position.set(x, h * 0.86 + 0.6, z); o.updateMatrix(); caps.setMatrixAt(i, o.matrix);
      o.position.set(x, 0.35, z); o.scale.set(1, 1, 1); o.updateMatrix(); trunks.setMatrixAt(i, o.matrix);
    }
    for (let i = 0; i < NM; i++) {
      o.position.set((rng() < 0.5 ? -1 : 1) * (6.8 + rng() * 6), 0, -30 + rng() * 60);
      o.scale.set(1.5 + rng() * 2.5, 0.5 + rng() * 0.6, 1.5 + rng() * 2);
      o.updateMatrix(); mounds.setMatrixAt(i, o.matrix);
    }
    scene.add(cones, caps, trunks, mounds);
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

  function attachSprite(v) {
    if (!sprites.tex || v.spr) return;
    const geo = sprGeo.clone();
    const mat = new T.MeshBasicMaterial({ map: sprites.tex, transparent: true, alphaTest: 0.25 });
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

  function resetPlayers() {
    for (const v of views.players) {
      scene.remove(v.root); scene.remove(v.shadow);
      if (v.spr) { scene.remove(v.spr.mesh); v.spr.mesh.geometry.dispose(); v.spr.mesh.material.dispose(); }
      if (v.mark) scene.remove(v.mark);
    }
    views.players = app.match.players.map(makePlayerMesh);
    views.players.forEach(attachSprite);
    for (const [, b] of views.balls) { scene.remove(b.mesh); scene.remove(b.shadow); }
    views.balls.clear();
  }

  // ------------------------------------------------------------ 雪玉と粉雪
  const ballGeo = new T.SphereGeometry(0.15, 12, 8);
  const ballMat = lambert(0xffffff, { emissive: 0x334455 });
  function ballView(b) {
    let v = views.balls.get(b.id);
    if (!v) {
      v = { mesh: new T.Mesh(ballGeo, ballMat), shadow: blob(0.16, 0.8) };
      scene.add(v.mesh);
      views.balls.set(b.id, v);
    }
    return v;
  }

  const puffGeo = new T.SphereGeometry(0.07, 6, 4);
  const puffMat = lambert(0xffffff);
  function puff(x, y, z, n, power) {
    for (let i = 0; i < n; i++) {
      let p = views.puffs.find((q) => q.life <= 0);
      if (!p) {
        if (views.puffs.length > 160) break;
        p = { mesh: new T.Mesh(puffGeo, puffMat), life: 0 };
        scene.add(p.mesh);
        views.puffs.push(p);
      }
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
    const steady = !!(p && app.aim && (p.aimF >= 1 || app.match.phase === 'vt'));
    const ready = !!(aim && aim.clear && p && p.balls > 0 && steady);
    if (ready && !app.hud.ready && app.aim && app.match.phase === 'play') sound.steady();
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
      app.aim = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, len: 0 };
      els.throwPad.classList.add('on');
      sound.unlock();
    });
    els.throwPad.addEventListener('pointermove', (e) => {
      const a = app.aim;
      if (!a || a.id !== e.pointerId) return;
      a.dx = e.clientX - a.sx; a.dy = e.clientY - a.sy;
      a.len = Math.hypot(a.dx, a.dy);
    });
    const release = (e, cancel) => {
      const a = app.aim;
      if (!a || a.id !== e.pointerId) return;
      app.aim = null;
      els.throwPad.classList.remove('on');
      updateAim();
      if (cancel) return;
      const p = me();
      if (!p || !p.alive) return;
      // 離した瞬間の指で狙いを決める
      app.aim = a;
      const aim = currentAim();
      app.aim = null;
      if (aim) app.input.throwAt = { x: aim.x, z: aim.z };
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
    return {
      unlock,
      throw() { burst(0.16, 1400, 0.8, 0.25, 'bandpass'); },
      steady() { tone(1320, 0.07, 0.12, 'triangle'); },
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
      made() { tone(880, 0.06, 0.08, 'sine'); },
      whistle(long) { tone(2300, long ? 0.7 : 0.35, 0.12, 'sine'); tone(2340, long ? 0.7 : 0.35, 0.08, 'sine'); },
      win() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.22, 0.14, 'triangle'), i * 110)); }
    };
  })();

  // ------------------------------------------------------------ 試合の流れ
  function startMatch() {
    sound.unlock();
    app.match = C.createMatch({
      seed: (Math.random() * 4294967296) >>> 0,
      skill: [0.55, app.diff],
      human: 1
    });
    resetPlayers();
    app.hud = {};
    app.paused = false;
    app.running = true;
    app.acc = 0;
    app.input.throwAt = null;
    els.vTitle.hidden = true;
    els.vResult.hidden = true;
    els.vPause.hidden = true;
    snapCamera();
    handleEvents();
  }

  /** 3D の位置に、ぽんと浮かぶ文字 */
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
  const DECIDED = { sets: 'セット数', points: 'ポイント合計', vt: 'ビクトリースロー' };

  function handleEvents() {
    const m = app.match;
    const mine = m.human;
    for (const e of C.drainEvents(m)) {
      switch (e.type) {
        case 'setStart':
          resetPlayers();
          snapCamera();
          showBanner(`SET ${e.setNo}<small>${e.setNo === 1 ? '敵陣のフラッグをめざせ' : 'よーい…'}</small>`, '', R.COUNTDOWN);
          break;
        case 'go':
          showBanner('スタート!', '', 0.8);
          sound.whistle(false);
          break;
        case 'throw': {
          const v = views.players[e.player];
          if (v) v.throwT = 0.35;
          const p = m.players[e.player];
          if (p && Math.hypot(p.x - camLook.x, p.z - camLook.z) < 14) sound.throw();
          break;
        }
        case 'splat': {
          puff(e.x, e.y, e.z, e.on === 'shelter' ? 9 : 6, 0.8);
          const p = me();
          sound.splat(p && Math.hypot(e.x - p.x, e.z - p.z) < 3);
          break;
        }
        case 'hit': {
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
            app.slowT = 0.16; app.shake = 0.28;
            const now = performance.now() / 1000;
            app.combo.n = now - app.combo.t < 6 ? app.combo.n + 1 : 1;
            app.combo.t = now;
            sound.hit(app.combo.n);
            const word = ['OUT!', 'ダブル!', 'トリプル!'][app.combo.n - 1] || `${app.combo.n}連続!`;
            popText(word, e.x, 2.2, e.z, app.combo.n);
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
          const who = e.winner === 0 ? 'あおの勝ち' : e.winner === 1 ? 'あかの勝ち' : '引き分け';
          showBanner(`${REASON[e.reason]}<small>SET ${e.setNo} ${who} ・ ${e.points[0]} - ${e.points[1]} pt</small>`, e.winner === 0 ? 'blue' : e.winner === 1 ? 'red' : '', R.SET_OVER);
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
          showBanner(`${e.winner === 0 ? 'あお' : 'あか'}の勝ち<small>ビクトリースロー ${vtTally()}</small>`, e.winner === 0 ? 'blue' : 'red', R.SET_OVER);
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
    els.resultTitle.textContent = m.winner === 0 ? '勝利!' : m.winner === 1 ? '負け…' : '引き分け';
    els.resultTitle.style.color = m.winner === 0 ? 'var(--blue)' : m.winner === 1 ? 'var(--red)' : '';
    const rows = m.setResults.map((r, i) => {
      const who = r.winner === 0 ? 'あお' : r.winner === 1 ? 'あか' : '引き分け';
      return `<li class="w${r.winner}">SET ${i + 1}: ${who} ・ ${REASON[r.reason]} <b>${r.points[0]} - ${r.points[1]}</b></li>`;
    });
    rows.push(`<li class="total">セット ${m.setWins[0]} - ${m.setWins[1]} ・ ポイント ${m.points[0]} - ${m.points[1]}</li>`);
    if (m.vt) rows.push(`<li class="total">ビクトリースロー ${vtTally()}</li>`);
    if (m.decidedBy) rows.push(`<li class="by">${DECIDED[m.decidedBy]}で決着</li>`);
    els.resultSets.innerHTML = rows.join('');
    els.vResult.hidden = false;
    if (m.winner === 0) sound.win();
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

  function camTarget(p) {
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
          sm.material.opacity = 1;
          sm.material.depthTest = true;
          sm.renderOrder = 3;
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

    camera.position.copy(camPos);
    if (app.shake > 0) {
      app.shake -= dt;
      camera.position.x += (Math.random() - 0.5) * app.shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * app.shake * 0.6;
    }
    camera.lookAt(camLook);
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
    if (playing) {
      const f = C.flagPos(1 - p.team);
      edgeMark(els.markFlag, 'mkFlag', f.x, 2.0, f.z, `フラッグ ${Math.round(Math.hypot(f.x - p.x, f.z - p.z))}m`);
    } else edgeMark(els.markFlag, 'mkFlag', null);
  }

  function updateHud() {
    const m = app.match;
    if (!m) return;
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
    const p = me();
    const balls = p ? p.balls : 0;
    let bh = '';
    for (let i = 0; i < R.MAX_CARRY; i++) bh += `<i class="${i < balls ? '' : 'none'}"></i>`;
    setHTML('mb', els.myBalls, bh);
    const empty = balls === 0;
    if (app.hud.empty !== empty) { app.hud.empty = empty; els.throwPad.classList.toggle('empty', empty); }
    // 丸めている進み具合 (12段階に丸める。細かく書き換えると遅い端末でカクつく)
    // 投げた直後は構え直し (ボタンが沈み、ふちが灰色で戻っていく)
    const recover = !!(p && p.cd > 0 && balls > 0 && app.match.phase === 'play');
    if (app.hud.recover !== recover) { app.hud.recover = recover; els.throwPad.classList.toggle('recover', recover); }
    const aiming = !!(p && app.aim && app.match.phase === 'play') && !recover;
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
          aiming: !!app.aim && app.match.phase === 'play',   // 投げるを押さえている間は構える (立つ)
          throwAt: app.input.throwAt
        };
        app.input.throwAt = null;
        C.step(app.match, h, inp);
        app.acc -= h; n++;
      }
      if (n === 4) app.acc = 0;
      handleEvents();
    }
    if (app.bannerT > 0) {
      app.bannerT -= dt;
      if (app.bannerT <= 0) els.banner.hidden = true;
    }
    updateHud();
    render(app.paused ? 0 : dt);
    updateEdgeMarks();
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
    if (on) {
      app.aim = null; app.stickTouch = null;
      app.input.mx = app.input.mz = 0; app.input.crouch = false;
      els.throwPad.classList.remove('on'); els.stick.classList.remove('on');
      setKnob(0, 0);
    }
  }

  function toTitle() {
    app.running = false;
    app.paused = false;
    els.vPause.hidden = true;
    els.vResult.hidden = true;
    els.vTitle.hidden = false;
  }

  function main() {
    buildField();
    loadSprites();
    bindControls();
    document.querySelectorAll('.diff button').forEach((b) => {
      b.addEventListener('click', () => {
        app.diff = Number(b.dataset.diff);
        document.querySelectorAll('.diff button').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    els.btnStart.addEventListener('click', startMatch);
    els.btnAgain.addEventListener('click', startMatch);
    els.btnPause.addEventListener('click', () => pause(true));
    els.btnResume.addEventListener('click', () => pause(false));
    els.btnQuit.addEventListener('click', toTitle);
    els.btnToTitle.addEventListener('click', toTitle);
    document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
    window.addEventListener('resize', resize);

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
      start: (diff, seed) => {
        if (diff != null) app.diff = diff;
        startMatch();
        if (seed != null) {
          app.match = C.createMatch({ seed, skill: [0.55, app.diff], human: 1 });
          resetPlayers(); snapCamera(); handleEvents();
        }
      },
      project: (x, y, z) => {
        const v = new T.Vector3(x, y, z).project(camera);
        const r = els.canvas.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
      },
      aimTarget,
      currentAim,
      setCam: (o) => { Object.assign(CAM, o); camera.fov = CAM.fov; camera.updateProjectionMatrix(); snapCamera(); },
      pickFrame,
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
      info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: renderer.getPixelRatio() })
    };
  }

  main();
})();
