import { useState, useCallback, useRef } from 'react'

export function useMutation<TArgs, TResult = void>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  const mutate = useCallback(async (args: TArgs): Promise<TResult | null> => {
    setLoading(true)
    setError(null)
    try {
      return await fnRef.current(args)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => setError(null), [])

  return { mutate, loading, error, reset }
}
