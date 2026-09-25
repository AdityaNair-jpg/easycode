import { SUPPORTED_CHAT_MODELS, type SupportedChatModelId } from "@easycode/shared";
import type { DialogContextValue } from "../../providers/dialog";
import { CwdDialogContent } from "./cwd-dialog";
import { ModelsDialogContent } from "./models-dialog";

// Shared by the slash commands and the clickable status bar, so both open
// the same dialog the same way.

export function openModelsDialog(
  dialog: DialogContextValue,
  onSelectModel: (modelId: SupportedChatModelId) => void,
) {
  dialog.open({
    title: "Select Model",
    children: (
      <ModelsDialogContent
        models={SUPPORTED_CHAT_MODELS.map((model) => model.id)}
        onSelectModel={onSelectModel}
      />
    ),
  });
};

export function openCwdDialog(dialog: DialogContextValue) {
  dialog.open({
    title: "Project Folder",
    children: <CwdDialogContent />,
  });
};
