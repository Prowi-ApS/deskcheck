export function useSse(url: string, onUpdate: () => void) {
  let es: EventSource | null = null

  function connect() {
    es = new EventSource(url)
    es.onmessage = () => onUpdate()
    es.onerror = () => {
      /* EventSource auto-reconnects */
    }
  }

  function disconnect() {
    es?.close()
    es = null
  }

  return { connect, disconnect }
}
