import { fireEvent, render } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import { WorkoutBuilder } from '../WorkoutBuilder';

function renderBuilder(onAdd = jest.fn(), onClose = jest.fn()) {
  return {
    onAdd,
    onClose,
    ...render(
      <ThemeProvider preference="dark">
        <WorkoutBuilder onAdd={onAdd} onClose={onClose} easyBaseline={480} />
      </ThemeProvider>,
    ),
  };
}

test('simple workouts use the compact composer and quality expands it', () => {
  const screen = renderBuilder();
  const simpleHeight = StyleSheet.flatten(screen.getByTestId('workout-builder').props.style).height;

  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));

  const qualityHeight = StyleSheet.flatten(screen.getByTestId('workout-builder').props.style).height;
  expect(qualityHeight).toBeGreaterThan(simpleHeight);
});

test('quality starts with a readable prescription instead of the full editor', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));

  expect(screen.getByText(/Warm-up/)).toBeTruthy();
  expect(screen.getByText(/6 × 800 m @ 5K/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Build a custom workout' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Decrease rounds' })).toBeNull();
});

test('Edit steps opens a block-first overview and keeps interval mechanics one level deeper', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  const summaryHeight = StyleSheet.flatten(screen.getByTestId('workout-builder').props.style).height;

  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));

  const editorHeight = StyleSheet.flatten(screen.getByTestId('workout-builder').props.style).height;
  expect(editorHeight).toBeGreaterThan(summaryHeight);
  expect(screen.getAllByText('6 × 800 m at 5K')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /Edit Intervals, 6 × 800 m at 5K/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Decrease rounds' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete interval block' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Review workout' })).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: /Edit Intervals, 6 × 800 m at 5K/ }));
  expect(screen.getByRole('button', { name: 'Decrease rounds' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Increase rounds' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete interval block' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Done editing intervals' })).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Done editing intervals' }));
  expect(screen.getByRole('button', { name: 'Review workout' })).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Back to workout summary' }));
  expect(screen.getByRole('button', { name: 'Build a custom workout' })).toBeTruthy();
});

test('the sheet exposes an explicit close action', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('button', { name: 'Close new workout' }));
  expect(screen.onClose).toHaveBeenCalledTimes(1);
});

test('an existing workout exposes a distinct destructive action', () => {
  const onDelete = jest.fn();
  const screen = render(
    <ThemeProvider preference="dark">
      <WorkoutBuilder
        onAdd={jest.fn()}
        onClose={jest.fn()}
        onDelete={onDelete}
        easyBaseline={480}
        initialWorkout={{
          type: 'easy',
          title: 'Easy Run',
          distanceMeters: 6 * 1609.344,
          durationSeconds: null,
          structure: [],
        }}
      />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByRole('button', { name: 'Delete run' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});

test('closing after a structure edit asks before discarding the workout', () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));
  fireEvent.press(screen.getByRole('button', { name: /Edit Intervals/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Increase rounds' }));
  // The customizer no longer carries its own X — close lives at the ROOT only
  // ("close at root, back within children", the audited sheet convention), so
  // discarding from a child means backing out first. The guard still fires:
  // the edit survives the back navigation and requestClose still sees it.
  fireEvent.press(screen.getByRole('button', { name: 'Back to workout blocks' }));
  fireEvent.press(screen.getByRole('button', { name: 'Back to workout summary' }));
  fireEvent.press(screen.getByRole('button', { name: 'Close new workout' }));

  expect(screen.onClose).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Discard workout changes?',
    'Your edited workout will not be saved.',
    expect.arrayContaining([expect.objectContaining({ text: 'Discard', style: 'destructive' })]),
  );
  alert.mockRestore();
});

test('Add workout creates an unscheduled workout and closes the composer', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('button', { name: 'Add workout' }));

  expect(screen.onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'easy', distanceMeters: expect.any(Number) }));
  expect(screen.onClose).toHaveBeenCalledTimes(1);
});

test('quality emits a concise title and declares both measurement and pace axes', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Add workout' }));

  const workout = screen.onAdd.mock.calls[0]![0];
  expect(workout.title).toBe('6×800m @ 5K');
  expect(workout.structure[0].target.by).toEqual(['distance', 'pace']);
  expect(workout.structure[1].children[0].target.by).toEqual(['distance', 'pace']);
  expect(workout.structure[1].children[0].target.pace).toEqual({
    kind: 'relative',
    reference: '5K',
    speed_fraction: 1,
  });
});

