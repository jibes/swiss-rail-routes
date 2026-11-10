# The logo, V15, and every file made from it. A viaduct seen from the side, in white on a flat
# red tile; drawn in the 108-unit tile itself, running out past both of its sides:
#
#   deck       y 30 to 39, the tile's whole width
#   arches     centred every 27 units on x 0, 27, 54, 81, 108: three whole ones and a half
#              at each side, so an arch, never a pier, meets the edge; 17.8 wide (2 × 8.91),
#              round tops on y 39
#   valley     a V with a rounded tip (V15, 10 Nov 2026; V14 a soft U): the piers stand on
#              y = 62 + 32 · (1 − (√(d² + t²) − t) / (√(1 + t²) − t)), d = |x − 54| / 54, t = 0.25:
#              62 at the sides, 94 at the tip
#
#   ground     white from the valley's line to the tile's foot (V15, no gap): one white shape with
#              the viaduct, reaching OVER (1 unit) up into its piers so no seam shows
#
# Colour: red #D40000 sky, white #FFFFFF mark. The arches are the red showing through, so the
# one-colour versions (status bar, Android themed icon, notification) are the same shape. No
# hairlines: the red is drawn only above the ground (never under white at the tile's foot), and
# the web icons are rounded by one mask over the finished image, not a clip on each shape.
# Adaptive and maskable icons: a launcher shows only the middle 72 of the 108 tile, so there the
# design is drawn at 2/3 in that middle, its deck and arches running on to the edges (0.22.1:
# drawn over the whole 108, the launcher cut off the valley and the sky and showed an "m").
#
#   python3 scripts/logo-sets.py           docs/design/logos/v15/
#   python3 scripts/logo-sets.py --apply   public/icons/{icon,maskable}.svg and the Android
#                                          launcher, themed, background and notification vectors
#   then: npm run icons                    the PNGs
import math
import os
import sys

RED = '#D40000'
WHITE = '#FFFFFF'
ROOT = os.path.join(os.path.dirname(__file__), '..')
DOCS = os.path.join(ROOT, 'docs', 'design', 'logos', 'v15')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'drawable')
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {v} {v}">{body}</svg>\n'

SIZE = 108
DECK_TOP, DECK = 30, 9
PERIOD, OFFSET, OPEN = 27, 54, 0.66
EDGE, DEPTH, TIP = 62, 32, 0.25
R_ARCH = PERIOD * OPEN / 2
SPRING = DECK_TOP + DECK + R_ARCH  # where an arch's round top meets its straight sides


def ground(x):
    d = min(abs(x - SIZE / 2) / (SIZE / 2), 1)
    v = (math.sqrt(d * d + TIP * TIP) - TIP) / (math.sqrt(1 + TIP * TIP) - TIP)
    return EDGE + DEPTH * (1 - v)


def f(v):
    return f'{v:.2f}'.rstrip('0').rstrip('.')


def viaduct(x_from=0, x_to=SIZE):
    """The white shape from x_from to x_to: the deck, then each pier between two arches as its
    own clockwise piece overlapping the deck by half a unit (non-zero fill joins them). Past the
    tile's sides the arches go on, the ground level with its sides."""
    centres = [OFFSET + k * PERIOD for k in range(-8, 9)]
    d = [f'M{f(x_from)},{DECK_TOP} H{f(x_to)} V{DECK_TOP + DECK} H{f(x_from)} Z']
    top = DECK_TOP + DECK
    for c, n in zip(centres, centres[1:]):
        if n + R_ARCH < x_from or c - R_ARCH > x_to:
            continue
        a, b = c + R_ARCH, n - R_ARCH  # the pier, from a to b
        p = [f'M{f(c)},{top - 0.5} H{f(n)} V{top}',
             f'A{f(R_ARCH)},{f(R_ARCH)} 0 0 0 {f(b)},{f(SPRING)} V{f(ground(b))}']
        for i in range(1, 7):
            x = b + (a - b) * i / 6
            p.append(f'L{f(x)},{f(ground(x))}')
        p.append(f'V{f(SPRING)} A{f(R_ARCH)},{f(R_ARCH)} 0 0 0 {f(c)},{top} Z')
        d.append(' '.join(p))
    return ' '.join(d)


OVER = 1


def ground_path(x_from=0, x_to=SIZE, foot=SIZE):
    """The ground, white, from the valley's line (OVER up into the piers) to `foot`."""
    xs = [x_from] + [x / 2 for x in range(int(max(x_from, 0) * 2), int(min(x_to, SIZE) * 2) + 1)] + [x_to]
    pts = ' '.join(f'L{f(x)},{f(ground(x) - OVER)}' for x in xs)
    return f'M{f(x_from)},{f(foot)} {pts} L{f(x_to)},{f(foot)} Z'


