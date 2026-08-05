import { abortReason } from './requestAbort'

interface SharedTask<T> {
  consumers: number
  controller: AbortController
  promise: Promise<T>
  retainedConsumers: number
  settled: boolean
}

export interface SharedResourceAcquireOptions<T> {
  force?: boolean
  load: (signal: AbortSignal) => Promise<T>
  retain?: boolean
  signal?: AbortSignal
}

export interface SharedResourceStoreOptions {
  completedLimit?: number
  deadline?: {
    error: () => unknown
    timeoutMs: number
  }
}

export interface SharedResourceStore<T> {
  acquire: (key: string, options: SharedResourceAcquireOptions<T>) => Promise<T>
  reset: (reason?: unknown) => void
  snapshot: () => { completed: number; pending: number }
}

export function createSharedResourceStore<T>(options: SharedResourceStoreOptions = {}): SharedResourceStore<T> {
  const completedLimit = options.completedLimit ?? 0
  const completed = new Map<string, T>()
  const pending = new Map<string, SharedTask<T>>()

  const remember = (key: string, value: T) => {
    if (completedLimit <= 0) {
      return
    }
    completed.delete(key)
    completed.set(key, value)
    while (completed.size > completedLimit) {
      const oldest = completed.keys().next().value as string | undefined
      if (oldest === undefined) {
        break
      }
      completed.delete(oldest)
    }
  }

  const readCompleted = (key: string): T | undefined => {
    const value = completed.get(key)
    if (value !== undefined) {
      completed.delete(key)
      completed.set(key, value)
    }
    return value
  }

  const release = (task: SharedTask<T>, retained: boolean, reason?: unknown) => {
    if (retained) {
      task.retainedConsumers -= 1
    } else {
      task.consumers -= 1
    }
    if (task.consumers !== 0 || task.retainedConsumers !== 0 || task.settled) {
      return
    }
    queueMicrotask(() => {
      if (
        task.consumers === 0
        && task.retainedConsumers === 0
        && !task.settled
        && !task.controller.signal.aborted
      ) {
        task.controller.abort(reason ?? new DOMException('No active data consumers remain.', 'AbortError'))
      }
    })
  }

  const consume = (task: SharedTask<T>, signal: AbortSignal | undefined, retained: boolean): Promise<T> => {
    if (signal?.aborted) {
      return Promise.reject(abortReason(signal))
    }
    if (retained) {
      task.retainedConsumers += 1
    } else {
      task.consumers += 1
    }
    return new Promise<T>((resolve, reject) => {
      let finished = false
      const finish = (callback: () => void) => {
        if (finished) {
          return
        }
        finished = true
        signal?.removeEventListener('abort', onAbort)
        release(task, retained)
        callback()
      }
      const onAbort = () => {
        const reason = abortReason(signal as AbortSignal)
        if (!finished) {
          finished = true
          signal?.removeEventListener('abort', onAbort)
          release(task, retained, reason)
          reject(reason)
        }
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      task.promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      )
    })
  }

  const createTask = (key: string, load: (signal: AbortSignal) => Promise<T>): SharedTask<T> => {
    const controller = new AbortController()
    const deadlineTimer = options.deadline
      ? globalThis.setTimeout(() => {
          if (!controller.signal.aborted) {
            controller.abort(options.deadline?.error())
          }
        }, options.deadline.timeoutMs)
      : null
    const task: SharedTask<T> = {
      consumers: 0,
      controller,
      promise: Promise.resolve(undefined as T),
      retainedConsumers: 0,
      settled: false,
    }
    let operation: Promise<T>
    try {
      operation = Promise.resolve(load(controller.signal))
    } catch (error) {
      operation = Promise.reject(error)
    }
    task.promise = operation
      .then((value) => {
        remember(key, value)
        return value
      })
      .finally(() => {
        if (deadlineTimer !== null) {
          globalThis.clearTimeout(deadlineTimer)
        }
        task.settled = true
        if (pending.get(key) === task) {
          pending.delete(key)
        }
      })
    pending.set(key, task)
    return task
  }

  return {
    acquire(key, acquireOptions) {
      if (acquireOptions.signal?.aborted) {
        return Promise.reject(abortReason(acquireOptions.signal))
      }
      const existing = pending.get(key)
      if (existing && !existing.controller.signal.aborted) {
        return consume(existing, acquireOptions.signal, Boolean(acquireOptions.retain))
      }
      const cached = readCompleted(key)
      if (cached !== undefined && !acquireOptions.force) {
        return Promise.resolve(cached)
      }
      const task = createTask(key, acquireOptions.load)
      return consume(task, acquireOptions.signal, Boolean(acquireOptions.retain))
    },
    reset(reason = new DOMException('Shared resource store reset.', 'AbortError')) {
      for (const task of pending.values()) {
        if (!task.settled && !task.controller.signal.aborted) {
          task.controller.abort(reason)
        }
      }
      pending.clear()
      completed.clear()
    },
    snapshot: () => ({ completed: completed.size, pending: pending.size }),
  }
}
