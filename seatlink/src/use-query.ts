import { useEffect, useState } from 'react'

type Result<T> = { data: T } | { error: true }

export function useQuery<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [attempt, setAttempt] = useState(0)
  const [settled, setSettled] = useState<{ attempt: number; load: typeof load; result: Result<T> }>()

  useEffect(() => {
    const controller = new AbortController()
    const finish = (result: Result<T>) => {
      if (!controller.signal.aborted) setSettled({ attempt, load, result })
    }

    void load(controller.signal).then(
      (data) => finish({ data }),
      () => finish({ error: true }),
    )
    return () => controller.abort()
  }, [attempt, load])

  return {
    result: settled?.attempt === attempt && settled.load === load ? settled.result : undefined,
    retry: () => setAttempt((previous) => previous + 1),
  }
}