test('both timed work and timed support steps serialize through the due structure', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));

  fireEvent.press(screen.getByRole('button', { name: /Edit Intervals, 6 × 800 m at 5K/ }));
  fireEvent.press(screen.getByRole('button', { name: /Edit Work, 800 m, 5K/ }));
  expect(screen.getByRole('button', { name: 'Measure step by time' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Set pace to Easy' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Set pace to 5K' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Measure step by time' }));
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);

  fireEvent.press(screen.getByRole('button', { name: 'Done editing intervals' }));
  fireEvent.press(screen.getByRole('button', { name: /Edit Warm-up/ }));
  expect(screen.queryByRole('button', { name: 'Set pace to 5K' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Set pace to Easy' })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Measure step by time' }));
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);
  fireEvent.press(screen.getByRole('button', { name: 'Review workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Add workout' }));

  const workout = screen.onAdd.mock.calls[0]![0];
  expect(workout.title).toBe('6 × 3:00 at 5K');
  expect(workout.distanceMeters).toBeGreaterThan(4 * 1609.344);
  expect(workout.structure[0].target.by).toEqual(['time', 'pace']);
  expect(workout.structure[1].children[0].target.by).toEqual(['time', 'pace']);
  expect(workout.structure[1].children[0].target.pace).toEqual({
    kind: 'relative',
    reference: '5K',
    speed_fraction: 1,
  });
});

test('top-level block removal is available inside its editor, not on the overview', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));

  expect(screen.queryByRole('button', { name: 'Remove Warm-up block' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: /Edit Warm-up/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Remove Warm-up block' }));

  expect(screen.queryByRole('button', { name: /Edit Warm-up/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Edit Intervals/ })).toBeTruthy();
});

test('support blocks can be restored and new work is inserted before the cool-down', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));

  fireEvent.press(screen.getByRole('button', { name: 'Add block' }));
  expect(screen.getByRole('button', { name: 'Add a warm-up block' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add a work effort block' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add a repeat interval block' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Add a cool-down block' })).toBeTruthy();

  fireEvent.press(screen.getByRole('button', { name: 'Add a work effort block' }));
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);
  fireEvent.press(screen.getByRole('button', { name: 'Review workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Add workout' }));

  expect(screen.onAdd.mock.calls[0]![0].structure.map((segment: { kind: string }) => segment.kind)).toEqual([
    'warmup',
    'repeat',
    'work',
    'cooldown',
  ]);
});

test('quality suggestions stay compact while preserving prescription detail for accessibility', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));

  const rail = screen.getByTestId('workout-template-rail');
  expect(screen.getByText('Start with')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Use 6 × 800 m: 5K pace · 400 m jog' })).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Use 4 mi tempo: Threshold · continuous' })).toBeTruthy();
  expect(screen.queryByText('5K pace · 400 m jog')).toBeNull();
  expect(screen.getByText('6×800')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Build a custom workout' })).toBeTruthy();
  expect(rail.props.horizontal).toBeUndefined();
  expect(screen.getAllByRole('radio', { name: /Use/ })).toHaveLength(4);
});

test('workout types use an icon tab and a non-colour selection mark', () => {
  const screen = renderBuilder();

  expect(screen.getByTestId('workout-type-icon-easy')).toBeTruthy();
  expect(screen.getByTestId('workout-type-icon-quality')).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId('workout-type-mark-easy').props.style).backgroundColor).not.toBe('transparent');
  expect(StyleSheet.flatten(screen.getByTestId('workout-type-mark-quality').props.style).backgroundColor).toBe('transparent');

  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));

  expect(StyleSheet.flatten(screen.getByTestId('workout-type-mark-quality').props.style).backgroundColor).not.toBe('transparent');
});

test('the primary action clears the host-provided bottom safe area', () => {
  const onAdd = jest.fn();
  const screen = render(
    <ThemeProvider preference="dark">
      <WorkoutBuilder onAdd={onAdd} onClose={jest.fn()} easyBaseline={480} bottomInset={34} />
    </ThemeProvider>,
  );

  expect(StyleSheet.flatten(screen.getByTestId('workout-builder-footer').props.style).paddingBottom).toBe(42);
});

