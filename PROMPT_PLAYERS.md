# 選手の絵を生成するときの指示

`ASSETS.md` の「1. 選手」を作るための指示。画像を作る道具 (ChatGPT・Gemini・Midjourney など) にそのまま貼れるよう、
**指示文は英語**にしてある (日本語より、ポーズや向きの指定が通りやすい)。下に日本語の意味を添えた。

## 進め方 (4 回に分けて頼む)

| 回 | 作る物 | 何枚 | ねらい |
| --- | --- | --- | --- |
| 0 | **キャラの設定画** (前・後ろ・横で立つ 3 体) | 気に入るまで | 見た目を先に決める。以降はこの絵を**参考画像として毎回添える** |
| 1 | **背中側** 8 ポーズ | 1 枚 (4 x 2 のマス) | 自分たち (あお) がいちばんよく見せる向き |
| 2 | **正面側** 8 ポーズ | 1 枚 | 相手 (あか) がいちばんよく見せる向き |
| 3 | **横向き (右向き)** 8 ポーズ | 1 枚 | 横へ走るとき。左向きは反転で作る |

- **あおだけ作ればよい。** あかは、同じ絵の青い所をこちらで赤に塗り替える (形がそろうので、並べたときにちぐはぐにならない)
- バックスの見分けは、こちらで頭の上に印を出す。絵を分けなくてよい
- 1 枚の中のマスの大きさや位置は、ずれていてもかまわない。**切り出し・大きさ合わせ・足もと合わせはこちらでやる**

---

## 毎回つける共通の指示

1〜3 回目の頭に、毎回これを付ける。

```text
Game sprite sheet for a mobile snowball-fight game.
One character, the SAME character in every cell (same face, same outfit, same proportions, same scale).

Character: a cheerful chibi athlete, about 2.5 heads tall, playing team "snowball fight" sport.
Outfit: puffy winter jacket in royal blue (#2f6fe0) with darker blue (#1d4fb0) side panels,
dark navy snow pants, chunky dark boots, light grey gloves,
a rounded sports helmet in dark blue (#1d4fb0) with small ski goggles pushed up on the front.
No numbers, no letters, no logos anywhere.

Style: soft toy-like 3D render (like a vinyl figure), clean shapes, gentle cel shading,
light coming from the upper left, thin darker outline. Bright and friendly.

Camera: HIGH ANGLE, looking DOWN at the character from about 55 degrees above
(like an isometric strategy game camera). Full body visible, feet included.
Orthographic look, no perspective distortion.

Layout: a 4 x 2 grid of equal square cells. One pose per cell. Wide empty gap between cells.
Nothing touches or crosses a cell border. Every character is the same size,
and all feet stand on the same baseline near the bottom of each cell.

Background: fully TRANSPARENT (real alpha channel, PNG). Do not draw a checkerboard.
If transparency is impossible, use a flat solid pure green (#00FF00) background with no gradient,
and do not use any green in the character.
No shadow on the ground, no snow, no effects, no text labels.
```

