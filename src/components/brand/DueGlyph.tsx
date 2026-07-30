import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

export type DueGlyphName =
  | 'base'
  | 'build'
  | 'contract'
  | 'easy'
  | 'history'
  | 'intent'
  | 'long'
  | 'mileage'
  | 'peak'
  | 'quality'
  | 'recovery'
  | 'taper';

/**
 * DueGlyph is the app's small custom icon family. The drawings share a 24×24
 * grid, rounded 1.8pt strokes, and blunt geometric forms so workout and plan
 * structure no longer depend entirely on generic SF Symbols.
 */
export function DueGlyph({
  name,
  size = 18,
  color,
}: {
  name: DueGlyphName;
  size?: number;
  color: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Glyph name={name} color={color} />
    </Svg>
  );
}

function Glyph({ name, color }: { name: DueGlyphName; color: string }) {
  const stroke = {
    stroke: color,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'base':
      return (
        <>
          <Rect x={4} y={10} width={7} height={7} rx={1.5} {...stroke} />
          <Rect x={13} y={7} width={7} height={10} rx={1.5} {...stroke} />
          <Line x1={3.5} y1={19.5} x2={20.5} y2={19.5} {...stroke} />
        </>
      );
    case 'build':
      return (
        <>
          <Path d="M4 18h4v-4h4v-4h4V6h4" {...stroke} />
          <Circle cx={20} cy={6} r={1.45} fill={color} />
        </>
      );
    case 'peak':
      return (
        <>
          <Path d="M3.5 18.5 9.4 8.4l3.5 5.5 3.1-4.1 4.5 8.7" {...stroke} />
          <Circle cx={9.4} cy={8.4} r={1.35} fill={color} />
        </>
      );
    case 'taper':
      return (
        <>
          <Line x1={4} y1={18.5} x2={21} y2={18.5} {...stroke} />
          <Line x1={5} y1={6} x2={5} y2={16} {...stroke} />
          <Line x1={10} y1={9} x2={10} y2={16} {...stroke} />
          <Line x1={15} y1={12} x2={15} y2={16} {...stroke} />
          <Line x1={20} y1={15} x2={20} y2={16} {...stroke} />
        </>
      );
    case 'quality':
      return <Path d="M13.7 2.8 5.5 13h5.3l-.6 8.2L18.5 11h-5.4l.6-8.2Z" fill={color} />;
    case 'easy':
      return (
        <>
          <Path d="M4 13.8c2.8-3.9 5.3-3.9 8.1 0s5.2 3.9 7.9 0" {...stroke} />
          <Line x1={5} y1={18.5} x2={19} y2={18.5} {...stroke} />
        </>
      );
    case 'long':
      return (
        <>
          <Path d="M5 17.8c2.2-7 5.1-9.8 8.1-5.5 2.7 3.8 4.6 1.9 5.9-4.1" {...stroke} />
          <Circle cx={4.6} cy={18.2} r={1.7} fill={color} />
          <Circle cx={19.2} cy={7.8} r={1.7} fill={color} />
        </>
      );
    case 'mileage':
      return (
        <>
          <Line x1={4} y1={6.5} x2={18.5} y2={6.5} {...stroke} />
          <Line x1={4} y1={12} x2={15} y2={12} {...stroke} />
          <Line x1={4} y1={17.5} x2={11.5} y2={17.5} {...stroke} />
          <Circle cx={20} cy={6.5} r={1.35} fill={color} />
          <Circle cx={16.5} cy={12} r={1.35} fill={color} />
          <Circle cx={13} cy={17.5} r={1.35} fill={color} />
        </>
      );
    case 'recovery':
      return <Path d="M17.8 15.8A7.5 7.5 0 0 1 8.2 6.2a7.6 7.6 0 1 0 9.6 9.6Z" {...stroke} />;
    case 'history':
      return (
        <>
          <Path d="M6.1 8.2H2.8V4.9" {...stroke} />
          <Path d="M3.2 8a9 9 0 1 1 .8 9.2" {...stroke} />
          <Path d="M12 7.4v5.1l3.4 2" {...stroke} />
        </>
      );
    case 'intent':
      return (
        <>
          <Circle cx={12} cy={12} r={7.6} {...stroke} />
          <Path d="m12 7.3 3.7 4.7-3.7 4.7L8.3 12 12 7.3Z" {...stroke} />
          <Circle cx={12} cy={12} r={1.35} fill={color} />
        </>
      );
    case 'contract':
    default:
      return (
        <>
          <Path d="M4 6.5h16M4 12h11.5M4 17.5h7" {...stroke} />
          <Circle cx={18.8} cy={12} r={1.6} fill={color} />
          <Circle cx={14.3} cy={17.5} r={1.6} fill={color} />
        </>
      );
  }
}
