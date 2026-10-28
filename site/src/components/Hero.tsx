import { m, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
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
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  // Subtle depth while the hero scrolls away: the art drifts up, away from the title, never onto it.
  const artShift = useTransform(scrollYProgress, [0, 1], ["translateY(0px)", "translateY(-60px)"]);

  const enter = (i: number) =>
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.3 } }
      : {
          initial: { opacity: 0, transform: "translateY(18px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.8, ease: EASE_OUT, delay: 0.15 + i * 0.08 },
        };

  return (
    <section id="home" ref={ref} className="hero" aria-labelledby="hero-title">
      <div className="container hero-grid">
        <m.p className="eyebrow hero-eyebrow" {...enter(0)}>
          {t.hero.eyebrow}
        </m.p>

        <m.div className="hero-art" style={reduce ? undefined : { transform: artShift }}>
          <m.div
            className="ring"
            aria-hidden="true"
            initial={reduce ? false : { opacity: 0, transform: "scale(0.94)" }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.1 }}
          />
          <NetworkArt label={t.hero.artLabel} />
        </m.div>

        <h1 id="hero-title" className="hero-title">
          {t.hero.title.map((line, i) => (
            <m.span key={`${line}-${i}`} className="hero-line" {...enter(1 + i)}>
              {line}
            </m.span>
          ))}
        </h1>

        <div className="hero-side">
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
              <a className="link-btn press" href={LINKS.github} target="_blank" rel="noreferrer">
                {t.hero.github} <ArrowUpRight />
                <span className="sr-only"> {t.ui.newTab}</span>
              </a>
              <a className="link-btn press" href={LINKS.npm} target="_blank" rel="noreferrer">
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
      </div>
    </section>
  );
}
