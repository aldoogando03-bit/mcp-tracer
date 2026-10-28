import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { GridLines, Nav, SectionRail } from "./components/Chrome";
import { Hero } from "./components/Hero";
import { Example, Footer, HowItWorks, Install, Tips } from "./components/Sections";
import { useLang } from "./i18n";
import { useActiveSection } from "./useActiveSection";

export function App() {
  const { t } = useLang();
  const active = useActiveSection();
  return (
    // LazyMotion + `m` components keep the animation bundle small; "user" follows the OS reduced-motion setting.
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <a className="skip-link" href="#main">
          {t.ui.skip}
        </a>
        <GridLines />
        <Nav active={active} />
        <SectionRail active={active} />
        <main id="main" tabIndex={-1}>
          <Hero />
          <HowItWorks />
          <Install />
          <Example />
          <Tips />
        </main>
        <Footer />
      </MotionConfig>
    </LazyMotion>
  );
}
