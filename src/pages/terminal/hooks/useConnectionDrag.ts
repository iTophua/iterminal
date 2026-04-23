import { useEffect, useState, useRef } from 'react'

/**
 * 连接标签拖拽到边缘创建新窗口的 Hook
 *
 * 左/右/底边缘：直接检测，到达边缘本身说明不在 tab 栏内排序
 * 顶部边缘：tab 栏在顶部，用更小阈值（10px）避免排序时误触
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
        clientY <= 10 ||
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
