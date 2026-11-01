# Round-trip logo concepts into docs/design/logos/<key>/ (Android's 108-unit grid, motif in
# the 66-unit safe zone). A loop of rail; the start, which is also the end, a big dot; solid dots
# where you get off, rings where you ride through. Each motif is drawn from (fg, accent, bg), so
# one drawing gives the icon, the adaptive foreground and the monochrome (themed) icon.
import math
import os

RED, WHITE, INK, PAPER = '#D40000', '#FFFFFF', '#121314', '#F7F7F5'
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'design', 'logos')
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{}</svg>\n'
SW = 6  # rail width


def at(cx, cy, r, deg):
    """Point on a circle, degrees clockwise from the top."""
    a = math.radians(deg)
    return round(cx + r * math.sin(a), 2), round(cy - r * math.cos(a), 2)


def start(fg, x, y):
    return f'<circle cx="{x}" cy="{y}" r="9.5" fill="{fg}"/>'


def off(fg, x, y):
    return f'<circle cx="{x}" cy="{y}" r="6" fill="{fg}"/>'


def through(fg, bg, x, y, mono):
    return f'<circle cx="{x}" cy="{y}" r="5" fill="{"none" if mono else bg}" stroke="{fg}" stroke-width="3.5"/>'


def rail(fg, d):
    return (f'<path d="{d}" stroke="{fg}" stroke-width="{SW}" stroke-linecap="round" '
            'stroke-linejoin="round" fill="none"/>')


def ring(fg, accent, bg, mono=False):
    # Rundfahrt: the plain loop, stops around it like a day's stations.
    c, r = (54, 54), 25
    s = f'<circle cx="54" cy="54" r="25" stroke="{fg}" stroke-width="{SW}" fill="none"/>'
    for d in (0, 70):
        s += off(fg, *at(*c, r, d))
    for d in (120, 250, 300):
        s += through(fg, bg, *at(*c, r, d), mono)
    return s + start(fg, *at(*c, r, 180))


def summit(fg, accent, bg, mono=False):
    # Gipfelrunde: the loop's top edge is the mountain you ride up to.
    d = 'M54 80 C34 80 26 68 28 58 L44 36 L52 44 L64 26 L82 56 C86 70 74 80 54 80 Z'
    s = rail(fg, d)
    s += off(fg, 64, 26) + through(fg, bg, 44, 36, mono) + through(fg, bg, 82, 56, mono)
    s += off(fg, 28, 58)
    return s + start(fg, 54, 80)


def metro(fg, accent, bg, mono=False):
    # Netzplan: the loop as a transit-map octagon, stations at its corners.
    pts = [at(54, 54, 27, 22.5 + 45 * k) for k in range(8)]
    d = 'M' + ' L'.join(f'{x} {y}' for x, y in pts) + ' Z'
    s = rail(fg, d)
    for k in (0, 2, 5):
        s += through(fg, bg, *pts[k], mono)
    for k in (1, 6):
        s += off(fg, *pts[k])
    return s + start(fg, *at(54, 54, 27 * math.cos(math.radians(22.5)), 180))


def lasso(fg, accent, bg, mono=False):
    # Lasso: out along one line, round a loop, back the same way, as most day trips go.
    c, r = (60, 46), 20
    jx, jy = at(*c, r, 225)
    s = rail(fg, f'M28 82 L{jx} {jy}')
    s += f'<circle cx="{c[0]}" cy="{c[1]}" r="{r}" stroke="{fg}" stroke-width="{SW}" fill="none"/>'
    for d in (0, 100):
        s += off(fg, *at(*c, r, d))
    for d in (50, 160, 300):
        s += through(fg, bg, *at(*c, r, d), mono)
    return s + through(fg, bg, 40, 70, mono) + start(fg, 28, 82)


def around(fg, accent, bg, mono=False):
    # Rund um den Berg: the loop goes round a peak (Rigi, Jungfrau), the peak in the accent.
    c, r = (54, 54), 27
    s = f'<path d="M40 64 L54 40 L68 64 Z" fill="{fg if mono else accent}" stroke="{fg if mono else accent}" stroke-width="4" stroke-linejoin="round"/>'
    s += f'<circle cx="54" cy="54" r="27" stroke="{fg}" stroke-width="{SW}" fill="none"/>'
    for d in (45, 300):
        s += off(fg, *at(*c, r, d))
    for d in (0, 110, 240):
        s += through(fg, bg, *at(*c, r, d), mono)
    return s + start(fg, *at(*c, r, 180))


SETS = [
    ('r1-ring', ring, RED, WHITE, WHITE),
    ('r2-gipfelrunde', summit, RED, WHITE, WHITE),
    ('r3-netzplan', metro, RED, WHITE, WHITE),
    ('r4-lasso', lasso, RED, WHITE, WHITE),
    ('r5-rund-um-den-berg', around, PAPER, INK, RED),
]


def scaled(body, k=1.2):
    # Favicons: no safe zone in a browser tab, so the motif fills more of it.
    return f'<g transform="translate(54 54) scale({k}) translate(-54 -54)">{body}</g>'


if __name__ == '__main__':
    for key, motif, bg, fg, accent in SETS:
        d = os.path.join(OUT, key)
        os.makedirs(d, exist_ok=True)
        rect = f'<rect width="108" height="108" fill="{bg}"/>'
        body = motif(fg, accent, bg)
        files = {
            'icon': rect + body,
            'maskable': rect + body,
            'adaptive-foreground': body,
            'adaptive-background': rect,
            'monochrome': motif('#000000', '#000000', '#ffffff', mono=True),
            'favicon': f'<rect width="108" height="108" rx="24" fill="{bg}"/>' + scaled(body),
        }
        for name, svg in files.items():
            with open(os.path.join(d, f'{name}.svg'), 'w') as f:
                f.write(SVG.format(svg))
    print('ok')
