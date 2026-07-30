import { useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import type { LatLng } from '@/lib';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';
import { CloseButton } from '@/components/CloseButton';
import { OverlayNav } from '@/components/OverlayNav';

import { RouteMapView } from './RouteMapView';

/**
 * A route map you can blow up to full screen — the activity-detail map idiom in
 * a reusable form. Renders an interactive `RouteMapView` tile with a corner
 * "expand" button; tapping it opens a full-screen map with a close (×) button in
 * the top-right. The full-screen map only mounts while open, so we never run two
 * live maps at once. The inline tile fills its parent's width (measured).
 */
export interface ExpandableRouteMapProps {
  path: LatLng[];
  /** Inline tile height. */
  height: number;
  cornerRadius?: number;
  showMarkers?: boolean;
  lineColor?: string;
}

export function ExpandableRouteMap({ path, height, cornerRadius = 0, showMarkers = true, lineColor }: ExpandableRouteMapProps) {
  const C = useTheme();
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(0);
  const { width: winW, height: winH } = useWindowDimensions();
  // Captured from the app's provider — a SafeAreaView inside a Modal reads 0
  // (the Modal portals outside the provider), so the close button would hide
  // behind the status bar.
  const insets = useSafeAreaInsets();

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={[styles.tile, { height, borderRadius: cornerRadius }]}>
      {w > 0 ? (
        <RouteMapView path={path} width={w} height={height} interactive showMarkers={showMarkers} lineColor={lineColor} cornerRadius={cornerRadius} />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Expand map to full screen"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.btn, styles.expandPos, pressed && styles.pressed]}
        hitSlop={8}
      >
        <SymbolView name="arrow.up.left.and.arrow.down.right" size={15} tintColor="#FFFFFF" resizeMode="scaleAspectFit" />
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)} presentationStyle="fullScreen">
        <View style={[styles.full, { backgroundColor: C.bg }]}>
          {open ? <RouteMapView path={path} width={winW} height={winH} interactive showMarkers={showMarkers} lineColor={lineColor} cornerRadius={0} /> : null}
          {/* The shared overlay row. Its own `closeWrap` used a literal 8 for
              the offset and space.l for the gutter — both a hair off the rest
              of the app. The empty leading slot keeps the close button on the
              RIGHT, which is correct here: this is a full-screen expansion of
              the tile below, not a navigation level. */}
          <OverlayNav floating topInset={insets.top}>
            <View />
            <CloseButton variant="overlay" accessibilityLabel="Close full-screen map" onPress={() => setOpen(false)} />
          </OverlayNav>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden' },
  full: { flex: 1 },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(11,14,18,0.5)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandPos: { position: 'absolute', right: 10, bottom: 10 },
  pressed: { opacity: 0.5, transform: [{ scale: 0.9 }] },
});
