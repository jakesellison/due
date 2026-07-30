import { useQuery, type QueryClient } from '@tanstack/react-query';

import { supabase } from '../supabase';

// ---- Shoes (gear tracking) --------------------------------------------------

/** Signed-URL lifetime (seconds) — mirrors activityPhotos' read TTL. */
const SIGNED_URL_TTL_S = 60 * 60;

/** A shoe with its mileage ledger attached (shoes table ⋈ shoe_mileage view). */
export interface Shoe {
  id: string;
  name: string;
  /** Storage path in the `shoe-photos` bucket, null = no photo. */
  photoPath: string | null;
  /** Time-limited signed read URL (the bucket is private — no public URL). */
  photoUrl: string | null;
  startingMeters: number;
  isDefault: boolean;
  retiredAt: string | null;
  /** starting_meters + sum of assigned activities (from the view). */
  totalMeters: number;
  activityCount: number;
}

interface ShoeRow {
  id: string;
  name: string;
  photo_path: string | null;
  starting_meters: number;
  is_default: boolean;
  retired_at: string | null;
}

interface ShoeMileageRow {
  shoe_id: string;
  total_meters: number;
  activity_count: number;
}

/**
 * Merge table rows with the mileage view: camelCase, totals attached (a shoe
 * with no assigned runs falls back to its starting meters — the view row still
 * exists, but be robust to its absence), ordered default → active → retired.
 * `photoUrls` (storage path → signed URL) is optional so callers that haven't
 * minted signed URLs yet (or have no photos to sign) can omit it.
 */
export function shapeShoes(
  rows: ShoeRow[],
  mileage: ShoeMileageRow[],
  photoUrls?: Map<string, string | null>,
): Shoe[] {
  const byShoe = new Map(mileage.map((m) => [m.shoe_id, m]));
  const shoes = rows.map((r): Shoe => {
    const m = byShoe.get(r.id);
    return {
      id: r.id,
      name: r.name,
      photoPath: r.photo_path,
      photoUrl: r.photo_path ? (photoUrls?.get(r.photo_path) ?? null) : null,
      startingMeters: r.starting_meters,
      isDefault: r.is_default,
      retiredAt: r.retired_at,
      totalMeters: m?.total_meters ?? r.starting_meters,
      activityCount: m?.activity_count ?? 0,
    };
  });
  const rank = (s: Shoe) => (s.retiredAt ? 2 : s.isDefault ? 0 : 1);
  return shoes.sort((a, b) => rank(a) - rank(b));
}

/** Every shoe the user owns, mileage attached, default first / retired last. */
export function useShoes(userId: string | null) {
  return useQuery<Shoe[]>({
    queryKey: ['shoes', userId],
    enabled: !!userId,
    queryFn: async () => {
      const [shoesRes, mileageRes] = await Promise.all([
        supabase
          .from('shoes')
          .select('id, name, photo_path, starting_meters, is_default, retired_at')
          .order('created_at', { ascending: true }),
        supabase.from('shoe_mileage').select('shoe_id, total_meters, activity_count'),
      ]);
      if (shoesRes.error) throw shoesRes.error;
      if (mileageRes.error) throw mileageRes.error;
      const rows = (shoesRes.data ?? []) as ShoeRow[];
      // Private bucket → mint per-photo signed URLs (owner-scoped by RLS),
      // same batch pattern as useActivityPhotos.
      const paths = rows.map((r) => r.photo_path).filter((p): p is string => !!p);
      let photoUrls: Map<string, string | null> | undefined;
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('shoe-photos').createSignedUrls(paths, SIGNED_URL_TTL_S);
        photoUrls = new Map((signed ?? []).map((s) => [s.path ?? '', s.signedUrl ?? null]));
      }
      return shapeShoes(rows, (mileageRes.data ?? []) as ShoeMileageRow[], photoUrls);
    },
  });
}

export async function invalidateShoeCaches(qc: QueryClient): Promise<void> {
  await qc.invalidateQueries({ queryKey: ['shoes'] });
}

