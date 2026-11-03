# まわりの景色の絵を生成するときの指示

`ASSETS.md` の「3. まわりの景色」を作るための指示。**ブロックをまるごとコピーして貼るだけ**でよい (1 回ぶん 1 ブロック)。

## 先に分かったこと: 空は画面に映らない

カメラは上から約 55° 見下ろしていて、画面のいちばん上でも地平線より下しか映らない。
**空と遠くの山を「背景」として敷いても、見える場所が無い。**
見えているのは**コートの左右の雪原**なので、そこに置く木と雪の山を先に作る。

| 回 | 作る物 | 使い方 | 優先 |
| --- | --- | --- | --- |
| A | 雪をかぶった木 3 種 (1 枚に 3 本) | コートの左右に立てる (選手と同じく、カメラへ向けた板) | ★★ |
| B | 雪の山 3 種 (1 枚に 3 つ) | コートの左右の雪原に置く (今の白い岩のような物の代わり) | ★★ |
| C | 観客と応援旗 (横に長い 1 枚) | コートの外の左右に並べる | なくてよい |
| D | 遠くの雪山 (横に長い 1 枚) | コートの奥に「山の壁」として立てる。画面のいちばん上にだけ少し見える | なくてよい |

- A・B・C は**選手と同じ見下ろしの角度**で描いてもらう (板に貼ってカメラへ向けるので、角度が違うと浮いて見える)
- 背景は本当の透明。透明にできない道具なら、A (木は緑を使う) は**マゼンタ `#FF00FF`**、B・C・D は**緑 `#00FF00`** のべた塗り
- 1 枚の中の並びや大きさは多少ずれてもよい。切り出しと大きさ合わせはこちらでやる

---

### A: 雪をかぶった木 3 種

```text
Game sprite sheet for a mobile snowball-fight game: three different snow-covered evergreen trees side by side in one image,
in three equal cells in one row, wide empty gap between them, nothing touches a cell border.
1. A tall slim fir tree. 2. A medium round pine tree. 3. A small young fir tree, about half the height of tree 1.
Thick soft snow resting on the branches, a little snow at the base of each trunk, dark green needles (#2f6b52), brown trunk.

Style: soft toy-like 3D render (like a vinyl figure), clean shapes, gentle cel shading,
light coming from the upper left, thin darker outline. Bright and friendly, matching cute chibi characters.

Camera: HIGH ANGLE, looking DOWN at the trees from about 55 degrees above
(like an isometric strategy game camera). Whole tree visible, base included.
Orthographic look, no perspective distortion. All trees stand on the same baseline near the bottom of each cell.

Background: fully TRANSPARENT (real alpha channel, PNG). Do not draw a checkerboard.
If transparency is impossible, use a flat solid pure magenta (#FF00FF) background with no gradient,
and do not use any pink or purple in the trees.
No shadow on the ground, no ground plane, no text.
```

### B: 雪の山 3 種

```text
Game sprite sheet for a mobile snowball-fight game: three different soft snow mounds side by side in one image,
in three equal cells in one row, wide empty gap between them, nothing touches a cell border.
1. A wide low snow drift. 2. A rounded snow hill with a small snowman-like bump on top. 3. A cluster of three small snow lumps.
Smooth fluffy snow (#f4f8fd) with soft blue shading (#c9dcef) on the shaded side, a few sparkles.

Style: soft toy-like 3D render, clean shapes, gentle cel shading,
light coming from the upper left, thin light-blue outline. Bright and friendly.

Camera: HIGH ANGLE, looking DOWN from about 55 degrees above (like an isometric strategy game camera).
Orthographic look, no perspective distortion. All mounds sit on the same baseline near the bottom of each cell.

Background: fully TRANSPARENT (real alpha channel, PNG). Do not draw a checkerboard.
If transparency is impossible, use a flat solid pure green (#00FF00) background with no gradient.
No shadow on the ground, no ground plane, no text.
```

### C: 観客と応援旗 (なくてよい)

```text
A long horizontal strip of cheerful chibi spectators for a mobile snowball-fight game, standing in a row behind a low snow wall,
wearing winter coats in many colors, some waving small blue flags and some waving small red flags, a few cheering with raised arms.
Everyone is small and simple, the same chibi style, about 2.5 heads tall. No faces facing away: all look toward the viewer.

Style: soft toy-like 3D render, clean shapes, gentle cel shading, light from the upper left. Bright and friendly.

Camera: HIGH ANGLE, looking DOWN from about 55 degrees above (like an isometric strategy game camera).
Orthographic look. The strip should repeat seamlessly from left to right.

Background: fully TRANSPARENT (real alpha channel, PNG). Do not draw a checkerboard.
If transparency is impossible, use a flat solid pure green (#00FF00) background, and do not use green clothes.
No text, no letters, no logos. Very wide image, about 4:1.
```

### D: 遠くの雪山 (なくてよい)

```text
A wide panorama of distant snowy mountains for the far end of a snowball-fight field in a mobile game.
Gentle rounded snow-covered peaks, a few snowy evergreen forests at their feet, soft blue-white colors (#e9f3fb, #bcd8f0, #8fb6dc).
The bottom edge is a flat snowy plain that fades into pure white (#f4f8fd), so it blends into the snow ground.
The top edge above the peaks is fully TRANSPARENT (real alpha channel, PNG); if impossible, flat pure green (#00FF00).

Style: soft toy-like illustration, clean shapes, gentle shading, light from the upper left, no harsh details.
The left and right edges must match so the strip can repeat seamlessly.
No sky, no sun, no clouds, no text. Very wide image, about 4:1.
```

---

## うまくいかないときの言い足し (必要な行だけ、指示文の最後に足す)

真横から見た木や山になるとき:

```text
The camera is ABOVE, looking down steeply. We see the top of the trees and the snow on top of the branches from above.
```

3 つが同じ形になるとき:

```text
The three must be clearly different in shape and size.
```

背景が市松模様・灰色になるとき (木なら #FF00FF、それ以外は #00FF00):

```text
Flat pure magenta #FF00FF background. No checkerboard.
```

```text
Flat pure green #00FF00 background. No checkerboard.
```

地面や影が描かれるとき:

```text
Nothing under the objects: no ground, no shadow, no snow floor. Only the objects themselves.
```

## 届いたらこちらでやること

- 四隅の画素を読んで、本当の透明か (市松でないか) を確かめる。べた塗りなら、その色からの距離で抜く
- 3 つに切り出し、足もとをそろえ、暗い地と明るい地に並べた見本を見る
- コートの左右に、選手と同じ作りの板 (縦に立ててカメラへ向ける) で並べ、写真を送る