(意味: 同じ 1 人を全部のマスに。2.5 頭身のちびキャラ、青いダウン・紺のズボン・ヘルメットにゴーグル。
文字や数字は入れない。おもちゃのような 3D 風、光は左上から。**上から約 55° 見下ろす角度**で足まで全部。
4 x 2 の同じ大きさのマスに 1 ポーズずつ、マスの間はあける。足もとの高さをそろえる。
背景は本当の透明。無理なら緑 #00FF00 のべた塗り。影・雪・効果・文字は描かない)

---

## 0 回目: 設定画

```text
Character design sheet, three views side by side on one image: front view, back view, right side view.
Standing relaxed, arms slightly away from the body, holding nothing.
[共通の指示をここに貼る。ただし Layout の行は「three equal cells in one row」に読みかえる]
```

- ここで顔・体形・色を決める。**気に入るまで何度でも作り直す**
- 決まったら、その絵を以降の回に**参考画像として添えて**「Use the attached character exactly.」と書き足す

---

## 1 回目: 背中側 (カメラから遠ざかる向き)

```text
BACK VIEW: the character faces AWAY from the camera (we see the back of the jacket and helmet),
seen from high above at about 55 degrees.
Use the attached character exactly.
The character throws with the RIGHT hand, toward the top of the image (away from the camera).

Cells, left to right, top row then bottom row:
1. Idle: standing, relaxed, a snowball held in the right hand at the waist.
2. Run A: running away from the camera, left foot forward, right arm forward.
3. Run B: running, both feet passing under the body, slightly up in the air.
4. Run C: running, right foot forward, left arm forward.
5. Crouch: squatting very low behind cover, knees fully bent, head ducked, body compact.
   Total height must be HALF of the idle pose.
6. Making a snowball: same low squat as cell 5, both hands together in front, packing snow.
7. Wind-up: right arm pulled far back behind the head holding a snowball,
   left arm pointing forward, body twisted, weight on the back foot.
8. Release: right arm fully extended forward and up after throwing, hand open,
   body leaning forward, weight on the front foot.

[共通の指示をここに貼る]
```

## 2 回目: 正面側 (カメラへ向かってくる向き)

1 回目の最初の 3 行と動きの説明を、次のように替える。動きの 1〜8 の並びは同じ。

```text
FRONT VIEW: the character faces TOWARD the camera (we see the face, chest and front of the helmet),
seen from high above at about 55 degrees.
Use the attached character exactly.
The character throws with the RIGHT hand, toward the bottom of the image (toward the camera).

Cells, left to right, top row then bottom row:
1. Idle: standing, relaxed, a snowball held in the right hand at the waist.
2. Run A: running toward the camera, left foot forward, right arm forward.
3. Run B: running, both feet passing under the body, slightly up in the air.
4. Run C: running, right foot forward, left arm forward.
5. Crouch: squatting very low behind cover, knees fully bent, head ducked, body compact.
   Total height must be HALF of the idle pose.
6. Making a snowball: same low squat as cell 5, both hands together in front, packing snow.
7. Wind-up: right arm pulled far back behind the head holding a snowball,
   left arm pointing forward, body twisted, weight on the back foot.
8. Release: right arm fully extended toward the camera after throwing, hand open,
   body leaning forward, weight on the front foot.

[共通の指示をここに貼る]
```

## 3 回目: 横向き (右を向く)

```text
SIDE VIEW: the character faces to the RIGHT of the image (profile, nose pointing right),
seen from high above at about 55 degrees.
Use the attached character exactly.
The character throws with the RIGHT hand, toward the right of the image.

Cells, left to right, top row then bottom row:
1. Idle: standing, relaxed, a snowball held in the right hand at the waist.
2. Run A: running to the right, left foot forward, right arm forward.
3. Run B: running, both feet passing under the body, slightly up in the air.
4. Run C: running, right foot forward, left arm forward.
5. Crouch: squatting very low behind cover, knees fully bent, head ducked, body compact.
   Total height must be HALF of the idle pose.
6. Making a snowball: same low squat as cell 5, both hands together in front, packing snow.
7. Wind-up: right arm pulled far back behind the head holding a snowball,
   left arm pointing forward (to the right), body twisted, weight on the back foot.
8. Release: right arm fully extended to the right after throwing, hand open,
   body leaning forward, weight on the front foot.

[共通の指示をここに貼る]
```

---

## うまくいかないときの言い直し

| 起きたこと | 足す・言い直す一文 |
| --- | --- |
| 真横や正面の目線で描かれ、見下ろしになっていない | `The camera is ABOVE the character, looking down steeply. We see the top of the helmet and the shoulders from above.` |
| マスごとに顔や服が変わる | `Exactly the same character in all 8 cells. Same colors, same helmet, same face.` と、0 回目の設定画を添え直す |
| しゃがみが高い (シェルターから頭が出る) | `The crouch is very low: the top of the helmet is at half the standing height.` |
| 背景が市松模様・灰色 | 透明をあきらめて `Flat pure green #00FF00 background. No checkerboard.` |
| 隣のマスとくっつく | `Leave a wide empty margin around each character. Make the characters smaller inside the cells.` |
| 4 x 2 にならず、ばらばらに並ぶ | 1 マスずつ頼み直してもよい (1 ポーズ 1 枚。大きさはこちらでそろえる) |
| 投げる手が左になる | `Right-handed throw. The snowball is in the RIGHT hand.` (左右が逆でも、こちらで反転できる。向きだけ合っていればよい) |

## 届いたらこちらで確かめること

- 四隅の画素を読み、本当に透明か (市松を描き込んでいないか) を見る
- 8 ポーズを切り出し、**同じ足もとの線で並べた見本を、暗い地と明るい地の両方で**見る
- しゃがみ (5・6) の高さが、立ち (1) の半分くらいか (シェルターの陰に隠れるか) を数字で見る
- あおを赤に塗り替えて、あおと並べて見る

## 送ってほしい物

- 0〜3 回目の絵 (PNG のまま。縮めたり JPEG にしたりしない)
- 0 回目は、採った 1 枚だけでよい
