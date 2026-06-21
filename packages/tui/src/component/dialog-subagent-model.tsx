import { createMemo, createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { pipe, flatMap, entries, filter, sortBy, map } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { createDialogProviderOptions, DialogProvider } from "./dialog-provider"
import * as fuzzysort from "fuzzysort"
import { useSync } from "../context/sync"
import { useConnected } from "./use-connected"

export function DialogSubagentModel() {
  const local = useLocal()
  const sync = useSync()
  const dialog = useDialog()
  const [query, setQuery] = createSignal("")

  const connected = useConnected()
  const providers = createDialogProviderOptions()

  const options = createMemo(() => {
    const needle = query().trim()

    const clearOption = {
      key: "clear" as const,
      value: undefined as { providerID: string; modelID: string } | undefined,
      title: "Use parent model",
      description: "Clear subagent model override",
      category: "Actions",
      onSelect: () => {
        local.subagent.clear()
        dialog.clear()
      },
    }

    const currentSubagent = local.subagent.current()

    const providerOptions = pipe(
      sync.data.provider,
      sortBy(
        (provider) => provider.id !== "opencode",
        (provider) => provider.name,
      ),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          map(([model, info]) => ({
            value: { providerID: provider.id, modelID: model },
            title: info.name ?? model,
            description:
              currentSubagent?.providerID === provider.id && currentSubagent?.modelID === model
                ? "(Current)"
                : undefined,
            category: connected() ? provider.name : undefined,
            disabled: provider.id === "opencode" && model.includes("-nano"),
            footer: info.cost?.input === 0 && provider.id === "opencode" ? "Free" : undefined,
            onSelect() {
              onSelect(provider.id, model)
            },
          })),
        ),
      ),
    )

    const popularProviders = !connected()
      ? pipe(
          providers(),
          map((option) => ({
            ...option,
            category: "Popular providers",
          })),
        )
      : []

    if (needle) {
      return [
        clearOption,
        ...fuzzysort.go(needle, providerOptions, { keys: ["title", "category"] }).map((x) => x.obj),
        ...fuzzysort.go(needle, popularProviders, { keys: ["title"] }).map((x) => x.obj),
      ]
    }

    return [clearOption, ...providerOptions, ...popularProviders]
  })

  function onSelect(providerID: string, modelID: string) {
    local.subagent.set({ providerID, modelID })
    dialog.clear()
  }

  return (
    <DialogSelect<ReturnType<typeof options>[number]["value"]>
      options={options()}
      actions={[
        {
          command: "subagent.dialog.provider",
          title: connected() ? "Connect provider" : "View all providers",
          onTrigger() {
            dialog.replace(() => <DialogProvider />)
          },
        },
      ]}
      current={local.subagent.current()}
      onFilter={setQuery}
      flat={true}
      skipFilter={true}
      title="Select subagent model"
    />
  )
}
