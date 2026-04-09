/**
 * Tiny EventSource wrapper. The deskcheck server emits an untyped
 * `{"type":"update"}` event whenever plan.json or results.json changes on
 * disk; consumers refetch on each notification.
 */
export function useSse(url: string, onMessage: () => void) {
  let es: EventSource | null = null

  function connect() {
    if (es) return
    es = new EventSource(url)
    es.onmessage = () => onMessage()
    es.onerror = () => {
      // EventSource auto-reconnects. Nothing to do.
    }
  }

  function disconnect() {
    es?.close()
    es = null
  }

  return { connect, disconnect }
}
