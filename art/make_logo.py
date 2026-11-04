"""届いたロゴ (art/logo_raw.png, 背景は本当の透明) から、タイトルのロゴとアプリのアイコンを作る。

    python3 -I art/make_logo.py

- logo.webp            タイトル画面のロゴ (幅 880px。画面 430pt の 2 倍で少し余裕)
- apple-touch-icon.png ホーム画面のアイコン (180x180。iOS は SVG を使えない)
- icon-512.png         大きいアイコン (512x512)
アイコンは、あおの夜空 (上から下へ明るく) に雪をちらし、ロゴを幅いっぱいに載せる。
iOS が角を丸めるので、四角いまま全面に描く。
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

logo = Image.open(os.path.join(HERE, 'logo_raw.png')).convert('RGBA')
# 透明なふちを切り詰める
logo = logo.crop(logo.getbbox())

# タイトルのロゴ
w = 880
t = logo.resize((w, round(logo.height * w / logo.width)), Image.LANCZOS)
t.save(os.path.join(ROOT, 'logo.webp'), 'WEBP', quality=90, method=6)


def icon(size):
    s = size
    bg = Image.new('RGBA', (s, s))
    d = ImageDraw.Draw(bg)
    top, bot = (16, 52, 130), (70, 150, 235)
    for y in range(s):
        k = y / (s - 1)
        d.line([(0, y), (s, y)], fill=tuple(round(top[i] + (bot[i] - top[i]) * k) for i in range(3)) + (255,))
    # 下に雪の丘
    d.ellipse([-s * 0.3, s * 0.78, s * 1.3, s * 1.5], fill=(240, 247, 255, 255))
    # 降る雪 (いつも同じ並びになるよう乱数を固定)
    rnd = random.Random(7)
    for _ in range(26):
        x, y, r = rnd.uniform(0, s), rnd.uniform(0, s * 0.8), rnd.uniform(s * 0.006, s * 0.016)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 170))
    # ロゴのまわりにやわらかい光
    lw = round(s * 1.03)   # まわりの雪しぶきだけ少しはみ出す (字と旗の先は切れない。1.08 では旗の先が角に切られた)
    lg = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
    glow = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    a = lg.split()[3].point(lambda v: min(255, v))
    halo = Image.new('RGBA', lg.size, (255, 255, 255, 0))
    halo.putalpha(a.point(lambda v: v * 0.55))
    ox, oy = (s - lg.width) // 2, round(s * 0.5 - lg.height * 0.52)
    glow.paste(halo, (ox, oy), halo)
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.03))
    bg = Image.alpha_composite(bg, glow)
    bg.alpha_composite(lg, (ox, oy))
    return bg.convert('RGB')


icon(512).save(os.path.join(ROOT, 'icon-512.png'))
icon(1024).resize((180, 180), Image.LANCZOS).save(os.path.join(ROOT, 'apple-touch-icon.png'))
print('logo.webp', t.size, os.path.getsize(os.path.join(ROOT, 'logo.webp')) // 1024, 'KB')
