import { SyntaxStyle } from "@opentui/core";
import type { ThemeColors } from "../theme";

// Styles the markdown renderer looks up by name. A dotted name only falls
// back to its first segment, so every markup.* name is registered explicitly,
// while tree-sitter captures in code blocks (function.method,
// keyword.operator, ...) resolve through their base name.
export function createSyntaxStyle(colors: ThemeColors): SyntaxStyle {
  const heading = { fg: colors.primary, bold: true };

  return SyntaxStyle.fromStyles({
    // Headings are captured per level, and markup.heading.N would otherwise
    // fall back to "markup" rather than "markup.heading"
    "markup.heading": heading,
    "markup.heading.1": heading,
    "markup.heading.2": heading,
    "markup.heading.3": heading,
    "markup.heading.4": heading,
    "markup.heading.5": heading,
    "markup.heading.6": heading,
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.strikethrough": { dim: true },
    "markup.quote": { fg: colors.dimSeparator, italic: true },
    "markup.list": { fg: colors.primary },
    "markup.list.checked": { fg: colors.success },
    "markup.list.unchecked": { fg: colors.dimSeparator },
    "markup.raw": { fg: colors.info },
    "markup.link": { fg: colors.info, underline: true },
    "markup.link.label": { fg: colors.info, underline: true },
    "markup.link.url": { fg: colors.dimSeparator },
    "markup.link.bracket.close": { fg: colors.dimSeparator },

    keyword: { fg: colors.planMode },
    string: { fg: colors.success },
    comment: { fg: colors.dimSeparator, italic: true },
    function: { fg: colors.primary },
    constructor: { fg: colors.info },
    type: { fg: colors.info },
    number: { fg: colors.error },
    constant: { fg: colors.error },
    boolean: { fg: colors.error },
    operator: { fg: colors.dimSeparator },
    punctuation: { fg: colors.dimSeparator },
  });
};
