import { marked } from 'marked'

export function useMarkdown() {
  function render(text: string): string {
    return marked.parse(text, { async: false }) as string
  }

  return { render }
}