def sky_path(x_from=0, x_to=SIZE, top=0):
    """The red: from `top` down to the valley's line, never under the ground."""
    xs = [x_from] + [x / 2 for x in range(int(max(x_from, 0) * 2), int(min(x_to, SIZE) * 2) + 1)] + [x_to]
    pts = ' '.join(f'L{f(x)},{f(ground(x))}' for x in reversed(xs))
    return f'M{f(x_from)},{f(top)} L{f(x_to)},{f(top)} {pts} Z'


PATH = viaduct() + ' ' + ground_path()
# Adaptive and maskable icons: a launcher shows only the middle 72 of 108 (and masks that), so
# there the whole design is drawn in that middle at 2/3, its deck and arches running on to the
# 108 edges, which only some launchers' zoom ever shows.
INNER = 72 / SIZE
INSET = (SIZE - 72) / 2
LO, HI = -INSET / INNER, SIZE + INSET / INNER
WIDE = viaduct(LO, HI) + ' ' + ground_path(LO, HI, HI)
SKY = sky_path()
SKY_WIDE = sky_path(LO, HI, LO)
TILE = f'<path d="{SKY}" fill="{RED}"/>'
INNER_TILE = (f'<g transform="translate({f(INSET)} {f(INSET)}) scale({INNER:.4f})">'
              f'<path d="{SKY_WIDE}" fill="{RED}"/></g>')
# Rounded by one mask over the finished image: a clip on each shape would let the red show
# along the white's edge (the hairline seen in a draft).
ROUND_MASK = (f'<defs><mask id="r"><rect width="{SIZE}" height="{SIZE}" rx="24" fill="#fff"/></mask></defs>')


def mark(colour, inner=False):
    if inner:
        return (f'<g transform="translate({f(INSET)} {f(INSET)}) scale({INNER:.4f})">'
                f'<path d="{WIDE}" fill="{colour}"/></g>')
    return f'<path d="{PATH}" fill="{colour}"/>'


def rounded(body):
    return f'{ROUND_MASK}<g mask="url(#r)">{body}</g>'


def docs():
    os.makedirs(DOCS, exist_ok=True)
    files = {
        'icon': TILE + mark(WHITE),
        'maskable': INNER_TILE + mark(WHITE, inner=True),
        'adaptive-foreground': mark(WHITE, inner=True),
        'adaptive-background': INNER_TILE,
        'monochrome': mark('#000', inner=True),
        'favicon': rounded(TILE + mark(WHITE)),
    }
    for name, body in files.items():
        with open(os.path.join(DOCS, f'{name}.svg'), 'w') as fh:
            fh.write(SVG.format(v=SIZE, body=body))


# ── Android vector drawables ───────────────────────────────────────────────────────────────

def vector(body, size=SIZE, viewport=SIZE):
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<!-- Logo V15, generated by scripts/logo-sets.py; do not edit by hand. -->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            f'    android:width="{size}dp" android:height="{size}dp" '
            f'android:viewportWidth="{viewport}" android:viewportHeight="{viewport}">\n{body}</vector>\n')


def android_mark(colour, at=None, path=None):
    k, dx, dy = at or (INNER, INSET, INSET)
    path = path or WIDE
    return (f'    <group android:translateX="{dx:.2f}" android:translateY="{dy:.2f}" '
            f'android:scaleX="{k:.4f}" android:scaleY="{k:.4f}">\n'
            f'        <path android:pathData="{path}" android:fillColor="{colour}"/>\n'
            '    </group>\n')


def apply():
    icons = os.path.join(ROOT, 'public', 'icons')
    with open(os.path.join(icons, 'icon.svg'), 'w') as fh:
        fh.write(SVG.format(v=SIZE, body=rounded(TILE + mark(WHITE))))
    with open(os.path.join(icons, 'maskable.svg'), 'w') as fh:
        fh.write(SVG.format(v=SIZE, body=INNER_TILE + mark(WHITE, inner=True)))
    # The foreground and themed icon: the design in the middle 72, running on to the edges.
    with open(os.path.join(RES, 'ic_launcher_foreground.xml'), 'w') as fh:
        fh.write(vector(android_mark(WHITE)))
    with open(os.path.join(RES, 'ic_launcher_monochrome.xml'), 'w') as fh:
        fh.write(vector(android_mark(WHITE)))
    with open(os.path.join(RES, 'ic_launcher_background.xml'), 'w') as fh:
        # The red only above the ground, in the same middle 72 as the foreground.
        fh.write(vector(android_mark(RED, path=SKY_WIDE)))
    # Status bar, 24 dp: the viaduct and its ground, full width in 22 dp, centred on its box.
    top, bottom = DECK_TOP, SIZE
    k = 22 / SIZE
    at = (k, 1, 12 - (top + bottom) / 2 * k)
    with open(os.path.join(RES, 'ic_stat_rail.xml'), 'w') as fh:
        fh.write(vector(android_mark(WHITE, at, PATH), size=24, viewport=24))


if __name__ == '__main__':
    if '--apply' in sys.argv:
        apply()
        print('applied')
    else:
        docs()
        print('ok')
