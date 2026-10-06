export function manageModalFocus(dialog, onClose) {
  const previousFocus = document.activeElement;
  const controls = () => [...dialog.querySelectorAll('button:not([disabled]), a[href], iframe, input:not([disabled]), [tabindex="0"]')];
  controls()[0]?.focus();
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    } else if (event.key === "Tab") {
      const elements = controls();
      const first = elements[0], last = elements.at(-1);
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("keydown", onKeyDown, true);
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
  };
}
