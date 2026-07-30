import { useLocalSearchParams } from 'expo-router';
import { SessionView } from '@/components/session/SessionView';

export default function WorkoutDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionView workoutId={id ?? undefined} />;
}
