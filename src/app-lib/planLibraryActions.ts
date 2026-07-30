import { useCallback, useState } from 'react';
import { Alert, Share } from 'react-native';

import { showChoiceSheet } from '@/app-lib/choiceSheet';
import * as FileSystem from 'expo-file-system/legacy';
import type { QueryClient } from '@tanstack/react-query';

import {
  deletePlan,
  exportPlanToRelative,
  fetchPlanBundle,
  planDueFilename,
  renamePlan,
  switchActivePlan,
  type MyPlan,
} from '@/app-lib/queries';

/**
 * Rename and export are standalone rather than hook-bound because the Plan
 * tab's active-plan menu needs them without the rest of the list machinery —
 * it acts on one known plan, not a selection. They lived duplicated there
 * verbatim, which is the drift this module exists to prevent.
 */
export function promptRenamePlan(plan: MyPlan, queryClient: QueryClient): void {
  Alert.prompt(
    'Rename plan',
    'Give this plan a new name.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: async (text?: string) => {
          const name = (text ?? '').trim();
          if (!name || name === plan.raceName) return;
          try {
            await renamePlan(plan.id, name, queryClient);
          } catch {
            Alert.alert('Couldn’t rename plan', 'Please try again.');
          }
        },
      },
    ],
    'plain-text',
    plan.raceName,
  );
}

/** Writes the plan's relative `.due` to the cache dir and opens the share sheet. */
export async function exportPlanDue(planId: string, raceName: string): Promise<void> {
  try {
    const bundle = await fetchPlanBundle(planId);
    if (!bundle) {
      Alert.alert('Couldn’t export plan', 'That plan could not be found.');
      return;
    }
    const json = JSON.stringify(exportPlanToRelative(bundle.plan, bundle.weeks, bundle.workouts), null, 2);
    const uri = `${FileSystem.cacheDirectory}${planDueFilename(raceName)}`;
    await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
    await Share.share({ url: uri });
  } catch (error) {
    Alert.alert('Couldn’t export plan', error instanceof Error ? error.message : 'Please try again.');
  }
}

/**
 * Shared lifecycle actions for every saved-plan list. Keeping this in one hook
 * prevents the two-plan preview and the full library from drifting into
 * different menus or destructive safeguards.
 */
export function usePlanLibraryActions(activePlanId: string | null, queryClient: QueryClient) {
  const [switching, setSwitching] = useState<string | null>(null);

  const selectPlan = useCallback(
    (plan: MyPlan) => {
      if (plan.id === activePlanId || switching) return;
      Alert.alert('Switch active plan?', `Make “${plan.raceName}” your active plan? Week and Plan will follow it.`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            setSwitching(plan.id);
            try {
              await switchActivePlan(plan.id, activePlanId, queryClient);
            } catch {
              Alert.alert('Couldn’t switch plan', 'Please try again.');
            } finally {
              setSwitching(null);
            }
          },
        },
      ]);
    },
    [activePlanId, queryClient, switching],
  );

  const remove = useCallback(
    (plan: MyPlan) => {
      const isActive = plan.id === activePlanId;
      Alert.alert(
        isActive ? 'Delete your active plan?' : 'Delete plan?',
        isActive
          ? `“${plan.raceName}” is active. Deleting it removes its workouts and leaves no active plan. This can’t be undone.`
          : `Permanently delete “${plan.raceName}” and its workouts. This can’t be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deletePlan(plan.id, queryClient);
              } catch {
                Alert.alert('Couldn’t delete plan', 'Please try again.');
              }
            },
          },
        ],
      );
    },
    [activePlanId, queryClient],
  );

  const openPlanMenu = useCallback(
    (plan: MyPlan) => {
      const isActive = plan.id === activePlanId;
      // Dispatch is on the KEY, not the visible label. This used to compare the
      // callback's option against the string 'Export .due' etc., so renaming a
      // menu item silently disconnected its action.
      showChoiceSheet({
        title: plan.raceName,
        options: [
          ...(isActive ? [] : [{ key: 'activate' as const, label: 'Make active' }]),
          { key: 'rename' as const, label: 'Rename' },
          { key: 'export' as const, label: 'Export .due' },
          { key: 'delete' as const, label: 'Delete' },
        ],
        destructiveKey: 'delete',
        onPick: (key) => {
          if (key === 'activate') selectPlan(plan);
          else if (key === 'rename') promptRenamePlan(plan, queryClient);
          else if (key === 'export') void exportPlanDue(plan.id, plan.raceName);
          else if (key === 'delete') remove(plan);
        },
      });
    },
    [activePlanId, queryClient, remove, selectPlan],
  );

  return { switching, openPlanMenu };
}
