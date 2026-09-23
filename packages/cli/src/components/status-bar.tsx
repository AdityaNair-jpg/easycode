import { basename } from "node:path";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../providers/theme";
import { usePromptConfig } from "../providers/prompt-config";
import { useDialog } from "../providers/dialog";
import { Mode } from "@easycode/database/enums";
import { Clickable } from "./clickable";
import { openCwdDialog, openModelsDialog } from "./dialogs";

type Props = {
  // Mirrors the keyboard, which ignores Tab while a reply is streaming
  disabled?: boolean;
};

function hoverAttributes(hovered: boolean) {
  return hovered ? TextAttributes.UNDERLINE : 0;
}

export function StatusBar({ disabled = false }: Props) {
  const { mode, model, toggleMode, setModel } = usePromptConfig();
  const { colors } = useTheme();
  const dialog = useDialog();

  return (
    <box flexDirection="row" gap={1}>

      <Clickable onClick={toggleMode} disabled={disabled}>
        {(hovered) => (
          <text
            selectable={false}
            attributes={hoverAttributes(hovered)}
            fg={mode === Mode.PLAN ? colors.planMode : colors.primary}
          >
            {mode === Mode.PLAN ? "Plan" : "Build"}
          </text>
        )}
      </Clickable>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        ›
      </text>
      <Clickable onClick={() => openModelsDialog(dialog, setModel)} disabled={disabled}>
        {(hovered) => (
          <text selectable={false} attributes={hoverAttributes(hovered)}>
            {model}
          </text>
        )}
      </Clickable>

      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        ›
      </text>
      <Clickable onClick={() => openCwdDialog(dialog)} disabled={disabled}>
        {(hovered) => (
          <text selectable={false} attributes={TextAttributes.DIM | hoverAttributes(hovered)}>
            {basename(process.cwd())}
          </text>
        )}
      </Clickable>
    </box>
  );
};
