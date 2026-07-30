import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';
import { useClock } from '@shopify/react-native-skia';

import {
  planCoverPalettePair,
  planCoverSeedValue,
  planCoverToneStrength,
  type PlanCoverMode,
  type PlanCoverTone,
} from '@/lib/plan/cover';
import { useTheme } from '@/theme/ThemeProvider';

interface PlanCoverFieldProps {
  seed: string;
  mode: PlanCoverMode;
  width: number;
  height: number;
  testID?: string;
  borderRadius?: number;
  animated?: boolean;
  tone?: PlanCoverTone;
}

type RGBA = readonly [number, number, number, number];

const SHADERS: Record<PlanCoverMode, string> = {
  contour: `
    uniform float2 resolution;
    uniform float seed;
    uniform float time;
    uniform float4 ground;
    uniform float4 accentA;
    uniform float4 accentB;

    float hash11(float p) {
      return fract(sin(p * 127.1 + seed * 0.019) * 43758.5453);
    }

    half4 main(float2 fragCoord) {
      float2 uv = fragCoord / resolution;
      float aspect = resolution.x / resolution.y;
      float2 focus = float2(
        0.28 + 0.22 * hash11(2.3),
        0.42 + 0.18 * hash11(6.7)
      );
      float phase = hash11(4.1) * 6.2831853;
      float x = uv.x * aspect;
      float field = uv.y
        + 0.16 * sin((x - focus.x * aspect) * 2.35 + phase)
        + 0.052 * sin((x + uv.y) * 6.2 - phase)
        + 0.028 * sin((x - uv.y) * 11.0 + phase)
        - time * 0.012;
      float contour = abs(fract(field * 10.5) - 0.5);
      float fineLine = 1.0 - smoothstep(0.025, 0.055, contour);
      float majorContour = abs(fract(field * 3.5 + 0.16) - 0.5);
      float majorLine = 1.0 - smoothstep(0.025, 0.050, majorContour);
      float basin = 0.5 + 0.5 * sin(field * 4.8 + phase);
      float4 color = mix(accentA, mix(accentA, accentB, 0.34), basin);
      color = mix(color, ground, 0.055);
      color = mix(color, accentB, fineLine * 0.94);
      color = mix(color, ground, majorLine * 0.20);
      return half4(color);
    }
  `,
  strata: `
    uniform float2 resolution;
    uniform float seed;
    uniform float time;
    uniform float4 ground;
    uniform float4 accentA;
    uniform float4 accentB;

    float hash11(float p) {
      return fract(sin(p * 127.1 + seed * 0.017) * 43758.5453);
    }

    half4 main(float2 fragCoord) {
      float2 uv = fragCoord / resolution;
      float aspect = resolution.x / resolution.y;
      float x = uv.x * aspect;
      float phase = hash11(3.9) * 6.2831853;
      float field = uv.y
        + 0.19 * sin(x * 1.9 + phase)
        + 0.052 * sin((x + uv.y) * 5.4 - phase)
        - time * 0.009;
      float stepped = field * 5.2;
      float band = mod(floor(stepped), 4.0);
      float edgeDistance = abs(fract(stepped) - 0.5);
      float edge = 1.0 - smoothstep(0.035, 0.075, edgeDistance);
      float4 mutedA = mix(accentA, ground, 0.16);
      float4 mutedB = mix(accentB, ground, 0.12);
      float4 color = accentA;
      if (band > 0.5) color = mix(accentA, accentB, 0.34);
      if (band > 1.5) color = mutedB;
      if (band > 2.5) color = mutedA;
      color = mix(color, accentB, edge * 0.62);
      return half4(color);
    }
  `,
  traverse: `
    uniform float2 resolution;
    uniform float seed;
    uniform float time;
    uniform float4 ground;
    uniform float4 accentA;
    uniform float4 accentB;

    float hash11(float p) {
      return fract(sin(p * 127.1 + seed * 0.023) * 43758.5453);
    }

    half4 main(float2 fragCoord) {
      float2 uv = fragCoord / resolution;
      float aspect = resolution.x / resolution.y;
      float phase = hash11(9.1) * 6.2831853;
      float angle = -0.52 + hash11(4.8) * 1.04;
      float cs = cos(angle);
      float sn = sin(angle);
      float2 p = float2((uv.x - 0.5) * aspect, uv.y - 0.5);
      float2 q = float2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
      float influenceA = exp(-pow((q.x - mix(-0.65, 0.15, hash11(2.4))) * 2.4, 2.0));
      float influenceB = exp(-pow((q.x - mix(0.10, 0.72, hash11(7.6))) * 3.1, 2.0));
      float trackField = q.y
        + 0.11 * sin(q.x * 2.8 + phase)
        + 0.075 * influenceA
        - 0.062 * influenceB
        + 0.025 * sin((q.x - q.y) * 7.2 - phase)
        - time * 0.010;
      float tracks = abs(fract(trackField * 9.0) - 0.5);
      float rail = 1.0 - smoothstep(0.032, 0.064, tracks);
      float broad = 0.5 + 0.5 * sin(trackField * 3.4 + phase);
      float4 color = mix(accentA, mix(accentA, accentB, 0.28), broad);
      color = mix(color, ground, 0.045);
      color = mix(color, accentB, rail * 0.92);
      return half4(color);
    }
  `,
};

