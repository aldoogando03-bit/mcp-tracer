/** Strong ease-out for entrances (Emil Kowalski's curve); never ease-in for UI. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Section ids, in page order. Drive the nav, the side rail and the scroll spy. */
export const SECTIONS = ["home", "how", "install", "example", "tips"] as const;
export type SectionId = (typeof SECTIONS)[number];