test('edit mode rehydrates a structured workout and saves support-mile changes without replacing the quality set', () => {
  const onAdd = jest.fn();
  const onClose = jest.fn();
  const M = 1609.344;
  const screen = render(
    <ThemeProvider preference="dark">
      <WorkoutBuilder
        onAdd={onAdd}
        onClose={onClose}
        easyBaseline={480}
        submitLabel="Apply changes"
        initialWorkout={{
          type: 'quality',
          title: 'Quality Run',
          distanceMeters: 14 * M,
          durationSeconds: null,
          structure: [
            { kind: 'warmup', target: { by: ['distance', 'pace'], distance_m: 2 * M, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
            { kind: 'repeat', sets: 5, children: [
              { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 2 * M, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
              { kind: 'recovery', target: { by: 'time', duration_s: 90, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
            ] },
            { kind: 'cooldown', target: { by: ['distance', 'pace'], distance_m: M, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
          ],
        }}
      />
    </ThemeProvider>,
  );

  expect(screen.getByRole('button', { name: /Edit Cool-down, 1 mi, Easy/ })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: /Edit Cool-down, 1 mi, Easy/ }));
  fireEvent.changeText(screen.getByLabelText('Step distance in miles'), '4');
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);
  fireEvent.press(screen.getByRole('button', { name: 'Apply changes' }));

  expect(onAdd).toHaveBeenCalledTimes(1);
  const edited = onAdd.mock.calls[0]![0];
  expect(edited.structure[1]).toMatchObject({ kind: 'repeat', sets: 5 });
  expect(edited.structure[2]).toMatchObject({ kind: 'cooldown' });
  expect((edited.structure[2] as { target: { distance_m: number } }).target.distance_m).toBeGreaterThan(3.99 * M);
  expect(edited.distanceMeters).toBeCloseTo(17 * M, -1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('distance input accepts tenths and the mile stepper advances by 0.1 mi', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));
  fireEvent.press(screen.getByRole('button', { name: /Edit Cool-down, 1 mi, Easy/ }));

  fireEvent.changeText(screen.getByLabelText('Step distance in miles'), '2.4');
  fireEvent.press(screen.getByRole('button', { name: 'Increase step amount' }));
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);

  expect(screen.getByRole('button', { name: /Edit Cool-down, 2.5 mi, Easy/ })).toBeTruthy();
});

test('cool-down can fill the remainder to an exact workout total', () => {
  const onAdd = jest.fn();
  const M = 1609.344;
  const screen = render(
    <ThemeProvider preference="dark">
      <WorkoutBuilder
        onAdd={onAdd}
        onClose={jest.fn()}
        easyBaseline={480}
        submitLabel="Apply changes"
        initialWorkout={{
          type: 'quality',
          title: 'Quality Run',
          distanceMeters: 14 * M,
          durationSeconds: null,
          structure: [
            { kind: 'warmup', target: { by: ['distance', 'pace'], distance_m: 2 * M, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
            { kind: 'repeat', sets: 5, children: [
              { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 2 * M, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
              { kind: 'recovery', target: { by: 'time', duration_s: 90, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
            ] },
            { kind: 'cooldown', target: { by: ['distance', 'pace'], distance_m: M, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
          ],
        }}
      />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByRole('button', { name: /Edit Cool-down, 1 mi, Easy/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Finish workout at total distance' }));
  fireEvent.changeText(screen.getByLabelText('Workout total in miles'), '17');
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);
  fireEvent.press(screen.getByRole('button', { name: 'Apply changes' }));

  const edited = onAdd.mock.calls[0]![0];
  expect((edited.structure[2] as { target: { distance_m: number } }).target.distance_m).toBeCloseTo(4 * M, -1);
  expect(edited.distanceMeters).toBeCloseTo(17 * M, -1);
});

test('distance input can author an exact meter-based block', () => {
  const screen = renderBuilder();
  fireEvent.press(screen.getByRole('tab', { name: 'Quality workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Build a custom workout' }));
  fireEvent.press(screen.getByRole('button', { name: /Edit Warm-up/ }));

  fireEvent.press(screen.getByRole('radio', { name: 'Use meters' }));
  fireEvent.changeText(screen.getByLabelText('Step distance in meters'), '3200');
  fireEvent.press(screen.getAllByRole('button', { name: 'Close step editor' })[0]!);

  expect(screen.getByRole('button', { name: /Edit Warm-up, 3200 m, Easy/ })).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Review workout' }));
  fireEvent.press(screen.getByRole('button', { name: 'Add workout' }));
  expect(screen.onAdd.mock.calls[0]![0].structure[0].target.distance_m).toBe(3200);
});

test('edit mode preserves an exact total when time-based leaves are unchanged', () => {
  const onAdd = jest.fn();
  const M = 1609.344;
  const screen = render(
    <ThemeProvider preference="dark">
      <WorkoutBuilder
        onAdd={onAdd}
        onClose={jest.fn()}
        easyBaseline={480}
        submitLabel="Apply changes"
        initialWorkout={{
          type: 'quality',
          title: 'Quality Run',
          distanceMeters: 14 * M,
          durationSeconds: null,
          structure: [
            { kind: 'warmup', target: { by: ['distance', 'pace'], distance_m: 2 * M, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
            { kind: 'repeat', sets: 5, children: [
              { kind: 'work', target: { by: ['distance', 'pace'], distance_m: 2 * M, pace: { kind: 'relative', reference: 'threshold', speed_fraction: 1 } } },
              { kind: 'recovery', target: { by: 'time', duration_s: 90, pace: { kind: 'relative', reference: 'recovery', speed_fraction: 1 } } },
            ] },
            { kind: 'cooldown', target: { by: ['distance', 'pace'], distance_m: M, pace: { kind: 'relative', reference: 'easy', speed_fraction: 1 } } },
          ],
        }}
      />
    </ThemeProvider>,
  );

  fireEvent.press(screen.getByRole('button', { name: 'Apply changes' }));
  expect(onAdd.mock.calls[0]![0].distanceMeters).toBeCloseTo(14 * M, -1);
});
