const mockRpc = jest.fn();
const mockFrom = jest.fn();

jest.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { attachRouteToWorkout, createRoute } from '../routes';

const routeRow = {
  id: 'r1',
  name: 'River loop',
  points: [[41.88, -87.62], [41.89, -87.61]],
  path: null,
  distance_meters: 9656,
  created_at: '2026-07-21T12:00:00Z',
  updated_at: '2026-07-21T12:00:00Z',
  archived_at: null,
  provenance: 'due_builder',
};

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
});

test('createRoute uses the atomic create-and-attach RPC in workout context', async () => {
  mockRpc.mockResolvedValue({ data: routeRow, error: null });

  const route = await createRoute({
    userId: 'u1',
    workoutId: 'w1',
    name: 'River loop',
    points: [[41.88, -87.62], [41.89, -87.61]],
    path: null,
    distanceMeters: 9656.4,
  });

  expect(mockRpc).toHaveBeenCalledWith('create_route_and_attach', {
    p_workout_id: 'w1',
    p_name: 'River loop',
    p_points: [[41.88, -87.62], [41.89, -87.61]],
    p_path: null,
    p_distance_meters: 9656,
  });
  expect(mockFrom).not.toHaveBeenCalled();
  expect(route.id).toBe('r1');
  expect(route.provenance).toBe('due_builder');
});

test('attachRouteToWorkout replaces the user selection idempotently', async () => {
  const upsert = jest.fn().mockResolvedValue({ error: null });
  mockFrom.mockReturnValue({ upsert });

  await attachRouteToWorkout('u1', 'w1', 'r1');

  expect(mockFrom).toHaveBeenCalledWith('workout_route_selections');
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: 'u1', workout_id: 'w1', route_id: 'r1' }),
    { onConflict: 'user_id,workout_id' },
  );
});
