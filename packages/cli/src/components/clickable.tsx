import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRenderer } from "@opentui/react";

type Props = {
  onClick: () => void;
  disabled?: boolean;
  // Receives whether the pointer is over an enabled target, for hover styling
  children: (hovered: boolean) => ReactNode;
};

export function Clickable({ onClick, disabled = false, children }: Props) {
  const renderer = useRenderer();
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);

  const setPointer = (isOver: boolean) => {
    hoveredRef.current = isOver;
    setHovered(isOver);
    renderer.setMousePointer(isOver && !disabled ? "pointer" : "default");
  };

  // Clicking often opens a dialog or navigates, unmounting this before the
  // pointer leaves it, which would otherwise strand the hand cursor
  useEffect(() => {
    return () => {
      if (hoveredRef.current) renderer.setMousePointer("default");
    };
  }, [renderer]);

  return (
    <box
      flexDirection="row"
      gap={1}
      onMouseOver={() => setPointer(true)}
      onMouseOut={() => setPointer(false)}
      onMouseDown={(event) => {
        if (disabled) return;
        event.stopPropagation();
        onClick();
      }}
    >
      {children(hovered && !disabled)}
    </box>
  );
};
