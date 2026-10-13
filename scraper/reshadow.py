"""Ground shadow that follows the tyres, for renders shot from a high camera angle.

carimg.py puts a flat oval shadow under every car. For photos taken from above (Nissan's
configurator renders, for example) the far wheels sit higher in the picture than the oval,
so the car looks like it is floating. This removes that oval and draws a contact shadow along
the bottom outline of the car instead, plus a soft pad slanted between the front and rear wheels.

  python3 scraper/reshadow.py site/img/cars/nissan-gravite/*.webp   (rewrites in place)
"""
import sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter

def strip(im):
    a = np.array(im.getchannel('A')).astype(np.int16)
    solid = a >= 235; h, w = a.shape
    cols = solid.any(0)
    low = np.where(cols, h - 1 - np.argmax(solid[::-1, :], 0), -1)
    rows = np.arange(h)[:, None]
    semi = (a > 0) & (a < 235)
    a[semi & ((~cols)[None, :] | (rows > low[None, :]))] = 0
    out = im.copy(); out.putalpha(Image.fromarray(a.astype(np.uint8)))
    return out, low, cols

def contact_shadow(im):
    im = im.convert('RGBA')
    car, low, cols = strip(im)
    W, H = im.size
    xs = np.where(cols)[0]; x0, x1 = xs[0], xs[-1]; cw = x1 - x0
    A = np.array(car.getchannel('A')) >= 235
    top = np.argmax(A.any(1)); ch = low.max() - top
    mid = (x0 + x1) // 2
    li = x0 + int(np.argmax(low[x0:mid])); ri = mid + int(np.argmax(low[mid:x1 + 1]))
    ly, ry = low[li], low[ri]
    sh = Image.new('L', (W, H), 0); d = ImageDraw.Draw(sh)
    t = float(max(8, ch * 0.07))
    for x in range(x0, x1 + 1, 4):
        y = low[x]
        if y >= 0: d.ellipse([x - t, y - t * 0.5, x + t, y + t * 0.6], fill=150)
    cx, cy = (li + ri) / 2, (ly + ry) / 2
    ang = np.degrees(np.arctan2(ry - ly, ri - li))
    pad = Image.new('L', (W * 2, H * 2), 0)
    L = np.hypot(ri - li, ry - ly) * 0.62 + cw * 0.12
    ImageDraw.Draw(pad).ellipse([W - L, H - t * 1.3, W + L, H + t * 1.3], fill=90)
    pad = pad.rotate(-ang, center=(W, H)).crop((int(W - cx), int(H - cy), int(W - cx) + W, int(H - cy) + H))
    sh = Image.fromarray(np.maximum(np.array(sh), np.array(pad))).filter(ImageFilter.GaussianBlur(max(6, t * 0.9)))
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); layer.putalpha(sh)
    return Image.alpha_composite(layer, car)

if __name__ == '__main__':
    for f in sys.argv[1:]:
        contact_shadow(Image.open(f)).save(f, 'WEBP', quality=82, method=6); print('reshadowed', f)
