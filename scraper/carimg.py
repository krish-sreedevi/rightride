#!/usr/bin/env python3
"""
Right Ride car image standardizer.

Turns any manufacturer car photo into one consistent "studio" picture:
  * background removed (keeps real transparency; plain backdrops are flood-filled away;
    busy photos go through an AI cut-out model, rembg / u2net, when installed)
  * trimmed to the car, scaled to the same size and position on a fixed canvas
  * a soft ground shadow added under the wheels
  * saved as a transparent WebP

Usage as a tool:
  python3 scraper/carimg.py INPUT_URL_OR_FILE OUTPUT.webp [--w 1200 --h 700] [--no-shadow] [--flip]

Usage as the site pipeline (reads data/maker-images/*.json, writes site/img/cars/...):
  python3 scraper/carimg.py --build [--only "Brand|Model,..."] [--force]

Every output has the same canvas and the car's wheels sit on the same line, so the
tiles, car page and carousel all look alike whichever maker the photo came from.
"""
import argparse, hashlib, io, json, os, re, sys, glob, urllib.request
from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageChops

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
CANVAS = (1200, 700)       # output size
CAR_W, CAR_H = 0.90, 0.78  # the car may fill at most this share of the canvas
GROUND = 0.88              # wheels sit on this line (share of canvas height)

_rembg = None
def rembg_session():
    global _rembg
    if _rembg is None:
        try:
            from rembg import new_session
            _rembg = new_session('isnet-general-use')
        except Exception:
            _rembg = False
    return _rembg

def fetch(src):
    if os.path.exists(src):
        return open(src, 'rb').read()
    req = urllib.request.Request(src, headers={'User-Agent': UA, 'Accept': 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()

def has_real_alpha(im):
    if im.mode != 'RGBA':
        return False
    a = im.getchannel('A')
    lo, hi = a.getextrema()
    if lo > 250:
        return False
    # at least 8% of pixels clearly transparent, mostly at the edges
    small = a.resize((64, 64))
    px = list(small.tobytes())
    edge = [px[i] for i in range(64)] + [px[-64 + i] for i in range(64)] + [px[i * 64] for i in range(64)] + [px[i * 64 + 63] for i in range(64)]
    return sum(1 for v in px if v < 40) / len(px) > 0.08 and sum(1 for v in edge if v < 40) / len(edge) > 0.6

def clean_alpha(im):
    """renders that come with transparency sometimes carry a faint backdrop or a baked-in floor shadow:
    drop near-invisible pixels, and semi-transparent pixels beside or below the solid car body"""
    import numpy as np
    a = np.array(im.getchannel("A")).astype(np.int16)
    a[a < 40] = 0
    solid = a >= 235
    h, w = a.shape
    cols = solid.any(axis=0)
    # lowest solid pixel per column (wheels/tyres are solid); below it is floor
    low = np.where(cols, h - 1 - np.argmax(solid[::-1, :], axis=0), -1)
    rows = np.arange(h)[:, None]
    semi = (a > 0) & (a < 235)
    floor = semi & ((~cols)[None, :] | (rows > low[None, :]))
    a[floor] = 0
    out = im.copy(); out.putalpha(Image.fromarray(a.astype(np.uint8)))
    return out

def border_stats(rgb):
    w, h = rgb.size
    s = rgb.resize((min(w, 200), min(h, 200)))
    W, H = s.size
    pts = [s.getpixel((x, 0)) for x in range(W)] + [s.getpixel((x, H - 1)) for x in range(W)] + [s.getpixel((0, y)) for y in range(H)] + [s.getpixel((W - 1, y)) for y in range(H)]
    mean = tuple(sum(p[i] for p in pts) / len(pts) for i in range(3))
    var = sum(sum((p[i] - mean[i]) ** 2 for i in range(3)) for p in pts) / len(pts)
    return mean, var ** 0.5

def flood_cutout(rgb, tol=26):
    """remove a plain backdrop by flood-filling from the borders"""
    w, h = rgb.size
    mask = Image.new('L', (w, h), 255)
    work = rgb.copy()
    marker = (1, 254, 3)
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w - 1, h // 2)]:
        try:
            ImageDraw.floodfill(work, (x, y), marker, thresh=tol)
        except Exception:
            pass
    diff = ImageChops.difference(work, Image.new('RGB', (w, h), marker)).convert('L')
    mask = diff.point(lambda v: 0 if v < 3 else 255)
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = rgb.convert('RGBA'); out.putalpha(mask)
    return out

def cutout(im, ai=False):
    """returns (RGBA image with transparent background, method); ai=True ignores the photo's own transparency
    (for renders with a baked-in floor shadow) and cuts the car out again on a white backdrop"""
    im = ImageOps.exif_transpose(im)
    if im.mode in ('P', 'LA'):
        im = im.convert('RGBA')
    if ai and im.mode == 'RGBA':
        bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg.convert('RGB')
    if not ai and has_real_alpha(im):
        return clean_alpha(im.convert('RGBA')), 'alpha'
    rgb = im.convert('RGB')
    mean, sd = border_stats(rgb)
    if sd < 14 and not rembg_session():
        out = flood_cutout(rgb)
        a = out.getchannel('A')
        cover = sum(1 for v in a.resize((80, 80)).tobytes() if v > 128) / 6400
        if 0.08 < cover < 0.85:
            return out, 'flood'
    sess = rembg_session()
    if sess:
        from rembg import remove
        out = remove(rgb, session=sess, post_process_mask=True)
        return out.convert('RGBA'), 'ai'
    return None, 'none'

def trim(im):
    """crop to the solid car; faint haze or a semi-transparent backdrop around it is dropped"""
    solid = im.getchannel('A').point(lambda v: 255 if v > 150 else 0)
    box = solid.getbbox()
    if not box:
        return im
    x0, y0, x1, y1 = box
    pad = 4
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.size[0], x1 + pad), min(im.size[1], y1 + pad)))

