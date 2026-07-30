/**
 * The Plans modal owns its own navigation stack.
 *
 * WHY THIS EXISTS. `/plans` is presented modally, and every screen it leads to —
 * the import flow, a plan's detail, a starter preview — is a card WITHIN that
 * one modal task. Registered flat in the root stack, those pushes went onto the
 * stack the modal sits on top of, so they were created BEHIND the presented
 * modal: navigation "succeeded" and nothing appeared. Tapping "Bring your own
 * plan" (or a starter tile, or a saved plan row) did nothing at all.
 *
 * A nested Stack is the fix and the idiomatic shape: a modal that contains a
 * flow presents its own navigator, so pushes inside it stay inside it and the
 * X on `/plans` still dismisses the whole task.
 *
 * Presentation stays `card` for every child, for the reason the root layout
 * already recorded: presenting one of these as another modal stacks native
 * sheets and can pull the child header into the unsafe top region.
 */
import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

export default function PlansLayout() {
  const C = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'card',
        contentStyle: { backgroundColor: C.bg },
      }}
    />
  );
}
