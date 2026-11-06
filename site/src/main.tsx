import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LangProvider } from "./i18n";
// Self-hosted fonts: no third-party requests, and the page never depends on fonts.googleapis.com being reachable.
// Latin subsets cover English and Spanish (ñ, accents, «», curly quotes). Bricolage's CSS uses unicode-range instead.
import "@fontsource-variable/bricolage-grotesque/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>
);