const effectCache = new Map<PlanCoverMode, SkRuntimeEffect | null>();

function shaderFor(mode: PlanCoverMode): SkRuntimeEffect | null {
  if (effectCache.has(mode)) return effectCache.get(mode) ?? null;
  let effect: SkRuntimeEffect | null = null;
  try {
    effect = Skia.RuntimeEffect.Make(SHADERS[mode]);
  } catch {
    effect = null;
  }
  effectCache.set(mode, effect);
  return effect;
}

function parseColor(value: string): RGBA {
  const normalized = value.replace('#', '');
  if (normalized.length !== 6) return [0, 0, 0, 1];
  return [
    Number.parseInt(normalized.slice(0, 2), 16) / 255,
    Number.parseInt(normalized.slice(2, 4), 16) / 255,
    Number.parseInt(normalized.slice(4, 6), 16) / 255,
    1,
  ];
}

function makeVivid(color: RGBA): RGBA {
  const mean = (color[0] + color[1] + color[2]) / 3;
  const channel = (value: number) => (
    Math.max(0, Math.min(1, (mean + (value - mean) * 1.32) * 1.13 + 0.018))
  );
  return [channel(color[0]), channel(color[1]), channel(color[2]), color[3]];
}

function mixColor(from: RGBA, to: RGBA, amount: number): RGBA {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
    from[3] + (to[3] - from[3]) * amount,
  ];
}

export function PlanCoverField({
  seed,
  mode,
  width,
  height,
  testID,
  borderRadius = 0,
  animated = false,
  tone = 'balanced',
}: PlanCoverFieldProps) {
  const C = useTheme();
  const reduceMotion = useReducedMotion();
  const effect = shaderFor(mode);
  const palette = [C.planWarm, C.planViolet, C.planBlue, C.planGreen, C.planRose] as const;
  const pair = planCoverPalettePair(seed);
  const accentA = palette[pair[0]];
  const accentB = palette[pair[1]];
  const toneStrength = planCoverToneStrength(tone);
  const colors = useMemo(() => ({
    ground: parseColor(C.brand),
    accentA: mixColor(parseColor(C.brand), makeVivid(parseColor(accentA)), toneStrength),
    accentB: mixColor(parseColor(C.brand), makeVivid(parseColor(accentB)), toneStrength),
  }), [C.brand, accentA, accentB, toneStrength]);
  const base = useMemo(() => ({
    resolution: { x: width, y: height },
    seed: planCoverSeedValue(seed),
    time: 0,
    ...colors,
  }), [colors, height, seed, width]);

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{ width, height, borderRadius, overflow: 'hidden', backgroundColor: C.brand }}
    >
      {effect ? (
        animated && !reduceMotion ? (
          <AnimatedField effect={effect} uniforms={base} width={width} height={height} />
        ) : (
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={effect} uniforms={base} />
            </Fill>
          </Canvas>
        )
      ) : (
        <LinearGradient
          colors={[C.planWarm, C.planViolet, C.brand]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      )}
    </View>
  );
}

function AnimatedField({
  effect,
  uniforms,
  width,
  height,
}: {
  effect: SkRuntimeEffect;
  uniforms: {
    resolution: { x: number; y: number };
    seed: number;
    time: number;
    ground: RGBA;
    accentA: RGBA;
    accentB: RGBA;
  };
  width: number;
  height: number;
}) {
  const clock = useClock();
  const liveUniforms = useDerivedValue(() => ({
    ...uniforms,
    time: clock.value / 1000,
  }), [clock, uniforms]);

  return (
    <Canvas style={{ width, height }}>
      <Fill>
        <Shader source={effect} uniforms={liveUniforms} />
      </Fill>
    </Canvas>
  );
}
