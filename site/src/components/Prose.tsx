import type { ReactNode } from "react";

/** tool_names become inline code; hyphenated names (mcp-tracer, 3560-24PS, PC-PT) never break at the hyphen. */
const TOKEN = /(\b[a-z]+(?:_[a-z]+)+\b)|([A-Za-z0-9.]+(?:-[A-Za-z0-9./]+)+)/g;

export function Prose({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      m[1] ? (
        <code key={m.index} className="inline-code">
          {m[0]}
        </code>
      ) : (
        <span key={m.index} className="nowrap">
          {m[0]}
        </span>
      )
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
