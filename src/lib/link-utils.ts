import React from 'react'
import { cn } from '@/lib/utils'

export const URL_REGEX = /(https?:\/\/[^\s<>]+)/g

export function extractUrls(text: string): string[] {
  if (!text) return []
  const matches = text.match(URL_REGEX)
  return matches || []
}

export function renderTextWithLinks(
  text: string,
  isMe: boolean,
  isHighlighted?: boolean,
): React.ReactNode[] {
  if (!text) return []
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(
      React.createElement(
        'a',
        {
          key: `link-${match.index}`,
          href: match[0],
          target: '_blank',
          rel: 'noopener noreferrer',
          onClick: (e: React.MouseEvent) => e.stopPropagation(),
          className: cn(
            'underline break-all hover:opacity-80',
            isHighlighted ? '!text-blue-700 font-medium' : isMe ? 'text-blue-100' : 'text-blue-600',
          ),
        },
        match[0],
      ),
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}
