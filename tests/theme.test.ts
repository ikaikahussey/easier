import { describe, expect, it } from "vitest";
import { activeTheme, contrast, THEMES, themeStyle } from "@/ui/theme";

describe("themes", () => {
  for (const [name, t] of Object.entries(THEMES)) {
    it(`${name} meets contrast minimums`, () => {
      expect(contrast(t.display, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.onBg, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.ink, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.actionText, t.action)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.link, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.ink, t.soft)).toBeGreaterThanOrEqual(4.5);
      for (const c of [t.danger, t.warn, t.ok]) expect(contrast(c, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.danger, t.soft)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("selects by SITE_THEME and falls back to poster", () => {
    expect(activeTheme({ SITE_THEME: "teal" })).toBe(THEMES.teal);
    expect(activeTheme({ SITE_THEME: "nope" })).toBe(THEMES.poster);
    expect(activeTheme({})).toBe(THEMES.poster);
  });

  it("emits every token as a CSS variable", () => {
    const style = themeStyle(THEMES.poster) as Record<string, string>;
    expect(style["--t-action-text"]).toBe(THEMES.poster.actionText);
    expect(Object.keys(style)).toHaveLength(Object.keys(THEMES.poster).length);
  });
});
