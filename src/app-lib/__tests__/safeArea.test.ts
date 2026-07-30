import { resolveModalSafeInsets } from '../safeArea';

test('keeps launch insets while a native modal reports a zero first frame', () => {
  expect(
    resolveModalSafeInsets(
      { top: 0, right: 0, bottom: 0, left: 0 },
      { top: 62, right: 0, bottom: 34, left: 0 },
    ),
  ).toEqual({ top: 62, right: 0, bottom: 34, left: 0 });
});

test('prefers newer live insets when they are larger', () => {
  expect(
    resolveModalSafeInsets(
      { top: 64, right: 1, bottom: 35, left: 1 },
      { top: 62, right: 0, bottom: 34, left: 0 },
    ),
  ).toEqual({ top: 64, right: 1, bottom: 35, left: 1 });
});
