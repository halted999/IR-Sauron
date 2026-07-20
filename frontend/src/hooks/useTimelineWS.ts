import { useEffect, useRef, useState, useCallback } from 'react'
import { useCaseStore } from '../store/case'
import type { Event, Branch } from '../types'

interface WSPayloadEvent {
  event: Event
}

interface WSPayloadBranch {
  branch: Branch
}

interface WSPayloadUser {
  user_id: string
  username: string
}

interface WSMessage {
  type: string
  payload: unknown
}

const BASE_RECONNECT_DELAY = 1000
const MAX_RECONNECT_DELAY = 30000

export function useTimelineWS(caseId: string): { connectedUsers: string[] } {
  const [connectedUsers, setConnectedUsers] = useState<string[]>([])
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelayRef = useRef(BASE_RECONNECT_DELAY)
  const isMountedRef = useRef(true)

  const { addEvent, updateEventInStore, removeEvent, addBranch, updateBranchInStore } =
    useCaseStore()

  const handleMessage = useCallback(
    (msg: WSMessage) => {
      switch (msg.type) {
        case 'event_created': {
          const { event } = msg.payload as WSPayloadEvent
          addEvent(event)
          break
        }
        case 'event_updated': {
          const { event } = msg.payload as WSPayloadEvent
          updateEventInStore(event)
          break
        }
        case 'event_deleted': {
          const { event } = msg.payload as WSPayloadEvent
          removeEvent(event.id)
          break
        }
        case 'branch_created': {
          const { branch } = msg.payload as WSPayloadBranch
          addBranch(branch)
          break
        }
        case 'branch_updated': {
          const { branch } = msg.payload as WSPayloadBranch
          updateBranchInStore(branch)
          break
        }
        case 'user_joined': {
          const { username } = msg.payload as WSPayloadUser
          setConnectedUsers((prev) =>
            prev.includes(username) ? prev : [...prev, username],
          )
          break
        }
        case 'user_left': {
          const { username } = msg.payload as WSPayloadUser
          setConnectedUsers((prev) => prev.filter((u) => u !== username))
          break
        }
        default:
          break
      }
    },
    [addEvent, updateEventInStore, removeEvent, addBranch, updateBranchInStore],
  )

  // Keep handleMessage stable across renders so connect() doesn't need it as dep
  const handleMessageRef = useRef(handleMessage)
  useEffect(() => {
    handleMessageRef.current = handleMessage
  })

  const connect = useCallback(() => {
    if (!isMountedRef.current) return

    const token = localStorage.getItem('access_token')
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/cases/${caseId}${token ? `?token=${token}` : ''}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectDelayRef.current = BASE_RECONNECT_DELAY
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WSMessage
        handleMessageRef.current(msg)
      } catch {
        // Ignore parse errors
      }
    }

    ws.onerror = () => {
      // Will trigger onclose
    }

    ws.onclose = () => {
      wsRef.current = null
      if (!isMountedRef.current) return

      const delay = reconnectDelayRef.current
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY)

      reconnectTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          connect()
        }
      }, delay)
    }
  }, [caseId])

  useEffect(() => {
    isMountedRef.current = true
    connect()

    return () => {
      isMountedRef.current = false
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return { connectedUsers }
}
