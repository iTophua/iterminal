import { forwardRef } from 'react'

interface TerminalContainerProps {
  visible: boolean
}

export const TerminalContainer = forwardRef<HTMLDivElement, TerminalContainerProps>(
  function TerminalContainer({ visible }, ref) {
    return (
      <div
        ref={ref}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          padding: 4,
          display: visible ? 'block' : 'none',
        }}
      />
    )
  }
)