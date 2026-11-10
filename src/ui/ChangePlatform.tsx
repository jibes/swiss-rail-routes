// Where the same train runs on under another number: "The train continues as S1" (0.43.0). The
// platforms that stood here ("Pl. 7 → 8", 0.17.3) are beside the station's names since 0.50.0
// (`StationPlatform`).
import { continuesAs } from '../core/changePlatform';
import type { LineRow } from '../core/rows';
import { useT } from '../store';

export function ChangePlatform({ rows, i }: { rows: LineRow[]; i: number }) {
  const t = useT();
  const on = continuesAs(rows, i);
  if (!on) return null;
  return (
    <span className="change-pl">
      {t(on.likely ? 'continuesAsLikely' : 'continuesAs', { line: on.line })}
    </span>
  );
}
