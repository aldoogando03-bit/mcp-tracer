import { m, useReducedMotion } from "motion/react";
import { COMMAND, LINKS } from "../content";
import { useLang } from "../i18n";
import { EASE_OUT } from "../motion";
import { CopyButton } from "./CopyButton";
import { ArrowUpRight } from "./icons";
import { NetworkArt } from "./NetworkArt";
import { Prose } from "./Prose";

export function Hero() {
  const { t } = useLang();
  const reduce = useReducedMotion();

  const enter = (i: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 } }
      : {
          initial: { opacity: 0, transform: "translateY(18px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.8, ease: EASE_OUT, delay: 0.1 + i * 0.08 },
        };

  return (
    <section id="home" className="hero" aria-labelledby="hero-title">
      <div className="container hero-grid">
        <div className="hero-copy">
          <m.p className="tag" {...enter(0)}>
            <span className="led" aria-hidden="true" />
            {t.hero.eyebrow}
          </m.p>

          <h1 id="hero-title" className="hero-title">
            {t.hero.title.map((line, i) => (
              <m.span key={`${line}-${i}`} className="hero-line" {...enter(1 + i)}>
                {line}
              </m.span>
            ))}
          </h1>

          <m.p className="hero-lede" {...enter(4)}>
            <Prose text={t.hero.lede} />
          </m.p>

          <m.div className="hero-cta" {...enter(5)}>
            <div className="cmd">
              <span className="cmd-prompt" aria-hidden="true">
                $
              </span>
              <code className="cmd-text">{COMMAND}</code>
              <CopyButton text={COMMAND} label={t.ui.copyCommand} />
            </div>
            <div className="hero-links">
              <a className="btn btn--solid press" href={LINKS.github} target="_blank" rel="noreferrer">
                {t.hero.github} <ArrowUpRight />
                <span className="sr-only"> {t.ui.newTab}</span>
              </a>
              <a className="btn press" href={LINKS.npm} target="_blank" rel="noreferrer">
                {t.hero.npm} <ArrowUpRight />
                <span className="sr-only"> {t.ui.newTab}</span>
              </a>
            </div>
          </m.div>

          <m.ul className="hero-meta" {...enter(6)}>
            {t.hero.meta.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </m.ul>
        </div>

        <m.div
          className="hero-art"
          initial={reduce ? false : { opacity: 0, transform: "translateY(24px)" }}
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.2 }}
        >
          <div className="window">
            <div className="window-bar" aria-hidden="true">
              <span className="window-dots">
                <i />
                <i />
                <i />
              </span>
              <span className="window-title">topology.json</span>
            </div>
            <div className="window-canvas">
              <NetworkArt label={t.hero.artLabel} />
            </div>
            <div className="window-status" aria-hidden="true">
              <span className="led led--green" />
              validate_config · ok
            </div>
          </div>
        </m.div>
      </div>
    </section>
  );
}
