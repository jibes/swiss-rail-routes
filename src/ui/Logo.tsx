/** The app's mark, V13 (scripts/logo-sets.py draws the icons; this is the same shape inline). */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#d40000" />
      <g transform="translate(50 52) scale(0.78) translate(-50 -52)">
        <path
          fill="#fff"
          fillRule="evenodd"
          d="M39 10h22a15 15 0 0 1 15 15v38a15 15 0 0 1-15 15H39a15 15 0 0 1-15-15V25a15 15 0 0 1 15-15zM37 19a6 6 0 0 0-6 6v19a6 6 0 0 0 6 6h26a6 6 0 0 0 6-6V25a6 6 0 0 0-6-6zM35 59a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM65 59a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"
        />
        <path fill="#fff" d="M33 50 44 35l6 7 7-10 10 18z" />
        <path d="M36 82 26 94M64 82l10 12" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      </g>
    </svg>
  );
}
