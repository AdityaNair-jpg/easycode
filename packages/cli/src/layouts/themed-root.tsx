import type { ReactNode } from "react";
import { useTheme } from "../providers/theme";
import { useCopyOnSelect } from "../hooks/use-copy-on-select";
import { useRuntimeWarnings } from "../hooks/use-runtime-warnings";

type Props = {
  children: ReactNode;
};

export function ThemedRoot({ children }: Props) {
  const { colors } = useTheme();
  useCopyOnSelect();
  useRuntimeWarnings();

  return (
    <box 
      backgroundColor={colors.background} 
      width="100%" 
      height="100%" 
      flexGrow={1}
    >
      {children}
    </box>
  );
};