import { Empty, Spin, Tree } from 'antd'
import {
  FolderOutlined,
  FileOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons'
import { TreeNode } from './types'
import { formatSize } from './utils'

const { DirectoryTree } = Tree

interface FileListProps {
  loading: boolean
  treeData: TreeNode[]
  viewMode: 'tree' | 'list'
  expandedKeys: string[]
  selectedKeys: string[]
  searchResults: TreeNode[]
  searchLoading: boolean
  sortField: 'name' | 'size' | 'modified' | null
  sortOrder: 'asc' | 'desc'
  onSelect: (keys: React.Key[]) => void
  onExpand: (keys: React.Key[], info: any) => void
  onRightClick: (info: { event: React.MouseEvent; node: any }) => void
  onSearchSelect: (node: TreeNode) => void
  onSortChange: (field: 'name' | 'size' | 'modified') => void
  onNavigate: (path: string) => void
  dragTargetPath: string | null
}

export function FileList({
  loading,
  treeData,
  viewMode,
  expandedKeys,
  selectedKeys,
  searchResults,
  searchLoading,
  sortField,
  sortOrder,
  onSelect,
  onExpand,
  onRightClick,
  onSearchSelect,
  onSortChange,
  onNavigate,
  dragTargetPath,
}: FileListProps) {
  const renderTreeNode = (node: TreeNode) => (
    <span
      data-dir-path={node.isDirectory ? node.path : undefined}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        color: node.isDirectory ? 'var(--color-primary)' : 'var(--color-text)',
      }}
    >
      {node.title}
      {!node.isDirectory && node.size !== undefined && node.size > 0 && (
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
          {formatSize(node.size)}
        </span>
      )}
    </span>
  )

  const sortedData = sortField
    ? [...treeData].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        let cmp = 0
        if (sortField === 'name') {
          cmp = (a.title || '').localeCompare(b.title || '')
        } else if (sortField === 'size') {
          cmp = (a.size || 0) - (b.size || 0)
        } else if (sortField === 'modified') {
          cmp = (a.modified || '').localeCompare(b.modified || '')
        }
        return sortOrder === 'asc' ? cmp : -cmp
      })
    : treeData

  return (
    <div
      style={{
        height: '100%',
        overflow: 'auto',
        padding: 8,
        background: 'var(--color-bg-elevated)',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
    >
      {searchResults.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-tertiary)',
              marginBottom: 8,
              padding: '0 4px',
            }}
          >
            找到 {searchResults.length} 个结果
          </div>
          {searchResults.map((item) => (
            <div
              key={item.key}
              onClick={() => onSearchSelect(item)}
              onDoubleClick={() => onSearchSelect(item)}
              style={{
                padding: '8px 12px',
                background: 'var(--color-bg-container)',
                borderRadius: 4,
                cursor: 'pointer',
                transition: 'background 0.15s',
                border: '1px solid var(--color-border)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 185, 107, 0.1)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-bg-container)'
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  marginBottom: 4,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {item.isDirectory ? (
                  <FolderOutlined style={{ color: 'var(--color-primary)' }} />
                ) : (
                  <FileOutlined style={{ color: 'var(--color-text-tertiary)' }} />
                )}
                <span
                  style={{
                    color: item.isDirectory ? 'var(--color-primary)' : 'var(--color-text)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title}
                </span>
              </div>
              <div
                style={{
                  color: 'var(--color-text-quaternary)',
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.path}
              </div>
            </div>
          ))}
        </div>
      ) : searchLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : treeData.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ color: 'var(--color-text-quaternary)' }}>空目录</span>}
        />
      ) : viewMode === 'tree' ? (
        <DirectoryTree
          treeData={treeData}
          expandedKeys={expandedKeys}
          selectedKeys={selectedKeys}
          onSelect={onSelect}
          onExpand={onExpand}
          expandAction="doubleClick"
          titleRender={renderTreeNode}
          onRightClick={onRightClick}
        />
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '4px 8px',
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 4,
            }}
          >
            <span
              onClick={() => onSortChange('name')}
              style={{
                color: sortField === 'name' ? 'var(--color-primary)' : 'var(--color-text-quaternary)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              名称{' '}
              {sortField === 'name' &&
                (sortOrder === 'asc' ? (
                  <ArrowUpOutlined style={{ fontSize: 10 }} />
                ) : (
                  <ArrowDownOutlined style={{ fontSize: 10 }} />
                ))}
            </span>
            <span
              onClick={() => onSortChange('size')}
              style={{
                color: sortField === 'size' ? 'var(--color-primary)' : 'var(--color-text-quaternary)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              大小{' '}
              {sortField === 'size' &&
                (sortOrder === 'asc' ? (
                  <ArrowUpOutlined style={{ fontSize: 10 }} />
                ) : (
                  <ArrowDownOutlined style={{ fontSize: 10 }} />
                ))}
            </span>
            <span
              onClick={() => onSortChange('modified')}
              style={{
                color: sortField === 'modified' ? 'var(--color-primary)' : 'var(--color-text-quaternary)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              修改时间{' '}
              {sortField === 'modified' &&
                (sortOrder === 'asc' ? (
                  <ArrowUpOutlined style={{ fontSize: 10 }} />
                ) : (
                  <ArrowDownOutlined style={{ fontSize: 10 }} />
                ))}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sortedData.map((item) => (
              <div
                key={item.key}
                data-dir-path={item.isDirectory ? item.path : undefined}
                className="file-list-item"
                onClick={() => onSelect([item.key])}
                onDoubleClick={() => {
                  if (item.isDirectory) {
                    onNavigate(item.path)
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  onSelect([item.key])
                  onRightClick({ event: e, node: { ...item, key: item.key } })
                }}
                style={{
                  padding: '8px 12px',
                  background: selectedKeys.includes(item.key as string)
                    ? 'rgba(0, 185, 107, 0.15)'
                    : dragTargetPath === item.path
                      ? 'rgba(0, 185, 107, 0.25)'
                      : 'transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  border:
                    dragTargetPath === item.path
                      ? '2px dashed var(--color-primary)'
                      : '2px solid transparent',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    marginBottom: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {item.isDirectory ? <FolderOutlined /> : <FileOutlined />}
                  <span
                    style={{
                      color: item.isDirectory ? 'var(--color-primary)' : 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </span>
                </div>
                <div
                  style={{
                    color: 'var(--color-text-quaternary)',
                    fontSize: 11,
                    display: 'flex',
                    gap: 12,
                  }}
                >
                  <span>{formatSize(item.size || 0)}</span>
                  <span>{item.modified || '-'}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}