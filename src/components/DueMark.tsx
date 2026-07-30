import Svg, { Path } from 'react-native-svg';

/** Canonical whistle-d geometry from the Due brand kit. */
export const DUE_MARK_PATH =
  'M328.1,363.7L417.9,99.9A40.1,40.1 0 0 0 379.9,46.8L318.0,46.8A54.4,54.4 0 0 0 270.1,75.3L222.0,164.0A17.8,17.8 0 0 1 204.7,173.2A144.5,144.5 0 1 0 328.1,363.7Z M250.3,326.4A63.1,63.1 0 1 0 124.1,326.4A63.1,63.1 0 1 0 250.3,326.4Z M332.3,139.1L262.7,139.1A5.1,5.1 0 0 0 258.2,141.8L241.2,173.2A5.1,5.1 0 0 0 245.7,180.8L321.6,180.8A5.1,5.1 0 0 0 326.5,177.3L337.2,145.9A5.1,5.1 0 0 0 332.3,139.1Z';

export function DueMark({ size = 32, color = '#FFC93C' }: { size?: number; color?: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="40 40 385 430"
      accessibilityRole="image"
      accessibilityLabel="Due"
    >
      <Path fill={color} fillRule="evenodd" d={DUE_MARK_PATH} />
    </Svg>
  );
}
