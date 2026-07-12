import { useEffect, useState } from 'react'

/** Keeps a component mounted through its exit transition instead of unmounting
 * the instant `isOpen` flips false — apply the returned `closing` flag as a CSS
 * class that plays the reverse of the mount animation. */
export function useDelayedUnmount(isOpen: boolean, durationMs: number) {
  const [shouldRender, setShouldRender] = useState(isOpen)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true)
      setClosing(false)
      return
    }
    if (!shouldRender) return
    setClosing(true)
    const timer = setTimeout(() => {
      setShouldRender(false)
      setClosing(false)
    }, durationMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  return { shouldRender, closing }
}
