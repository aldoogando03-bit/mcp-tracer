import { m, useReducedMotion } from "motion/react";
import { EASE_OUT } from "../motion";

const AMBER = "#f5a524";
const GREEN = "#12b76a";

type LinkDef = { d: string; leds: [number, number][] };

/** R1 → S1 → PC1..PC3, drawn in the same order PTBuilder cables them. */
const LINKS: LinkDef[] = [
  { d: "M210 136 L210 189", leds: [[210, 143], [210, 182]] },
  { d: "M190 231 C190 265 115 265 115 299", leds: [[190, 238], [115, 292]] },
  { d: "M210 231 L210 299", leds: [[210, 238], [210, 292]] },
  { d: "M230 231 C230 265 305 265 305 299", leds: [[230, 238], [305, 292]] },
];

const PCS = [
  { x: 115, label: "PC1" },
  { x: 210, label: "PC2" },
  { x: 305, label: "PC3" },
];

const NODE_START = 0.35;
const NODE_STAGGER = 0.12;
const LINK_START = 1.0;
const LINK_STAGGER = 0.14;
const LINK_DRAW = 0.55;

/** Flat drafting-style devices: ink outline, paper fill and a hard offset shadow. */
function PC({ x }: { x: number }) {
  return (
    <>
      <rect x={x - 23} y={303} width={52} height={34} rx={4} fill="var(--ink)" />
      <rect x={x - 26} y={299} width={52} height={34} rx={4} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2} />
      <rect x={x - 21} y={303} width={42} height={22} rx={2} fill="var(--ink)" />
      <path d={`M${x - 15} 309 l5 4 -5 4`} fill="none" stroke="var(--signal)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <rect x={x - 4} y={333} width={8} height={6} fill="var(--ink)" />
      <rect x={x - 15} y={339} width={30} height={4} rx={2} fill="var(--ink)" />
    </>
  );
}

export function NetworkArt({ label }: { label: string }) {
  const reduce = useReducedMotion();

  const node = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(10px) scale(0.95)" },
          animate: { opacity: 1, transform: "translateY(0px) scale(1)" },
          transition: { duration: 0.7, ease: EASE_OUT, delay: NODE_START + i * NODE_STAGGER },
        };

  return (
    <svg className="network-art" viewBox="0 0 420 400" role="img" aria-label={label}>
      {/* Links: draw, then their LEDs light amber and settle on green, like a port coming up in PT. */}
      {LINKS.map((link, i) => {
        const delay = LINK_START + i * LINK_STAGGER;
        return (
          <g key={link.d}>
            <m.path
              d={link.d}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
              strokeLinecap="round"
              initial={reduce ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: LINK_DRAW, ease: EASE_OUT, delay }}
            />
            {link.leds.map(([cx, cy]) => (
              <m.circle
                key={`${cx}-${cy}`}
                cx={cx}
                cy={cy}
                r={3.5}
                stroke="var(--paper)"
                strokeWidth={1.5}
                initial={reduce ? false : { opacity: 0, fill: AMBER }}
                animate={{ opacity: 1, fill: GREEN }}
                style={reduce ? { fill: GREEN } : undefined}
                transition={{
                  opacity: { duration: 0.2, delay: delay + LINK_DRAW * 0.7 },
                  fill: { duration: 0.35, ease: "easeOut", delay: delay + LINK_DRAW + 0.45 },
                }}
              />
            ))}
          </g>
        );
      })}

      {/* R1: a router. */}
      <m.g className="node" {...node(0)}>
        <rect x={174} y={96} width={80} height={44} rx={8} fill="var(--ink)" />
        <rect x={170} y={92} width={80} height={44} rx={8} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2} />
        <circle cx={210} cy={114} r={13} fill="none" stroke="var(--ink)" strokeWidth={2} />
        <path
          d="M203 107 l14 14 M217 107 l-14 14"
          fill="none"
          stroke="var(--signal)"
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <text x={262} y={118} className="node-label">
          R1 · 2911
        </text>
      </m.g>

      {/* S1: a switch with a row of ports. */}
      <m.g className="node" {...node(1)}>
        <rect x={164} y={193} width={100} height={42} rx={6} fill="var(--ink)" />
        <rect x={160} y={189} width={100} height={42} rx={6} fill="var(--paper)" stroke="var(--ink)" strokeWidth={2} />
        <circle cx={171} cy={199} r={2.2} fill={GREEN} />
        <circle cx={179} cy={199} r={2.2} fill={GREEN} />
        <circle cx={187} cy={199} r={2.2} fill={AMBER} />
        {Array.from({ length: 8 }, (_, i) => (
          <rect key={i} x={168 + i * 11.5} y={210} width={8} height={10} rx={1} fill="var(--ink)" />
        ))}
        <text x={272} y={214} className="node-label">
          S1 · 2960-24TT
        </text>
      </m.g>

      {PCS.map((pc, i) => (
        <m.g key={pc.label} className="node" {...node(2 + i)}>
          <PC x={pc.x} />
          <text x={pc.x} y={366} textAnchor="middle" className="node-label">
            {pc.label}
          </text>
        </m.g>
      ))}
    </svg>
  );
}
