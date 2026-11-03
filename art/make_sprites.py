"""
届いた選手の絵 (art/player_back.png ・ player_front.png ・ player_side.png) から、
ゲームが読む 1 枚の絵 (players.webp) を作る。

    python3 -I art/make_sprites.py

やること:
  1. 背景の薄いもや (透明度 48 以下) を消し、キャラの中 (200 以上) を完全な不透明にそろえる
  2. 4 x 2 のマスから 8 ポーズを切り出す。小さな汚れの塊は捨てる
  3. 3 枚とも同じ倍率で縮め、足もとを同じ線に、頭の真ん中を同じ横位置にそろえる
  4. 背中側の 7 コマ目 (振りかぶり) は左手で投げていたので、左右を反転して右手にする
  5. あおの青い所を赤に塗り替えて、あかの 3 行を作る
  6. 8 列 x 6 行 (あお 背中・正面・横 / あか 背中・正面・横) に並べて WebP で書き出す
  7. 暗い地と明るい地に並べた見本 (art/check_sprites.png) も書き出す (目で見る用)
  あとから届いた 1 枚絵 (OVERRIDE) は、もとのコマとヘルメットの幅・足もと・頭の真ん中をそろえて差し替える
"""
import json
import os
from collections import deque

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CELL = 192           # 1 コマの大きさ (px)
BASE = CELL - 8      # 足もとの線 (上から)
IDLE_H = 150         # 立ちの高さ (px)。走る絵は立ちより 1 割ほど高いので、上に余白を残す
SHEETS = ['player_back.png', 'player_front.png', 'player_side.png']
MIRROR = {('player_back.png', 6)}   # 左手で投げていたコマ (0 から数える)
# あとから届いた 1 枚絵で差し替えるコマ: (絵, コマ) -> ファイル。背景が黒の JPEG でもよい
OVERRIDE = {
    ('player_back.png', 4): 'player_back_crouch.jpg',   # 背中側のしゃがむ
    ('player_back.png', 5): 'player_back_crouch.jpg',   # 背中側の丸める (同じ絵。手もとに雪がある)
}


def clean_alpha(rgba):
    a = rgba[..., 3].astype(np.int32)
    a[a <= 48] = 0
    a[a >= 200] = 255
    rgba[..., 3] = a.astype(np.uint8)
    rgba[a == 0, :3] = 0          # 透明な所に残った色 (青い光) を消す。縮めたときにふちへ混ざらないように
    return rgba


def components(mask):
    """mask (bool) のつながった塊ごとに、画素数と位置を返す (4 近傍)"""
    h, w = mask.shape
    label = np.zeros((h, w), np.int32)
    out = []
    n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if label[y0, x0]:
            continue
        n += 1
        q = deque([(y0, x0)])
        label[y0, x0] = n
        cnt = 0
        while q:
            y, x = q.popleft()
            cnt += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not label[yy, xx]:
                    label[yy, xx] = n
                    q.append((yy, xx))
        out.append((n, cnt))
    return label, out


