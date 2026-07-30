export interface EdgeInsetsLike {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * A native modal can briefly report zero insets while its presentation root is
 * attaching. Keep the live values authoritative, but never regress below the
 * launch-window metrics on this portrait-only app's first frame.
 */
export function resolveModalSafeInsets(
  live: EdgeInsetsLike,
  launch?: EdgeInsetsLike | null,
): EdgeInsetsLike {
  return {
    top: Math.max(live.top, launch?.top ?? 0),
    right: Math.max(live.right, launch?.right ?? 0),
    bottom: Math.max(live.bottom, launch?.bottom ?? 0),
    left: Math.max(live.left, launch?.left ?? 0),
  };
}
