"""
届いたコートと壁の絵 (art/*_raw.jpg) から、ゲームが読む絵 (tex_*.jpg) を作る。

    python3 -I art/make_court.py

  雪面 2 種 (つなぎ目はもとから合っている) ・ シェルターの面 ・ シャトーの面 ・ 壁の上面 ・ 旗の布
  シェルター・シャトー・旗は、あおの絵の青い所を塗り替えて あか・中央 を作る。
  見本 (art/check_court.png) も書き出す。
"""
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load(name):
    return Image.open(os.path.join(HERE, name)).convert('RGB')


def recolor(img, mode):
    """青 (色相 205〜250°・彩度 0.45 以上) を赤 (あか) か淡い灰青 (中央) へ。白いビニールは残す"""
    hsv = np.array(img.convert('HSV')).astype(np.float32)
    hue = hsv[..., 0] * 360 / 255
    sat = hsv[..., 1] / 255
    blue = (hue > 200) & (hue < 255) & (sat > 0.45)
    out = hsv.copy()
    if mode == 'red':
        out[..., 0] = np.where(blue, ((hue - 228 + 360 + 2) % 360) * 255 / 360, hsv[..., 0])
    else:   # 中央: 色を抜いて明るく (どちらのチームの物でもない)
        out[..., 1] = np.where(blue, hsv[..., 1] * 0.18, hsv[..., 1])
        out[..., 2] = np.where(blue, np.minimum(255, hsv[..., 2] * 0.5 + 75), hsv[..., 2])
    return Image.fromarray(out.astype(np.uint8), 'HSV').convert('RGB')


def save(img, name, size, q=86):
    img = img.resize(size, Image.LANCZOS)
    path = os.path.join(ROOT, name)
    img.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
    print(name, size, os.path.getsize(path) // 1024, 'KB')
    return img


def crop_nonwhite(img, thr=235):
    a = np.array(img).astype(int)
    m = a.min(axis=2) < thr
    ys, xs = np.nonzero(m)
    return img.crop((xs.min() + 4, ys.min() + 4, xs.max() - 3, ys.max() - 3))   # 縁の白いにじみも落とす


def main():
    out = {}
    out['ground'] = save(load('snow_ground_raw.jpg'), 'tex_ground.jpg', (512, 512), 82)
    out['court'] = save(load('snow_court_raw.jpg'), 'tex_court.jpg', (512, 512), 82)

    shelter = load('shelter_raw.jpg')
    out['shelter_blue'] = save(shelter, 'tex_shelter_blue.jpg', (512, 256))
    out['shelter_red'] = save(recolor(shelter, 'red'), 'tex_shelter_red.jpg', (512, 256))
    out['shelter_center'] = save(recolor(shelter, 'center'), 'tex_shelter_center.jpg', (512, 256))

    # シャトーは塔のあるお城の形で描かれていて、上の方は背景の白。
    # どの塔も壁もそろって見える高さ (いちばん低い壁の上端より下) から下を、壁の面として使う
    ch = load('chateau_raw.jpg')
    w, h = ch.size
    ch = ch.crop((0, int(h * 0.30), w, h))
    out['chateau_blue'] = save(ch, 'tex_chateau_blue.jpg', (1024, 336))
    out['chateau_red'] = save(recolor(ch, 'red'), 'tex_chateau_red.jpg', (1024, 336))

    out['walltop'] = save(load('wall_top_raw.jpg'), 'tex_walltop.jpg', (512, 128))

    flag = crop_nonwhite(load('flag_blue_raw.jpg'))
    out['flag_blue'] = save(flag, 'tex_flag_blue.jpg', (512, 340))
    out['flag_red'] = save(recolor(flag, 'red'), 'tex_flag_red.jpg', (512, 340))

    # 見本: 雪面は 2 x 2 に並べて、つなぎ目が見えないかを見る
    W = 1024
    sheet = Image.new('RGB', (W, 1500), (40, 44, 56))
    y = 0
    for key in ('ground', 'court'):
        t = out[key].resize((256, 256))
        for i in range(2):
            for j in range(2):
                sheet.paste(t, (i * 256 + (0 if key == 'ground' else 512), j * 256))
    y = 520
    x = 0
    for key in ('shelter_blue', 'shelter_red', 'shelter_center'):
        t = out[key].resize((330, 165)); sheet.paste(t, (x, y)); x += 340
    y += 175
    for i, key in enumerate(('chateau_blue', 'chateau_red')):
        t = out[key].resize((500, 164)); sheet.paste(t, (i * 512, y))
    y += 175
    sheet.paste(out['walltop'].resize((512, 128)), (0, y))
    y += 140
    for i, key in enumerate(('flag_blue', 'flag_red')):
        t = out[key].resize((300, 200)); sheet.paste(t, (i * 320, y))
    sheet.save(os.path.join(HERE, 'check_court.png'))


if __name__ == '__main__':
    main()
