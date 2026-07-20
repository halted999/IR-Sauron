import React, { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import type { Comment, CommentVisibility, CreateCommentData } from '../../types'
import { deleteComment, resolveComment } from '../../api/events'
import { useAuthStore } from '../../store/auth'
import { useToastStore } from '../../store/toast'
import { Button } from '../ui/Button'
import { Spinner } from '../ui/Spinner'

interface CommentListProps {
  fetchComments: () => Promise<Comment[]>
  onCreateComment: (data: CreateCommentData) => Promise<Comment>
}

const VISIBILITY_LABELS: Record<CommentVisibility, { label: string; icon: string; color: string }> =
  {
    internal: { label: 'Внутренний', icon: '🔒', color: '#8b949e' },
    report: { label: 'В отчёт', icon: '📋', color: '#58a6ff' },
  }

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

interface CommentItemProps {
  comment: Comment
  currentUserId?: string
  currentUserRole?: string
  onReply: (commentId: string) => void
  onResolve: (commentId: string) => void
  onDelete: (commentId: string) => void
  isReply?: boolean
}

const CommentItem: React.FC<CommentItemProps> = ({
  comment,
  currentUserId,
  currentUserRole,
  onReply,
  onResolve,
  onDelete,
  isReply = false,
}) => {
  const vis = VISIBILITY_LABELS[comment.visibility]
  const authorName = comment.author?.full_name ?? comment.author?.username ?? 'Пользователь'
  const canModerate =
    currentUserRole === 'admin' ||
    currentUserRole === 'ir_lead' ||
    currentUserRole === 'investigator'

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        opacity: comment.is_resolved ? 0.65 : 1,
        marginLeft: isReply ? 32 : 0,
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: comment.is_deleted ? 'var(--bg-tertiary)' : '#1f6feb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 700,
          color: '#fff',
          flexShrink: 0,
          marginTop: 1,
        }}
      >
        {comment.is_deleted ? '?' : getInitials(authorName)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {comment.is_deleted ? (
          <div
            style={{
              color: 'var(--text-secondary)',
              fontSize: 12,
              fontStyle: 'italic',
              padding: '4px 0',
            }}
          >
            [Удалено]
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                {authorName}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {format(new Date(comment.created_at), 'dd.MM.yyyy HH:mm', { locale: ru })}
              </span>
              <span
                style={{
                  fontSize: 10,
                  color: vis.color,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                {vis.icon} {vis.label}
              </span>
              {comment.is_resolved && (
                <span style={{ fontSize: 10, color: 'var(--success)' }}>✓ Решено</span>
              )}
            </div>

            <p
              style={{
                fontSize: 13,
                color: 'var(--text-primary)',
                marginTop: 4,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {comment.body}
            </p>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              {!isReply && (
                <button
                  onClick={() => onReply(comment.id)}
                  style={actionBtnStyle}
                >
                  Ответить
                </button>
              )}
              {canModerate && !comment.is_resolved && (
                <button onClick={() => onResolve(comment.id)} style={actionBtnStyle}>
                  Отметить решённым
                </button>
              )}
              {(currentUserId === comment.author_id || canModerate) && (
                <button
                  onClick={() => onDelete(comment.id)}
                  style={{ ...actionBtnStyle, color: 'var(--danger)' }}
                >
                  Удалить
                </button>
              )}
            </div>
          </>
        )}

        {/* Replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                currentUserId={currentUserId}
                currentUserRole={currentUserRole}
                onReply={onReply}
                onResolve={onResolve}
                onDelete={onDelete}
                isReply
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 11,
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
}

export const CommentList: React.FC<CommentListProps> = ({ fetchComments, onCreateComment }) => {
  const { user } = useAuthStore()
  const toast = useToastStore()
  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [body, setBody] = useState('')
  const visibility: CommentVisibility = 'internal'
  const [replyToId, setReplyToId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    loadComments()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const loadComments = async () => {
    setIsLoading(true)
    try {
      const data = await fetchComments()
      setComments(data)
    } catch {
      toast.error('Ошибка загрузки комментариев')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (!body.trim()) return
    setIsSubmitting(true)
    try {
      const comment = await onCreateComment({
        body: body.trim(),
        visibility,
        parent_comment_id: replyToId ?? undefined,
      })
      setComments((prev) => {
        if (replyToId) {
          return prev.map((c) => {
            if (c.id === replyToId) {
              return { ...c, replies: [...(c.replies ?? []), comment] }
            }
            return c
          })
        }
        return [...prev, comment]
      })
      setBody('')
      setReplyToId(null)
      toast.success('Комментарий добавлен')
    } catch {
      toast.error('Ошибка добавления комментария')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleResolve = async (commentId: string) => {
    try {
      const updated = await resolveComment(commentId)
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, is_resolved: updated.is_resolved } : c)),
      )
    } catch {
      toast.error('Ошибка')
    }
  }

  const handleDelete = async (commentId: string) => {
    try {
      await deleteComment(commentId)
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, is_deleted: true, body: '' }
            : {
                ...c,
                replies: c.replies?.map((r) =>
                  r.id === commentId ? { ...r, is_deleted: true, body: '' } : r,
                ),
              },
        ),
      )
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  if (isLoading)
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
        <Spinner size={20} />
      </div>
    )

  const replyTarget = replyToId ? comments.find((c) => c.id === replyToId) : null

  return (
    <div>
      {/* Comment list */}
      {comments.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Комментариев нет
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
          {comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              currentUserId={user?.id}
              currentUserRole={user?.role}
              onReply={setReplyToId}
              onResolve={handleResolve}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Add comment form */}
      <div
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 10,
        }}
      >
        {replyTarget && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>Ответ на комментарий:</span>
            <span style={{ color: 'var(--text-primary)' }}>
              {replyTarget.author?.username ?? '?'}
            </span>
            <button
              onClick={() => setReplyToId(null)}
              style={{ ...actionBtnStyle, marginLeft: 4, fontSize: 12 }}
            >
              ✕
            </button>
          </div>
        )}
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Добавить комментарий..."
          rows={3}
          style={{ resize: 'vertical', marginBottom: 8, fontSize: 13 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.ctrlKey) handleSubmit()
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Ctrl+Enter для отправки
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            isLoading={isSubmitting}
            disabled={!body.trim()}
            style={{ width: '100%' }}
          >
            Отправить
          </Button>
        </div>
      </div>
    </div>
  )
}
