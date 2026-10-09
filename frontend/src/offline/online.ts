import { useSyncExternalStore } from 'react'

// Whether the browser thinks it has a connection. True only means it might: the API can still be out of reach, and
// a request failing is the real sign. False is reliable, so pages use it to say so before anything is tried.
export function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine
}

export function subscribeOnline(listener: () => void) {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, isOnline)
}