def load_black_bg(path):
    """背景が黒 (0〜2) の JPEG を透明にする。ふちからつながる黒だけを抜く (体の中の黒い輪郭は残す)"""
    rgb = np.array(Image.open(os.path.join(HERE, path)).convert('RGB')).astype(np.int32)
    h, w = rgb.shape[:2]
    mx = rgb.max(axis=2)
    bg = np.zeros((h, w), bool)
    q = deque()
    for y in range(h):
        for x in (0, w - 1):
            if mx[y, x] <= 6 and not bg[y, x]:
                bg[y, x] = True; q.append((y, x))
    for x in range(w):
        for y in (0, h - 1):
            if mx[y, x] <= 6 and not bg[y, x]:
                bg[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < h and 0 <= xx < w and not bg[yy, xx] and mx[yy, xx] <= 6:
                bg[yy, xx] = True; q.append((yy, xx))
    alpha = np.where(bg, 0, 255).astype(np.int32)
    # ふち: 背景に接している暗い画素は、明るさに応じて半透明にする (JPEG のにじみ)
    near = np.zeros_like(bg)
    near[1:] |= bg[:-1]; near[:-1] |= bg[1:]; near[:, 1:] |= bg[:, :-1]; near[:, :-1] |= bg[:, 1:]
    edge = near & ~bg & (mx <= 24)
    alpha[edge] = np.clip((mx[edge] - 6) * 255 // 18, 0, 255)
    out = np.zeros((h, w, 4), np.uint8)
    out[..., :3] = rgb
    out[..., 3] = alpha
    out[alpha == 0, :3] = 0
    return out


def helmet_width(cell):
    """頭のあたり (上から 30%) で、不透明な画素がいちばん横に広い行の幅 (= ヘルメットの幅)"""
    x0, y0, x1, y1 = bbox(cell[..., 3])
    top = cell[y0:y0 + int((y1 - y0) * 0.3), :, 3] > 128
    widths = [int(np.ptp(np.nonzero(r)[0])) + 1 for r in top if r.any()]
    return max(widths)


def fit_override(orig, path):
    """差し替えの絵を、もとのコマと同じ大きさ・同じ位置に合わせる (ヘルメットの幅・足もと・頭の真ん中)"""
    src = load_black_bg(path)
    k = helmet_width(orig) / helmet_width(src)
    img = Image.fromarray(src).resize((round(src.shape[1] * k), round(src.shape[0] * k)), Image.LANCZOS)
    small = np.array(img)
    ox0, oy0, ox1, oy1 = bbox(orig[..., 3])
    sx0, sy0, sx1, sy1 = bbox(small[..., 3])
    dx = round(head_center_x(orig) - head_center_x(small))
    dy = oy1 - sy1
    out = Image.new('RGBA', (orig.shape[1], orig.shape[0]), (0, 0, 0, 0))
    out.paste(img, (dx, dy), img)
    return np.array(out)


def cut_cells(path):
    im = np.array(Image.open(os.path.join(HERE, path)).convert('RGBA'))
    im = clean_alpha(im)
    h, w = im.shape[:2]
    cw, ch = w // 4, h // 2
    cells = []
    for i in range(8):
        r, c = divmod(i, 4)
        cell = im[r * ch:(r + 1) * ch, c * cw:(c + 1) * cw].copy()
        # 小さな汚れを捨てる: いちばん大きい塊の 2% 未満の塊
        mask = cell[..., 3] > 0
        label, comps = components(mask)
        big = max(cnt for _, cnt in comps)
        drop = [n for n, cnt in comps if cnt < big * 0.02]
        if drop:
            cell[np.isin(label, drop)] = 0
        if (path, i) in MIRROR:
            cell = cell[:, ::-1].copy()
        if (path, i) in OVERRIDE:
            cell = fit_override(cell, OVERRIDE[(path, i)])
        cells.append(cell)
    return cells


def bbox(a):
    ys, xs = np.nonzero(a > 128)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def head_center_x(cell):
    """頭のあたり (上から 30%) の不透明な画素の横の真ん中。腕を広げても動かない"""
    x0, y0, x1, y1 = bbox(cell[..., 3])
    top = cell[y0:y0 + int((y1 - y0) * 0.3), :, 3] > 128
    xs = np.nonzero(top)[1]
    return xs.mean()


def place(cell, scale):
    """縮めて、足もとを BASE に、頭の真ん中を CELL/2 にそろえて 1 コマにする"""
    x0, y0, x1, y1 = bbox(cell[..., 3])
    hx = head_center_x(cell)
    img = Image.fromarray(cell)
    nw, nh = round(cell.shape[1] * scale), round(cell.shape[0] * scale)
    small = img.resize((nw, nh), Image.LANCZOS)
    out = Image.new('RGBA', (CELL, CELL), (0, 0, 0, 0))
    ox = round(CELL / 2 - hx * scale)
    oy = round(BASE - y1 * scale)
    out.alpha_composite(small, (ox, oy)) if ox >= 0 and oy >= 0 else out.paste(small, (ox, oy), small)
    arr = np.array(out)
    # はみ出していないか
    bx0, by0, bx1, by1 = bbox(arr[..., 3])
    return arr, (bx0, by0, bx1, by1)


def to_red(rgba):
    """青 (色相 205〜250°) の服とヘルメットを赤へ。ゴーグルのレンズ (水色・白っぽい) は残す"""
    img = Image.fromarray(rgba, 'RGBA')
    hsv = np.array(img.convert('RGB').convert('HSV')).astype(np.float32)
    hue = hsv[..., 0] * 360 / 255
    sat = hsv[..., 1] / 255
    val = hsv[..., 2] / 255
    # 上着・ヘルメットは彩度 0.88〜1.0。レンズ (0.46) と紺のズボン (0.56) は残す
    blue = (hue > 205) & (hue < 250) & (sat > 0.62) & (val > 0.3)
    shift = hsv.copy()
    shift[..., 0] = np.where(blue, (hue - 228 + 360 + 2) % 360 * 255 / 360, hsv[..., 0])
    rgb = np.array(Image.fromarray(shift.astype(np.uint8), 'HSV').convert('RGB'))
    out = rgba.copy()
    out[..., :3] = np.where(blue[..., None], rgb, rgba[..., :3])
    return out


def main():
    sheets = [cut_cells(p) for p in SHEETS]
    # 倍率は 1 枚ごと: どの向きでも立ち (1 コマ目) の高さが IDLE_H になるように
    # (横向きの絵だけ 1 割近く大きく描かれていて、向きを変えるたびに大きさが変わって見えた)
    rows = []
    report = {}
    scales = {}
    for name, cells in zip(SHEETS, sheets):
        b = bbox(cells[0][..., 3])
        scale = IDLE_H / (b[3] - b[1])
        scales[name] = round(float(scale), 4)
        row = []
        for i, c in enumerate(cells):
            arr, bb = place(c, scale)
            row.append(arr)
            report[f'{name}#{i + 1}'] = {'bbox': [int(v) for v in bb], 'h': int(bb[3] - bb[1])}
            assert bb[0] > 0 and bb[1] > 0 and bb[2] < CELL and bb[3] <= BASE + 1, f'はみ出し {name} {i + 1} {bb}'
        rows.append(row)
    rows += [[to_red(c) for c in row] for row in rows[:3]]
    atlas = Image.new('RGBA', (CELL * 8, CELL * len(rows)), (0, 0, 0, 0))
    for r, row in enumerate(rows):
        for c, arr in enumerate(row):
            atlas.paste(Image.fromarray(arr), (c * CELL, r * CELL))
    out = os.path.join(ROOT, 'players.webp')
    atlas.save(out, 'WEBP', quality=88, method=6)
    print(out, os.path.getsize(out) // 1024, 'KB', atlas.size, 'scale', scales)
    # 見本: 暗い地と明るい地
    w, h = atlas.size
    chk = Image.new('RGBA', (w, h * 2))
    for i, col in enumerate([(30, 30, 40, 255), (235, 240, 250, 255)]):
        bg = Image.new('RGBA', (w, h), col)
        bg.alpha_composite(atlas)
        chk.paste(bg, (0, i * h))
    chk.convert('RGB').resize((w // 2, h)).save(os.path.join(HERE, 'check_sprites.png'))
    with open(os.path.join(HERE, 'sprites_report.json'), 'w') as f:
        json.dump({'cell': CELL, 'base': BASE, 'scale': scales, 'frames': report}, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
