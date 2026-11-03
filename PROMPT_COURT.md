# コートと壁の絵を生成するときの指示

`ASSETS.md` の「2. コートと壁」を作るための指示。**ブロックをまるごとコピーして貼るだけ**でよい (1 回ぶん 1 ブロック)。

## 進め方

| 回 | 作る物 | 使う所 |
| --- | --- | --- |
| A | コートの外の雪面 | まわりの地面 (くり返して敷く) |
| B | コートの中の雪面 | コートの中 (くり返して敷く) |
| C | シェルターの面 (**あおだけ**) | シェルター 5 基の前と後ろ |
| D | シャトーの面 (**あおだけ**) | シャトー 2 基の前と後ろ |
| E | 壁の上面 | シェルター・シャトーの丸い上 |
| F | フラッグの布 (**あおだけ**) | 旗ざおの布。コードで波打たせる |

- **あか・中央の色は生成しない。** あおの絵の青い所を、こちらで赤 (あか) と淡い灰青 (中央) に塗り替える
- 雪面は、こちらで**つなぎ目が目立たないように**直してから敷く。少しつながっていなくてもよい
- 大きさは 1024 x 1024 などで届いてかまわない。こちらで縮める
- C〜F は**絵の中に背景を入れない** (面が画像いっぱいに広がるように頼んである)。透明は要らない

---

### A: コートの外の雪面

```text
Seamless tileable texture of fresh natural snow on the ground, seen from directly above (top-down, flat, orthographic).
Soft powdery snow with gentle bumps, a few scattered faint footprints and small clumps, subtle sparkle.
Colors: almost white with very light cool blue shading (#f4f8fd to #dde8f4).
Even, soft lighting with no strong shadows and no light direction, so it can be repeated without visible seams.
The pattern must wrap perfectly: the left edge matches the right edge, the top edge matches the bottom edge.
No objects, no people, no lines, no text. Square image.
```

### B: コートの中の雪面

```text
Seamless tileable texture of groomed, packed snow on a sports field, seen from directly above (top-down, flat, orthographic).
Smoother and flatter than fresh snow: lightly compacted surface with very fine grain and a few tiny scuffs.
Colors: very light icy white-blue (#eaf3fc to #d8e6f3), slightly bluer than fresh snow.
Even, soft lighting with no strong shadows and no light direction, so it can be repeated without visible seams.
The pattern must wrap perfectly: the left edge matches the right edge, the top edge matches the bottom edge.
No lines, no markings, no footprints, no objects, no text. Square image.
```

### C: シェルターの面 (あお)

```text
Texture of the front face of an inflatable air-filled barrier wall used in team snowball fight sport,
seen straight on (front view, flat, orthographic, no perspective).
The wall face fills the ENTIRE image edge to edge. No background, no ground, no sky visible.
Material: puffy white vinyl (#f3f7fc) made of soft horizontal air tubes with stitched seams between them,
gentle wrinkles, a soft glossy sheen.
A wide royal blue (#2f6fe0) horizontal band runs across the lower third, with a thin darker blue (#1d4fb0) edge line.
Style: soft toy-like 3D render, clean and bright, gentle cel shading, light from the upper left.
No text, no logos, no numbers. Wide image, about 2:1.
```

### D: シャトーの面 (あお)

```text
Texture of the front face of a large inflatable air-filled castle wall ("chateau") used in team snowball fight sport,
seen straight on (front view, flat, orthographic, no perspective).
The wall face fills the ENTIRE image edge to edge. No background, no ground, no sky visible.
Material: the same puffy white vinyl (#f3f7fc) as a smaller barrier wall: soft horizontal air tubes, stitched seams,
gentle wrinkles, soft glossy sheen. Slightly bigger and sturdier, with a few vertical seams dividing it into panels.
Two royal blue (#2f6fe0) horizontal bands: a wide one across the lower third and a thin one near the top,
with thin darker blue (#1d4fb0) edge lines.
Style: soft toy-like 3D render, clean and bright, gentle cel shading, light from the upper left.
No text, no logos, no numbers. Very wide image, about 8:3.
```

### E: 壁の上面

```text
Texture of the rounded top of an inflatable air-filled barrier wall, seen from directly above (top-down, flat, orthographic).
A single long soft white vinyl tube (#f3f7fc) running left to right, filling the ENTIRE image edge to edge.
Gentle highlight along the middle, soft shading toward the top and bottom edges, a few small wrinkles, stitched seam lines at both edges.
The pattern must repeat seamlessly from left to right.
Style: soft toy-like 3D render, clean and bright.
No background, no text, no logos. Very wide image, about 4:1.
```

### F: フラッグの布 (あお)

```text
Flat rectangular team flag fabric for a snowball fight sport team, seen straight on (front view, flat, orthographic).
The fabric fills the ENTIRE image edge to edge. No pole, no background, no sky.
Royal blue (#2f6fe0) fabric with a large simple white snowflake emblem in the center,
a thin darker blue (#1d4fb0) border along all four edges, subtle woven fabric texture.
Lay it completely flat: no folds, no waves, no shadows (the game animates the waving).
Style: clean and bright, slightly soft.
No text, no letters, no numbers. Image ratio about 3:2.
```

---

## うまくいかないときの言い足し (必要な行だけ、指示文の最後に足す)

面が画像いっぱいに広がらず、まわりに背景が描かれるとき:

```text
The texture must fill the whole image. Crop tightly: no border, no margin, no background around it.
```

斜めから見た立体の壁として描かれるとき:

```text
Completely flat front view, like a scanned texture. No 3D perspective, no visible sides or top.
```

雪面に強い影や光の向きがあるとき:

```text
Perfectly even lighting from directly above. No shadows that point in any direction.
```

文字やロゴが入ってしまうとき:

```text
Absolutely no text, letters, numbers, logos or symbols other than the snowflake.
```

## 届いたらこちらでやること

- 雪面: つなぎ目を目立たなくする処理をして、512 x 512 の JPEG にする。並べた見本を目で見る
- シェルター・シャトー・旗: 青い所を赤と淡い灰青に塗り替えて、あか・中央を作る。白いビニールの所は残す
- 3D の壁に貼り、今の画面と並べた写真を送る
