import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { fontSizes, radius, space, type Tokens } from '@/theme/tokens';

export interface ErrorStateProps {
  /** Headline — label style, never a narrated sentence ("Couldn't load…"). */
  title?: string;
  /** Optional detail line (usually the thrown Error's message). */
  message?: string | null;
  /** Retry handler — omit to render a message-only block with no action. */
  onRetry?: () => void;
  /** CTA label — "Retry" by default, label-style (never a sentence). */
  retryLabel?: string;
  /** Compact = an inline row (for embedding inside a card/list), not a
   *  centered full-block state. Used where a whole-screen takeover would be
   *  too heavy (e.g. a single provider row inside a longer list). */
  compact?: boolean;
}

/**
 * Shared error/retry primitive — the model Routes' `ErrorCard` set, generalized
 * so every screen's error branch gets a real retry affordance instead of
 * reimplementing its own centered message block. Dark-token styled; the
 * yellow CTA is allowed here because a retry IS an action, not decoration.
 * Copy stays label+number style, never a narrated sentence.
 */
export function ErrorState({
  title = "Couldn’t load this",
  message,
  onRetry,
  retryLabel = 'Retry',
  compact = false,
}: ErrorStateProps) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (compact) {
    return (
      <View style={styles.compactRoot} testID="error-state-compact">
        <Text style={styles.compactText} numberOfLines={1}>{title}</Text>
        {onRetry ? (
          <ActionButton
            accessibilityLabel={retryLabel}
            hitSlop={8}
            onPress={onRetry}
            color={C.yellow}
            radius={radius.pill}
            contentStyle={styles.compactRetry}
          >
            <ActionButtonLabel style={styles.compactRetryText}>{retryLabel}</ActionButtonLabel>
          </ActionButton>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.root} testID="error-state">
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.body}>{message}</Text> : null}
      {onRetry ? (
        <ActionButton
          accessibilityLabel={retryLabel}
          onPress={onRetry}
          color={C.yellow}
          radius={radius.pill}
          style={styles.retryOuter}
          contentStyle={styles.retry}
        >
          <ActionButtonLabel>{retryLabel}</ActionButtonLabel>
        </ActionButton>
      ) : null}
    </View>
  );
}

const makeStyles = (C: Tokens) =>
  StyleSheet.create({
    root: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
    title: { fontSize: fontSizes.sectionTitle, fontWeight: '700', color: C.ink, marginBottom: space.sm, textAlign: 'center' },
    body: { fontSize: fontSizes.labelLg, color: C.mute, textAlign: 'center' },
    retryOuter: {
      marginTop: space.lg,
    },
    retry: {
      paddingVertical: space.sm,
      paddingHorizontal: space.xl,
    },
    compactRoot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
    },
    compactText: { flex: 1, fontSize: fontSizes.label, color: C.mute, fontWeight: '500', marginRight: space.md },
    compactRetry: {
      paddingVertical: space.xs,
      paddingHorizontal: space.md,
    },
    compactRetryText: { fontSize: fontSizes.labelSm },
  });
