import type { PlannedChain } from '../core/planner/plan';
import { changesOf } from '../core/trip';
import { useT } from '../store';
import { duration, hhmm, minutesBetween } from './format';
import { Icon } from './icons';

/** Departure → arrival as the headline, and duration · rides · changes · disruptions. The same on
 * the trip screen and a shared trip. */
export function TripFacts({ chain }: { chain: PlannedChain }) {
  const t = useT();
  const changes = changesOf(chain.connections);
  // Disruptions are on the rides they concern; their number is said at the top.
  const disruptions = chain.warnings.filter((w) => w.type === 'disruption').length;
  const trains = chain.connections.reduce(
    (n, c) => n + c.sections.filter((s) => s.mode !== 'walk').length,
    0,
  );
  return (
    <>
      <p className="hero-times">
        <span>{hhmm(chain.dep)}</span>
        <Icon name="next" size={28} />
        <span>{hhmm(chain.arr)}</span>
      </p>
      <p className="facts">
        {duration(minutesBetween(chain.dep, chain.arr))} ·{' '}
        {trains === 1 ? t('train1') : t('trainsN', { n: trains })}
        {changes > 0 && ` · ${changes === 1 ? t('transfer1') : t('transfers', { n: changes })}`}
        {disruptions > 0 && (
          <>
            {' · '}
            <span className="red-text">
              {disruptions === 1 ? t('disruption1') : t('disruptionsN', { n: disruptions })}
            </span>
          </>
        )}
      </p>
    </>
  );
}
