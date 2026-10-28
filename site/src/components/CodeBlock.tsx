import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

const TOKEN = /("(?:\\.|[^"\\])*")|(\/\*[\s\S]*?\*\/)|\b(addDevice|addLink|configureIosDevice|configurePcIp|claude|codex|gemini|npx)\b/g;

/** Minimal highlighting: strings, comments and the PTBuilder / CLI function names. */
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const cls = m[1] ? "tok-str" : m[2] ? "tok-com" : "tok-fn";
    out.push(
      <span key={m.index} className={cls}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code, label, copyLabel, caption }: { code: string; label: string; copyLabel: string; caption?: string }) {
  return (
    <figure className="code">
      <div className="code-bar">
        <figcaption className="code-label">{label}</figcaption>
        <CopyButton text={code} label={copyLabel} />
      </div>
      {/* Long lines scroll inside the block, never the page; focusable so keyboards can scroll it. */}
      <pre className="code-pre" tabIndex={0} aria-label={label}>
        <code>{highlight(code)}</code>
      </pre>
      {caption && <p className="code-caption">{caption}</p>}
    </figure>
  );
}
