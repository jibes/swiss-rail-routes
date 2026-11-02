/**
 * The app's one loading sign: a train (a dot) running along a stretch of line between two
 * stations. `label` is said to screen readers; `small` fits inside a control.
 */
export function RailLoader({ label, small }: { label?: string; small?: boolean }) {
  return (
    <span
      className={`rail-loader ${small ? 'small' : ''}`}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="track" />
      <span className="train" />
    </span>
  );
}
