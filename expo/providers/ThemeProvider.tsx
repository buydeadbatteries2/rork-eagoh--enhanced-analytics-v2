import { palette } from "@/constants/colors";

/**
 * ThemeProvider — always returns the dark cybernetic EAGOH palette.
 * Light/dark mode toggle has been removed; the app uses one consistent dark theme.
 */

export type ThemePalette = typeof palette;

export function useAppTheme() {
  return { palette };
}

export function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
