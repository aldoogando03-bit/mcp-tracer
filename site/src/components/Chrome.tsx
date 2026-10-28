import { LINKS } from "../content";
import { useLang } from "../i18n";
import { SECTIONS, type SectionId } from "../motion";
import { ArrowUpRight } from "./icons";

/** The fixed vertical hairlines of the reference layout; they share the 5-column grid of every section. */
export function GridLines() {
  return (
    <div className="gridlines" aria-hidden="true">
      <div className="container gridlines-inner">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
    </div>
  );
}

export function Nav({ active }: { active: SectionId }) {
  const { t, lang, setLang } = useLang();
  const links = SECTIONS.filter((s) => s !== "home");

  return (
    <header className="nav">
      <div className="container nav-grid">
        <a className="logo" href="#home">
          mcp-tracer
        </a>
        <nav className="nav-links" aria-label={t.ui.sections}>
          <ul>
            {links.map((id) => (
              <li key={id}>
                <a href={`#${id}`} aria-current={active === id ? "true" : undefined}>
                  {t.nav[id]}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="nav-end">
          <div className="lang" role="group" aria-label={t.ui.language}>
            {(["en", "es"] as const).map((l) => (
              <button key={l} type="button" className="press" aria-pressed={lang === l} onClick={() => setLang(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <a className="nav-gh press" href={LINKS.github} target="_blank" rel="noreferrer">
            GitHub <ArrowUpRight size={14} />
            <span className="sr-only"> {t.ui.newTab}</span>
          </a>
        </div>
      </div>
    </header>
  );
}

/** Left-edge section indicator: dots, with a blue bar on the current section. */
export function SectionRail({ active }: { active: SectionId }) {
  const { t } = useLang();
  return (
    <nav className="rail" aria-label={t.ui.sections}>
      <ol>
        {SECTIONS.map((id) => (
          <li key={id}>
            <a href={`#${id}`} className="rail-item" aria-current={active === id ? "true" : undefined}>
              <span className="rail-mark" aria-hidden="true" />
              <span className="sr-only">{t.nav[id]}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
