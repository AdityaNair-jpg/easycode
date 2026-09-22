import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import type { SyntaxStyle } from "@opentui/core";
import type { ThemeColors, Theme } from "../../theme";
import { DEFAULT_THEME, THEMES } from "../../theme";
import { createSyntaxStyle } from "../../lib/syntax-style";

const CONFIG_DIR = join(homedir(), ".easycode");
const THEME_PREFERENCES_PATH = join(CONFIG_DIR, "preferences.json");

type ThemePreferences = {
  themeName: string;
};

function getInitialTheme(): Theme {
  try {
    const preferences = JSON.parse(
      readFileSync(THEME_PREFERENCES_PATH, "utf8"),
    ) as Partial<ThemePreferences>;
    const savedTheme = THEMES.find((theme) => theme.name === preferences.themeName);
    return savedTheme ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

function persistTheme(theme: Theme) {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(
      THEME_PREFERENCES_PATH,
      JSON.stringify({ themeName: theme.name } satisfies ThemePreferences, null, 2),
      "utf8",
    );
  } catch {
    // Ignore preference write failures so theme switching still works for this session.
  }
};

type ThemeContextValue = {
  colors: ThemeColors;
  syntaxStyle: SyntaxStyle;
  currentTheme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return value;
}

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getInitialTheme);

  const setTheme = useCallback((theme: Theme) => {
    setCurrentTheme(theme);
    persistTheme(theme);
  }, []);

  // One style per theme, shared by every markdown block. It wraps a native
  // handle, so the previous one is freed once the new theme has rendered.
  const syntaxStyle = useMemo(() => createSyntaxStyle(currentTheme.colors), [currentTheme]);
  useEffect(() => () => syntaxStyle.destroy(), [syntaxStyle]);

  return (
    <ThemeContext.Provider 
      value={{ colors: currentTheme.colors, syntaxStyle, currentTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
