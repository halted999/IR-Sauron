import React, { useState } from 'react'
import type { Branch, BranchStatus } from '../../types'
import { BRANCH_STATUS_LABELS } from '../../types'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { updateBranch, createBranch, deleteBranch } from '../../api/branches'
import { useCaseStore } from '../../store/case'
import { useToastStore } from '../../store/toast'

interface BranchPanelProps {
  branches: Branch[]
  currentBranch: Branch | null
  caseId: string
  onBranchSelect: (branch: Branch) => void
}

const STATUS_COLORS: Record<BranchStatus, { color: string; bg: string }> = {
  hypothesis: { color: '#8b949e', bg: 'rgba(139,148,158,0.15)' },
  confirmed: { color: '#3fb950', bg: 'rgba(63,185,80,0.15)' },
  rejected: { color: '#f85149', bg: 'rgba(248,81,73,0.15)' },
}

interface BranchNodeProps {
  branch: Branch
  allBranches: Branch[]
  depth: number
  currentBranchId: string | null
  onSelect: (b: Branch) => void
  onStatusChange: (b: Branch, status: BranchStatus, reason: string) => Promise<void>
  onDelete: (b: Branch) => void
}

const BranchNode: React.FC<BranchNodeProps> = ({
  branch,
  allBranches,
  depth,
  currentBranchId,
  onSelect,
  onStatusChange,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [newStatus, setNewStatus] = useState<BranchStatus>(branch.status)
  const [statusReason, setStatusReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const statusColors = STATUS_COLORS[branch.status]
  const isActive = branch.id === currentBranchId
  const children = allBranches.filter((b) => b.parent_branch_id === branch.id)

  const handleStatusSave = async () => {
    setIsSaving(true)
    try {
      await onStatusChange(branch, newStatus, statusReason)
      setShowStatusModal(false)
      setStatusReason('')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <div style={{ marginLeft: depth * 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            borderRadius: 6,
            cursor: 'pointer',
            background: isActive ? 'var(--bg-tertiary)' : 'transparent',
            border: isActive ? '1px solid var(--border)' : '1px solid transparent',
            marginBottom: 2,
            position: 'relative',
          }}
          onClick={() => onSelect(branch)}
        >
          {/* Tree connector */}
          {depth > 0 && (
            <span style={{ color: 'var(--border)', fontSize: 12, flexShrink: 0 }}>└</span>
          )}

          {/* Branch name */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {branch.is_main && (
                <span style={{ color: 'var(--accent)', marginRight: 4, fontSize: 10 }}>●</span>
              )}
              {branch.name}
            </div>
          </div>

          {/* Status badge */}
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 10,
              background: statusColors.bg,
              color: statusColors.color,
              flexShrink: 0,
              fontWeight: 500,
            }}
          >
            {BRANCH_STATUS_LABELS[branch.status]}
          </span>

          {/* Context menu button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 14,
              padding: '0 2px',
              flexShrink: 0,
            }}
          >
            ⋮
          </button>

          {/* Context menu */}
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                zIndex: 50,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                minWidth: 160,
                padding: '4px',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <MenuBtn
                onClick={() => {
                  setNewStatus(branch.status)
                  setShowStatusModal(true)
                  setMenuOpen(false)
                }}
              >
                Изменить статус
              </MenuBtn>
              {!branch.is_main && (
                <MenuBtn
                  danger
                  onClick={() => {
                    onDelete(branch)
                    setMenuOpen(false)
                  }}
                >
                  Удалить ветку
                </MenuBtn>
              )}
            </div>
          )}
        </div>

        {/* Children */}
        {children.length > 0 && (
          <div>
            {children.map((child) => (
              <BranchNode
                key={child.id}
                branch={child}
                allBranches={allBranches}
                depth={depth + 1}
                currentBranchId={currentBranchId}
                onSelect={onSelect}
                onStatusChange={onStatusChange}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Status change modal */}
      <Modal
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        title="Изменить статус ветки"
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowStatusModal(false)}>
              Отмена
            </Button>
            <Button variant="primary" onClick={handleStatusSave} isLoading={isSaving}>
              Сохранить
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="branch-status">Новый статус</label>
            <select
              id="branch-status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as BranchStatus)}
            >
              {Object.entries(BRANCH_STATUS_LABELS).map(([val, label]) => (
                <option key={val} value={val}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="branch-reason">Комментарий (необязательно)</label>
            <textarea
              id="branch-reason"
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              rows={3}
              placeholder="Причина изменения статуса..."
            />
          </div>
        </div>
      </Modal>
    </>
  )
}

const MenuBtn: React.FC<{
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}> = ({ onClick, children, danger }) => (
  <button
    onClick={onClick}
    style={{
      display: 'block',
      width: '100%',
      background: 'none',
      border: 'none',
      textAlign: 'left',
      padding: '6px 10px',
      fontSize: 12,
      color: danger ? 'var(--danger)' : 'var(--text-primary)',
      cursor: 'pointer',
      borderRadius: 4,
      fontFamily: 'inherit',
    }}
    onMouseEnter={(e) => {
      ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-tertiary)'
    }}
    onMouseLeave={(e) => {
      ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
    }}
  >
    {children}
  </button>
)

export const BranchPanel: React.FC<BranchPanelProps> = ({
  branches,
  currentBranch,
  caseId,
  onBranchSelect,
}) => {
  const toast = useToastStore()
  const { addBranch, updateBranchInStore } = useCaseStore()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [newBranchDesc, setNewBranchDesc] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const rootBranches = branches.filter((b) => !b.parent_branch_id)

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return
    setIsCreating(true)
    try {
      const branch = await createBranch(caseId, {
        name: newBranchName.trim(),
        description: newBranchDesc.trim() || undefined,
        parent_branch_id: currentBranch?.id,
      })
      addBranch(branch)
      setShowCreateModal(false)
      setNewBranchName('')
      setNewBranchDesc('')
      toast.success(`Ветка "${branch.name}" создана`)
    } catch {
      toast.error('Ошибка создания ветки')
    } finally {
      setIsCreating(false)
    }
  }

  const handleStatusChange = async (
    branch: Branch,
    status: BranchStatus,
    reason: string,
  ) => {
    try {
      const updated = await updateBranch(branch.id, {
        status,
        status_reason: reason || undefined,
      })
      updateBranchInStore(updated)
      toast.success('Статус ветки обновлён')
    } catch {
      toast.error('Ошибка обновления статуса')
      throw new Error('Failed')
    }
  }

  const handleDelete = async (branch: Branch) => {
    if (!confirm(`Удалить ветку "${branch.name}"?`)) return
    try {
      await deleteBranch(branch.id)
      useCaseStore.setState((s) => ({
        branches: s.branches.filter((b) => b.id !== branch.id),
      }))
      toast.success('Ветка удалена')
    } catch {
      toast.error('Ошибка удаления ветки')
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRight: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 12px 8px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <span
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}
        >
          Ветки ({branches.length})
        </span>
        <button
          onClick={() => setShowCreateModal(true)}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 5,
            color: 'var(--accent)',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 7px',
            cursor: 'pointer',
          }}
          title="Создать ветку"
        >
          +
        </button>
      </div>

      {/* Branch tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px' }}>
        {branches.length === 0 ? (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '8px 4px' }}>
            Нет веток
          </p>
        ) : (
          rootBranches.map((branch) => (
            <BranchNode
              key={branch.id}
              branch={branch}
              allBranches={branches}
              depth={0}
              currentBranchId={currentBranch?.id ?? null}
              onSelect={onBranchSelect}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* Create branch modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Создать ветку"
        width={400}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
              Отмена
            </Button>
            <Button
              variant="primary"
              onClick={handleCreateBranch}
              isLoading={isCreating}
              disabled={!newBranchName.trim()}
            >
              Создать
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label htmlFor="branch-name">Название ветки *</label>
            <input
              id="branch-name"
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              placeholder="Например: Гипотеза фишинга"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="branch-desc">Описание</label>
            <textarea
              id="branch-desc"
              value={newBranchDesc}
              onChange={(e) => setNewBranchDesc(e.target.value)}
              rows={3}
              placeholder="Краткое описание ветки..."
            />
          </div>
          {currentBranch && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Ответвление от: <strong>{currentBranch.name}</strong>
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}
