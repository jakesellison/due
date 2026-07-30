import { Text, View } from 'react-native';

/** Phase 0 boot screen: proves the toolchain end to end, nothing more. */
export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F0F12' }}>
      <Text style={{ color: '#FFC93C', fontSize: 29, fontWeight: '700', letterSpacing: -0.5 }}>Due</Text>
      <Text style={{ color: '#A6A5AD', fontSize: 12, marginTop: 6 }}>extraction rebuild · phase 0</Text>
    </View>
  );
}
