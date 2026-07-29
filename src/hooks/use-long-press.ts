import { useCallback, useRef, useState } from 'react'

interface UseLongPressOptions {
  onLongPress: (e: React.MouseEvent | React.TouchEvent) => void
  onClick?: (e: React.MouseEvent | React.TouchEvent) => void
  delay?: number
  moveTolerance?: number
}

export function useLongPress({
  onLongPress,
  onClick,
  delay = 400,
  moveTolerance = 8,
}: UseLongPressOptions) {
  const [isPressing, setIsPressing] = useState(false)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const longPressTriggered = useRef(false)

  const clear = useCallback(
    (e: React.MouseEvent | React.TouchEvent, shouldTriggerClick = true) => {
      if (timeout.current) {
        clearTimeout(timeout.current)
      }

      const target = e.target as HTMLElement
      const isIgnored =
        target &&
        typeof target.closest === 'function' &&
        (target.closest('[data-selection-toggle="true"]') ||
          target.closest('[data-task-marker="true"]'))

      if (shouldTriggerClick && !longPressTriggered.current && onClick && !isIgnored) {
        onClick(e)
      }
      startPos.current = null
      setIsPressing(false)
    },
    [onClick],
  )

  const handleStart = (clientX: number, clientY: number, e: any) => {
    startPos.current = { x: clientX, y: clientY }
    longPressTriggered.current = false
    setIsPressing(true)
    if (timeout.current) {
      clearTimeout(timeout.current)
    }
    timeout.current = setTimeout(() => {
      longPressTriggered.current = true
      onLongPress(e)
    }, delay)
  }

  const handleMove = (clientX: number, clientY: number) => {
    if (!startPos.current) return
    const dx = clientX - startPos.current.x
    const dy = clientY - startPos.current.y
    if (Math.sqrt(dx * dx + dy * dy) > moveTolerance) {
      if (timeout.current) {
        clearTimeout(timeout.current)
      }
      setIsPressing(false)
    }
  }

  return {
    handlers: {
      onMouseDown: (e: React.MouseEvent) => handleStart(e.clientX, e.clientY, e),
      onMouseUp: (e: React.MouseEvent) => clear(e),
      onMouseLeave: (e: React.MouseEvent) => clear(e, false),
      onMouseMove: (e: React.MouseEvent) => handleMove(e.clientX, e.clientY),
      onTouchStart: (e: React.TouchEvent) =>
        handleStart(e.touches[0].clientX, e.touches[0].clientY, e),
      onTouchEnd: (e: React.TouchEvent) => clear(e),
      onTouchMove: (e: React.TouchEvent) => handleMove(e.touches[0].clientX, e.touches[0].clientY),
      onClickCapture: (e: React.MouseEvent | React.TouchEvent) => {
        if (longPressTriggered.current) {
          e.stopPropagation()
          e.preventDefault()
        }
      },
    },
    isPressing,
  }
}
