import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import * as ImagePicker from 'expo-image-picker';

import { useSession } from '@/app-lib/auth';
import { showChoiceSheet } from '@/app-lib/choiceSheet';
import { closeScreen } from '@/app-lib/nav';
import { useAppPreferences } from '@/app-lib/preferences';
import {
  createShoe,
  deleteShoe,
  setDefaultShoe,
  updateShoe,
  uploadShoePhoto,
  useShoes,
  type Shoe,
} from '@/app-lib/queries';
import { metersToUnits, unitsToMeters } from '@/lib';
import { ErrorState } from '@/components/ErrorState';
import { ActionButton, ActionButtonLabel } from '@/components/ActionButton';
import { ModalFooter } from '@/components/ModalFooter';
import { SheetGrabberHeader } from '@/components/SheetGrabberHeader';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { display, fontSizes, radius, space, typeRole, type Tokens } from '@/theme/tokens';
import { PoweredByStrava } from './StravaAttribution';

/**
 * Add/edit a shoe — one screen for both modes (`shoeId` null = create). Name,
 * photo (camera or library via expo-image-picker, stored in the `shoe-photos`
 * bucket), starting miles, plus edit-only actions: set default, retire, delete.
 */
export function ShoeEditor({ shoeId }: { shoeId: string | null }) {
  const C = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { userId, ready } = useSession();
  const { preferences } = useAppPreferences();
  const units = preferences.distance;
  const unitWord = units === 'mi' ? 'miles' : 'kilometers';
  const shoes = useShoes(ready ? userId : null);
  const shoe: Shoe | null = useMemo(
    () => shoes.data?.find((s) => s.id === shoeId) ?? null,
    [shoes.data, shoeId],
  );

  const [name, setName] = useState<string | null>(null); // null = untouched
  const [startingMi, setStartingMi] = useState<string | null>(null);
  const [pickedPhoto, setPickedPhoto] = useState<{ uri: string; base64: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const nameValue = name ?? shoe?.name ?? '';
  const startingValue =
    startingMi ?? (shoe && shoe.startingMeters > 0 ? metersToUnits(shoe.startingMeters, units).toFixed(0) : '');
  const photoUri = pickedPhoto?.uri ?? shoe?.photoUrl ?? null;
  const canSave = nameValue.trim().length > 0 && !busy;

  const pickPhoto = useCallback(async (source: 'library' | 'camera') => {
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1] as [number, number],
      quality: 0.5,
      base64: true,
    };
    const result =
      source === 'camera'
        ? await (async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) return null;
            return ImagePicker.launchCameraAsync(opts);
          })()
        : await ImagePicker.launchImageLibraryAsync(opts);
    const asset = result && !result.canceled ? result.assets[0] : null;
    if (asset?.base64) setPickedPhoto({ uri: asset.uri, base64: asset.base64 });
  }, []);

  // The shared selector, not a three-button Alert. This was the app's only
  // "pick one of N" asked through the platform's CONFIRMATION grammar; every
  // other selector is an action sheet, which is what iOS provides for choosing.
  const onPhotoPress = useCallback(() => {
    showChoiceSheet({
      title: 'Shoe photo',
      options: [
        { key: 'camera' as const, label: 'Take photo' },
        { key: 'library' as const, label: 'Choose from library' },
      ],
      onPick: (key) => void pickPhoto(key),
    });
  }, [pickPhoto]);

  const onSave = useCallback(async () => {
    if (!userId || !canSave) return;
    setBusy(true);
    try {
      const startingMeters = Math.round(unitsToMeters(Number(startingValue) || 0, units));
      let id = shoeId;
      if (id) {
        await updateShoe(id, { name: nameValue, startingMeters }, queryClient);
      } else {
        // The DB trigger promotes a user's first live shoe to default.
        id = await createShoe({ userId, name: nameValue, startingMeters }, queryClient);
      }
      if (pickedPhoto) {
        await uploadShoePhoto({ userId, shoeId: id, base64: pickedPhoto.base64 }, queryClient);
      }
      closeScreen(router);
    } catch (err) {
      console.warn('[shoes] save failed', err);
      Alert.alert('Couldn’t save shoe', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }, [userId, canSave, shoeId, nameValue, startingValue, pickedPhoto, queryClient, router, units]);

  const onMakeDefault = useCallback(async () => {
    if (!shoeId) return;
    setBusy(true);
    try {
      await setDefaultShoe(shoeId, queryClient);
    } finally {
      setBusy(false);
    }
  }, [shoeId, queryClient]);

  const onToggleRetired = useCallback(async () => {
    if (!shoeId || !shoe) return;
    setBusy(true);
    try {
      await updateShoe(shoeId, { retired: !shoe.retiredAt }, queryClient);
    } finally {
      setBusy(false);
    }
  }, [shoeId, shoe, queryClient]);

  const onDelete = useCallback(() => {
    if (!shoeId) return;
    Alert.alert('Delete shoe?', 'Runs assigned to it keep their data (shoe cleared).', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await deleteShoe(shoeId, queryClient);
            closeScreen(router);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }, [shoeId, queryClient, router]);

  const title = shoeId ? 'Edit shoe' : 'New shoe';
  const mileageLine =
    shoe && shoe.activityCount > 0
      ? `${metersToUnits(shoe.totalMeters, units).toFixed(0)} ${units}  ${shoe.activityCount} runs`
      : shoe
        ? `${metersToUnits(shoe.totalMeters, units).toFixed(0)} ${units}`
        : null;

  // Editing an existing shoe depends on `shoes` resolving first — without these
  // gates the screen would flash a blank "New shoe" create form while loading,
  // and stay on it permanently on a bad id/failed fetch (Save would then create
  // a NEW shoe instead of editing). New-shoe mode (shoeId == null) has no data
  // to wait on, so it skips straight to the form.
  if (shoeId && shoes.error) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <ErrorState
              title="Couldn’t load this shoe"
              message={shoes.error instanceof Error ? shoes.error.message : String(shoes.error)}
              onRetry={() => shoes.refetch()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }
  if (shoeId && (!ready || shoes.isLoading)) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <ActivityIndicator color={C.mute} />
          </View>
        </SafeAreaView>
      </View>
    );
  }
  if (shoeId && !shoe) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.centered}>
            <ErrorState title="Shoe not found" />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <SheetGrabberHeader onClose={() => closeScreen(router)} accessibilityLabel="Close shoe editor" />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>{title}</Text>
          {mileageLine ? <Text style={styles.subtitle}>{mileageLine}</Text> : null}

          <View style={[styles.card, styles.cardPanel]}>
            <View style={styles.cardInner}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={photoUri ? 'Change shoe photo' : 'Add shoe photo'}
                onPress={onPhotoPress}
                disabled={busy}
                style={({ pressed }) => [styles.photoWrap, pressed && styles.pressed]}
              >
                {photoUri ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    source={{ uri: photoUri }}
                    style={styles.photo}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.photoEmpty}>
                    <SymbolView
                      name="shoe.2.fill"
                      size={30}
                      tintColor={C.faint}
                      resizeMode="scaleAspectFit"
                    />
                    <Text style={styles.photoEmptyText}>Add photo</Text>
                  </View>
                )}
              </Pressable>

              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={nameValue}
                onChangeText={setName}
                placeholder="e.g. Pegasus 41"
                placeholderTextColor={C.faint}
                editable={!busy}
                returnKeyType="done"
              />

              <Text style={styles.label}>Starting {unitWord} (already on the shoe)</Text>
              <TextInput
                style={styles.input}
                value={startingValue}
                onChangeText={setStartingMi}
                placeholder="0"
                placeholderTextColor={C.faint}
                keyboardType="number-pad"
                editable={!busy}
                returnKeyType="done"
              />
            </View>
          </View>

          {shoeId && shoe ? (
            <View style={[styles.card, styles.cardPanel]}>
              <View>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || shoe.isDefault || !!shoe.retiredAt}
                  onPress={onMakeDefault}
                  style={({ pressed }) => [styles.actionRow, pressed && styles.rowPressed]}
                >
                  <Text style={styles.actionLabel}>Default for new runs</Text>
                  {shoe.isDefault ? (
                    <Text style={styles.activeTag}>Default</Text>
                  ) : shoe.retiredAt ? (
                    <Text style={styles.actionMuted}>Retired</Text>
                  ) : (
                    <Text style={styles.actionLink}>Make default</Text>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onToggleRetired}
                  style={({ pressed }) => [styles.actionRow, styles.rowDivider, pressed && styles.rowPressed]}
                >
                  <Text style={styles.actionLabel}>{shoe.retiredAt ? 'Unretire' : 'Retire'}</Text>
                  <Text style={styles.actionMuted}>
                    {shoe.retiredAt ? 'Back in rotation' : 'Keeps its history'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={onDelete}
                  style={({ pressed }) => [styles.actionRow, styles.rowDivider, pressed && styles.rowPressed]}
                >
                  <Text style={[styles.actionLabel, styles.danger]}>Delete shoe</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <PoweredByStrava />
        </ScrollView>

        <ModalFooter>
          <ActionButton
            accessibilityLabel="Save shoe"
            loadingAccessibilityLabel="Saving shoe"
            loadingLabel="Saving…"
            disabled={!canSave && !busy}
            loading={busy}
            onPress={onSave}
            color={C.yellow}
            variant="commit"
          >
            <ActionButtonLabel>Save</ActionButtonLabel>
          </ActionButton>
        </ModalFooter>
      </SafeAreaView>
    </View>
  );
}

const makeStyles = (C: Tokens) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safe: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  scroll: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  title: {
    ...typeRole.pageTitle,
    color: C.ink,
    paddingHorizontal: space.xxs,
    paddingTop: space.s,
  },
  subtitle: {
    fontSize: fontSizes.metadata,
    fontWeight: '600',
    color: C.mute,
    paddingHorizontal: space.xxs,
    marginTop: 3,
  },
  card: {
    backgroundColor: C.card,
    borderColor: C.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  cardPanel: { marginTop: space.lg },
  cardInner: { padding: space.lg },
  pressed: { opacity: 0.7 },

  photoWrap: { alignSelf: 'center', marginBottom: space.l },
  photo: { width: 112, height: 112, borderRadius: radius.md },
  photoEmpty: {
    width: 112,
    height: 112,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.s,
    backgroundColor: C.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  photoEmptyText: { fontSize: fontSizes.labelSm, fontWeight: '700', color: C.faint },

  label: {
    fontSize: fontSizes.metadata,
    fontWeight: '700',
    color: C.mute,
    marginTop: space.md,
    marginBottom: space.s,
  },
  input: {
    backgroundColor: C.fill,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    paddingHorizontal: space.l,
    paddingVertical: space.md,
    fontSize: fontSizes.body,
    fontWeight: '600',
    color: C.ink,
  },

  actionRow: {
    minHeight: 52,
    paddingHorizontal: space.lg,
    paddingVertical: space.l,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  rowPressed: { backgroundColor: C.fill },
  actionLabel: { fontSize: fontSizes.body, fontWeight: '700', color: C.ink },
  actionLink: { fontSize: fontSizes.label, fontWeight: '700', color: C.mute, textDecorationLine: 'underline' },
  actionMuted: { fontSize: fontSizes.metadata, fontWeight: '600', color: C.faint },
  activeTag: { fontSize: fontSizes.metadata, fontWeight: '700', color: C.yellowText, letterSpacing: 0.2 },
  danger: { color: C.dangerText },

});
