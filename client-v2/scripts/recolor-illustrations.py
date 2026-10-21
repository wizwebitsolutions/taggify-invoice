"""Make dark-theme variants of the illustration PNGs (public/illustrations/*-dark.png).
Run from client-v2: python scripts/recolor-illustrations.py public/illustrations public/illustrations

peach backdrop -> slate, pale peach leaves -> blue-grey, bright strong orange
(shirts, hearts, accents) -> mint. Skin, hair, greys and greens are kept. Every swap only applies to solid areas, so shading and highlights on skin stay as drawn."""
import sys, colorsys, glob, os
from PIL import Image, ImageFilter

SLATE = (27, 43, 55)      # blob backdrop
MINT_H = 170 / 360        # teal hue of the dark --primary #64EBD6

# Hand-marked regions for the sidebar hero art, so it matches the dark reference
# exactly: (x0, y0, x1, y1) in source pixels.
HERO = {
    "sidebar-illustration.png": {
        "skin": [(120, 30, 168, 92), (118, 132, 168, 156)],  # face/neck, hands: general rules only
        "mint": [(80, 78, 172, 160), (190, 20, 210, 42)],    # shirt, heart
    },
}

def inside(boxes, x, y):
    return any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in boxes)

def hero_pixel(spec, x, y, r, g, b, a):
    """Every warm colour outside the skin becomes slate / mint / blue-grey."""
    if a == 0 or inside(spec["skin"], x, y):
        return None
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hd = h * 360
    if not (hd <= 50 or hd >= 340) or s < 0.035 or v < 0.35:
        return None
    if s < 0.22 and v > 0.85:
        return classify(r, g, b, a)[1] or None
    if inside(spec["mint"], x, y):
        nr, ng, nb = colorsys.hsv_to_rgb(MINT_H, min(1, max(s, 0.5) * 0.62), min(1, v * 0.92))
        return (int(nr * 255), int(ng * 255), int(nb * 255), a)
    k = 0.55 + 0.45 * v * (1 - s * 0.5)
    return (int(150 * k), int(178 * k), int(200 * k), a)

def is_skin(r, g, b, a):
    if a < 128:
        return False
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return (h * 360 <= 35) and 0.30 <= s < 0.70 and v > 0.70 and not (h * 360 <= 18 and s >= 0.62)

def blush_patches(pixels, results, w, h):
    """Mint candidates in a patch mostly ringed by skin are cheek blush, not clothing."""
    keep = set()
    seen = [False] * (w * h)
    for start in range(w * h):
        if seen[start] or results[start][0] != "mint":
            continue
        stack, comp, ring = [start], [], {}
        seen[start] = True
        while stack:
            i = stack.pop(); comp.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if results[j][0] == "mint":
                        if not seen[j]:
                            seen[j] = True; stack.append(j)
                    else:
                        ring[j] = True
        skin = sum(1 for j in ring if is_skin(*pixels[j]))
        if ring and skin / len(ring) > 0.6:
            keep.update(comp)
    return keep

def components(w, h, member):
    """Yield (pixel indices, ring indices) for each 4-connected region where member(i) is true."""
    seen = bytearray(w * h)
    for start in range(w * h):
        if seen[start] or not member(start):
            continue
        stack, comp, ring = [start], [], set()
        seen[start] = 1
        while stack:
            i = stack.pop(); comp.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if member(j):
                        if not seen[j]:
                            seen[j] = 1; stack.append(j)
                    else:
                        ring.add(j)
        yield comp, ring

def floating_accents(pixels, results, w, h):
    """Small coral shapes sitting on the backdrop (hearts, coins, chart bars) -> mint."""
    def coral(i):
        r, g, b, a = pixels[i]
        if a < 128 or results[i][0] is not None:
            return False
        hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
        return hh * 360 <= 20 and ss >= 0.42 and vv > 0.85
    out = set()
    for comp, ring in components(w, h, coral):
        if len(comp) > 0.015 * w * h or not ring:
            continue
        open_ = sum(1 for j in ring if pixels[j][3] < 128 or results[j][0] in ("bg", "mint"))
        if open_ / len(ring) > 0.7:
            out.update(comp)
    return out

def classify(r, g, b, a):
    if a == 0:
        return None, None
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    hd = h * 360
    if not (hd <= 45 or hd >= 340):
        return None, None
    if 0.035 <= s < 0.22 and v > 0.85:
        t = min(1, max(0, (0.99 - v) / 0.14 + (s - 0.07) * 2))
        lift = int(18 * t)
        return "bg", (SLATE[0] + lift, SLATE[1] + lift, SLATE[2] + lift, a)
    if 0.22 <= s < 0.36 and v > 0.80:
        k = v * (1 - s * 0.5)
        return "leaf", (int(150 * k), int(178 * k), int(200 * k), a)
    if hd <= 18 and s >= 0.62 and v > 0.80:
        nr, ng, nb = colorsys.hsv_to_rgb(MINT_H, min(1, s * 0.62), min(1, v * 0.92))
        return "mint", (int(nr * 255), int(ng * 255), int(nb * 255), a)
    return None, None

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, "*.png"))):
    if f.endswith("-dark.png"):
        continue
    im = Image.open(f).convert("RGBA")
    pixels = list(im.getdata())
    results = [classify(*p) for p in pixels]
    def density(kind, radius):
        mask = Image.new("L", im.size)
        mask.putdata([255 if k == kind else 0 for k, _ in results])
        return list(mask.filter(ImageFilter.BoxBlur(radius)).getdata())
    mint_d, leaf_d, bg_d = density("mint", 2), density("leaf", 3), density("bg", 4)
    blush = blush_patches(pixels, results, *im.size)
    accents = floating_accents(pixels, results, *im.size)
    out = []
    for i, (p, (k, new), md, ld, bd) in enumerate(zip(pixels, results, mint_d, leaf_d, bg_d)):
        if (k == "mint" and (md < 40 or i in blush)) or (k == "leaf" and ld < 150) or (k == "bg" and bd < 90):
            out.append(p)  # small patch (skin shading, highlights): keep the original colour
        elif i in accents:
            r, g, b, a = p
            hh, ss, vv = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            nr, ng, nb = colorsys.hsv_to_rgb(MINT_H, min(1, ss * 0.75), min(1, vv * 0.92))
            out.append((int(nr * 255), int(ng * 255), int(nb * 255), a))
        else:
            out.append(new if new else p)
    spec = HERO.get(os.path.basename(f))
    if spec:
        w = im.width
        # Inside the skin boxes the general rules still apply (shirt edges, backdrop, blush kept).
        out = [hero_pixel(spec, i % w, i // w, *p) or o for i, (p, o) in enumerate(zip(pixels, out))]
    im.putdata(out)
    im.save(os.path.join(dst, os.path.basename(f)[:-4] + "-dark.png"))
    print("ok", os.path.basename(f))
