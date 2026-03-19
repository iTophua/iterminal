export function EmptyView() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: 'var(--color-bg-container)',
      }}
    >
      <p style={{ color: 'var(--color-text-tertiary)', fontSize: 16 }}>没有活动的会话</p>
      <p style={{ color: 'var(--color-text-quaternary)', fontSize: 14 }}>
        请先在连接管理中连接服务器
      </p>
    </div>
  )
}