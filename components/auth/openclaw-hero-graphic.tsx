import { cn } from "@/lib/utils";

type OpenclawHeroGraphicProps = {
  className?: string;
  pupilOffset: {
    x: number;
    y: number;
  };
};

export function OpenclawHeroGraphic({ className, pupilOffset }: OpenclawHeroGraphicProps) {
  return (
    <svg
      viewBox="0 0 1600 1200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      className={cn("h-full w-full", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="bg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <radialGradient
          id="glow-left"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(420 320) rotate(20) scale(520 360)"
        >
          <stop stopColor="#94a3b8" stopOpacity="0.22" />
          <stop offset="1" stopColor="#94a3b8" stopOpacity="0" />
        </radialGradient>
        <radialGradient
          id="glow-right"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(1220 860) rotate(-18) scale(520 360)"
        >
          <stop stopColor="#64748b" stopOpacity="0.18" />
          <stop offset="1" stopColor="#64748b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97373" />
          <stop offset="100%" stopColor="#7f1d1d" />
        </linearGradient>
      </defs>

      <rect width="1600" height="1200" fill="url(#bg-gradient)" />
      <ellipse cx="420" cy="320" rx="520" ry="360" fill="url(#glow-left)" />
      <ellipse cx="1220" cy="860" rx="520" ry="360" fill="url(#glow-right)" />

      <g transform="translate(542 364) scale(4.3)">
        <path
          d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
          fill="url(#lobster-gradient)"
        />
        <path
          d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
          fill="url(#lobster-gradient)"
        />
        <path
          d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
          fill="url(#lobster-gradient)"
        />
        <path d="M45 15 Q35 5 30 8" stroke="#ff4d4d" strokeWidth="3" strokeLinecap="round" />
        <path d="M75 15 Q85 5 90 8" stroke="#ff4d4d" strokeWidth="3" strokeLinecap="round" />
        <circle cx="45" cy="35" r="6" fill="#050810" />
        <circle cx="75" cy="35" r="6" fill="#050810" />
        <circle cx={46 + pupilOffset.x} cy={34 + pupilOffset.y} r="2.5" fill="#00e5cc" />
        <circle cx={76 + pupilOffset.x} cy={34 + pupilOffset.y} r="2.5" fill="#00e5cc" />
      </g>
    </svg>
  );
}
