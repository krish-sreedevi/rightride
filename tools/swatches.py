"""Work out each colour's swatch from its own photo, so the dot always matches the car.

Reads the colour images listed in site/data/extras.json (transparent studio renders in site/img/cars),
samples the painted body and writes data/swatches.json: { "img/cars/...webp": ["#rrggbb"] or [body, roof] }.
scraper/normalize.mjs uses these first and only falls back to guessing from the colour's name.
Run:  python3 tools/swatches.py
"""
import colorsys, json, os, re, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')


def hexof(rgb):
    return '#%02x%02x%02x' % tuple(int(round(c)) for c in rgb)


def body_pixels(im):
    """Opaque pixels of the car, without the bottom band (tyres and shadow)."""
    im = im.convert('RGBA')
    w, h = im.size
    im = im.resize((160, max(1, int(160 * h / w))))
    w, h = im.size
    px = im.load()
    opaque = [(x, y) for y in range(h) for x in range(w) if px[x, y][3] > 235]
    if not opaque:
        return [], []
    ys = [y for _, y in opaque]
    top, bot = min(ys), max(ys)
    span = max(1, bot - top)
    body = [px[x, y][:3] for x, y in opaque if top + span * 0.18 <= y <= top + span * 0.72]
    roof = [px[x, y][:3] for x, y in opaque if y <= top + span * 0.12]
    return body, roof


def clusters(pixels, k=6):
    """Group similar colours (PIL median cut) and return [(count, rgb)] largest first."""
    if not pixels:
        return []
    strip = Image.new('RGB', (len(pixels), 1))
    strip.putdata(pixels)
    q = strip.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()
    out = [(n, tuple(pal[i * 3:i * 3 + 3])) for n, i in q.getcolors()]
    return sorted(out, reverse=True)


def hsv(rgb):
    return colorsys.rgb_to_hsv(*(c / 255 for c in rgb))


def lift(pixels, rgb):
    """The paint as you'd name it: pixels close to the chosen cluster, taken at their brighter, unshaded tone."""
    h0, s0, _ = hsv(rgb)
    if s0 > 0.28:  # coloured paint: every pixel of the same hue, so shadows don't drag it towards brown or black
        hd = lambda h: min(abs(h - h0), 1 - abs(h - h0))
        near = [p for p in pixels if hd(hsv(p)[0]) < 0.05 and hsv(p)[1] > 0.25 and hsv(p)[2] > 0.15]
        lo, hi = .6, .9
    else:
        near = [p for p in pixels if sum((x - y) ** 2 for x, y in zip(p, rgb)) < 55 ** 2]
        lo, hi = .55, .85
    if len(near) < 12:
        return rgb
    # coloured paint: rank by colourfulness (saturation x brightness) so pale highlights and dark shadows both drop out
    near.sort(key=(lambda p: hsv(p)[1] * hsv(p)[2]) if s0 > 0.28 else (lambda p: sum(p)))
    band = near[int(len(near) * lo):int(len(near) * hi)] or near
    return tuple(sum(c) / len(band) for c in zip(*band))


# neutral paints are judged badly from photos (studio light makes white look grey, reflections make black look grey)
NEUTRAL = [(r'\b(silver|platinum|moonstone)\b', '#c4c7cc'), (r'\b(white|snow|arctic|polar|ivory|alpine)\b', '#f1f1ef'), (r'\b(black|onyx|obsidian|abyss|ebony|jet)\b', '#151618')]


def by_name(name):
    n = re.sub(r'\(.*?\)', '', name.lower())
    for pat, col in NEUTRAL:
        if re.search(pat, n):
            return col
    return None


def paint(pixels):
    cs = clusters(pixels)
    if not cs:
        return None
    return lift(pixels, _paint(cs))


def _paint(cs):
    total = sum(n for n, _ in cs)
    # glass, grille and tyres are dark and colourless; a black car is mostly dark
    dark = sum(n for n, c in cs if hsv(c)[2] < 0.2)
    if dark / total > 0.55:
        return min((c for n, c in cs if hsv(c)[2] < 0.2), key=lambda c: hsv(c)[2])
    # a clearly coloured cluster that covers a fair share of the body is the paint
    chroma = [(n, c) for n, c in cs if hsv(c)[1] > 0.28 and hsv(c)[2] > 0.18]
    if chroma and max(n for n, _ in chroma) / total >= 0.16:
        return max(chroma)[1]
    # otherwise the paint is white, silver or grey: the biggest non-dark cluster
    light = [(n, c) for n, c in cs if hsv(c)[2] >= 0.2]
    return max(light)[1] if light else cs[0][1]


def far(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5 > 90


def main():
    ex = json.load(open(os.path.join(SITE, 'data', 'extras.json')))
    out, missing = {}, 0
    for key, m in ex['models'].items():
        for c in m.get('colors', []):
            src = c['img']
            path = os.path.join(SITE, src)
            if src.startswith('http') or not os.path.exists(path):
                missing += 1
                continue
            try:
                body, roof = body_pixels(Image.open(path))
                dual = re.search(r'dual|two.?tone|roof|\+| with ', c['name'], re.I)
                named = None if dual else by_name(c['name'])
                if named:
                    out[src] = [named]
                    continue
                b = paint(body)
                if not b:
                    continue
                sw = [hexof(b)]
                if dual:
                    r = paint(roof)
                    if r and far(r, b):
                        sw = [hexof(b), hexof(r)]
                out[src] = sw
            except Exception as e:  # a broken image keeps the name-based guess
                print('skip', src, e, file=sys.stderr)
    dest = os.path.join(ROOT, 'data', 'swatches.json')
    json.dump(out, open(dest, 'w'), indent=0, sort_keys=True)
    print(f'{len(out)} swatches written to data/swatches.json ({missing} images not found locally)')


if __name__ == '__main__':
    main()