export async function createShoe(
  input: { userId: string; name: string; startingMeters?: number; makeDefault?: boolean },
  qc?: QueryClient,
): Promise<string> {
  // The unique partial index idx_shoes_one_default (0009_shoes.sql) forbids two
  // live defaults, so an existing default must be cleared BEFORE inserting a new
  // default — otherwise the insert trips the constraint. A transactional RPC
  // would close the brief no-default window (see PRODUCTION-READINESS.md).
  if (input.makeDefault) await clearDefaultShoe();
  const { data, error } = await supabase
    .from('shoes')
    .insert({
      user_id: input.userId,
      name: input.name.trim(),
      starting_meters: input.startingMeters ?? 0,
      is_default: !!input.makeDefault,
    })
    .select('id')
    .single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  if (qc) await invalidateShoeCaches(qc);
  return id;
}

export async function updateShoe(
  shoeId: string,
  patch: { name?: string; startingMeters?: number; retired?: boolean; photoPath?: string },
  qc?: QueryClient,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.startingMeters !== undefined) row.starting_meters = patch.startingMeters;
  if (patch.photoPath !== undefined) row.photo_path = patch.photoPath;
  if (patch.retired !== undefined) {
    row.retired_at = patch.retired ? new Date().toISOString() : null;
    if (patch.retired) row.is_default = false; // a retired shoe can't be the default
  }
  const { error } = await supabase.from('shoes').update(row).eq('id', shoeId);
  if (error) throw error;
  if (qc) await invalidateShoeCaches(qc);
}

/**
 * Clear the default flag on all of the caller's live default shoes. RLS scopes
 * this to the caller's own shoes.
 */
async function clearDefaultShoe(): Promise<void> {
  const { error } = await supabase.from('shoes').update({ is_default: false }).eq('is_default', true);
  if (error) throw error;
}

/** Make `shoeId` the default. */
export async function setDefaultShoe(shoeId: string, qc?: QueryClient): Promise<void> {
  // The unique partial index idx_shoes_one_default (0009_shoes.sql) forbids two
  // live defaults, so clear the existing default BEFORE setting the new one —
  // setting first would trip the constraint. A transactional RPC would close the
  // brief no-default window (see PRODUCTION-READINESS.md).
  await clearDefaultShoe();
  const { error } = await supabase.from('shoes').update({ is_default: true }).eq('id', shoeId);
  if (error) throw error;
  if (qc) await invalidateShoeCaches(qc);
}

/**
 * Delete a shoe and its orphaned storage photo. Its activities keep running
 * (shoe_id → null via FK).
 */
export async function deleteShoe(shoeId: string, qc?: QueryClient): Promise<void> {
  // Read the photo path before the row is gone so the storage object doesn't
  // leak forever after the shoe is deleted.
  const { data: shoe } = await supabase
    .from('shoes')
    .select('photo_path')
    .eq('id', shoeId)
    .maybeSingle();
  const { error } = await supabase.from('shoes').delete().eq('id', shoeId);
  if (error) throw error;
  const photoPath = (shoe as { photo_path: string | null } | null)?.photo_path;
  if (photoPath) await supabase.storage.from('shoe-photos').remove([photoPath]);
  if (qc) await invalidateShoeCaches(qc);
}

/** Reassign (or clear) the shoe on one activity. */
export async function assignShoeToActivity(
  activityId: string,
  shoeId: string | null,
  qc?: QueryClient,
): Promise<void> {
  const { error } = await supabase.from('activities').update({ shoe_id: shoeId }).eq('id', activityId);
  if (error) throw error;
  if (qc) {
    await Promise.all([invalidateShoeCaches(qc), qc.invalidateQueries({ queryKey: ['activities'] })]);
  }
}

/**
 * Upload a shoe photo (base64 from expo-image-picker) to
 * `shoe-photos/<userId>/<shoeId>.jpg` and point the shoe at it. Replacing a
 * photo is remove-then-upload rather than `upsert: true`: the storage server's
 * x-upsert path trips owner RLS even on brand-new objects, while plain
 * delete + insert match the bucket policies exactly.
 */
export async function uploadShoePhoto(
  input: { userId: string; shoeId: string; base64: string },
  qc?: QueryClient,
): Promise<string> {
  const path = `${input.userId}/${input.shoeId}.jpg`;
  const bytes = Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0));
  await supabase.storage.from('shoe-photos').remove([path]); // no-op when absent
  const { error } = await supabase.storage
    .from('shoe-photos')
    .upload(path, bytes.buffer as ArrayBuffer, { contentType: 'image/jpeg' });
  if (error) throw error;
  await updateShoe(input.shoeId, { photoPath: path }, qc);
  return path;
}
