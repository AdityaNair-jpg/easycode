import { useEffect } from "react";
import { useToast } from "../providers/toast";

// Before bun 1.3, raw mode on Windows leaves the console without virtual
// terminal input, so Windows Terminal never forwards mouse events and
// scrolling and clicking silently do nothing. Say so instead.
const MIN_BUN_FOR_WINDOWS_MOUSE = "1.3.0";

export function useRuntimeWarnings() {
  const { show } = useToast();

  useEffect(() => {
    if (process.platform !== "win32") return;
    if (Bun.semver.order(Bun.version, MIN_BUN_FOR_WINDOWS_MOUSE) >= 0) return;

    show({
      variant: "error",
      message: `Mouse input needs bun ${MIN_BUN_FOR_WINDOWS_MOUSE}+ (running ${Bun.version}). Run: npm install -g bun@latest`,
      duration: 12_000,
    });
  }, [show]);
};