def keep_largest(im):
    """keep the car: the largest opaque blob plus pieces sitting inside its outline (mirrors, antennas);
    drops people, signs and other things the cut-out kept beside the car"""
    try:
        import numpy as np
        from scipy import ndimage
    except Exception:
        return im
    a = np.array(im.getchannel('A'))
    lab, n = ndimage.label(a > 96)
    if n <= 1:
        return im
    sizes = ndimage.sum(np.ones_like(lab), lab, index=range(1, n + 1))
    big = int(np.argmax(sizes)) + 1
    ys, xs = np.where(lab == big)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    keep = np.zeros_like(a, dtype=bool)
    for i in range(1, n + 1):
        yy, xx = np.where(lab == i)
        if i == big:
            keep |= lab == i; continue
        inside = ((xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)).mean()
        if inside > 0.9 and sizes[i - 1] < sizes[big - 1] * 0.5:
            keep |= lab == i
    soft = ndimage.binary_dilation(keep, iterations=3)
    a2 = np.where(soft, a, 0).astype('uint8')
    out = im.copy(); out.putalpha(Image.fromarray(a2))
    return out

def cut_reflection(im):
    """studio shots on a glossy floor include a mirrored car below the tyres: cut at the narrow 'tyre contact' rows"""
    try:
        import numpy as np
    except Exception:
        return im
    a = np.array(im.getchannel('A')) > 64
    occ = a.mean(axis=1)
    if occ.max() <= 0:
        return im
    ymax = int(occ.argmax()); mn, ymin = occ[ymax], ymax
    for y in range(ymax, len(occ)):
        if occ[y] < mn:
            mn, ymin = occ[y], y
        elif mn < occ.max() * 0.35 and occ[y] > max(mn * 2, occ.max() * 0.12) and y - ymin > 4:
            return im.crop((0, 0, im.size[0], ymin + 2))
    return im

def compose(car, size=CANVAS, shadow=True):
    W, H = size
    car = trim(cut_reflection(keep_largest(trim(car))))
    cw, ch = car.size
    scale = min(W * CAR_W / cw, H * CAR_H / ch)
    car = car.resize((max(1, round(cw * scale)), max(1, round(ch * scale))), Image.LANCZOS)
    cw, ch = car.size
    x = (W - cw) // 2
    y = round(H * GROUND) - ch
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if shadow:
        sh = Image.new('L', (W, H), 0)
        d = ImageDraw.Draw(sh)
        sw, shh = cw * 0.92, max(10, ch * 0.10)
        cx, cy = W / 2, H * GROUND - shh * 0.15
        d.ellipse([cx - sw / 2, cy - shh / 2, cx + sw / 2, cy + shh / 2], fill=120)
        sh = sh.filter(ImageFilter.GaussianBlur(max(6, shh * 0.45)))
        shadow_layer = Image.new('RGBA', (W, H), (0, 0, 0, 0)); shadow_layer.putalpha(sh)
        canvas = Image.alpha_composite(canvas, shadow_layer)
    canvas.alpha_composite(car, (x, y))
    return canvas

