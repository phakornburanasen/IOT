import { useState, useEffect, useRef, useCallback } from 'react'
import './App.css'
import { API_BASE_URL, AUTO_REFRESH_MS } from './config'
import APIGateway from './APIGateway'
import FollowUpWork from './FollowUpWork'

// ── Hash-based routing helpers ──────────────────────────────────────────────
type ViewType = 'logs' | 'devices' | 'gateway' | 'followup'

const VALID_VIEWS: ViewType[] = ['logs', 'devices', 'gateway', 'followup']

function getViewFromHash(): ViewType {
  const hash = window.location.hash.replace('#/', '').split('?')[0] as ViewType
  return VALID_VIEWS.includes(hash) ? hash : 'logs'
}

function setHashView(view: ViewType) {
  window.history.replaceState(null, '', `#/${view}`)
}
// ────────────────────────────────────────────────────────────────────────────

interface IotData {
  id: number
  Status: number
  Status_Text: string | null
  Uid: string
  Box: string | null
  Order: string | null
  Count: number
  Time: string | null
  Hour: number
  Second: number
  PauseTime: string | null
  SN_mac: string
  Key_button: number
  Ip_address: string
  SSID_wifi: string
  Ref_id: number | null
  Created_At: string | null
}

// Fixed column widths keep the table geometry stable when page data changes.
const columnWidths: Record<keyof IotData, number> = {
  id: 82,
  Status: 132,
  Status_Text: 160,
  Uid: 150,
  Box: 120,
  Order: 130,
  Count: 94,
  Time: 110,
  Hour: 90,
  Second: 96,
  PauseTime: 130,
  SN_mac: 180,
  Key_button: 116,
  Ip_address: 145,
  SSID_wifi: 160,
  Ref_id: 100,
  Created_At: 180,
}

interface Toast {
  id: number
  type: 'success' | 'error'
  message: string
}

// Box ping status from backend
interface BoxStatus {
  box: string
  ip: string
  sn_mac: string
  uid: string
  last_seen: string | null
  online: boolean
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function App() {
  // State variables
  const [data, setData] = useState<IotData[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [debouncedSearch, setDebouncedSearch] = useState<string>('')
  const [page, setPage] = useState<number>(1)
  const [displayedPage, setDisplayedPage] = useState<number>(1)
  const [limit, setLimit] = useState<number>(10)
  const [total, setTotal] = useState<number>(0)
  const [totalPages, setTotalPages] = useState<number>(0)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [copiedUid, setCopiedUid] = useState<string | null>(null)

  // Navigation layout state — sidebar persisted in localStorage, view from URL hash
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    const saved = localStorage.getItem('iot_sidebar')
    return saved === null ? true : saved === 'open'
  })
  const [activeView, setActiveView] = useState<ViewType>(getViewFromHash)

