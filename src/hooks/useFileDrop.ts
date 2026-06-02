import { useRef, useState, type DragEvent as ReactDragEvent } from "react";

interface UseFileDropOptions {
  disabled: boolean;
  onFile: (file: File) => void;
}

export function useFileDrop({ disabled, onFile }: UseFileDropOptions) {
  const dragDepthRef = useRef(0);
  const [isFileDragActive, setIsFileDragActive] = useState(false);

  function resetFileDrag() {
    dragDepthRef.current = 0;
    setIsFileDragActive(false);
  }

  function onDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsFileDragActive(true);
  }

  function onDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
    setIsFileDragActive(true);
  }

  function onDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsFileDragActive(false);
    }
  }

  function onDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resetFileDrag();

    if (disabled) {
      return;
    }

    const file = event.dataTransfer.files[0];
    if (file) {
      onFile(file);
    }
  }

  return {
    isFileDragActive,
    dragHandlers: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  };
}

function hasDraggedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes("Files");
}
