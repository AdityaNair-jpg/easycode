import { useEffect } from "react";
import { useRenderer } from "@opentui/react";
import {
  createClipboard,
  createHostClipboard,
  createRendererClipboardAdapter,
  type Selection,
} from "@opentui/core";
import { useToast } from "../providers/toast";

// The app captures the mouse, so the terminal's own selection can't copy
// anything. Copy whatever is selected once the drag ends instead.
export function useCopyOnSelect() {
  const renderer = useRenderer();
  const { show } = useToast();

  useEffect(() => {
    // "best-available" writes the OS clipboard locally and falls back to
    // OSC 52 through the terminal, which also reaches it over SSH
    const clipboard = createClipboard({
      host: createHostClipboard(),
      terminal: createRendererClipboardAdapter(renderer),
    });

    // Emitted once, when the mouse is released
    const handleSelection = async (selection: Selection | null) => {
      const text = selection?.getSelectedText() ?? "";
      if (text.trim() === "") return;

      try {
        const result = await clipboard.writeText(text, { destination: "best-available" });
        const copied =
          result.host.status === "written" || result.terminal.status === "attempted";

        show(
          copied
            ? { variant: "success", message: `Copied ${text.length} characters` }
            : { variant: "error", message: "Could not copy to the clipboard" },
        );
      } catch {
        show({ variant: "error", message: "Could not copy to the clipboard" });
      }
    };

    renderer.on("selection", handleSelection);

    return () => {
      renderer.off("selection", handleSelection);
      void clipboard.dispose();
    };
  }, [renderer, show]);
};
