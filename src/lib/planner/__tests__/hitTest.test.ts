import {
  dayAtX,
  dayAtPoint,
  type XRange,
} from '../hitTest';

const ranges: XRange[] = [
  { x0: 0, x1: 50 },
  { x0: 50, x1: 100 },
  { x0: 100, x1: 150 },
];

test('dayAtX maps an x into its slot; half-open ranges avoid double-hits', () => {
  expect(dayAtX(10, ranges)).toBe(0);
  expect(dayAtX(50, ranges)).toBe(1); // boundary belongs to the next slot
  expect(dayAtX(149, ranges)).toBe(2);
});

test('dayAtX returns null outside every range', () => {
  expect(dayAtX(-5, ranges)).toBeNull();
  expect(dayAtX(150, ranges)).toBeNull();
});

test('dayAtPoint gates on the strip band', () => {
  expect(dayAtPoint(75, 20, ranges, 10, 40)).toBe(1); // inside band → hit
  expect(dayAtPoint(75, 5, ranges, 10, 40)).toBeNull(); // above band
  expect(dayAtPoint(75, 60, ranges, 10, 40)).toBeNull(); // below band (tray zone)
});
