/*!
 * app.js — 画面まわり。three.js で描き、指の操作を Core へ渡す。
 */
(function () {
  'use strict';

  const C = window.Core;
  const R = C.R;
  const T = window.THREE;
  const VERSION = 'v1';

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('view'), game: $('game'),
    setsBlue: $('setsBlue'), setsRed: $('setsRed'), aliveBlue: $('aliveBlue'), aliveRed: $('aliveRed'),
    setNo: $('setNo'), time: $('time'), stockBlue: $('stockBlue'), stockRed: $('stockRed'),
    stickZone: $('stickZone'), stick: $('stick'), knob: $('knob'), moveHint: $('moveHint'),
    btnCrouch: $('btnCrouch'), makeRing: $('makeRing'), throwPad: $('throwPad'), myBalls: $('myBalls'),
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
    crouchTouch: null,
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
  const camera = new T.PerspectiveCamera(52, 1, 0.5, 120);
  const camPos = new T.Vector3(0, 16, 30);
  const camLook = new T.Vector3(0, 0, 10);

  scene.add(new T.HemisphereLight(0xf2f8ff, 0x9fb4cc, 1.6));
  const sun = new T.DirectionalLight(0xffffff, 1.5);
  sun.position.set(-6, 14, 8);
  scene.add(sun);

  const lambert = (c, extra) => new T.MeshLambertMaterial(Object.assign({ color: c }, extra || {}));

  function buildField() {
    const ground = new T.Mesh(new T.PlaneGeometry(90, 120), lambert(COLORS.snow));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const court = new T.Mesh(new T.PlaneGeometry(R.HALF_W * 2, R.HALF_L * 2), lambert(COLORS.court));
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
    line(R.HALF_W * 2, 0.16, 0, 0, new T.MeshBasicMaterial({ color: 0xe86a62 }));

    // シェルター (空気で膨らませた白い壁。チームの色の帯つき)
    for (const s of C.SHELTERS) {
      const g = new T.Group();
      const body = new T.Mesh(new T.BoxGeometry(s.w, s.h - 0.12, s.d), lambert(0xf3f7fc));
      body.position.y = (s.h - 0.12) / 2;
      g.add(body);
      const top = new T.Mesh(new T.CylinderGeometry(s.d / 2, s.d / 2, s.w, 14), lambert(0xf3f7fc));
      top.rotation.z = Math.PI / 2;
      top.position.y = s.h - 0.12;
      top.scale.set(1, 1, 1);
      g.add(top);
      const band = new T.Mesh(new T.BoxGeometry(s.w + 0.02, 0.14, s.d + 0.02), lambert(COLORS.shelter[s.team < 0 ? 2 : s.team]));
      band.position.y = 0.32;
      g.add(band);
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
      const cloth = new T.Mesh(clothGeo, lambert(COLORS.team[team], { side: T.DoubleSide }));
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
    return { root, pose, shoulder, shoulder2, hand, shadow, crouch: 0, throwT: 0, outT: -1, step: 0, mats };
  }

  const views = { players: [], balls: new Map(), puffs: [] };

  const meRing = new T.Mesh(new T.RingGeometry(0.42, 0.56, 32), new T.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.95, depthWrite: false }));
  meRing.rotation.x = -Math.PI / 2;
  meRing.renderOrder = 2;
  scene.add(meRing);
  const meArrow = new T.Mesh(new T.ConeGeometry(0.16, 0.32, 3), new T.MeshBasicMaterial({ color: 0xffcf3a }));
  meArrow.rotation.x = Math.PI;
  scene.add(meArrow);

  function resetPlayers() {
    for (const v of views.players) { scene.remove(v.root); scene.remove(v.shadow); }
    views.players = app.match.players.map(makePlayerMesh);
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

  const lockRing = new T.Mesh(new T.RingGeometry(0.45, 0.6, 28), new T.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true, opacity: 0.9 }));
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

  function updateAim() {
    const p = me();
    if (!app.aim || !p || !p.alive || app.aim.len < 14) { aimLine.visible = false; aimRing.visible = false; lockRing.visible = false; return; }
    const t = aimTarget(app.aim.dx, app.aim.dy);
    app.aim.tx = t.x; app.aim.tz = t.z;
    const tr = C.trajectory(p.x, p.z, t.x, t.z, 0.025);
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
    // いまの位置のままなら当たる相手がいれば赤く (動かれると外れる)
    const victim = C.predictHit(app.match.players, p.team, p.x, p.z, t.x, t.z);
    const col = victim ? 0xff3b30 : tr.hit === 'shelter' ? 0x9aa6b8 : 0xffb020;
    aimRing.material.color.setHex(col);
    aimLine.material.color.setHex(col);
    app.aimVictim = victim ? victim.id : null;
    if (victim) { lockRing.visible = true; lockRing.position.set(victim.x, 0.03, victim.z); } else lockRing.visible = false;
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

    // しゃがむ (押している間)
    els.btnCrouch.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      capture(els.btnCrouch, e.pointerId);
      app.crouchTouch = e.pointerId;
      app.input.crouch = true;
      els.btnCrouch.classList.add('on');
    });
    const endCrouch = (e) => {
      if (app.crouchTouch !== e.pointerId) return;
      app.crouchTouch = null;
      app.input.crouch = false;
      els.btnCrouch.classList.remove('on');
    };
    els.btnCrouch.addEventListener('pointerup', endCrouch);
    els.btnCrouch.addEventListener('pointercancel', endCrouch);

    // 投げる: 押して引くと狙い、離すと投げる
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
      if (a.len >= 14) {
        const t = aimTarget(a.dx, a.dy);
        app.input.throwAt = t;
      } else {
        app.input.throwAt = autoTarget(p);
      }
    };
    els.throwPad.addEventListener('pointerup', (e) => release(e, false));
    els.throwPad.addEventListener('pointercancel', (e) => release(e, true));

    // パソコンで試すとき用のキー操作
    const keys = {};
    const applyKeys = () => {
      if (app.stickTouch) return;
      app.input.mx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
      app.input.mz = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
      if (app.crouchTouch == null) app.input.crouch = !!keys.shift;
    };
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      keys[k] = true; applyKeys();
      if (k === ' ') { const p = me(); if (p && p.alive) app.input.throwAt = autoTarget(p); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; applyKeys(); });
  }

  // 合成したイベントや、すでに離れた指では失敗することがあるので包む
  function capture(el, id) { try { el.setPointerCapture(id); } catch (err) { /* 捕まえられなくても動く */ } }

  function setKnob(dx, dy) { els.knob.style.transform = `translate(${dx}px, ${dy}px)`; }

  /** タップで投げたとき: 前方のいちばん近い相手の足もとへ (先読みはしない) */
  function autoTarget(p) {
    const s = C.side(p.team);
    let best = null, bd = Infinity;
    for (const q of app.match.players) {
      if (!q.alive || q.team === p.team) continue;
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > R.RANGE) continue;
      const ahead = (p.z - q.z) * s;
      const score = d - (ahead > 0 ? 3 : 0);
      if (score < bd) { bd = score; best = q; }
    }
    if (best) return { x: best.x, z: best.z };
    return { x: p.x, z: p.z - s * 12 };
  }

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
      splat(near) { burst(0.12, 500, 0.7, near ? 0.5 : 0.22, 'lowpass'); },
      hit() { burst(0.2, 700, 0.6, 0.6, 'lowpass'); tone(520, 0.18, 0.18, 'triangle', 260); },
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

  function showBanner(html, cls, sec) {
    els.banner.innerHTML = html;
    els.banner.className = 'banner' + (cls ? ' ' + cls : '');
    els.banner.hidden = false;
    app.bannerT = sec || 1.6;
  }

  const REASON = { flag: 'フラッグ奪取!', allout: '全員退場', time: '時間切れ' };

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
          puff(e.x, e.y, e.z, 16, 1.3);
          sound.hit();
          const v = views.players[e.player];
          if (v) v.outT = 0;
          if (e.player === mine) { app.shake = 0.5; sound.out(); showBanner('当たった!<small>仲間に交代</small>', 'red', 1.2); }
          else if (m.players[e.by] && m.players[e.by].id === mine) showBanner('命中!', 'blue', 0.8);
          break;
        }
        case 'made': if (e.player === m.human) sound.made(); break;
        case 'handOver': break;
        case 'setEnd': {
          sound.whistle(true);
          const who = e.winner === 0 ? 'あおの勝ち' : e.winner === 1 ? 'あかの勝ち' : '引き分け';
          showBanner(`${REASON[e.reason]}<small>SET ${e.setNo} ${who}</small>`, e.winner === 0 ? 'blue' : e.winner === 1 ? 'red' : '', R.SET_OVER);
          app.aim = null; els.throwPad.classList.remove('on');
          break;
        }
        case 'matchEnd':
          showResult();
          break;
      }
    }
  }

  function showResult() {
    const m = app.match;
    app.running = false;
    els.resultTitle.textContent = m.winner === 0 ? '勝利!' : m.winner === 1 ? '負け…' : '引き分け';
    els.resultTitle.style.color = m.winner === 0 ? 'var(--blue)' : m.winner === 1 ? 'var(--red)' : '';
    els.resultSets.innerHTML = m.setResults.map((r, i) => {
      const who = r.winner === 0 ? 'あお' : r.winner === 1 ? 'あか' : '引き分け';
      return `<li class="w${r.winner}">SET ${i + 1}: ${who} ・ ${REASON[r.reason]} (残り ${r.alive[0]} 対 ${r.alive[1]})</li>`;
    }).join('');
    els.vResult.hidden = false;
    if (m.winner === 0) sound.win();
  }

  // ------------------------------------------------------------ 描く
  function snapCamera() {
    const p = me();
    const target = camTarget(p);
    camPos.copy(target.pos); camLook.copy(target.look);
  }

  function camTarget(p) {
    const x = p ? p.x * 0.35 : 0;
    const z = p ? clampN(p.z, -16, 17) : 12;
    return { pos: new T.Vector3(x, 21, z + 10), look: new T.Vector3(x, 0, z - 5) };
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
          v.root.position.y = 0;
          const k = Math.max(0, 1 - Math.max(0, v.outT - 0.8) / 0.6);
          v.root.visible = k > 0;
          v.shadow.visible = k > 0;
          v.root.scale.setScalar(0.4 + 0.6 * k);
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
      }

      // 球
      const seen = new Set();
      for (const b of m.balls) {
        const v = ballView(b);
        v.mesh.position.set(b.x, b.y, b.z);
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
        meArrow.position.set(mine.x, 2.25 + Math.sin(t * 5) * 0.08, mine.z);
      } else { meRing.visible = false; meArrow.visible = false; }

      // カメラ: 自分を追う (斜め上から)
      const target = camTarget(mine && mine.alive ? mine : mine);
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
    setText('stb', els.stockBlue, String(m.stock[0]));
    setText('str', els.stockRed, String(m.stock[1]));
    const p = me();
    const balls = p ? p.balls : 0;
    let bh = '';
    for (let i = 0; i < R.MAX_CARRY; i++) bh += `<i class="${i < balls ? '' : 'none'}"></i>`;
    setHTML('mb', els.myBalls, bh);
    const empty = balls === 0;
    if (app.hud.empty !== empty) { app.hud.empty = empty; els.throwPad.classList.toggle('empty', empty); }
    // 丸めている進み具合 (12段階に丸める。細かく書き換えると遅い端末でカクつく)
    const prog = p && p.makeT > 0 ? Math.round(p.makeT / R.MAKE_TIME * 12) / 12 : 0;
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
      app.acc += dt;
      const h = 1 / 60;
      let n = 0;
      while (app.acc >= h && n < 4) {
        const inp = {
          mx: app.input.mx, mz: app.input.mz, crouch: app.input.crouch,
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
  }

  function resize() {
    const w = els.game.clientWidth, h = els.game.clientHeight;
    if (!(w >= 1 && h >= 1)) return;   // 回転中などに 0 が来ることがある
    renderer.setSize(w, h, false);
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
      els.throwPad.classList.remove('on'); els.btnCrouch.classList.remove('on'); els.stick.classList.remove('on');
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
      frames: () => app.frames,
      info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: renderer.getPixelRatio() })
    };
  }

  main();
})();
