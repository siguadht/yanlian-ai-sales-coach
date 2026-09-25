import { useId, useRef, type CSSProperties, type PointerEvent } from "react";

type OrbState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "disconnected";
type OrbTone = "dark" | "light";

/** Original YANLI companion: an organic silhouette whose eyes carry gaze and voice state. */
export function AiCustomerAvatar({ state = "idle", featured = false, tone = "dark", followPointer = true, gaze }: { state?: OrbState; featured?: boolean; tone?: OrbTone; followPointer?: boolean; gaze?: { x: number; y: number } }) {
  const uid = useId().replaceAll(":", "");
  const bodyId = `bot-body-${uid}`;
  const shadowId = `bot-shadow-${uid}`;
  const root = useRef<HTMLSpanElement>(null);

  const followPointerEvent = (event: PointerEvent<HTMLSpanElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width - .5) * 2;
    const y = ((event.clientY - bounds.top) / bounds.height - .5) * 2;
    event.currentTarget.style.setProperty("--gaze-x", x.toFixed(3));
    event.currentTarget.style.setProperty("--gaze-y", y.toFixed(3));
  };
  const resetGaze = () => {
    root.current?.style.setProperty("--gaze-x", "0");
    root.current?.style.setProperty("--gaze-y", "0");
  };
  const gazeStyle = !followPointer ? {
    "--gaze-x": String(gaze?.x ?? 0),
    "--gaze-y": String(gaze?.y ?? 0),
  } as CSSProperties : undefined;

  return <span
    ref={root}
    style={gazeStyle}
    className={`ai-orb ai-orb-${state} ai-orb-tone-${tone} ${featured ? "ai-orb-featured" : ""}`}
    aria-hidden="true"
    onPointerMove={followPointer ? followPointerEvent : undefined}
    onPointerLeave={resetGaze}
  >
    <span className="ai-orb-halo halo-one" />
    <span className="ai-orb-halo halo-two" />
    <svg className="ai-customer-portrait" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={bodyId} x1="28" y1="22" x2="88" y2="103" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--orb-body-start)" />
          <stop offset=".52" stopColor="var(--orb-body-middle)" />
          <stop offset="1" stopColor="var(--orb-body-end)" />
        </linearGradient>
        <filter id={shadowId} x="-28" y="-22" width="176" height="176" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="13" stdDeviation="10" floodColor="var(--orb-shadow)" floodOpacity=".22" />
        </filter>
      </defs>

      <g className="orb-state-ring" strokeLinecap="round">
        <path d="M27 32c8-10 19-16 33-17" />
        <path d="M91 38c5 8 8 17 8 27" />
      </g>
      <g className="orb-head" filter={`url(#${shadowId})`}>
        <path d="M61 13c24 1 40 18 43 41 4 27-10 48-35 53-27 5-50-9-56-33C7 49 19 29 39 19c7-4 14-6 22-6Z" fill={`url(#${bodyId})`} />
        <path d="M33 27c13-9 31-11 45-3" stroke="white" strokeOpacity="var(--orb-highlight-opacity)" strokeWidth="4" strokeLinecap="round" />
        <g className="orb-gaze">
          <g className="orb-eyes" fill="var(--orb-eye)">
            <rect x="39" y="43" width="10" height="27" rx="5" transform="rotate(-12 44 56.5)" />
            <rect x="66" y="39" width="11" height="30" rx="5.5" transform="rotate(-12 71.5 54)" />
          </g>
        </g>
      </g>
    </svg>
  </span>;
}
