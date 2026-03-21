import { Input, Button, Tooltip, Space } from 'antd'
import {
  HomeOutlined, ReloadOutlined, UploadOutlined,
  FolderAddOutlined, FileAddOutlined, EyeOutlined, EyeInvisibleOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, UnorderedListOutlined, PartitionOutlined,
} from '@ant-design/icons'
import type { ToolbarProps } from './types'

export function FileToolbar({
  currentPath,
  onPathChange,
  onNavigate,
  showHidden,
  onToggleHidden,
  viewMode,
  onViewModeChange,
  onRefresh,
  onNewFile,
  onNewFolder,
  onUpload,
  onUploadFolder,
  loading,
  onGoBack,
  canGoBack,
  onGoForward,
  canGoForward,
}: ToolbarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      borderBottom: '1px solid var(--color-border)',
      background: 'var(--color-bg-elevated)',
    }}>
      {/* 导航按钮 */}
      <Space size={2}>
        <Tooltip title="后退">
          <Button
            size="small"
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={onGoBack}
            disabled={!canGoBack}
            style={{ color: canGoBack ? 'var(--color-text-tertiary)' : 'var(--color-text-quaternary)' }}
          />
        </Tooltip>
        <Tooltip title="前进">
          <Button
            size="small"
            type="text"
            icon={<ArrowRightOutlined />}
            onClick={onGoForward}
            disabled={!canGoForward}
            style={{ color: canGoForward ? 'var(--color-text-tertiary)' : 'var(--color-text-quaternary)' }}
          />
        </Tooltip>
        <Tooltip title="主目录">
          <Button
            size="small"
            type="text"
            icon={<HomeOutlined />}
            onClick={() => onNavigate('/home')}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
      </Space>

      {/* 路径输入 */}
      <Input
        size="small"
        value={currentPath}
        onChange={e => onPathChange(e.target.value)}
        onPressEnter={() => onNavigate(currentPath)}
        style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
        autoCorrect="off"
      />

      {/* 刷新和视图切换 */}
      <Space size={2}>
        <Tooltip title="刷新">
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined spin={loading} />}
            onClick={onRefresh}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
        <Tooltip title={viewMode === 'tree' ? '列表视图' : '树形视图'}>
          <Button
            size="small"
            type="text"
            icon={viewMode === 'tree' ? <UnorderedListOutlined /> : <PartitionOutlined />}
            onClick={() => onViewModeChange(viewMode === 'tree' ? 'list' : 'tree')}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
        <Tooltip title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}>
          <Button
            size="small"
            type="text"
            icon={showHidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
            onClick={onToggleHidden}
            style={{ color: showHidden ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
      </Space>

      {/* 分隔线 */}
      <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />

      {/* 操作按钮 */}
      <Space size={2}>
        <Tooltip title="新建文件">
          <Button
            size="small"
            type="text"
            icon={<FileAddOutlined />}
            onClick={onNewFile}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
        <Tooltip title="新建文件夹">
          <Button
            size="small"
            type="text"
            icon={<FolderAddOutlined />}
            onClick={onNewFolder}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
        <Tooltip title="上传文件">
          <Button
            size="small"
            type="text"
            icon={<UploadOutlined />}
            onClick={onUpload}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
        <Tooltip title="上传文件夹">
          <Button
            size="small"
            type="text"
            icon={<FolderAddOutlined />}
            onClick={onUploadFolder}
            style={{ color: 'var(--color-text-tertiary)' }}
          />
        </Tooltip>
      </Space>
    </div>
  )
}