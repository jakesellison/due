import { THEMES, semantic, space, usesAccessibilityTextLayout } from '../tokens';

describe('THEMES', () => {
  test('dark and light expose the full token contract', () => {
    const keys = ['bg', 'card', 'panel', 'slate', 'fill', 'line', 'ink', 'mute', 'faint', 'yellow', 'accentInk', 'cyan', 'pink', 'elev', 'easy', 'paceSlow', 'paceFast', 'red', 'qual', 'yellowText', 'cyanText', 'qualText', 'easyText', 'positiveText', 'warningText', 'dangerText', 'brand', 'brandInk', 'brandText', 'brandMute', 'planWarm', 'planViolet', 'planBlue', 'planGreen', 'planRose', 'z1', 'z2', 'z3', 'z4', 'z5'] as const;
    for (const name of ['dark', 'light'] as const)
      for (const k of keys) expect(typeof THEMES[name][k]).toBe('string');
  });
  test('dark bg is near-black and light bg is a grouped canvas behind white cards', () => {
    expect(THEMES.dark.bg).toBe('#0F0F12');
    expect(THEMES.light.bg).toBe('#F3F3F5');
    expect(THEMES.light.card).toBe('#FFFFFF');
  });
  test('semantic roles map onto palette colours, never new hex', () => {
    const s = semantic(THEMES.dark);
    expect(s.pace).toBe(THEMES.dark.paceFast);
    expect(s.hr).toBe(THEMES.dark.red);
    expect(s.elevation).toBe(THEMES.dark.elev);
    expect(s.positive).toBe(THEMES.dark.positiveText);
  });
  test('small-text accent tokens meet WCAG AA on every standard surface', () => {
    const channel = (hex: string, offset: number) => {
      const raw = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const contrast = (a: string, b: string) => {
      const aLuminance = luminance(a);
      const bLuminance = luminance(b);
      const hi = Math.max(aLuminance, bLuminance);
      const lo = Math.min(aLuminance, bLuminance);
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const C of Object.values(THEMES)) {
      for (const foreground of [C.ink, C.mute, C.paceFast, C.yellowText, C.cyanText, C.qualText, C.easyText, C.positiveText, C.warningText, C.dangerText]) {
        for (const background of [C.bg, C.card, C.panel, C.slate]) {
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
      for (const background of [C.bg, C.card, C.panel, C.slate]) {
        expect(contrast(C.faint, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test('quality and long labels remain AA on their tinted plan rows', () => {
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const blend = (foreground: string, background: string, alpha: number) => {
      const fg = rgb(foreground);
      const bg = rgb(background);
      return `#${fg.map((channel, index) => Math.round(channel * alpha + bg[index]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
    };
    const channel = (value: number) => {
      const raw = value / 255;
      return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex);
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    const contrast = (a: string, b: string) => {
      const hi = Math.max(luminance(a), luminance(b));
      const lo = Math.min(luminance(a), luminance(b));
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const C of Object.values(THEMES)) {
      for (const ground of [C.bg, C.card]) {
        expect(contrast(C.qualText, blend(C.qual, ground, 0.06))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.cyanText, blend(C.cyan, ground, 0.055))).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test('plan-cover text remains AA over every deterministic palette after its stable scrim', () => {
    const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
    const blend = (foreground: string, background: string, alpha: number) => {
      const fg = rgb(foreground);
      const bg = rgb(background);
      return `#${fg.map((channel, index) => Math.round(channel * alpha + bg[index]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
    };
    const channel = (value: number) => {
      const raw = value / 255;
      return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) => {
      const [r, g, b] = rgb(hex);
      return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
    };
    const contrast = (a: string, b: string) => {
      const hi = Math.max(luminance(a), luminance(b));
      const lo = Math.min(luminance(a), luminance(b));
      return (hi + 0.05) / (lo + 0.05);
    };

    for (const C of Object.values(THEMES)) {
      for (const ground of [C.planWarm, C.planViolet, C.planBlue, C.planGreen, C.planRose]) {
        // Decorative white shapes can lift the ground by 8%; the stable brand
        // scrim is then the final layer under all hero copy.
        const highlighted = blend('#FFFFFF', ground, 0.08);
        const scrimmed = blend(C.brand, highlighted, 0.42);
        expect(contrast(C.brandMute, scrimmed)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(C.brandText, scrimmed)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  test('space scale is a 4pt grid', () => {
    expect(space.md).toBe(12);
  });
  test('Dynamic Type switches to structural reflow at the shared breakpoint', () => {
    expect(usesAccessibilityTextLayout(1.59)).toBe(false);
    expect(usesAccessibilityTextLayout(1.6)).toBe(true);
    expect(usesAccessibilityTextLayout(2.35)).toBe(true);
  });
});
