import { useEffect, useState, useRef } from 'react'

/**
 * 连接标签拖拽到边缘创建新窗口的 Hook
 */
export function useConnectionDragToNewWindow(isDragging: boolean) {
  const [isDragToNewWindow, setIsDragToNewWindow] = useState(false)
  const edgeThresholdRef = useRef(60)

  useEffect(() => {
    if (!isDragging) {
      setIsDragToNewWindow(false)
      return
    }

    const handlePointerMove = (e: PointerEvent) => {
      const clientX = e.clientX
      const clientY = e.clientY
      const windowWidth = window.innerWidth
      const windowHeight = window.innerHeight
      const edgeThreshold = edgeThresholdRef.current

      const atEdge =
        clientX <= edgeThreshold ||
        clientX >= windowWidth - edgeThreshold ||
        clientY <= edgeThreshold ||
        clientY >= windowHeight - edgeThreshold

      setIsDragToNewWindow(atEdge)
    }

    window.addEventListener('pointermove', handlePointerMove)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
    }
  }, [isDragging])

  return {
    isDragToNewWindow,
    setIsDragToNewWindow,
  }
}
