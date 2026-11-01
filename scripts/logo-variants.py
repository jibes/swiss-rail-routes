# Three variations each of the top three logo concepts (H Fluchtpunkt, A Die Linie,
# D Kehrtunnel), into docs/design/logos/variants/<key>/; same files and grid as logo-sets.py.
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from importlib import import_module

base = import_module('logo-sets')
RED, WHITE, INK, PAPER = base.RED, base.WHITE, base.INK, base.PAPER
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'design', 'logos', 'variants')


# ── H · Fluchtpunkt ──────────────────────────────────────────────────────────────────────────
def track(fg, ties_fg, sun=None, mono=False):
    def x_at(y):
        return (y - 28) * 26 / 56
    ties = ''.join(
        f'<path d="M{54 - x_at(y) - o:.1f} {y} H{54 + x_at(y) + o:.1f}" stroke="{ties_fg}" stroke-width="{t}" stroke-linecap="round"/>'
        for y, o, t in ((78, 6, 5), (64, 4.2, 4), (53.5, 3, 3.2), (46, 2.2, 2.6)))
    # Themed icons are one colour: a sun would merge with the track, so it is left out there.
    disc = f'<circle cx="54" cy="36" r="17" fill="{sun}"/>' if sun and not mono else ''
    rails = (f'<path d="M28 84 L54 28 L80 84" stroke="{fg}" stroke-width="5" stroke-linejoin="round" '
             'stroke-linecap="round" fill="none"/>')
    # A sun behind the peak: the rails cut a thin gap through it so the apex stays sharp.
    gap = '' if not sun or mono else (f'<path d="M28 84 L54 28 L80 84" stroke="{SUNGAP}" stroke-width="10" '
                                      'stroke-linejoin="round" fill="none"/>')
    return disc + gap + rails + ties


SUNGAP = PAPER


def h1(fg, accent, bg, mono=False):  # the original, red
    return track(fg, fg, mono=mono)


def h2(fg, accent, bg, mono=False):  # daylight: ink track on paper, the sun setting behind the peak
    global SUNGAP
    SUNGAP = bg
    return track(fg, fg, sun=accent, mono=mono)


def h3(fg, accent, bg, mono=False):  # night: white track on ink, red sun
    global SUNGAP
    SUNGAP = bg
    return track(fg, fg, sun=accent, mono=mono)


# ── A · Die Linie ────────────────────────────────────────────────────────────────────────────
def line_icon(fg, accent, path, ends, ring, sw=7, mono=False):
    (x1, y1), (x2, y2) = ends
    rx, ry = ring
    return (f'<path d="{path}" stroke="{fg}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
            f'<circle cx="{x1}" cy="{y1}" r="9.5" fill="{fg}"/><circle cx="{x2}" cy="{y2}" r="9.5" fill="{fg}"/>'
            f'<circle cx="{rx}" cy="{ry}" r="6.5" fill="{"none" if mono else accent}" stroke="{fg}" stroke-width="4.5"/>')


def a1(fg, accent, bg, mono=False):  # bolder, centred diagonal
    return line_icon(fg, accent, 'M28 76 L80 32', ((28, 76), (80, 32)), (54, 54), mono=mono)


def a2(fg, accent, bg, mono=False):  # the line as a curve: a route, not a chart
    return line_icon(fg, accent, 'M26 74 C44 74 44 54 54 54 C64 54 64 34 82 34',
                     ((26, 74), (82, 34)), (54, 54), mono=mono)


def a3(fg, accent, bg, mono=False):  # light tile, red line
    return line_icon(fg, accent, 'M26 74 C44 74 44 54 54 54 C64 54 64 34 82 34',
                     ((26, 74), (82, 34)), (54, 54), mono=mono)


# ── D · Kehrtunnel ───────────────────────────────────────────────────────────────────────────
def d1(fg, accent, bg, mono=False):  # the original loop, heavier
    return base.spiral(fg, accent, bg, mono).replace('stroke-width="6"', 'stroke-width="7"')


def helix(fg, accent, bg, end, mono=False):
    # Geometric: east along a straight, a full turn on a circle, out south under the straight.
    entry = 'M24 62 H70'
    turn = 'M70 62 A16 16 0 1 0 54 46'
    exit_ = 'M54 46 V84'
    s = f'stroke="{fg}" stroke-width="7" stroke-linecap="round" fill="none"'
    if mono:
        cut = ('<defs><mask id="m"><rect width="108" height="108" fill="#fff"/>'
               '<path d="M44 62 H64" stroke="#000" stroke-width="17"/></mask></defs>')
        return (cut + f'<path d="{exit_}" {s} mask="url(#m)"/><path d="{turn}" {s}/><path d="{entry}" {s}/>'
                f'<circle cx="24" cy="62" r="8" fill="{fg}"/><circle cx="54" cy="84" r="8" fill="{fg}"/>')
    return (f'<path d="{exit_}" {s}/><path d="{turn}" {s}/>'
            f'<path d="M44 62 H64" stroke="{bg}" stroke-width="17"/>'
            f'<path d="{entry}" {s}/>'
            f'<circle cx="24" cy="62" r="8" fill="{fg}"/><circle cx="54" cy="84" r="8" fill="{end}"/>')


def d2(fg, accent, bg, mono=False):  # geometric helix, red tile
    return helix(fg, accent, bg, fg, mono)


def d3(fg, accent, bg, mono=False):  # geometric helix, ink on paper, red destination
    return helix(fg, accent, bg, accent, mono)


SETS = [
    ('h1-fluchtpunkt', h1, RED, WHITE, RED),
    ('h2-fluchtpunkt-tag', h2, PAPER, INK, RED),
    ('h3-fluchtpunkt-nacht', h3, INK, WHITE, RED),
    ('a1-linie-kraeftig', a1, RED, WHITE, RED),
    ('a2-linie-bogen', a2, RED, WHITE, RED),
    ('a3-linie-hell', a3, PAPER, RED, PAPER),
    ('d1-kehrtunnel', d1, RED, WHITE, WHITE),
    ('d2-kehrtunnel-geometrisch', d2, RED, WHITE, WHITE),
    ('d3-kehrtunnel-hell', d3, PAPER, INK, RED),
]

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
        'favicon': f'<rect width="108" height="108" rx="24" fill="{bg}"/>' + base.scaled(body),
    }
    for name, svg in files.items():
        with open(os.path.join(d, f'{name}.svg'), 'w') as f:
            f.write(base.SVG.format(svg))
print('ok')
