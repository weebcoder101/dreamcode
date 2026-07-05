import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import { batch, createContext, createEffect, onCleanup, Show, useContext, type JSX, type ParentProps } from "solid-js"
import { useTheme } from "../context/theme"
import { MouseButton, Renderable, RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { useToast } from "./toast"
import { Flag } from "@opencode-ai/core/flag/flag"
import { useBindings, useOpencodeModeStack } from "../keymap"
import { useClipboard } from "../context/clipboard"
import { hasTextSelection } from "../util/selection"

export function Dialog(
  props: ParentProps<{
    size?: "medium" | "large" | "xlarge"
    onClose: () => void
  }>,
) {
  const dimensions = useTerminalDimensions()
  const { theme } = useTheme()
  const renderer = useRenderer()

  let dismiss = false
  const width = () => {
    if (props.size === "xlarge") return 116
    if (props.size === "large") return 88
    return 60
  }

  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection()
        // If the selection references only destroyed renderables (stale),
        // getSelectedText() returns "". Clear it immediately so dismiss
        // can proceed in a single click.
        if (dismiss && !hasTextSelection(renderer)) {
          renderer.clearSelection()
          dismiss = false
        }
      }}
      onMouseUp={(e: { stopPropagation(): void }) => {
        e.stopPropagation()
        if (dismiss) {
          renderer.clearSelection()
          dismiss = false
          return
        }
        props.onClose?.()
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      position="absolute"
      zIndex={3000}
      paddingTop={dimensions().height / 4}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e: { stopPropagation(): void }) => {
          dismiss = false
          e.stopPropagation()
        }}
        width={width()}
        maxWidth={dimensions().width - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  )
}

function init() {
  const [store, setStore] = createStore({
    stack: [] as {
      element: JSX.Element
      onClose?: () => void
    }[],
    size: "medium" as "medium" | "large" | "xlarge",
  })

  const renderer = useRenderer()
  const modeStack = useOpencodeModeStack()

  createEffect(() => {
    if (store.stack.length === 0) return
    const popMode = modeStack.push("modal")
    onCleanup(popMode)
  })

  let focus: Renderable | null
  let clearing = false
  function refocus() {
    setTimeout(() => {
      if (!focus) return
      if (focus.isDestroyed) return
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true
          if (find(child)) return true
        }
        return false
      }
      const found = find(renderer.root)
      if (!found) return
      focus.focus()
    }, 1)
  }

  useBindings(() => ({
    // Esc ALWAYS dismisses the dialog — selection management is the
    // responsibility of handleSelectionKey (app.tsx) and mouse handlers.
    enabled: store.stack.length > 0,
    bindings: [
      {
        key: "escape",
        desc: "Close dialog",
        group: "Dialog",
        cmd: () => {
          // Clear any stale selection so subsequent interactions work.
          renderer.clearSelection()
          const current = store.stack.at(-1)
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
      {
        key: "ctrl+c",
        desc: "Close dialog",
        group: "Dialog",
        cmd: () => {
          // Clear any stale selection so subsequent interactions work.
          renderer.clearSelection()
          const current = store.stack.at(-1)
          current?.onClose?.()
          setStore("stack", store.stack.slice(0, -1))
          refocus()
        },
      },
    ],
  }))

  return {
    clear() {
      // Prevent re-entrant clear() — the overlay's onClose and a content
      // handler (e.g. dialog-select option's onSelect) can both call clear()
      // in the same event chain. Without this guard, the inner box with
      // stopPropagation is destroyed while the mouseup event is still
      // propagating, which can leave a stale selection on the renderer and
      // block subsequent clicks (InlineToolRow guard at index.tsx:1903).
      if (clearing) return
      clearing = true
      try {
        // Clear any stale selection first — destroyed dialog nodes leave the
        // Selection object with references to dead renderables, whose
        // getSelectedText() still returns cached text. This permanently blocks
        // the InlineToolRow guard (session/index.tsx:1903) on every future
        // mouse interaction until another selection event clears it naturally.
        renderer.clearSelection()
        for (const item of store.stack) {
          if (item.onClose) item.onClose()
        }
        batch(() => {
          setStore("size", "medium")
          setStore("stack", [])
        })
        refocus()
      } finally {
        clearing = false
      }
    },
    replace(input: any, onClose?: () => void) {
      // Prevent re-entrant replace() — if this fires while clear() is
      // running (e.g. from an onClose callback), the batch in clear()
      // would overwrite the stack with [] and discard the new content.
      if (clearing) return
      // Clear selection before replacing — old dialog content is destroyed
      // and any selection referencing it would become stale.
      renderer.clearSelection()
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable
        focus?.blur()
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose()
      }
      setStore("size", "medium")
      setStore("stack", [
        {
          element: input,
          onClose,
        },
      ])
    },
    get clearing() {
      return clearing
    },
    get stack() {
      return store.stack
    },
    get size() {
      return store.size
    },
    setSize(size: "medium" | "large" | "xlarge") {
      setStore("size", size)
    },
  }
}

export type DialogContext = ReturnType<typeof init> & { readonly clearing: boolean }

const ctx = createContext<DialogContext>()

export function DialogProvider(props: ParentProps) {
  const value = init()
  const renderer = useRenderer()
  const toast = useToast()
  const clipboard = useClipboard()

  function copySelection() {
    // Skip copy if dialog is mid-clear — the render tree may be in an
    // inconsistent state and getSelection() could reference destroyed nodes.
    if (value.clearing) return false
    const text = renderer.getSelection()?.getSelectedText()
    if (!text || !clipboard.write) return false
    void clipboard.write(text).then(
      () => toast.show({ message: "Copied to clipboard", variant: "info" }),
      (error) => toast.error(error),
    )
    renderer.clearSelection()
    return true
  }

  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        zIndex={3000}
        onMouseDown={(evt: { button: number; preventDefault(): void; stopPropagation(): void }) => {
          if (!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
          if (evt.button !== MouseButton.RIGHT) return

          if (!copySelection()) return
          evt.preventDefault()
          evt.stopPropagation()
        }}
        onMouseUp={!Flag.OPENCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT ? () => {
          // Skip copy selection while dialog is clearing or already gone
          if (value.clearing || value.stack.length === 0) return
          copySelection()
        } : undefined}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size}>
            {value.stack.at(-1)!.element}
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  )
}

export function useDialog() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  return value
}
