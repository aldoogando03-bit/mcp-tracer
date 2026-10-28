import { useRef, useState, type KeyboardEvent } from "react";
import { CLIENTS, EXAMPLE_SCRIPT, LINKS, type ClientId } from "../content";
import { useLang } from "../i18n";
import { CodeBlock } from "./CodeBlock";
import { ArrowUpRight } from "./icons";
import { Prose } from "./Prose";
import { Reveal } from "./Reveal";

function SectionHead({ index, title, intro, id }: { index: string; title: string; intro: string; id: string }) {
  return (
    <Reveal className="section-head">
      <span className="section-index" aria-hidden="true">
        {index}
      </span>
      <div className="section-heading">
        <h2 id={id} className="section-title">
          {title}
        </h2>
        <p className="section-intro">
          <Prose text={intro} />
        </p>
      </div>
    </Reveal>
  );
}

export function HowItWorks() {
  const { t } = useLang();
  return (
    <section id="how" className="section" aria-labelledby="how-title">
      <div className="container">
        <SectionHead id="how-title" index={t.how.index} title={t.how.title} intro={t.how.intro} />
        <ol className="steps">
          {t.how.steps.map((s, i) => (
            <li key={s.title}>
              <Reveal className="step" delay={i * 0.06}>
                <span className="step-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="step-title">{s.title}</h3>
                <p className="step-text">
                  <Prose text={s.text} />
                </p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ClientTabs() {
  const { t } = useLang();
  const [active, setActive] = useState<ClientId>(CLIENTS[0].id);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const client = CLIENTS.find((c) => c.id === active) ?? CLIENTS[0];

  // WAI-ARIA tabs: arrows move between tabs, Home/End jump to the ends.
  function onKeyDown(e: KeyboardEvent, i: number) {
    const last = CLIENTS.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(CLIENTS[next].id);
    tabs.current[next]?.focus();
  }

  return (
    <div className="tabs">
      <div className="tablist" role="tablist" aria-label={t.install.clientTitle}>
        {CLIENTS.map((c, i) => (
          <button
            key={c.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${c.id}`}
            className="tab"
            aria-selected={active === c.id}
            aria-controls={`panel-${c.id}`}
            tabIndex={active === c.id ? 0 : -1}
            onClick={() => setActive(c.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${client.id}`} aria-labelledby={`tab-${client.id}`} className="tabpanel" key={client.id}>
        <p className="tab-where">
          <Prose text={t.install.where[client.id]} />
        </p>
        <CodeBlock code={client.code} label={client.label} copyLabel={t.ui.copySnippet} />
      </div>
    </div>
  );
}

export function Install() {
  const { t } = useLang();
  return (
    <section id="install" className="section" aria-labelledby="install-title">
      <div className="container">
        <SectionHead id="install-title" index={t.install.index} title={t.install.title} intro={t.install.intro} />
        <div className="install-grid">
          <Reveal className="card install-pt">
            <span className="card-step">A</span>
            <h3 className="card-title">{t.install.ptTitle}</h3>
            <ol className="plain-steps">
              {t.install.ptSteps.map((s) => (
                <li key={s}>
                  <Prose text={s} />
                </li>
              ))}
            </ol>
            <a className="text-link" href={LINKS.ptbuilder} target="_blank" rel="noreferrer">
              {t.install.ptLink} <ArrowUpRight size={14} />
              <span className="sr-only"> {t.ui.newTab}</span>
            </a>
          </Reveal>

          <Reveal className="card install-client" delay={0.06}>
            <span className="card-step">B</span>
            <h3 className="card-title">{t.install.clientTitle}</h3>
            <p className="card-note">{t.install.clientNote}</p>
            <ClientTabs />
          </Reveal>

          <Reveal className="card install-ask" delay={0.12}>
            <span className="card-step">C</span>
            <h3 className="card-title">{t.install.askTitle}</h3>
            <p className="card-note">{t.install.askText}</p>
            <ul className="chips">
              {t.install.prompts.map((p) => (
                <li key={p}>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Example() {
  const { t } = useLang();
  return (
    <section id="example" className="section" aria-labelledby="example-title">
      <div className="container">
        <SectionHead id="example-title" index={t.example.index} title={t.example.title} intro={t.example.caption} />
        <div className="example-grid">
          <Reveal className="example-prompt">
            <p className="eyebrow">{t.example.you}</p>
            <blockquote className="quote">“{t.example.prompt}”</blockquote>
          </Reveal>
          <Reveal className="example-code" delay={0.08}>
            <p className="eyebrow">{t.example.agent}</p>
            <CodeBlock code={EXAMPLE_SCRIPT} label={t.example.codeLabel} copyLabel={t.ui.copyScript} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function Tips() {
  const { t } = useLang();
  return (
    <section id="tips" className="section" aria-labelledby="tips-title">
      <div className="container">
        <SectionHead id="tips-title" index={t.tips.index} title={t.tips.title} intro={t.tips.intro} />
        <ul className="tips">
          {t.tips.items.map((tip, i) => (
            <li key={tip.title}>
              <Reveal className="tip" delay={(i % 4) * 0.05}>
                <span className="tip-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="tip-title">{tip.title}</h3>
                <p className="tip-text">
                  <Prose text={tip.text} />
                </p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Footer() {
  const { t } = useLang();
  const links = [
    { href: LINKS.github, label: t.footer.links.github },
    { href: LINKS.npm, label: t.footer.links.npm },
    { href: LINKS.apiNotes, label: t.footer.links.api },
    { href: LINKS.verifyPort, label: t.footer.links.verify },
  ];
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <Reveal className="footer-title">
          <p className="display">
            {t.footer.title.map((line) => (
              <span key={line} className="hero-line">
                {line}
              </span>
            ))}
          </p>
        </Reveal>
        <ul className="footer-links">
          {links.map((l) => (
            <li key={l.href}>
              <a className="text-link" href={l.href} target="_blank" rel="noreferrer">
                {l.label} <ArrowUpRight size={14} />
                <span className="sr-only"> {t.ui.newTab}</span>
              </a>
            </li>
          ))}
        </ul>
        <p className="footer-disclaimer">{t.footer.disclaimer}</p>
        <p className="footer-credit">{t.footer.credit}</p>
      </div>
    </footer>
  );
}
