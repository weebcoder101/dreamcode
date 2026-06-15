const locks = new Map<string, Promise<void>>()

async function acquire(key: string): Promise<Disposable> {
  while (true) {
    const current = locks.get(key)
    if (!current) {
      let resolve: () => void
      const promise = new Promise<void>((r) => { resolve = r })
      locks.set(key, promise)
      return {
        [Symbol.dispose]: () => {
          resolve!()
          locks.delete(key)
        },
      }
    }
    await current
  }
}

export const Lock = {
  write: (key: string): Promise<Disposable> => acquire(key),
}
