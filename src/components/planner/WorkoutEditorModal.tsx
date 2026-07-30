import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RacePaces } from '@/lib/kpi/targetPace';

import { SCRIM } from '@/theme/tokens';

import { WorkoutBuilder, type BuiltWorkout } from './WorkoutBuilder';

export function WorkoutEditorModal({
  visible,
  onClose,
  onSubmit,
  onDelete,
  easyBaseline,
  racePaces,
  initialWorkout,
  submitLabel,
  editorKey,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (workout: BuiltWorkout) => void | Promise<void>;
  onDelete?: () => void;
  easyBaseline: number;
  racePaces: RacePaces | null;
  initialWorkout?: BuiltWorkout | null;
  submitLabel?: string;
  /** Remounts state when the host switches from create to another workout. */
  editorKey: string;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close workout editor" style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <WorkoutBuilder
          key={editorKey}
          onAdd={onSubmit}
          onClose={onClose}
          onDelete={onDelete}
          easyBaseline={easyBaseline}
          racePaces={racePaces}
          bottomInset={insets.bottom}
          initialWorkout={initialWorkout}
          submitLabel={submitLabel}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: SCRIM },
  wrap: { flex: 1, justifyContent: 'flex-end' },
});
