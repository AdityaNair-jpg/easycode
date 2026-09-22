import { useEffect, useState } from "react";
import { Mode } from "@easycode/database/enums";
import { useTheme } from "../providers/theme";

// The "aesthetic" set from cli-spinners, as opentui-spinner rendered it.
// Drawn locally because opentui-spinner pins its own @opentui/core, and two
// copies of core crash at startup.
const FRAMES = [
  "▰▱▱▱▱▱▱",
  "▰▰▱▱▱▱▱",
  "▰▰▰▱▱▱▱",
  "▰▰▰▰▱▱▱",
  "▰▰▰▰▰▱▱",
  "▰▰▰▰▰▰▱",
  "▰▰▰▰▰▰▰",
  "▰▱▱▱▱▱▱",
];
const FRAME_INTERVAL_MS = 80;

type Props = {
  mode ?: Mode;
};

export function Spinner({ mode = Mode.BUILD }: Props) {
  const { colors } = useTheme();
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % FRAMES.length);
    }, FRAME_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const activeColor = mode === Mode.PLAN ? colors.planMode : colors.primary;

  return <text fg={activeColor}>{FRAMES[frame]}</text>;
};
