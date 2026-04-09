import { onMounted, onUnmounted } from 'vue'
import { useSse } from './useSse'
import type { UseRun } from './useRun'

/**
 * Connect a `useRun` instance to the deskcheck SSE stream so it refetches
 * the merged run endpoint whenever the server detects a file change. Calls
 * `refresh()` once on mount, then on every notification.
 *
 * Used by V1/V2/V3 — V0 (run list) does its own polling instead since the
 * dashboard isn't tied to a single plan id.
 */
export function useRunSse(planId: string, run: UseRun): void {
  const { connect, disconnect } = useSse(
    `/api/events/${encodeURIComponent(planId)}`,
    () => {
      void run.refresh()
    },
  )

  onMounted(() => {
    void run.refresh()
    connect()
  })

  onUnmounted(() => {
    disconnect()
  })
}
