import type { CSSProperties } from "react";

/**
 * Site color themes. Every color in the UI comes from these tokens: the stylesheet reads
 * them as CSS variables (--t-*), so switching themes needs no other change.
 * Select a preset with SITE_THEME; the default is "poster".
 */
export interface Theme {
  /** Page and hero background. */
  bg: string;
  /** Headline color on the background. */
  display: string;
  /** Hard offset shadow under headlines and buttons. */
  shadow: string;
  /** Body text and labels on the background. */
  onBg: string;
  /** Content sheets. */
  surface: string;
  /** Text on sheets. */
  ink: string;
  /** Secondary text on sheets. */
  muted: string;
  /** Rules and table lines on sheets. */
  line: string;
  /** Primary button fill and its text. */
  action: string;
  actionText: string;
  /** Links and panel title bars on sheets. */
  link: string;
  /** Tinted note background (Labor Pledge notes). */
  soft: string;
  danger: string;
  warn: string;
  ok: string;
}

export const THEMES = {
  /** Deep blue, signal red, gold: 1990s storefront poster. */
  poster: {
    bg: "#003f63",
    display: "#ff3333",
    shadow: "#ffb400",
    onBg: "#dcdcdc",
    surface: "#ffffff",
    ink: "#000000",
    muted: "#4a4a4a",
    line: "#c8c8c8",
    action: "#c8102e",
    actionText: "#ffffff",
    link: "#003f63",
    soft: "#fff1c2",
    danger: "#b00020",
    warn: "#7a5600",
    ok: "#1f7a3f",
  },
  /** Teal, school-bus yellow, hot pink: 1990s sportswear. */
  teal: {
    bg: "#005f61",
    display: "#ffe600",
    shadow: "#ff2e88",
    onBg: "#f2f2f2",
    surface: "#ffffff",
    ink: "#000000",
    muted: "#4a4a4a",
    line: "#c8c8c8",
    action: "#a3004f",
    actionText: "#ffffff",
    link: "#005f61",
    soft: "#fff9c4",
    danger: "#b00020",
    warn: "#7a5600",
    ok: "#1f7a3f",
  },
  /** Grape, lime, tangerine: 1990s arcade. */
  arcade: {
    bg: "#3b0a57",
    display: "#b6ff00",
    shadow: "#ff7a00",
    onBg: "#efe6f5",
    surface: "#ffffff",
    ink: "#000000",
    muted: "#4a4a4a",
    line: "#c8c8c8",
    action: "#6a1b9a",
    actionText: "#ffffff",
    link: "#5a1580",
    soft: "#f4ffd6",
    danger: "#b00020",
    warn: "#7a5600",
    ok: "#1f7a3f",
  },
} satisfies Record<string, Theme>;

export type ThemeName = keyof typeof THEMES;

export function activeTheme(env: Record<string, string | undefined> = process.env): Theme {
  const name = env.SITE_THEME as ThemeName | undefined;
  return (name && THEMES[name]) || THEMES.poster;
}

const cssName = (key: string) => `--t-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** CSS variables for the theme, applied on <html>. */
export function themeStyle(theme: Theme): CSSProperties {
  return Object.fromEntries(Object.entries(theme).map(([k, v]) => [cssName(k), v])) as CSSProperties;
}

/** WCAG contrast ratio between two hex colors. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
