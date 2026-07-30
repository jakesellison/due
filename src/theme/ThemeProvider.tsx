import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEMES, type Tokens, type ThemeName } from './tokens';

/**
 * Runtime theming. The active theme = the OS colour scheme, unless the user has
 * pinned a preference (persisted to AsyncStorage and editable from the You hub).
 *
 * The optional `preference` prop is a CONTROLLED override: when provided the
 * provider uses it verbatim and skips persistence (used by tests and any caller
 * that wants a fixed theme). When omitted, the provider loads the persisted
 * preference (default 'system') and exposes `useThemePreference()` to change it.
 *
 * Components read `useTheme()` for the active Tokens and build styles via
 * `useThemedStyles(makeStyles)` — replacing every static `StyleSheet.create`.
 */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORE_KEY = 'mileage.themePreference';

interface ThemeCtx {
  tokens: Tokens;
  scheme: ThemeName;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({
  preference,
  children,
}: {
  preference?: ThemePreference;
  children: ReactNode;
}) {
  const os = useColorScheme();
  const controlled = preference != null;
  const [stored, setStored] = useState<ThemePreference>('system');

  // Load the persisted preference once (uncontrolled mode only).
  useEffect(() => {
    if (controlled) return;
    let active = true;
    AsyncStorage.getItem(STORE_KEY)
      .then((v) => {
        if (active && (v === 'system' || v === 'light' || v === 'dark')) setStored(v);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [controlled]);

  const setPreference = useCallback((p: ThemePreference) => {
    setStored(p);
    AsyncStorage.setItem(STORE_KEY, p).catch(() => undefined);
  }, []);

  const active = controlled ? preference : stored;
  const scheme: ThemeName = active === 'system' ? (os === 'light' ? 'light' : 'dark') : active;
  const value = useMemo<ThemeCtx>(
    () => ({ tokens: THEMES[scheme], scheme, preference: active, setPreference }),
    [scheme, active, setPreference],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useCtx(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within a ThemeProvider');
  return c;
}

export function useTheme(): Tokens {
  return useCtx().tokens;
}
export function useScheme(): ThemeName {
  return useCtx().scheme;
}

/** The active theme preference + a setter that persists it. */
export function useThemePreference(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const { preference, setPreference } = useCtx();
  return { preference, setPreference };
}

/** Build (and memoize per active theme) a StyleSheet from the current tokens. */
export function useThemedStyles<T>(make: (C: Tokens) => T): T {
  const { tokens } = useCtx();
  return useMemo(() => make(tokens), [tokens, make]);
}
