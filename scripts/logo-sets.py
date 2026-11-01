# Generates logo concept sets D–H into docs/design/logos/<key>/ (108-unit Android grid,
# motif inside the 66-unit safe zone). Each motif is drawn from (fg, accent, bg) so the
# same drawing gives the icon, the adaptive foreground and the monochrome (themed) icon.
import os

RED, WHITE, INK, PAPER = '#D40000', '#FFFFFF', '#121314', '#F7F7F5'
OUT = os.path.join(os.path.dirname(__file__), '..', 'docs', 'design', 'logos')
SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">{}</svg>\n'


def spiral(fg, accent, bg, mono=False):
    # Kehrtunnel: the line turns a full loop and passes under itself to gain height (Albula, Brusio).
    entry = 'M22 80 C40 80 54 76 62 66'
    loop = 'M62 66 C72 54 72 34 56 32 C40 30 34 48 44 60 C50 68 60 74 72 70'
    exit_ = 'M72 70 C80 67 84 60 86 52'
    over = 'M44 60 C50 68 60 74 72 70'
    s = f'stroke="{fg}" stroke-width="6" stroke-linecap="round" fill="none"'
    if mono:
        cut = ('<defs><mask id="m"><rect width="108" height="108" fill="#fff"/>'
               f'<path d="{over}" stroke="#000" stroke-width="14" fill="none"/></mask></defs>')
        return (cut + f'<path d="{entry}" {s} mask="url(#m)"/><path d="{loop}" {s}/><path d="{exit_}" {s}/>'
                f'<circle cx="22" cy="80" r="7" fill="{fg}"/><circle cx="86" cy="52" r="7" fill="{fg}"/>')
    return (f'<path d="{entry}" {s}/><path d="{loop}" {s}/>'
            f'<path d="{over}" stroke="{bg}" stroke-width="14" fill="none"/>'
            f'<path d="{over}" {s}/><path d="{exit_}" {s}/>'
            f'<circle cx="22" cy="80" r="7" fill="{fg}"/><circle cx="86" cy="52" r="7" fill="{fg}"/>')


def summit(fg, accent, bg, mono=False):
    # Gipfel: the route itself is the mountain; you get off at the top.
    return (f'<path d="M24 78 L42 52 L51 62 L64 36 L84 70" stroke="{fg}" stroke-width="6" '
            'stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
            f'<circle cx="24" cy="78" r="7" fill="{fg}"/><circle cx="84" cy="70" r="7" fill="{fg}"/>'
            f'<circle cx="64" cy="36" r="8.5" fill="{accent if not mono else fg}" stroke="{fg}" stroke-width="4"/>')


def viaduct(fg, accent, bg, mono=False):
    # Viadukt: tall arches on slender piers, the line (red) running across the top (Landwasser).
    arches = ''.join(f'M{x} 84 V56.5 A5.5 5.5 0 0 1 {x + 11} 56.5 V84 Z' for x in (26, 41, 56, 71))
    rail = f'<path d="M18 38 H90" stroke="{accent if not mono else fg}" stroke-width="5" stroke-linecap="round"/>'
    return (f'<path fill-rule="evenodd" fill="{fg}" d="M22 44 H86 V84 H22 Z {arches}"/>' + rail)


def dayarc(fg, accent, bg, mono=False):
    # Tagesbogen: the day as an arc from morning to evening, the sun on it, the rail below.
    return (f'<path d="M26 70 A28 28 0 0 1 82 70" stroke="{fg}" stroke-width="5" stroke-linecap="round" fill="none"/>'
            f'<path d="M22 82 H86" stroke="{fg}" stroke-width="5" stroke-linecap="round"/>'
            f'<circle cx="26" cy="70" r="6" fill="{fg}"/><circle cx="82" cy="70" r="6" fill="{fg}"/>'
            f'<circle cx="68" cy="45.8" r="10" fill="{accent if not mono else fg}"/>')


def vanish(fg, accent, bg, mono=False):
    # Fluchtpunkt: a track runs into the distance and becomes the peak it leads to.
    def x_at(y):  # half-width of the track at height y (rails meet at y=28)
        return (y - 28) * 26 / 56
    ties = ''.join(
        f'<path d="M{54 - x_at(y) - o:.1f} {y} H{54 + x_at(y) + o:.1f}" stroke="{fg}" stroke-width="{t}" stroke-linecap="round"/>'
        for y, o, t in ((78, 6, 5), (64, 4.2, 4), (53.5, 3, 3.2), (46, 2.2, 2.6), (40.5, 1.6, 2.1)))
    return (f'<path d="M28 84 L54 28 L80 84" stroke="{fg}" stroke-width="5" stroke-linejoin="round" '
            'stroke-linecap="round" fill="none"/>' + ties)


SETS = [
    # key, motif, background, foreground, accent, favicon motif (simplified)
    ('d-spiral', spiral, RED, WHITE, WHITE, None),
    ('e-summit', summit, RED, WHITE, RED, None),
    ('f-viaduct', viaduct, INK, WHITE, RED, None),
    ('g-dayarc', dayarc, PAPER, INK, RED, None),
    ('h-vanish', vanish, RED, WHITE, RED, None),
]


def scaled(body, k=1.25):
    # Favicons: the motif larger (no safe zone in a browser tab), strokes a bit heavier.
    return f'<g transform="translate(54 54) scale({k}) translate(-54 -54)">{body}</g>'


for key, motif, bg, fg, accent, _ in SETS:
    d = os.path.join(OUT, key)
    os.makedirs(d, exist_ok=True)
    rect = f'<rect width="108" height="108" fill="{bg}"/>'
    files = {
        'icon': rect + motif(fg, accent, bg),
        'maskable': rect + motif(fg, accent, bg),
        'adaptive-foreground': motif(fg, accent, bg),
        'adaptive-background': rect,
        'monochrome': motif('#000000', '#000000', 'none', mono=True),
        'favicon': f'<rect width="108" height="108" rx="24" fill="{bg}"/>'
        + scaled(motif(fg, accent, bg).replace('stroke-width="5"', 'stroke-width="7"').replace('stroke-width="6"', 'stroke-width="8"')),
    }
    for name, body in files.items():
        with open(os.path.join(d, f'{name}.svg'), 'w') as f:
            f.write(SVG.format(body))
print('ok')
