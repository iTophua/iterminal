import { useState, useEffect, useCallback, useRef } from 'react'
import { Input, Button, Tooltip, Modal, Spin } from 'antd'
import {
  HomeOutlined,
  ReloadOutlined,
  UploadOutlined,
  DownloadOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloudUploadOutlined,
  FolderAddOutlined,
  SearchOutlined,
  CloseOutlined,
  UnorderedListOutlined,
  PartitionOutlined,
} from '@ant-design/icons'
import { useTerminalStore } from '../stores/terminalStore'
import { TreeNode } from './fileManager/types'
import {
  NewFileModal,
  NewFolderModal,
  RenameModal,
  DeleteModal,
  ChmodModal,
  CompressModal,
  ConflictModal,
} from './fileManager/Modals'
import { ContextMenu } from './fileManager/ContextMenu'
import { FileList } from './fileManager/FileList'
import { useFileManager } from './fileManager/hooks/useFileManager'
import { useFileOperations } from './fileManager/hooks/useFileOperations'
import { useTransfer } from './fileManager/hooks/useTransfer'
import { useDragDrop } from './fileManager/hooks/useDragDrop'
import { formatSize } from './fileManager/utils'

interface FileManagerPanelProps {
  connectionId: string
  visible: boolean
  onClose: () => void
}