  // Sync hash → state on browser back/forward
  useEffect(() => {
    const onHashChange = () => setActiveView(getViewFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Navigate: update state + URL hash
  const navigate = useCallback((view: ViewType) => {
    setHashView(view)
    setActiveView(view)
  }, [])

  // Persist sidebar state to localStorage
  const toggleSidebar = useCallback(() => {
    setSidebarOpen(prev => {
      const next = !prev
      localStorage.setItem('iot_sidebar', next ? 'open' : 'closed')
      return next
    })
  }, [])

  // Advanced State features
  const [selectedRow, setSelectedRow] = useState<IotData | null>(null)
  const [showColMenu, setShowColMenu] = useState<boolean>(false)
  const [sortField, setSortField] = useState<keyof IotData | null>('id')
  const [sortAsc, setSortAsc] = useState<boolean>(false) // Default descending by ID (newest first)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef<number>(0)

  // Box ping status state
  const [boxStatuses, setBoxStatuses] = useState<BoxStatus[]>([])
  const [boxStatusLoading, setBoxStatusLoading] = useState<boolean>(false)
  const [boxStatusError, setBoxStatusError] = useState<string | null>(null)
  const [tooltipNode, setTooltipNode] = useState<{ box: BoxStatus; x: number; y: number } | null>(null)
  const boxStatusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Real-time SSE state
  const [sseConnected, setSseConnected] = useState<boolean>(false)
  const [newRowCount, setNewRowCount] = useState<number>(0)   // จำนวน rows ใหม่ที่เข้ามาตั้งแต่โหลดหน้า
  const [newRowIds, setNewRowIds] = useState<Set<number>>(new Set()) // ids ของ rows ใหม่สำหรับ highlight
  const lastIdRef = useRef<number>(0)                          // track id ล่าสุดแบบ stable (ไม่ trigger re-render)
  const sseRef = useRef<EventSource | null>(null)              // เก็บ EventSource instance

  const [visibleColumns, setVisibleColumns] = useState<Record<keyof IotData, boolean>>({
    id: true,
    Status: true,
    Status_Text: true,
    Uid: true,
    Box: true,
    Order: true,
    Count: true,
    Time: false,
    Hour: false, // Default hidden to keep main view clean
    Second: true, // Default hidden to keep main view clean
    PauseTime: true,
    SN_mac: true,
    Key_button: true,
    Ip_address: true,
    SSID_wifi: false, // Default hidden
    Ref_id: false, // Default hidden
    Created_At: true,
  })

  const columnLabels: Record<keyof IotData, string> = {
    id: 'ID',
    Status: 'Status',
    Status_Text: 'Status Text',
    Uid: 'UID',
    Box: 'Box',
    Order: 'Order',
    Count: 'Count',
    Time: 'Time',
    Hour: 'Hour',
    Second: 'Second',
    PauseTime: 'Pause Time',
    SN_mac: 'SN / MAC',
    Key_button: 'Key Button',
    Ip_address: 'IP Address',
    SSID_wifi: 'SSID Wifi',
    Ref_id: 'Ref ID',
    Created_At: 'Created At',
  }

  // Toast Notification handler
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  const copyUID = useCallback(async (uid: string) => {
    const value = uid.trim()
    if (!value) {
      showToast('ไม่มี UID สำหรับคัดลอก', 'error')
      return
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        const input = document.createElement('textarea')
        input.value = value
        input.setAttribute('readonly', '')
        input.style.position = 'fixed'
        input.style.opacity = '0'
        input.style.pointerEvents = 'none'
        document.body.appendChild(input)
        input.focus()
        input.select()
        const copied = document.execCommand('copy')
        document.body.removeChild(input)
        if (!copied) {
          throw new Error('execCommand copy failed')
        }
      }
      setCopiedUid(value)
      window.setTimeout(() => {
        setCopiedUid((cur) => (cur === value ? null : cur))
      }, 1500)
    } catch {
      showToast('ไม่สามารถคัดลอก UID ได้', 'error')
    }
  }, [showToast])

  // Close column visibility dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowColMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Search Debouncer: delay 400ms to avoid excessive API queries
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm)
      setPage(1) // Reset to page 1 on new search
    }, 400)
    return () => clearTimeout(timer)
  }, [searchTerm])

  // Fetch data on parameters change
  const fetchData = useCallback(async (showLoading = true) => {
    const requestId = ++requestIdRef.current
    if (showLoading) setLoading(true)
    try {
      let url = `${API_BASE_URL}/iot-data?page=${page}&limit=${limit}`
      if (debouncedSearch) {
        url += `&search=${encodeURIComponent(debouncedSearch)}`
      }
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch data')
      }
      const resData = await response.json()

      // Safety check: if page is out of bounds due to deletions or other state changes
      if (requestId !== requestIdRef.current) return

      if (resData.data.length === 0 && resData.total_pages > 0 && page > resData.total_pages) {
        setPage(resData.total_pages)
      } else {
        setData(resData.data)
        setDisplayedPage(page)
        setTotal(resData.total)
        setTotalPages(resData.total_pages)

        // อัปเดต lastIdRef จาก data ที่โหลดมา (page 1 เท่านั้น เพื่อให้ SSE ได้ id ล่าสุดจริง)
        if (page === 1 && resData.data.length > 0) {
          const maxId = Math.max(...resData.data.map((d: IotData) => d.id))
          if (maxId > lastIdRef.current) {
            lastIdRef.current = maxId
          }
        }
      }
    } catch (error: unknown) {
      if (requestId === requestIdRef.current) {
        showToast(errorMessage(error, 'Error loading data'), 'error')
      }
    } finally {
      if (showLoading && requestId === requestIdRef.current) setLoading(false)
    }
  }, [page, limit, debouncedSearch, showToast])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void fetchData(), 0)
    return () => window.clearTimeout(initialLoad)
  }, [fetchData])

  // Background refresh is a fallback for proxies/networks that interrupt SSE.
  // It also guarantees that updates to an existing row become visible.
  useEffect(() => {
    if (activeView !== 'logs') return
    const interval = window.setInterval(() => void fetchData(false), AUTO_REFRESH_MS)
    return () => window.clearInterval(interval)
  }, [activeView, fetchData])

  // ── Server-Sent Events: รับ rows ใหม่แบบ real-time ──────────────────────
  // เปิด SSE เฉพาะ logs view, page 1, ไม่มี search
  // ใช้ lastIdRef เพื่อ track id ล่าสุดโดยไม่ต้อง re-open connection ทุกครั้ง
  useEffect(() => {
    // ปิด SSE เดิมก่อนเสมอ
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
      setSseConnected(false)
    }

    // เปิด SSE เฉพาะ logs view, page 1, ไม่ค้นหา และรอ fetchData เสร็จก่อน (loading = false)
    if (activeView !== 'logs' || page !== 1 || debouncedSearch !== '' || loading) return

    const connectSSE = () => {
      const url = `${API_BASE_URL}/iot-stream?last_id=${lastIdRef.current}`
      const es = new EventSource(url)
      sseRef.current = es

      // onopen คือสัญญาณว่า HTTP connection เปิดสำเร็จแล้ว
      es.onopen = () => {
        setSseConnected(true)
      }

      // backend ส่ง "event: connected" เป็น heartbeat แรก — ใช้ยืนยันซ้ำ
      es.addEventListener('connected', () => {
        setSseConnected(true)
      })

      es.addEventListener('new_rows', (e: MessageEvent) => {
        try {
          const newRows: IotData[] = JSON.parse(e.data)
          if (!newRows.length) return

          // อัปเดต lastIdRef ให้เป็น id ล่าสุด
          const maxNewId = Math.max(...newRows.map(r => r.id))
          lastIdRef.current = maxNewId

          // นับ rows ใหม่สำหรับ indicator
          setNewRowCount(prev => prev + newRows.length)

          // เพิ่ม ids ของ rows ใหม่ใน set สำหรับ highlight
          const incomingIds = new Set(newRows.map(r => r.id))
          setNewRowIds(prev => new Set([...prev, ...incomingIds]))
          // ลบ highlight หลัง 3 วินาที
          setTimeout(() => {
            setNewRowIds(prev => {
              const next = new Set(prev)
              incomingIds.forEach(id => next.delete(id))
              return next
            })
          }, 3000)

          setData(prev => {
            // Prepend rows ใหม่ (reverse เพราะ backend ส่งมาเรียง ASC)
            const merged = [...newRows.slice().reverse(), ...prev]
            return limit > 0 ? merged.slice(0, limit) : merged
          })
          setTotal(prev => prev + newRows.length)
        } catch { /* ignore parse errors */ }
      })

      // Go backend emits this for inserts, updates, and deletes.
      es.addEventListener('data_changed', () => {
        void fetchData(false)
      })

      es.onerror = () => {
        setSseConnected(false)
        // browser จะ reconnect อัตโนมัติ — เมื่อ reconnect สำเร็จจะยิง 'open' event
      }

      es.onopen = () => {
        setSseConnected(true)
      }
    }

    connectSSE()

    return () => {
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      setSseConnected(false)
    }
  }, [activeView, page, debouncedSearch, loading, limit, fetchData])

  // Fetch box ping status from backend
  const fetchBoxStatus = useCallback(async () => {
    setBoxStatusLoading(true)
    setBoxStatusError(null)
    try {
      const res = await fetch(`${API_BASE_URL}/box-status`)
      if (!res.ok) throw new Error('Failed to fetch box status')
      const json = await res.json()
      setBoxStatuses(json.boxes || [])
    } catch (error: unknown) {
      setBoxStatusError(errorMessage(error, 'Error fetching box status'))
    } finally {
      setBoxStatusLoading(false)
    }
  }, [])

  // Auto-fetch box status when devices view is active, refresh every 30s
  useEffect(() => {
    if (activeView === 'devices') {
      const initialLoad = window.setTimeout(() => void fetchBoxStatus(), 0)
      boxStatusIntervalRef.current = setInterval(fetchBoxStatus, 30000)
      return () => {
        window.clearTimeout(initialLoad)
        if (boxStatusIntervalRef.current) {
          clearInterval(boxStatusIntervalRef.current)
          boxStatusIntervalRef.current = null
        }
      }
    } else {
      if (boxStatusIntervalRef.current) {
        clearInterval(boxStatusIntervalRef.current)
        boxStatusIntervalRef.current = null
      }
    }
    return () => {
      if (boxStatusIntervalRef.current) {
        clearInterval(boxStatusIntervalRef.current)
        boxStatusIntervalRef.current = null
      }
    }
  }, [activeView, fetchBoxStatus])

  // Delete row handler
  const handleDeleteConfirm = async () => {
    if (deleteId === null) return
    try {
      const response = await fetch(`${API_BASE_URL}/iot-data/${deleteId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error('Failed to delete record')
      }
      showToast('ลบข้อมูลเรียบร้อยแล้ว')
      if (selectedRow?.id === deleteId) {
        setSelectedRow(null)
      }
      setDeleteId(null)
      // Refresh current page. If deleted the last item on the page, go to previous page.
      if (data.length === 1 && page > 1) {
        setPage(page - 1)
      } else {
        fetchData()
      }
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Error deleting record'), 'error')
      setDeleteId(null)
    }
  };

  // Generate pagination page numbers dynamically
  const getPageNumbers = () => {
    const pages: (number | string)[] = []
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      if (page <= 4) {
        pages.push(1, 2, 3, 4, 5, '...', totalPages)
      } else if (page >= totalPages - 3) {
        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
      } else {
        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages)
      }
    }
    return pages
  };

  // Status badge renderer
  const renderStatus = (status: number, statusText: string | null) => {
    const text = statusText || (
      status === 1 ? 'START' :
        status === 2 ? 'STOP' :
          status === 3 ? 'PAUSE' :
            status === 4 ? 'RESUME' :
              status === 5 ? 'RESET' : `Unknown (${status})`
    )

    let className = 'status-other'
    if (status === 1) className = 'status-start'
    else if (status === 2) className = 'status-stop'
    else if (status === 3) className = 'status-pause'
    else if (status === 4) className = 'status-resume'
    else if (status === 5) className = 'status-reset'

    return (
      <span className={`status-badge ${className}`}>
        {text}
      </span>
    )
  }

  // Client-side Sorting Handler
  const handleSort = (field: keyof IotData) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(true)
    }
  }

  // Sorting logic on active table rows
  const sortedData = [...data].sort((a, b) => {
    if (!sortField) return 0
    const valA = a[sortField]
    const valB = b[sortField]
    if (valA === null || valA === undefined) return sortAsc ? 1 : -1
    if (valB === null || valB === undefined) return sortAsc ? -1 : 1

    if (typeof valA === 'number' && typeof valB === 'number') {
      return sortAsc ? valA - valB : valB - valA
    }
    return sortAsc
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA))
  })
  const visibleTableWidth = (Object.keys(columnWidths) as (keyof IotData)[])
    .filter((col) => visibleColumns[col])
    .reduce((sum, col) => sum + columnWidths[col], 112)
  const tableMinHeight = limit > 0 ? 49 * limit + 49 : 200

  // Toggle Column Visibility
  const toggleColumn = (col: keyof IotData) => {
    setVisibleColumns(prev => ({
      ...prev,
      [col]: !prev[col]
    }))
  }

  // CSV Exporter
  const exportToCSV = () => {
    if (data.length === 0) {
      showToast('ไม่มีข้อมูลสำหรับการดาวน์โหลด', 'error')
      return
    }
    const headers = Object.keys(columnLabels) as (keyof IotData)[]
    const csvRows = []

    // Header row
    csvRows.push(headers.map(h => `"${columnLabels[h]}"`).join(','))

    // Data rows
    for (const row of data) {
      const values = headers.map(h => {
        const val = row[h]
        return val !== null && val !== undefined ? `"${String(val).replace(/"/g, '""')}"` : '""'
      })
      csvRows.push(values.join(','))
    }

    const csvContent = "\uFEFF" + csvRows.join('\n') // Include BOM for Excel support with Thai letters
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `iot_data_export_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    showToast('ดาวน์โหลดไฟล์ CSV เรียบร้อยแล้ว')
  }

  return (
    <div className={`app-container ${sidebarOpen ? 'sidebar-expanded' : 'sidebar-collapsed'}`}>
      {/* Toast Notification Area */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.type === 'success' ? (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            ) : (
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* 1. Navbar */}
      <header className="navbar">
        <div className="navbar-left">
          <button
            className="sidebar-toggle-btn"
            onClick={() => toggleSidebar()}
            title={sidebarOpen ? "ซ่อนเมนูบาร์" : "แสดงเมนูบาร์"}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
          <div className="navbar-brand">
            <div className="brand-dot"></div>
            <span className="brand-title">IoT Monitor</span>
          </div>
        </div>

        <div className="navbar-right">
          <div className="connection-status">
            <span className="pulse-indicator online"></span>
            <span className="status-label-text">Go API Server: Connected</span>
          </div>
          {/* Real-time SSE indicator */}
          {activeView === 'logs' && page === 1 && debouncedSearch === '' && (
            <div className={`sse-status ${sseConnected ? 'sse-on' : 'sse-off'}`} title={sseConnected ? 'Real-time เชื่อมต่ออยู่' : 'กำลังเชื่อมต่อ real-time...'}>
              <span className={`pulse-indicator ${sseConnected ? 'online' : 'offline'}`}></span>
              <span className="status-label-text">
                {sseConnected ? 'Live' : 'Connecting...'}
              </span>
              {newRowCount > 0 && (
                <span
                  className="new-row-badge"
                  title={`มีข้อมูลใหม่ ${newRowCount} แถว`}
                  onClick={() => setNewRowCount(0)}
                >
                  +{newRowCount}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="main-layout">
        {/* 2. Sidebar (Menu Bar) */}
        <aside className="sidebar">
          <div className="sidebar-menu">
            <div className="sidebar-section-title">เมนูระบบ</div>

            <button
              className={`menu-item ${activeView === 'logs' ? 'active' : ''}`}
              onClick={() => navigate('logs')}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <span>Log Data</span>
            </button>

            <button
              className={`menu-item ${activeView === 'devices' ? 'active' : ''}`}
              onClick={() => navigate('devices')}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
              </svg>
              <span>Device Status</span>
            </button>

            <button
              className={`menu-item ${activeView === 'gateway' ? 'active' : ''}`}
              onClick={() => navigate('gateway')}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h7.5M8.25 12h7.5m-7.5 5.25h7.5M3.75 4.5v15A2.25 2.25 0 006 21h12a2.25 2.25 0 002.25-2.25V4.5A2.25 2.25 0 0018 2.25H6A2.25 2.25 0 003.75 4.5z" />
              </svg>
              <span>API Gateway</span>
            </button>

            <button
              className={`menu-item ${activeView === 'followup' ? 'active' : ''}`}
              onClick={() => navigate('followup')}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3.75h10.5A2.25 2.25 0 0119.5 6v12A2.25 2.25 0 0117.25 20.25H6.75A2.25 2.25 0 014.5 18V6a2.25 2.25 0 012.25-2.25z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 8.25h7.5M8.25 12h7.5M8.25 15.75h4.5" />
              </svg>
              <span>Follow Up On Work</span>
            </button>
          </div>

          <div className="sidebar-info-card">
            <div className="info-title">Go API Endpoint</div>
            <div className="info-value">10.0.0.32.71:8000</div>
          </div>
        </aside>

        {/* 3. Main content area */}
        <main className="dashboard-content">
          {activeView === 'logs' ? (
            <div className="dashboard">
              {/* Title & Info */}
              <div className="dashboard-header">
                <div className="dashboard-title-group">
                  <h1>IOT Data Monitoring</h1>
                  <p className="dashboard-subtitle">แสดงรายการข้อมูล RFID ที่รับมาจากอุปกรณ์ทั้งหมดเรียลไทม์</p>
                </div>
                <div className="action-buttons">
                  {/* Export to CSV Button */}
                  <button className="btn btn-secondary btn-export" onClick={exportToCSV} title="ส่งออกข้อมูลเป็นไฟล์ CSV">
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    <span>ส่งออก CSV</span>
                  </button>

                  {/* Refresh Button */}
                  <button className="btn btn-secondary" onClick={() => void fetchData()} title="รีเฟรชข้อมูล">
                    <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span>โหลดใหม่</span>
                  </button>
                </div>
              </div>

              {/* Main Datatable Card */}
              <div className="dashboard-card">
                {/* Controls: Search and Page Limit & Column Filter */}
                <div className="control-panel">
                  <div className="search-wrapper">
                    <svg className="search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <input
                      type="text"
                      className="search-input"
                      placeholder="Search ..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        className="search-clear-btn"
                        onClick={() => setSearchTerm('')}
                        title="Clear search"
                      >
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="panel-right-controls">
                    {/* Column Selector */}
                    <div className="column-selector-wrapper" ref={dropdownRef}>
                      <button className="btn btn-secondary btn-column-toggle" onClick={() => setShowColMenu(!showColMenu)}>
                        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-12-3h18m-18-6h18m-18-6h18" />
                        </svg>
                        <span>คอลัมน์ ({Object.values(visibleColumns).filter(Boolean).length})</span>
                      </button>
                      {showColMenu && (
                        <div className="column-dropdown">
                          <div className="column-dropdown-header">เลือกคอลัมน์ที่ต้องการแสดง</div>
                          <div className="column-dropdown-list">
                            {(Object.keys(columnLabels) as (keyof IotData)[]).map((col) => (
                              <label key={col} className="column-dropdown-item">
                                <input
                                  type="checkbox"
                                  checked={visibleColumns[col]}
                                  onChange={() => toggleColumn(col)}
                                />
                                <span>{columnLabels[col]}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="limit-selector">
                      <span>แสดง:</span>
                      <select
                        className="limit-select"
                        value={limit}
                        onChange={(e) => {
                          setLimit(Number(e.target.value))
                          setPage(1)
                        }}
                      >
                        <option value={5}>5 แถว</option>
                        <option value={10}>10 แถว</option>
                        <option value={25}>25 แถว</option>
                        <option value={50}>50 แถว</option>
                        <option value={-1}>ทั้งหมด</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Data Table */}
                <div
                  className={`table-responsive ${loading ? 'is-loading' : ''}`}
                  style={{ minHeight: `${tableMinHeight}px` }}
                  aria-busy={loading}
                >
                  {loading && (
                    <div className="loading-overlay">
                      <div className="spinner"></div>
                      <span>กำลังดึงข้อมูลจาก SQL Server...</span>
                    </div>
                  )}
                  {!loading && sortedData.length === 0 ? (
                    <div className="empty-state">
                      <svg className="empty-state-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                      <h3>ไม่พบข้อมูล IOT</h3>
                      <p>ไม่พบรายการที่ค้นหา หรือฐานข้อมูลยังไม่มีแถวข้อมูล</p>
                    </div>
                  ) : sortedData.length > 0 ? (
                    <table className="premium-table" style={{ minWidth: `${visibleTableWidth}px` }}>
                      <colgroup>
                        {(Object.keys(columnWidths) as (keyof IotData)[]).map((col) => (
                          visibleColumns[col] ? <col key={col} style={{ width: `${columnWidths[col]}px` }} /> : null
                        ))}
                        <col style={{ width: '112px' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          {(Object.keys(columnLabels) as (keyof IotData)[]).map((col) => {
                            if (!visibleColumns[col]) return null
                            return (
                              <th
                                key={col}
                                onClick={() => handleSort(col)}
                                style={{ cursor: 'pointer', userSelect: 'none' }}
                                className={sortField === col ? 'sorted-header' : ''}
                              >
                                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  <span>{columnLabels[col]}</span>
                                  {sortField === col ? (
                                    sortAsc ? (
                                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
                                      </svg>
                                    ) : (
                                      <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                      </svg>
                                    )
                                  ) : (
                                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.3 }}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
                                    </svg>
                                  )}
                                </div>
                              </th>
                            )
                          })}
                          <th style={{ textAlign: 'center' }}>การทำงาน</th>
                        </tr>
                      </thead>
                      <tbody key={displayedPage} className="table-page-enter">
                        {sortedData.map((row) => (
                          <tr
                            key={row.id}
                            className={`table-row-hover ${selectedRow?.id === row.id ? 'active-row' : ''} ${newRowIds.has(row.id) ? 'row-new' : ''}`}
                            onClick={() => setSelectedRow(row)}
                          >
                            {visibleColumns.id && (
                              <td className="bold-text" style={{ color: '#0f172a', fontWeight: 600 }}>
                                #{row.id}
                              </td>
                            )}
                            {visibleColumns.Status && <td>{renderStatus(row.Status, row.Status_Text)}</td>}
                            {visibleColumns.Status_Text && (
                              <td style={{ color: '#0f172a', fontWeight: 500 }}>
                                {row.Status_Text || '-'}
                              </td>
                            )}
                            {visibleColumns.Uid && <td><span className="code-text">{row.Uid || '-'}</span></td>}
                            {visibleColumns.Box && <td><span className="code-text">{row.Box || '-'}</span></td>}
                            {visibleColumns.Order && <td><span className="code-text">{row.Order || '-'}</span></td>}
                            {visibleColumns.Count && (
                              <td>
                                <span className="counter-num" style={{ fontWeight: 600, color: '#0f172a' }}>
                                  {row.Count}
                                </span>
                              </td>
                            )}
                            {visibleColumns.Time && <td>{row.Time || '-'}</td>}
                            {visibleColumns.Hour && <td><span className="code-text">{row.Hour} น.</span></td>}
                            {visibleColumns.Second && <td><span className="code-text">{row.Second} วิ.</span></td>}
                            {visibleColumns.PauseTime && <td>{row.PauseTime || '-'}</td>}
                            {visibleColumns.SN_mac && <td><span className="code-text">{row.SN_mac || '-'}</span></td>}
                            {visibleColumns.Key_button && (
                              <td>
                                <span className="code-text" style={{ fontWeight: 600 }}>
                                  {row.Key_button}
                                </span>
                              </td>
                            )}
                            {visibleColumns.Ip_address && <td><span className="code-text">{row.Ip_address || '-'}</span></td>}
                            {visibleColumns.SSID_wifi && <td><span className="code-text">{row.SSID_wifi || '-'}</span></td>}
                            {visibleColumns.Ref_id && (
                              <td>
                                <span className="code-text">
                                  {row.Ref_id !== null ? `#${row.Ref_id}` : '-'}
                                </span>
                              </td>
                            )}
                            {visibleColumns.Created_At && <td>{row.Created_At || '-'}</td>}

                            <td style={{ textAlign: 'center' }}>
                              <button
                                className="btn btn-danger"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setDeleteId(row.id)
                                }}
                                title="ลบแถวข้อมูลนี้"
                              >
                                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                                </svg>
                                <span style={{ marginLeft: '4px' }}>ลบ</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>

                {/* Pagination Panel */}
                {data.length > 0 && (
                  <div className="pagination-container">
                    <div className="pagination-info">
                      {limit === -1 ? (
                        <>แสดงทั้งหมด <span className="pagination-highlight">{total}</span> รายการ</>
                      ) : (
                        <>แสดง <span className="pagination-highlight">{((displayedPage - 1) * limit) + 1}</span> ถึง <span className="pagination-highlight">{((displayedPage - 1) * limit) + data.length}</span> จากทั้งหมด <span className="pagination-highlight">{total}</span> รายการ</>
                      )}
                    </div>

                    {limit !== -1 && (
                      <div className="pagination-buttons">
                        {/* First Page */}
                        <button
                          className={`page-btn ${page === 1 ? 'disabled' : ''}`}
                          onClick={() => page > 1 && setPage(1)}
                          disabled={page === 1}
                          title="หน้าแรก"
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                          </svg>
                        </button>

                        {/* Prev Page */}
                        <button
                          className={`page-btn ${page === 1 ? 'disabled' : ''}`}
                          onClick={() => page > 1 && setPage(page - 1)}
                          disabled={page === 1}
                          title="ย้อนกลับ"
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                          </svg>
                        </button>

                        {/* Numbered Pages */}
                        {getPageNumbers().map((p, idx) => (
                          <button
                            key={idx}
                            className={`page-btn ${p === page ? 'active' : ''} ${p === '...' ? 'disabled' : ''}`}
                            onClick={() => typeof p === 'number' && setPage(p)}
                            disabled={p === '...'}
                          >
                            {p}
                          </button>
                        ))}

                        {/* Next Page */}
                        <button
                          className={`page-btn ${page === totalPages ? 'disabled' : ''}`}
                          onClick={() => page < totalPages && setPage(page + 1)}
                          disabled={page === totalPages}
                          title="ถัดไป"
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </button>

                        {/* Last Page */}
                        <button
                          className={`page-btn ${page === totalPages ? 'disabled' : ''}`}
                          onClick={() => page < totalPages && setPage(totalPages)}
                          disabled={page === totalPages}
                          title="หน้าสุดท้าย"
                        >
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : activeView === 'devices' ? (
            <div className="dashboard">
              {/* Device Status — Box Ping Node View */}
              <div className="dashboard-header">
                <div className="dashboard-title-group">
                  <h1>Device Status</h1>
                  <p className="dashboard-subtitle">
                    สถานะการเชื่อมต่อของแต่ละ Box — อัปเดตทุก 30 วินาที
                  </p>
                </div>
                <div className="action-buttons">
                  <button
                    className="btn btn-secondary"
                    onClick={fetchBoxStatus}
                    disabled={boxStatusLoading}
                    title="รีเฟรชสถานะ ping"
                  >
                    <svg
                      width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                      style={{ animation: boxStatusLoading ? 'spin 0.8s linear infinite' : 'none' }}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    <span>{boxStatusLoading ? 'กำลัง ping...' : 'รีเฟรช'}</span>
                  </button>
                </div>
              </div>

              {/* Summary bar */}
              {!boxStatusLoading && boxStatuses.length > 0 && (
                <div className="box-status-summary">
                  <div className="summary-chip online">
                    <span className="summary-dot online"></span>
                    Online: {boxStatuses.filter(b => b.online).length}
                  </div>
                  <div className="summary-chip offline">
                    <span className="summary-dot offline"></span>
                    Offline: {boxStatuses.filter(b => !b.online).length}
                  </div>
                  <div className="summary-chip total">
                    ทั้งหมด: {boxStatuses.length} Box
                  </div>
                </div>
              )}

              {/* Node Grid */}
              {boxStatusLoading && boxStatuses.length === 0 ? (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <span>กำลัง ping อุปกรณ์ทั้งหมด...</span>
                </div>
              ) : boxStatusError ? (
                <div className="empty-state">
                  <svg className="empty-state-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <h3>ไม่สามารถดึงข้อมูลสถานะได้</h3>
                  <p>{boxStatusError}</p>
                </div>
              ) : boxStatuses.length === 0 ? (
                <div className="empty-state">
                  <svg className="empty-state-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                  </svg>
                  <h3>ไม่พบข้อมูล Box ในระบบ</h3>
                  <p>ยังไม่มีข้อมูล Box ที่มี IP address ใน dbo.iot_data</p>
                </div>
              ) : (
                <div className="box-node-grid">
                  {boxStatuses.map((box) => (
                    <div
                      key={box.box}
                      className={`box-node ${box.online ? 'box-node-online' : 'box-node-offline'}`}
                      onMouseEnter={(e) => {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setTooltipNode({
                          box,
                          x: rect.left + rect.width / 2,
                          y: rect.top - 12,
                        })
                      }}
                      onMouseLeave={() => setTooltipNode(null)}
                    >
                      {/* Pulse ring for online nodes */}
                      {box.online && <span className="node-pulse-ring" />}

                      {/* Icon */}
                      <div className="node-icon">
                        <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                        </svg>
                      </div>

                      {/* Box name */}
                      <span className="node-label">{box.box}</span>

                      {/* Status dot + text */}
                      <span className={`node-status-text ${box.online ? 'online' : 'offline'}`}>
                        <span className={`node-dot ${box.online ? 'online' : 'offline'}`} />
                        {box.online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Floating Tooltip */}
              {tooltipNode && (
                <div
                  className="node-tooltip"
                  style={{
                    left: tooltipNode.x,
                    top: tooltipNode.y,
                  }}
                >
                  <div className="tooltip-row tooltip-title">{tooltipNode.box.box}</div>
                  <div className="tooltip-row">
                    <span className="tooltip-label">IP Address</span>
                    <span className="tooltip-value">{tooltipNode.box.ip}</span>
                  </div>
                  <div className="tooltip-row">
                    <span className="tooltip-label">SN / MAC</span>
                    <span className="tooltip-value">{tooltipNode.box.sn_mac || '-'}</span>
                  </div>
                  <div className="tooltip-row">
                    <span className="tooltip-label">UID</span>
                    <span className="tooltip-value">{tooltipNode.box.uid || '-'}</span>
                  </div>
                  <div className="tooltip-row">
                    <span className="tooltip-label">Last Seen</span>
                    <span className="tooltip-value">{tooltipNode.box.last_seen || '-'}</span>
                  </div>
                  <div className={`tooltip-status ${tooltipNode.box.online ? 'online' : 'offline'}`}>
                    <span className={`node-dot ${tooltipNode.box.online ? 'online' : 'offline'}`} />
                    {tooltipNode.box.online ? 'Online' : 'Offline'}
                  </div>
                </div>
              )}
            </div>
          ) : activeView === 'gateway' ? (
            <APIGateway showToast={showToast} />
          ) : (
            <FollowUpWork showToast={showToast} />
          )}
        </main>
      </div>

      {/* 4. Footer */}
      <footer className="app-footer">
        <div className="footer-left">
          <span>© 2026 <strong>IoT Monitor</strong></span>
        </div>
        <div className="footer-right">
          <div className="system-version">System Version v1.2.0</div>
          <span className="divider-dot">•</span>
          <div className="db-status">
            <span className="status-indicator-green"></span>
            Database connection: Active
          </div>
        </div>
      </footer>

      {/* Row Details Sidebar / Drawer */}
      {selectedRow && (
        <div className="drawer-overlay" onClick={() => setSelectedRow(null)}>
          <div className="drawer-content" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div className="drawer-title-group">
                <h3>รายละเอียดข้อมูล IoT</h3>
                <span className="drawer-subtitle-id">ID: #{selectedRow.id}</span>
              </div>
              <button className="drawer-close-btn" onClick={() => setSelectedRow(null)} title="ปิดหน้าต่าง">
                <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="drawer-body">
              {/* Primary Status Card */}
              <div className="drawer-status-card">
                <div className="status-label">สถานะการทำงานปัจจุบัน</div>
                <div className="status-badge-container">
                  {renderStatus(selectedRow.Status, selectedRow.Status_Text)}
                  <span className="status-text-raw">{selectedRow.Status_Text || 'ไม่มีข้อมูลข้อความ'}</span>
                </div>
              </div>

              {/* Grid of Fields */}
              <div className="drawer-details-grid">
                <div className="detail-item">
                  <span className="detail-label">UID (รหัสอุปกรณ์)</span>
                  <div className="detail-copy-row">
                    <span className="detail-val code-text">{selectedRow.Uid || '-'}</span>
                    <button
                      type="button"
                      className={`detail-copy-btn ${copiedUid === selectedRow.Uid ? 'copied' : ''}`}
                      onClick={() => void copyUID(selectedRow.Uid || '')}
                      title="Copy UID"
                    >
                      {copiedUid === selectedRow.Uid ? (
                        <>
                          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          <span className="copy-label">คัดลอก</span>
                        </>
                      ) : (
                        <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 7.5V6A2.25 2.25 0 0110.5 3.75h7.5A2.25 2.25 0 0120.25 6v7.5A2.25 2.25 0 0118 15.75h-1.5m-8.25-8.25H6A2.25 2.25 0 003.75 9.75v8.25A2.25 2.25 0 006 20.25h8.25a2.25 2.25 0 002.25-2.25V9.75A2.25 2.25 0 0014.25 7.5H8.25z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Box (กล่อง)</span>
                  <span className="detail-val code-text">{selectedRow.Box || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Order</span>
                  <span className="detail-val code-text">{selectedRow.Order || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Count (นับจำนวน)</span>
                  <span className="detail-val number-val">{selectedRow.Count}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Ref ID (รหัสอ้างอิง)</span>
                  <span className="detail-val code-text">{selectedRow.Ref_id !== null ? `#${selectedRow.Ref_id}` : '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Time (เวลา)</span>
                  <span className="detail-val">{selectedRow.Time || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Pause Time (เวลาหยุดพัก)</span>
                  <span className="detail-val">{selectedRow.PauseTime || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Hour (ชั่วโมง)</span>
                  <span className="detail-val code-text">{selectedRow.Hour} น.</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Second (วินาที)</span>
                  <span className="detail-val code-text">{selectedRow.Second} วิ.</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">WiFi SSID</span>
                  <span className="detail-val code-text">{selectedRow.SSID_wifi || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">IP Address</span>
                  <span className="detail-val code-text">{selectedRow.Ip_address || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">SN / MAC</span>
                  <span className="detail-val code-text">{selectedRow.SN_mac || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Key Button</span>
                  <span className="detail-val code-text">{selectedRow.Key_button}</span>
                </div>
              </div>

              {/* Timestamp Card */}
              <div className="drawer-footer-card">
                <div className="footer-card-item">
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>สร้างเมื่อ: {selectedRow.Created_At || '-'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteId !== null && (
        <div className="modal-overlay" onClick={() => setDeleteId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon">
              <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h3 className="modal-title">ยืนยันการลบข้อมูล</h3>
            <p className="modal-desc">คุณต้องการลบแถวข้อมูล ID #{deleteId} ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteId(null)}>
                ยกเลิก
              </button>
              <button className="btn btn-primary" style={{ background: '#ef4444' }} onClick={handleDeleteConfirm}>
                ยืนยันการลบ
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
