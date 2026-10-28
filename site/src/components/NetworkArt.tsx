import { m, useReducedMotion } from "motion/react";
import { EASE_OUT } from "../motion";

const AMBER = "#f5a524";
const GREEN = "#3ddc84";

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

function PC({ x }: { x: number }) {
  return (
    <>
      <rect x={x - 26} y={300} width={52} height={36} rx={3} fill="url(#bronze)" stroke="var(--rim)" />
      <rect x={x - 21} y={304} width={42} height={26} rx={1.5} fill="#0b0d12" />
      <rect x={x - 21} y={304} width={42} height={8} rx={1.5} fill="url(#screen-glow)" />
      <rect x={x - 6} y={336} width={12} height={7} fill="url(#bronze)" />
      <rect x={x - 16} y={343} width={32} height={4} rx={2} fill="url(#bronze)" stroke="var(--rim)" />
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
    <svg className="network-art" viewBox="0 0 420 420" role="img" aria-label={label}>
      <defs>
        <linearGradient id="bronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6c9a1" />
          <stop offset="0.32" stopColor="#ab7f55" />
          <stop offset="0.68" stopColor="#5c3f27" />
          <stop offset="1" stopColor="#21160d" />
        </linearGradient>
        <linearGradient id="bronze-top" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#f1dcbc" />
          <stop offset="1" stopColor="#9a6f48" />
        </linearGradient>
        <linearGradient id="screen-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c97ff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7c97ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Links: draw, then their LEDs light amber and settle on green, like a port coming up in PT. */}
      {LINKS.map((link, i) => {
        const delay = LINK_START + i * LINK_STAGGER;
        return (
          <g key={link.d}>
            <m.path
              d={link.d}
              fill="none"
              stroke="var(--cable)"
              strokeWidth={1.5}
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
                r={3}
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

      {/* R1: a Cisco-style router puck. */}
      <m.g className="node" {...node(0)}>
        <path d="M170 95 v26 a40 13 0 0 0 80 0 v-26" fill="url(#bronze)" stroke="var(--rim)" />
        <ellipse cx={210} cy={95} rx={40} ry={13} fill="url(#bronze-top)" stroke="var(--rim)" />
        <path d="M198 91 l24 8 M222 91 l-24 8" stroke="#3a2716" strokeWidth={2} strokeLinecap="round" />
        <text x={262} y={112} className="node-label">
          R1 · 2911
        </text>
      </m.g>

      {/* S1: a switch box. */}
      <m.g className="node" {...node(1)}>
        <path d="M160 200 l10 -10 h100 l-10 10 z" fill="url(#bronze-top)" stroke="var(--rim)" />
        <rect x={160} y={200} width={100} height={30} rx={2} fill="url(#bronze)" stroke="var(--rim)" />
        <path d="M188 194 h44 M196 197 h44" stroke="#3a2716" strokeWidth={1.6} strokeLinecap="round" />
        <text x={272} y={219} className="node-label">
          S1 · 2960-24TT
        </text>
      </m.g>

      {PCS.map((pc, i) => (
        <m.g key={pc.label} className="node" {...node(2 + i)}>
          <PC x={pc.x} />
          <text x={pc.x} y={364} textAnchor="middle" className="node-label">
            {pc.label}
          </text>
        </m.g>
      ))}
    </svg>
  );
}
