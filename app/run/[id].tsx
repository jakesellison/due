import { useLocalSearchParams } from 'expo-router';
import { SessionView } from '@/components/session/SessionView';

export default function RunDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SessionView activityId={id ?? undefined} />;
}
