import type { RouteTemplate } from '../core/data';
import type { LatLon } from '../core/model';
import { TEMPLATES } from '../data';
import { useT } from '../store';

export { TEMPLATES };

const km = (a: LatLon, b: LatLon) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 76);

/** Runs a route the way that continues from `from`: reversed when its far end is nearer. */
export function directionFrom(
  tp: RouteTemplate,
  from: LatLon | undefined,
  stop: (ref: string) => LatLon | undefined,
): boolean {
  if (!from) return false;
  const a = stop(tp.chain[0]!.ref);
  const b = stop(tp.chain.at(-1)!.ref);
  return !!a && !!b && km(from, b) < km(from, a);
}

export function TemplatePicker({
  onPick,
  reversedFor,
}: {
  onPick: (t: RouteTemplate, reversed: boolean) => void;
  reversedFor: (t: RouteTemplate) => boolean;
}) {
  const t = useT();
  return (
    <section className="routes" id="routes" aria-labelledby="routes-label">
      <h2 id="routes-label" className="section-label">
        {t('addRoute')}
      </h2>
      <div className="route-chips">
        {TEMPLATES.map((tp) => {
          const rev = reversedFor(tp);
          const a = tp.chain[0]!;
          const b = tp.chain.at(-1)!;
          const [from, to] = rev ? [b, a] : [a, b];
          return (
            <button
              key={tp.id}
              type="button"
              className="route-chip"
              onClick={() => onPick(tp, rev)}
            >
              <strong>{tp.name}</strong>
              <span>
                {from.name} → {to.name}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
