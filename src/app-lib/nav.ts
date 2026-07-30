import type { useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/**
 * Close a pushed/modal screen: pop when there's history, else land on the
 * Dash. A cold deep link (e.g. duerunning://run/<id>) mounts the screen as the
 * stack ROOT, where a bare router.back() has nothing to pop and react-
 * navigation raises "GO_BACK was not handled by any navigator".
 */
export function closeScreen(router: Router): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
