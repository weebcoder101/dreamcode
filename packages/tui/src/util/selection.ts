/**
 * ========================================================
 * IMPORTANT: Stale Selection Contract
 * ========================================================
 *
 * The renderer (@opentui/core) maintains a Selection object that can outlive
 * the renderable nodes it references. When renderables are destroyed (e.g.
 * during dialog.clear()), getSelection() STILL returns the Selection object,
 * but getSelectedText() on the destroyed nodes returns "" because the text
 * extraction walks a now-empty tree.
 *
 * This means:
 *   - getSelection() !== null  DOES NOT mean there is valid selected text
 *   - getSelectedText() === "" CAN indicate a stale selection
 *   - Callers MUST NOT treat "selection exists" as a binary dismiss guard
 *   - Callers MUST treat empty-text selections as stale and clear them
 *
 * The functions in this file handle this correctly. External callers should
 * use hasTextSelection() and clearStaleSelection() rather than calling
 * getSelection() directly.
 * ========================================================
 */

import type { ClipboardService } from "../context/clipboard"

/** Standardized selection guard result: true = handler should return (text selected) */
export function hasTextSelection(renderer: Renderer): boolean {
  const sel = renderer.getSelection()
  if (!sel) return false
  const text = sel.getSelectedText()
  if (!text) {
    // Stale selection: object exists but all referenced nodes are destroyed.
    // Clear it so downstream guards see getSelection() === null.
    renderer.clearSelection()
    return false
  }
  return true
}

/**
 * Proactively clear any stale selection at the outermost event boundary.
 * Returns true if a stale selection was found and cleared.
 *
 * Call this ONCE at the root of an event handler before any per-component
 * selective handlers run. This eliminates the need for individual call sites
 * to reason about stale selection — they simply see getSelection() === null.
 */
export function clearStaleSelection(renderer: Renderer): boolean {
  const sel = renderer.getSelection()
  if (!sel) return false
  const text = sel.getSelectedText()
  if (text) return false
  renderer.clearSelection()
  return true
}

type Toast = {
  show: (input: { message: string; variant: "info" | "success" | "warning" | "error" }) => void
  error: (err: unknown) => void
}

type FocusableSelectionTarget = {
  hasSelection: () => boolean
  getClipboardText?: (text: string) => string
}

type Renderer = {
  getSelection: () => { getSelectedText: () => string; selectedRenderables: FocusableSelectionTarget[] } | null
  clearSelection: () => void
  currentFocusedRenderable?: FocusableSelectionTarget | null
}

type SelectionKeyEvent = {
  ctrl?: boolean
  name: string
  preventDefault: () => void
  stopPropagation: () => void
}

export function copy(renderer: Renderer, toast: Toast, clipboard: ClipboardService): boolean {
  const selection = renderer.getSelection()
  if (!selection) return false

  const text = selection.getSelectedText()
  if (!text) return false

  const focus = renderer.currentFocusedRenderable
  const clipboardText =
    focus?.getClipboardText && selection.selectedRenderables.includes(focus) ? focus.getClipboardText(text) : text

  clipboard
    ?.write?.(clipboardText)
    .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
    .catch(toast.error)

  renderer.clearSelection()
  return true
}

export function handleSelectionKey(
  renderer: Renderer,
  toast: Toast,
  event: SelectionKeyEvent,
  clipboard: ClipboardService,
) {
  const selection = renderer.getSelection()
  if (!selection) return

  if (event.ctrl && event.name === "c") {
    if (!copy(renderer, toast, clipboard)) {
      renderer.clearSelection()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    return
  }

  if (event.name === "escape") {
    renderer.clearSelection()
    event.preventDefault()
    event.stopPropagation()
    return
  }

  const focus = renderer.currentFocusedRenderable
  if (focus?.hasSelection() && selection.selectedRenderables.includes(focus)) return

  renderer.clearSelection()
}

export * as Selection from "./selection"
