export function InteractLogo({ className = "h-10 w-auto" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/interact-logo.svg" alt="Interact District 2482" className={className} width={1206} height={414} />;
}

export function ImpactLogo({ className = "w-32 h-auto" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/lasting-impact.png" alt="Create lasting impact" className={className} width={479} height={296} />;
}
