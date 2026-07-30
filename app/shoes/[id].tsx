import { useLocalSearchParams } from 'expo-router';

import { ShoeEditor } from '@/components/ShoeEditor';

/** Edit-a-shoe sheet (modal over Settings): rename, photo, default, retire, delete. */
export default function EditShoeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ShoeEditor shoeId={id ?? null} />;
}
