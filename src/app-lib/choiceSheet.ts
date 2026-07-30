/**
 * showChoiceSheet — the app's ONE "pick one of N" native selector.
 *
 * Due asks this question in five places (distance units, temperature units,
 * appearance, the active-plan menu, the plan-library row menu, the shoe photo
 * source) and, before this file, implemented it three and a half times:
 *
 *   - `ChoiceSettingRow` in you.tsx — ActionSheetIOS, Cancel FIRST, callback
 *     indexed `options[index - 1]`.
 *   - the Appearance row, ~70 lines below it in the same file — a near-verbatim
 *     copy of the above.
 *   - the plan menus (plan.tsx, planLibraryActions.ts) — Cancel LAST, callback
 *     indexed `options[index]`.
 *   - the shoe photo source — an `Alert` with three buttons, which is the
 *     platform's CONFIRMATION grammar pressed into selection duty.
 *
 * None of that was visible to the runner: iOS renders Cancel in its own
 * detached bottom group wherever it sits in the array. It was a live
 * off-by-one hazard for whoever next edited one of those option lists, and it
 * meant a fix to the Android fallback had to be made in three places.
 *
 * Cancel is LAST here, matching the majority of the call sites it replaces, so
 * the callback can index `options` directly with no arithmetic at all.
 *
 * Android/other has no action sheet, so it falls back to `Alert` with a
 * cancel-styled button — the same fallback the You rows already had, now in one
 * place rather than copied.
 */
import { ActionSheetIOS, Alert, Platform } from 'react-native';

export interface ChoiceOption<K extends string> {
  key: K;
  label: string;
}

export function showChoiceSheet<K extends string>({
  title,
  message,
  options,
  onPick,
  destructiveKey,
}: {
  /** Sheet title — the object being acted on, e.g. the plan's race name. */
  title?: string;
  message?: string;
  options: ReadonlyArray<ChoiceOption<K>>;
  onPick: (key: K) => void;
  /** Renders in the destructive role (red on iOS). */
  destructiveKey?: K;
}): void {
  const labels = options.map((o) => o.label);
  const destructiveIndex = destructiveKey
    ? options.findIndex((o) => o.key === destructiveKey)
    : -1;

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message,
        options: [...labels, 'Cancel'],
        cancelButtonIndex: labels.length,
        ...(destructiveIndex >= 0 ? { destructiveButtonIndex: destructiveIndex } : {}),
      },
      (index) => {
        // Cancel is the one index past the real options; anything out of range
        // (a dismissal) is a no-op rather than a spurious pick.
        const chosen = options[index];
        if (chosen) onPick(chosen.key);
      },
    );
    return;
  }

  Alert.alert(title ?? '', message, [
    ...options.map((o) => ({
      text: o.label,
      style: (o.key === destructiveKey ? 'destructive' : 'default') as 'destructive' | 'default',
      onPress: () => onPick(o.key),
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}
