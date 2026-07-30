import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { captureException } from '@/app-lib/sentry';
import { actionLabel, radius, space, THEMES, typeRole } from '@/theme/tokens';

// AppErrorBoundary is a class (no hooks), so it cannot use `useThemedStyles`
// and always renders the DARK palette. It reads that palette from `THEMES.dark`
// rather than hand-copying hex: `tokens.ts` is deliberately pure (no React
// Native imports) precisely so non-hook call sites like this one can import it.
//
// It previously inlined five hex literals, two of which had drifted off the
// retired Glass theme and were never updated — `#0E0D17` (a violet-cast
// near-black; the current `bg` is the NEUTRAL `#0F0F12`) and `#A9A5BF` (an old
// violet-cast mute). The crash screen was literally the last place in the app
// still rendering the old theme.
const D = THEMES.dark;

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * App-wide error boundary. A render-time throw anywhere below the root Stack
 * would otherwise crash to a blank/native screen with no recovery; this catches
 * it, logs it, and shows an on-brand fallback with a "Try again" reset.
 *
 * Class component because React error boundaries require getDerivedStateFromError
 * / componentDidCatch, which have no hooks equivalent.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Always keep the console log (visible in dev/Metro regardless of
    // whether crash reporting is configured/available).
    console.error('App render error:', error, info?.componentStack);
    // Best-effort report; captureException is itself guarded end-to-end, so a
    // reporting failure here can never break this fallback UI from rendering.
    captureException(error, { componentStack: info?.componentStack });
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: D.bg,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.xxl,
        }}
      >
        <Text style={{ ...typeRole.sheetTitle, color: D.ink, marginBottom: space.m }}>
          Something went wrong
        </Text>
        <Text style={{ ...typeRole.body, color: D.mute, textAlign: 'center', marginBottom: space.xl }}>
          The screen hit an unexpected error. Your data is safe — try again.
        </Text>
        {/* Hand-rolled rather than the ActionButton component: this is the
            screen that renders when something below has already thrown, so it
            stays free of hooks and theme context. It still wears the action
            voice — a flat accent plate with a tracked-uppercase legend — because
            `actionLabel` is a plain token this file can import. */}
        <Pressable
          accessibilityRole="button"
          onPress={this.reset}
          style={{
            backgroundColor: D.yellow,
            borderRadius: radius.md,
            paddingVertical: space.l,
            paddingHorizontal: space.xl + space.xs,
          }}
        >
          <Text style={{ ...actionLabel, color: D.accentInk }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
