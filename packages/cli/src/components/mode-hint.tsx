import { TextAttributes } from "@opentui/core";
import { usePromptConfig } from "../providers/prompt-config";
import { Clickable } from "./clickable";

type Props = {
  // Mirrors the keyboard, which ignores Tab while a reply is streaming
  disabled?: boolean;
};

// The "tab agents" hint, which also switches mode when clicked
export function ModeHint({ disabled = false }: Props) {
  const { toggleMode } = usePromptConfig();

  return (
    <box flexShrink={0} marginLeft="auto">
      <Clickable onClick={toggleMode} disabled={disabled}>
        {(hovered) => {
          const underline = hovered ? TextAttributes.UNDERLINE : 0;
          return (
            <>
              <text selectable={false} attributes={underline}>tab</text>
              <text selectable={false} attributes={TextAttributes.DIM | underline}>agents</text>
            </>
          );
        }}
      </Clickable>
    </box>
  );
};
