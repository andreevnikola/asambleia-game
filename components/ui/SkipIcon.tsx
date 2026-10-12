/** "Skip ahead": a triangle and a bar, leaning at the −9° of the brand's display type. */
export function SkipIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <g transform="translate(12 12) skewX(-9) translate(-12 -12)">
        <path d="M5 5.2v13.6a.8.8 0 0 0 1.24.66l9.9-6.8a.8.8 0 0 0 0-1.32l-9.9-6.8A.8.8 0 0 0 5 5.2Z" />
        <rect x="17.2" y="4.5" width="2.8" height="15" rx="1" />
      </g>
    </svg>
  );
}