export default function FileManagerPanel({ connectionId, visible, onClose }: FileManagerPanelProps) {
  const store = useTerminalStore()

  const [contextMenuVisible, setContextMenuVisible] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 })
  const [showHidden, setShowHidden] = useState(false)
  const [viewMode, setViewMode] = useState<'tree' | 'list'>(() => {
    const saved = localStorage.getItem('iterminal_file_view_mode')
    return saved === 'list' || saved === 'tree' ? saved : 'tree'
  })
  const [sortField, setSortField] = useState<'name' | 'size' | 'modified' | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const treeContainerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const fileManager = useFileManager({
    connectionId,
    visible,
    viewMode,
    showHidden,
  })

  const {
    treeData,
    treeDataRef,
    loading,
    selectedKeys,
    setSelectedKeys,
    selectedNode,
    selectedNodeRef,
    expandedKeys,
    currentPath,
    pathInput,
    setPathInput,
    loadDirectory,
    refreshCurrent,
    refreshDirectory,
    goHome,
    onExpand,
    onSelect,
    findNodeByPath,
  } = fileManager

  const fileOps = useFileOperations({
    connectionId,
    currentPath,
    selectedNode,
    selectedNodeRef,
    refreshCurrent,
    loadDirectory,
    viewMode,
  })

  const transfer = useTransfer({
    connectionId,
    currentPath,
    selectedNode,
    refreshDirectory,
  })

  const dragDrop = useDragDrop({
    visible,
    connectionId,
    currentPath,
    selectedNode,
    viewMode,
    uploadFile: transfer.uploadFile,
    uploadFolder: transfer.uploadFolder,
    panelRef,
    treeContainerRef,
  })

  useEffect(() => {
    const handleClickOutside = () => {
      if (contextMenuVisible) {
        setContextMenuVisible(false)
      }
    }
    if (contextMenuVisible) {
      document.addEventListener('click', handleClickOutside)
    }
    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenuVisible])

  const onPathInputPressEnter = useCallback(() => {
    const newPath = pathInput.trim()
    if (newPath) {
      loadDirectory(newPath, true)
    }
  }, [loadDirectory, pathInput])

  const onTreeRightClick = useCallback(
    (info: { event: React.MouseEvent; node: any }) => {
      const { event, node } = info
      event.preventDefault()
      event.stopPropagation()
      const nodePath = node.key as string
      const fileName = nodePath.split('/').pop() || nodePath
      const fullNode = findNodeByPath(treeDataRef.current, nodePath)
      const nodeData: TreeNode = fullNode
        ? {
            ...fullNode,
            title: fullNode.title || fileName,
          }
        : {
            key: nodePath,
            title: fileName,
            path: nodePath,
            isDirectory: !node.isLeaf,
            isLeaf: node.isLeaf,
          }
      fileOps.setRenameValue(nodeData.title as string)
      setSelectedNodeState(nodeData)
      setSelectedKeys([nodePath])
      setContextMenuPos({ x: event.clientX, y: event.clientY })
      setContextMenuVisible(true)
    },
    [findNodeByPath, treeDataRef]
  )

  const setSelectedNodeState = useCallback((node: TreeNode | null) => {
    selectedNodeRef.current = node
    fileOps.setRenameValue(node?.title as string || '')
  }, [selectedNodeRef, fileOps])

  const handleSearchSelect = useCallback(
    (node: TreeNode) => {
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/')) || '/'
      store.setCurrentPath(connectionId, parentPath)
      loadDirectory(parentPath, true)
      fileOps.setSearchVisible(false)
      fileOps.setSearchQuery('')
      fileOps.setSearchResults([])
    },
    [connectionId, loadDirectory, store, fileOps]
  )

  const handleSortChange = useCallback(
    (field: 'name' | 'size' | 'modified') => {
      if (sortField !== field) {
        setSortField(field)
        setSortOrder('asc')
      } else if (sortOrder === 'asc') {
        setSortOrder('desc')
      } else {
        setSortField(null)
      }
    },
    [sortField, sortOrder]
  )

  const content = (
    <div
      ref={panelRef}
      className="file-manager-panel"
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button, input, .ant-tree, .file-list-item, .ant-tooltip, .ant-modal')) return
        setSelectedKeys([])
        setSelectedNodeState(null)
      }}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement
        if (target.closest('button, input, .ant-tree, .file-list-item, .ant-tooltip, .ant-modal')) return
        e.preventDefault()
        setSelectedNodeState(null)
        setSelectedKeys([])
        setContextMenuPos({ x: e.clientX, y: e.clientY })
        setContextMenuVisible(true)
      }}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: dragDrop.isDragOver ? 'rgba(0, 185, 107, 0.05)' : 'var(--color-bg-elevated)',
        borderLeft: dragDrop.isDragOver ? '3px solid var(--color-primary)' : '1px solid var(--color-border)',
        zIndex: 1,
        display: 'flex',
        flexDirection: 'column',
        transform: visible ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.3s ease, background 0.2s, border-color 0.2s',
        overflow: 'hidden',
      }}
    >
      {dragDrop.isDragOver && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            padding: '12px 16px',
            background: 'rgba(0, 185, 107, 0.15)',
            borderRadius: 6,
            border: '2px dashed var(--color-primary)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(4px)',
          }}
        >
          <CloudUploadOutlined style={{ color: 'var(--color-primary)', fontSize: 18, marginRight: 8 }} />
          <span style={{ color: 'var(--color-primary)', fontSize: 14, fontWeight: 500 }}>
            释放以上传文件到当前目录
          </span>
        </div>
      )}

      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--color-text)', fontSize: 14, fontWeight: 500 }}>文件管理</span>
          <Tooltip title={viewMode === 'tree' ? '切换到列表视图' : '切换到树形视图'}>
            <Button
              size="small"
              icon={viewMode === 'tree' ? <UnorderedListOutlined /> : <PartitionOutlined />}
              onClick={() => {
                const newMode = viewMode === 'tree' ? 'list' : 'tree'
                setViewMode(newMode)
                localStorage.setItem('iterminal_file_view_mode', newMode)
              }}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-tertiary)',
              }}
            />
          </Tooltip>
        </div>
        <Button
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'var(--color-text-tertiary)' }}
        />
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Input
          size="small"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onPressEnter={onPathInputPressEnter}
          placeholder="输入路径..."
          style={{
            flex: 1,
            background: 'var(--color-bg-container)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
          }}
        />
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <Tooltip title="Home目录">
          <Button
            size="small"
            icon={<HomeOutlined />}
            onClick={goHome}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="返回上级">
          <Button
            size="small"
            icon={<ArrowLeftOutlined />}
            onClick={() => {
              const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/'
              store.setCurrentPath(connectionId, parent)
              loadDirectory(parent, true)
            }}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="刷新当前文件夹">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={refreshCurrent}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <div style={{ flex: 1 }} />
        <Tooltip title={showHidden ? '隐藏隐藏文件' : '显示隐藏文件'}>
          <Button
            size="small"
            icon={showHidden ? <EyeOutlined /> : <EyeInvisibleOutlined />}
            onClick={() => setShowHidden(!showHidden)}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="上传文件">
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={transfer.handleUploadFile}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="上传文件夹">
          <Button
            size="small"
            icon={<CloudUploadOutlined />}
            onClick={transfer.handleUploadFolder}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="下载选中文件">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={transfer.handleDownloadSelected}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="新建文件夹">
          <Button
            size="small"
            icon={<FolderAddOutlined />}
            onClick={() => fileOps.setNewFolderVisible(true)}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
        <Tooltip title="搜索文件">
          <Button
            size="small"
            icon={<SearchOutlined />}
            onClick={() => fileOps.setSearchVisible(!fileOps.searchVisible)}
            style={{
              background: fileOps.searchVisible ? 'rgba(0, 185, 107, 0.15)' : 'transparent',
              border: '1px solid var(--color-border)',
              color: fileOps.searchVisible ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
            }}
          />
        </Tooltip>
      </div>

      {fileOps.searchVisible && (
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--color-bg-container)',
          }}
        >
          <Input
            size="small"
            value={fileOps.searchQuery}
            onChange={(e) => fileOps.setSearchQuery(e.target.value)}
            onPressEnter={fileOps.handleSearch}
            placeholder="输入文件名搜索..."
            style={{
              flex: 1,
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <Button size="small" type="primary" loading={fileOps.searchLoading} onClick={fileOps.handleSearch}>
            搜索
          </Button>
          <Button
            size="small"
            icon={<CloseOutlined />}
            onClick={() => {
              fileOps.setSearchVisible(false)
              fileOps.setSearchQuery('')
              fileOps.setSearchResults([])
            }}
            style={{
              background: 'transparent',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-tertiary)',
            }}
          />
        </div>
      )}

      <div ref={treeContainerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <FileList
          loading={loading}
          treeData={treeData}
          viewMode={viewMode}
          expandedKeys={expandedKeys}
          selectedKeys={selectedKeys}
          searchResults={fileOps.searchResults}
          sortField={sortField}
          sortOrder={sortOrder}
          onSelect={onSelect}
          onExpand={onExpand}
          onRightClick={onTreeRightClick}
          onSearchSelect={handleSearchSelect}
          onSortChange={handleSortChange}
          onNavigate={(path: string) => {
            store.setCurrentPath(connectionId, path)
            loadDirectory(path, true)
          }}
          dragTargetPath={dragDrop.dragTargetPath}
        />
      </div>

      <ContextMenu
        visible={contextMenuVisible}
        position={contextMenuPos}
        selectedNode={selectedNode}
        onClose={() => setContextMenuVisible(false)}
        onRefresh={() => {
          refreshCurrent()
          setContextMenuVisible(false)
        }}
        onNewFile={() => {
          fileOps.setNewFileVisible(true)
          setContextMenuVisible(false)
        }}
        onNewFolder={() => {
          fileOps.setNewFolderVisible(true)
          setContextMenuVisible(false)
        }}
        onPreview={() => {
          fileOps.handlePreview()
          setContextMenuVisible(false)
        }}
        onEdit={() => {
          fileOps.handleEdit()
          setContextMenuVisible(false)
        }}
        onRename={() => {
          fileOps.setRenameVisible(true)
          setContextMenuVisible(false)
        }}
        onChmod={() => {
          fileOps.setChmodValue(selectedNode?.permissions || '644')
          fileOps.setChmodVisible(true)
          setContextMenuVisible(false)
        }}
        onDownload={() => {
          if (selectedNode && !selectedNode.isDirectory) {
            transfer.handleDownload(selectedNode.path, selectedNode.title)
          }
          setContextMenuVisible(false)
        }}
        onUpload={() => {
          transfer.handleUploadFile()
          setContextMenuVisible(false)
        }}
        onUploadFolder={() => {
          transfer.handleUploadFolder()
          setContextMenuVisible(false)
        }}
        onCopyName={() => {
          fileOps.copyFileName()
          setContextMenuVisible(false)
        }}
        onCopyPath={() => {
          fileOps.copyFullPath()
          setContextMenuVisible(false)
        }}
        onCompress={() => {
          fileOps.setCompressName((selectedNode?.title || '') + '.tar.gz')
          fileOps.setCompressVisible(true)
          setContextMenuVisible(false)
        }}
        onExtract={() => {
          fileOps.setExtractVisible(true)
          setContextMenuVisible(false)
        }}
        onDelete={() => {
          fileOps.setDeleteVisible(true)
          setContextMenuVisible(false)
        }}
      />

      <NewFileModal
        visible={fileOps.newFileVisible}
        fileName={fileOps.newFileName}
        onFileNameChange={fileOps.setNewFileName}
        onConfirm={fileOps.handleCreateFile}
        onCancel={() => {
          fileOps.setNewFileVisible(false)
          fileOps.setNewFileName('')
        }}
      />

      <NewFolderModal
        visible={fileOps.newFolderVisible}
        folderName={fileOps.newFolderName}
        onFolderNameChange={fileOps.setNewFolderName}
        onConfirm={fileOps.handleCreateFolder}
        onCancel={() => {
          fileOps.setNewFolderVisible(false)
          fileOps.setNewFolderName('')
        }}
      />

      <RenameModal
        visible={fileOps.renameVisible}
        currentValue={fileOps.renameValue}
        onValueChange={fileOps.setRenameValue}
        onConfirm={fileOps.handleRename}
        onCancel={() => {
          fileOps.setRenameVisible(false)
          fileOps.setRenameValue('')
        }}
      />

      <DeleteModal
        visible={fileOps.deleteVisible}
        fileName={selectedNodeRef.current?.title || selectedNodeRef.current?.path?.split('/').pop() || ''}
        isDirectory={selectedNodeRef.current?.isDirectory || false}
        onConfirm={fileOps.handleDelete}
        onCancel={() => fileOps.setDeleteVisible(false)}
      />

      <ChmodModal
        visible={fileOps.chmodVisible}
        value={fileOps.chmodValue}
        onValueChange={fileOps.setChmodValue}
        onConfirm={fileOps.handleChmod}
        onCancel={() => {
          fileOps.setChmodVisible(false)
          fileOps.setChmodValue('644')
        }}
      />

      <CompressModal
        visible={fileOps.compressVisible}
        fileName={fileOps.compressName}
        onFileNameChange={fileOps.setCompressName}
        onConfirm={fileOps.handleCompress}
        onCancel={() => {
          fileOps.setCompressVisible(false)
          fileOps.setCompressName('')
        }}
      />

      <ConflictModal
        visible={transfer.conflictModalVisible}
        fileName={transfer.conflictFile?.fileName || ''}
        remotePath={transfer.conflictFile?.remotePath}
        onOverwrite={() => transfer.resolveConflictDialog('overwrite')}
        onSkip={() => transfer.resolveConflictDialog('skip')}
        onRename={() => transfer.resolveConflictDialog('rename')}
      />

      <Modal
        open={fileOps.previewVisible}
        title={fileOps.previewFile?.name || '文件预览'}
        onCancel={() => fileOps.setPreviewVisible(false)}
        footer={null}
        width={800}
        styles={{ body: { maxHeight: '60vh', overflow: 'auto' } }}
      >
        {fileOps.previewLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <>
            {fileOps.previewTruncated && (
              <div style={{ marginBottom: 8, color: '#faad14', fontSize: 12 }}>
                文件较大，仅显示前 1MB 内容
              </div>
            )}
            <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              大小: {formatSize(fileOps.previewSize)}
            </div>
            <pre
              style={{
                background: 'var(--color-bg-container)',
                padding: 12,
                borderRadius: 4,
                overflow: 'auto',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
              }}
            >
              {fileOps.previewContent}
            </pre>
          </>
        )}
      </Modal>

      <Modal
        open={fileOps.editVisible}
        title={`编辑: ${fileOps.editFile?.name || ''}`}
        onCancel={() => fileOps.setEditVisible(false)}
        onOk={fileOps.handleSaveEdit}
        okText="保存"
        cancelText="取消"
        confirmLoading={fileOps.editSaving}
        width={900}
        styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
      >
        {fileOps.editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <Input.TextArea
            value={fileOps.editContent}
            onChange={(e) => fileOps.setEditContent(e.target.value)}
            rows={20}
            style={{
              fontFamily: 'monospace',
              fontSize: 12,
              background: 'var(--color-bg-container)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
        )}
      </Modal>

      <Modal
        open={fileOps.extractVisible}
        title="解压文件"
        onCancel={() => fileOps.setExtractVisible(false)}
        onOk={fileOps.handleExtract}
        okText="解压"
        cancelText="取消"
        confirmLoading={fileOps.extractLoading}
      >
        <p>
          确定要解压文件 <strong>{selectedNode?.title}</strong> 吗？
        </p>
        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>文件将解压到当前目录</p>
      </Modal>
    </div>
  )

  if (!visible) return null

  return content
}