def standardize(src, out, size=CANVAS, shadow=True, flip=False, quality=82, erase=None, ai=False):
    raw = fetch(src)
    im = Image.open(io.BytesIO(raw))
    car, how = cutout(im, ai)
    if car is None:
        return None
    for box in erase or []:  # manual fix: [x0, y0, x1, y1] as fractions of the source photo
        W, H = car.size
        ImageDraw.Draw(car).rectangle([box[0] * W, box[1] * H, box[2] * W, box[3] * H], fill=(0, 0, 0, 0))
    if flip:
        car = ImageOps.mirror(car)
    final = compose(car, size, shadow)
    os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
    final.save(out, 'WEBP', quality=quality, method=6)
    return how

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def build(only=None, force=False):
    """site pipeline: data/maker-images/*.json -> site/img/cars/<model>/{hero,<colour>}.webp + data/car-images.json"""
    out_dir = os.path.join(ROOT, 'site/img/cars')
    index_path = os.path.join(ROOT, 'data/car-images.json')
    index = json.load(open(index_path)) if os.path.exists(index_path) else {'models': {}}
    src_files = [f for f in glob.glob(os.path.join(ROOT, 'data/maker-images/*.json')) if not os.path.basename(f).startswith('_')]
    overrides = {}
    ov = os.path.join(ROOT, 'data/maker-images/_overrides.json')  # optional manual fixes: {"Brand|Model": {"hero": url, "flip": true}}
    if os.path.exists(ov):
        overrides = json.load(open(ov)).get('models', {})
    done = fail = 0
    for f in sorted(src_files):
        for key, m in json.load(open(f)).items():
            if only and key not in only:
                continue
            o = overrides.get(key, {})
            base = slug(key.replace('|', ' '))
            prev = index['models'].get(key, {})
            entry = {'hero': None, 'colors': [], 'interior': m.get('interior') or [], 'page': m.get('page')}
            jobs = []
            hero = o.get('hero') or m.get('hero')
            if hero: jobs.append(('hero', hero, None))
            for c in m.get('colors') or []:
                if c.get('img'): jobs.append(('color', c['img'], c['name']))
            for kind, url, name in jobs:
                h = hashlib.sha1(url.encode()).hexdigest()[:10]
                rel = f"img/cars/{base}/{'hero' if kind == 'hero' else slug(name)}-{h}.webp"
                path = os.path.join(ROOT, 'site', rel)
                rec = {'src': url, 'img': rel}
                if os.path.exists(path) and not force:
                    pass
                else:
                    try:
                        how = standardize(url, path, flip=o.get('flip', False), erase=o.get('erase') if kind == 'hero' else None, ai=o.get('ai', False))
                        if not how:
                            print('  could not cut out', key, kind, name or '', file=sys.stderr); fail += 1; continue
                        rec['how'] = how; done += 1
                    except Exception as e:
                        print('  failed', key, kind, name or '', str(e)[:80], file=sys.stderr); fail += 1
                        old = prev.get('hero') if kind == 'hero' else next((x for x in prev.get('colors', []) if x.get('name') == name), None)
                        if old: rec = old
                        else: continue
                if kind == 'hero': entry['hero'] = rec
                else: entry['colors'].append({**rec, 'name': name})
            if not entry['hero'] and entry['colors']:
                entry['hero'] = {k: v for k, v in entry['colors'][0].items() if k != 'name'}
            index['models'][key] = entry
            print(f"{key}: hero {'yes' if entry['hero'] else 'no'}, {len(entry['colors'])} colours, {len(entry['interior'])} interior")
    json.dump(index, open(index_path, 'w'), indent=1)
    print(f'done: {done} images made, {fail} failed')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?'); ap.add_argument('out', nargs='?')
    ap.add_argument('--w', type=int, default=CANVAS[0]); ap.add_argument('--h', type=int, default=CANVAS[1])
    ap.add_argument('--no-shadow', action='store_true'); ap.add_argument('--flip', action='store_true')
    ap.add_argument('--build', action='store_true'); ap.add_argument('--only'); ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    if a.build:
        build(set(a.only.split(',')) if a.only else None, a.force)
    elif a.src and a.out:
        print(standardize(a.src, a.out, (a.w, a.h), not a.no_shadow, a.flip))
    else:
        ap.print_help()
