import { Modal, Input, Form, Button, Space } from 'antd'

interface NewFileModalProps {
  visible: boolean
  fileName: string
  onFileNameChange: (name: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function NewFileModal({
  visible,
  fileName,
  onFileNameChange,
  onConfirm,
  onCancel,
  loading,
}: NewFileModalProps) {
  return (
    <Modal
      title="新建文件"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
    >
      <Form.Item label="文件名" style={{ marginTop: 16 }}>
        <Input
          value={fileName}
          onChange={e => onFileNameChange(e.target.value)}
          placeholder="输入文件名"
          onPressEnter={onConfirm}
          autoFocus
        />
      </Form.Item>
    </Modal>
  )
}

interface NewFolderModalProps {
  visible: boolean
  folderName: string
  onFolderNameChange: (name: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function NewFolderModal({
  visible,
  folderName,
  onFolderNameChange,
  onConfirm,
  onCancel,
  loading,
}: NewFolderModalProps) {
  return (
    <Modal
      title="新建文件夹"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="创建"
      cancelText="取消"
    >
      <Form.Item label="文件夹名" style={{ marginTop: 16 }}>
        <Input
          value={folderName}
          onChange={e => onFolderNameChange(e.target.value)}
          placeholder="输入文件夹名"
          onPressEnter={onConfirm}
          autoFocus
        />
      </Form.Item>
    </Modal>
  )
}

interface RenameModalProps {
  visible: boolean
  currentValue: string
  onValueChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function RenameModal({
  visible,
  currentValue,
  onValueChange,
  onConfirm,
  onCancel,
  loading,
}: RenameModalProps) {
  return (
    <Modal
      title="重命名"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
    >
      <Form.Item label="新名称" style={{ marginTop: 16 }}>
        <Input
          value={currentValue}
          onChange={e => onValueChange(e.target.value)}
          placeholder="输入新名称"
          onPressEnter={onConfirm}
          autoFocus
        />
      </Form.Item>
    </Modal>
  )
}

interface DeleteModalProps {
  visible: boolean
  fileName: string
  isDirectory: boolean
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function DeleteModal({
  visible,
  fileName,
  isDirectory,
  onConfirm,
  onCancel,
  loading,
}: DeleteModalProps) {
  return (
    <Modal
      title="确认删除"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="删除"
      okType="danger"
      cancelText="取消"
    >
      <p>
        确定要删除 {isDirectory ? '文件夹' : '文件'} <b>{fileName}</b> 吗？
      </p>
      {isDirectory && (
        <p style={{ color: 'var(--color-warning)' }}>
          文件夹内的所有内容都将被删除，此操作不可恢复。
        </p>
      )}
    </Modal>
  )
}

interface ChmodModalProps {
  visible: boolean
  value: string
  onValueChange: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function ChmodModal({
  visible,
  value,
  onValueChange,
  onConfirm,
  onCancel,
  loading,
}: ChmodModalProps) {
  return (
    <Modal
      title="修改权限"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="确定"
      cancelText="取消"
    >
      <Form.Item label="权限值 (八进制)" style={{ marginTop: 16 }}>
        <Input
          value={value}
          onChange={e => onValueChange(e.target.value)}
          placeholder="如: 755, 644"
          onPressEnter={onConfirm}
          autoFocus
        />
      </Form.Item>
    </Modal>
  )
}

interface CompressModalProps {
  visible: boolean
  fileName: string
  onFileNameChange: (name: string) => void
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export function CompressModal({
  visible,
  fileName,
  onFileNameChange,
  onConfirm,
  onCancel,
  loading,
}: CompressModalProps) {
  return (
    <Modal
      title="压缩文件"
      open={visible}
      onOk={onConfirm}
      onCancel={onCancel}
      confirmLoading={loading}
      okText="压缩"
      cancelText="取消"
    >
      <Form.Item label="输出文件名" style={{ marginTop: 16 }}>
        <Input
          value={fileName}
          onChange={e => onFileNameChange(e.target.value)}
          placeholder="output.tar.gz"
          onPressEnter={onConfirm}
          autoFocus
          suffix=".tar.gz"
        />
      </Form.Item>
    </Modal>
  )
}

interface ConflictModalProps {
  visible: boolean
  fileName: string
  remotePath?: string
  onOverwrite: () => void
  onSkip: () => void
  onRename: () => void
}

export function ConflictModal({
  visible,
  fileName,
  remotePath,
  onOverwrite,
  onSkip,
  onRename,
}: ConflictModalProps) {
  return (
    <Modal
      title="文件冲突"
      open={visible}
      onCancel={onSkip}
      footer={null}
    >
      <p>文件 <b>{fileName}</b> 已存在，请选择操作：</p>
      {remotePath && (
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 12 }}>
          目标路径: {remotePath}
        </p>
      )}
      <Space style={{ marginTop: 16 }}>
        <Button onClick={onOverwrite} danger>覆盖</Button>
        <Button onClick={onSkip}>跳过</Button>
        <Button onClick={onRename} type="primary">重命名</Button>
      </Space>
    </Modal>
  )
}