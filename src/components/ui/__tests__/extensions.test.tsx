/**
 * Wave-2 primitive extensions — the axes all six migration field reports
 * demanded: dense Stat tiers (the app's readouts live at 10–14pt, below the
 * wave-1 floor), a numeral FACE axis (three legitimate voices exist), a colour
 * argument on `eyebrowText` (the component had one, the factory — the actual
 * migration target — did not), and the leading/trailing hairline factories for
 * column cells. Each test pins the property that unblocked real call sites.
 */
import { StyleSheet } from 'react-native';

import { statValueText } from '@/components/ui/Stat';
import { eyebrowText } from '@/components/ui/Eyebrow';
import { hairlineLeft, hairlineRight } from '@/components/ui/Divider';
import { THEMES, data, dataRegular, fontSizes } from '@/theme/tokens';

const C = THEMES.dark;

test('statValueText reaches the dense band the wave-1 ladder missed', () => {
  expect(statValueText(C, 'micro').fontSize).toBe(fontSizes.micro);
  expect(statValueText(C, 'labelSm').fontSize).toBe(fontSizes.labelSm);
  expect(statValueText(C, 'label').fontSize).toBe(fontSizes.label);
  expect(statValueText(C, 'labelLg').fontSize).toBe(fontSizes.labelLg);
});

test('the wave-1 aliases still resolve to the same rungs', () => {
  expect(statValueText(C, 'sm')).toEqual(statValueText(C, 'metadata'));
  expect(statValueText(C, 'md')).toEqual(statValueText(C, 'body'));
  expect(statValueText(C, 'lg')).toEqual(statValueText(C, 'sectionTitle'));
  expect(statValueText(C, 'xl')).toEqual(statValueText(C, 'sheetTitle'));
});

test('the face axis: data / dataRegular set the family, system leaves it to the caller', () => {
  expect(statValueText(C, 'md', 'data').fontFamily).toBe(data);
  expect(statValueText(C, 'md', 'dataRegular').fontFamily).toBe(dataRegular);
  const system = statValueText(C, 'md', 'system');
  expect(system.fontFamily).toBeUndefined();
  expect(system.fontWeight).toBeUndefined(); // weight stays a call-site decision
  expect(system.fontVariant).toEqual(['tabular-nums']); // the one shared decision
});

test('eyebrowText takes a colour without losing the fixed weight and tracking', () => {
  const tinted = eyebrowText(C, 'micro', C.qualText);
  expect(tinted.color).toBe(C.qualText);
  expect(tinted.fontWeight).toBe('700');
  expect(tinted.letterSpacing).toBe(0.5);
  expect(eyebrowText(C, 'micro').color).toBe(C.mute); // default untouched
});

test('hairlineLeft / hairlineRight are the cell-edge counterparts of top/bottom', () => {
  expect(hairlineLeft(C)).toEqual({ borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.line });
  expect(hairlineRight(C)).toEqual({ borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: C.line });
});
