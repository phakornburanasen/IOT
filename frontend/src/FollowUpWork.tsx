import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { API_BASE_URL } from './config'

interface Props {
  showToast: (message: string, type?: 'success' | 'error') => void
}

interface FollowUpSummary {
  uid: string
  team: string | null
  box_no: string | null
  start: string | null
  latest_status_at: string | null
  status: string | null
  emp_id: string | null
  user: string
  user_name: string | null
  key_button: number | null
  finish_at: string | null
}

interface FollowUpListResponse {
  data: FollowUpSummary[]
  total: number
  page: number
  limit: number
  total_pages: number
}

interface FollowUpDetail {
  rfid: string | null
  barcode: string | null
  qty: number | null
  saporder: string | null
  bundle: number | null
  style: string | null
  color: string | null
  progress: string | null
  source_key: string | null
}

interface FollowUpDetailResponse {
  summary: FollowUpSummary
  detail: FollowUpDetail
}

interface DetailLineProps {
  label: string
  value: ReactNode
  valueClassName?: string
}

interface ProgressState {
  current: number
  total: number
  percent: number
  showBar: boolean
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

async function parseApiError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: string; message?: string }
    return payload.error || payload.message || fallback
  } catch {
    return fallback
  }
}

function DetailLine({ label, value, valueClassName }: DetailLineProps) {
  return (
    <div className="detail-item detail-item-inline">
      <div className="detail-line">
        <span className="detail-label">{label}</span>
        <span className="detail-separator">:</span>
        <span className={valueClassName ? `detail-val ${valueClassName}` : 'detail-val'}>{value}</span>
      </div>
    </div>
  )
}

function getProgressState(detail: FollowUpDetailResponse | null): ProgressState {
  const progressStr = (detail?.detail.progress || '').trim()
  let current = 0
  let total = 0
  const match = progressStr.match(/^(\d+)\s*\/\s*(\d+)$/)

  if (match) {
    current = parseInt(match[1], 10)
    total = parseInt(match[2], 10)
  } else if (detail?.detail.qty != null && detail?.detail.bundle != null) {
    current = detail.detail.qty
    total = detail.detail.bundle
  }

  return {
    current,
    total,
    percent: total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0,
    showBar: total > 0,
  }
}

function isSummaryFinished(summary: FollowUpSummary) {
  const statusLower = (summary.status || '').trim().toLowerCase()
  const hasFinishAt = Boolean(summary.finish_at && summary.finish_at.trim())

  return summary.key_button === 7
    || hasFinishAt
    || statusLower === 'finish'
    || statusLower === 'finished'
}

function getStatusTimestamp(summary: FollowUpSummary) {
  const isFinished = isSummaryFinished(summary)

  if (isFinished) {
    return summary.finish_at || summary.start || '-'
  }

  return summary.latest_status_at || summary.start || '-'
}

function getStatusKind(summary: FollowUpSummary) {
  const statusLower = (summary.status || '').trim().toLowerCase()

  if (isSummaryFinished(summary)) {
    return 'finished'
  }
  if (statusLower === 'count' || statusLower === 'running' || statusLower === 'run') {
    return 'running'
  }
  if (statusLower === 'pause' || statusLower.startsWith('pause')) {
    return 'paused'
  }
  return 'default'
}

export default function FollowUpWork({ showToast }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<FollowUpSummary[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<FollowUpDetailResponse | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchTerm.trim())
      setPage(1)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchTerm])

  useEffect(() => {
    let cancelled = false

    async function fetchList() {
      const query = debouncedSearch.trim()
      if (query === '') {
        setHasSearched(false)
        setRows([])
        setTotal(0)
        setTotalPages(0)
        setSelectedUid(null)
        setDetail(null)
        setLoading(false)
        return
      }

      setHasSearched(true)
      setLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          limit: String(limit),
        })
        params.set('search', query)

        const response = await fetch(`${API_BASE_URL}/follow-up-work?${params.toString()}`)
        if (!response.ok) {
          throw new Error(await parseApiError(response, 'Failed to load follow-up work'))
        }

        const payload = await response.json() as FollowUpListResponse
        if (cancelled) return

        setRows(payload.data)
        setTotal(payload.total)
        setTotalPages(payload.total_pages)

        if (payload.data.length === 0) {
          setSelectedUid(null)
          setDetail(null)
          return
        }

        const nextSelected = selectedUid && payload.data.some((item) => item.uid === selectedUid)
          ? selectedUid
          : payload.data[0].uid
        setSelectedUid(nextSelected)
      } catch (error) {
        if (!cancelled) {
          showToast(readErrorMessage(error, 'Failed to load follow-up work'), 'error')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchList()
    return () => {
      cancelled = true
    }
  }, [page, limit, debouncedSearch, reloadKey, showToast])

  useEffect(() => {
    if (!selectedUid) {
      setDetail(null)
      return
    }
    const uid = selectedUid

    let cancelled = false

    async function fetchDetail() {
      setDetailLoading(true)
      try {
        const response = await fetch(`${API_BASE_URL}/follow-up-work-detail?uid=${encodeURIComponent(uid)}`)
        if (!response.ok) {
          throw new Error(await parseApiError(response, 'Failed to load work detail'))
        }

        const payload = await response.json() as FollowUpDetailResponse
        if (!cancelled) {
          setDetail(payload)
        }
      } catch (error) {
        if (!cancelled) {
          setDetail(null)
          showToast(readErrorMessage(error, 'Failed to load work detail'), 'error')
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false)
        }
      }
    }

    void fetchDetail()
    return () => {
      cancelled = true
    }
  }, [selectedUid, showToast])

  const listSummary = useMemo(
    () => rows.find((item) => item.uid === selectedUid) ?? null,
    [rows, selectedUid],
  )
  // The detail endpoint is queried after selecting a row, so it is the
  // authoritative source for statuses that may change after the list loads.
  const selectedSummary = detail?.summary.uid === selectedUid ? detail.summary : listSummary

  return (
    <div className="dashboard followup-dashboard">
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>Follow Up On Work</h1>
          <p className="dashboard-subtitle">ติดตามสถานะงานจาก RFID พร้อมข้อมูลพนักงานและรายละเอียด bundle จากระบบภายนอก</p>
        </div>
        <div className="action-buttons">
          <button
            className="btn btn-secondary"
            onClick={() => setReloadKey((value) => value + 1)}
            disabled={!debouncedSearch.trim()}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            <span>รีโหลด</span>
          </button>
        </div>
      </div>

      <div className="dashboard-card">
        <div className="control-panel followup-controls">
          <div className="search-wrapper">
            <svg className="search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="ค้นหา barcode / RFID"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
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

          <div className="followup-toolbar">
            <div className="limit-selector">
              <span>แสดง:</span>
              <select
                className="limit-select"
                value={limit}
                onChange={(event) => {
                  setLimit(Number(event.target.value))
                  setPage(1)
                }}
              >
                <option value={10}>10 แถว</option>
                <option value={20}>20 แถว</option>
                <option value={50}>50 แถว</option>
              </select>
            </div>
            <div className="gateway-count">ทั้งหมด {total} รายการ</div>
          </div>
        </div>

        <div className="followup-layout">
          <section className="followup-list-panel">
            {loading ? (
              <div className="loading-overlay followup-loading">
                <div className="spinner"></div>
                <span>กำลังดึงข้อมูลติดตามงาน...</span>
              </div>
            ) : !hasSearched ? (
              <div className="empty-state">
                <svg className="empty-state-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <h3>พร้อมค้นหาข้อมูล</h3>
                <p>พิมพ์ Barcode หรือ RFID ในช่องค้นหาเพื่อแสดงรายการติดตามงาน</p>
              </div>
            ) : rows.length === 0 ? (
              <div className="empty-state">
                <svg className="empty-state-icon" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.125 10.5a3.375 3.375 0 116.75 0c0 1.45-.911 2.687-2.192 3.176-.62.237-1.058.81-1.058 1.474v.225m0 3.375h.008v.008h-.008v-.008z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3.75a8.25 8.25 0 100 16.5 8.25 8.25 0 000-16.5z" />
                </svg>
                <h3>ไม่พบข้อมูล</h3>
                <p>ลองค้นหาด้วย RFID หรือ barcode อื่น</p>
              </div>
            ) : (
              <>
                <div className="followup-table-wrap">
                  <table className="premium-table followup-table">
                    <thead>
                      <tr>
                        <th>Barcode / RFID</th>
                        <th>Team</th>
                        <th>BoxNo.</th>
                        <th>Start</th>
                        <th>Status</th>
                        <th>User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.uid}
                          className={`table-row-hover ${selectedUid === row.uid ? 'active-row' : ''}`}
                          onClick={() => setSelectedUid(row.uid)}
                        >
                          <td><span className="code-text">{row.uid}</span></td>
                          <td>{row.team || '-'}</td>
                          <td><span className="code-text">{row.box_no || '-'}</span></td>
                          <td>{row.start || '-'}</td>
                          <td>{row.status || '-'}</td>
                          <td className="followup-user-cell">{row.user || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="pagination-container">
                  <div className="pagination-info">
                    แสดง <span className="pagination-highlight">{rows.length}</span> จากทั้งหมด <span className="pagination-highlight">{total}</span> รายการ
                  </div>
                  {totalPages > 1 && (
                    <div className="pagination-buttons">
                      <button className={`page-btn ${page === 1 ? 'disabled' : ''}`} disabled={page === 1} onClick={() => setPage(page - 1)}>
                        ก่อนหน้า
                      </button>
                      <button className="page-btn active">{page}</button>
                      <button className={`page-btn ${page >= totalPages ? 'disabled' : ''}`} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                        ถัดไป
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>

          <aside className="followup-detail-panel">
            <div className="followup-detail-header">
              <div>
                <h2>รายละเอียดงาน</h2>
                <p>{selectedSummary ? `Barcode / RFID : ${selectedSummary.uid} ${isSummaryFinished(selectedSummary) ? 'Finished' : ''}` : 'เลือกรายการเพื่อดูรายละเอียด'}</p>
              </div>
              {detail?.detail.source_key && (
                <span className="status-badge status-other">source: {detail.detail.source_key}</span>
              )}
            </div>

            {detailLoading ? (
              <div className="loading-overlay followup-detail-loading">
                <div className="spinner"></div>
                <span>กำลังดึงรายละเอียดงาน...</span>
              </div>
            ) : !hasSearched ? (
              <div className="empty-state followup-detail-empty">
                <h3>ยังไม่มีข้อมูลแสดง</h3>
                <p>เริ่มจากค้นหา Barcode หรือ RFID ก่อน แล้วค่อยเลือกแถวเพื่อดูรายละเอียดงาน</p>
              </div>
            ) : !selectedSummary ? (
              <div className="empty-state followup-detail-empty">
                <h3>ยังไม่ได้เลือกรายการ</h3>
                <p>คลิกแถวทางซ้ายเพื่อดูข้อมูลสรุปและรายละเอียดงาน</p>
              </div>
            ) : (
              <div className="followup-detail-body">
                <div className="followup-summary-grid">
                  <div className="detail-item followup-progress-card">
                    <div className="followup-progress-header">
                      <span className="detail-label">PROGRESS</span>
                      {(() => {
                        const isFinished = isSummaryFinished(selectedSummary)
                        const statusLower = (selectedSummary.status || '').toLowerCase()
                        const isCounting = !isFinished && statusLower === 'count'
                        if (isCounting) {
                          return <span className="pulse-dot" aria-label="Running" />
                        }
                        return null
                      })()}
                    </div>
                    {(() => {
                      const isFinished = isSummaryFinished(selectedSummary)
                      const { current, total, percent, showBar } = getProgressState(detail)
                      const isComplete = isFinished || percent >= 100
                      if (!showBar) {
                        return <span className="detail-val followup-muted">-</span>
                      }
                      return (
                        <div className="followup-progress-value">
                          <div className="followup-progress-bar">
                            <div
                              className={`followup-progress-fill ${isComplete ? 'is-finished' : ''}`}
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <div className="followup-progress-meta">
                            <span className="followup-progress-text">{current}/{total} ชิ้น</span>
                            <span className={`followup-progress-percent ${isComplete ? 'is-finished' : ''}`}>
                              {percent}%
                            </span>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                  <DetailLine label="Barcode / RFID" value={selectedSummary.uid} valueClassName="code-text" />
                  <DetailLine label="Team" value={selectedSummary.team || '-'} />
                  <DetailLine label="BoxNo." value={selectedSummary.box_no || '-'} valueClassName="code-text" />
                  <DetailLine label="Start" value={selectedSummary.start || '-'} />
                  <div className="detail-item">
                    <div className="detail-line">
                      <span className="detail-label">Status</span>
                      <span className="detail-separator">:</span>
                      {(() => {
                        const isFinished = isSummaryFinished(selectedSummary)
                        const statusKind = getStatusKind(selectedSummary)
                        const isCounting = statusKind === 'running'
                        const isPaused = statusKind === 'paused'
                        const statusTimestamp = getStatusTimestamp(selectedSummary)
                        if (isFinished) {
                          return (
                            <div className="status-finished">
                              <span>finish</span>
                              <span className="status-finished-time">{statusTimestamp}</span>
                            </div>
                          )
                        }
                        if (isCounting) {
                          return (
                            <div className="status-counting">
                              <span className="pulse-dot" />
                              <span>Running...</span>
                              <span className="status-inline-time">{statusTimestamp}</span>
                            </div>
                          )
                        }
                        if (isPaused) {
                          return (
                            <div className="status-paused">
                              <span className="status-symbol" aria-hidden="true">||</span>
                              <span>{selectedSummary.status || 'Pause'}</span>
                              <span className="status-inline-time">{statusTimestamp}</span>
                            </div>
                          )
                        }
                        return (
                          <div className="status-neutral">
                            <span className="status-symbol status-symbol-dot" aria-hidden="true">•</span>
                            <span className="detail-val">{selectedSummary.status || '-'}</span>
                            <span className="status-inline-time">{statusTimestamp}</span>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                  <DetailLine label="User" value={selectedSummary.user || '-'} />
                </div>

                <div className="dashboard-divider"></div>

                <div className="followup-bundle-grid">
                  <DetailLine label="RFID" value={detail?.detail.rfid || '-'} valueClassName="code-text" />
                  <DetailLine label="BARCODE" value={detail?.detail.barcode || '-'} valueClassName="code-text" />
                  <DetailLine label="QTY" value={detail?.detail.qty ?? '-'} valueClassName="followup-muted" />
                  <DetailLine label="SAPORDER" value={detail?.detail.saporder || '-'} valueClassName="code-text" />
                  <DetailLine label="BUNDLE" value={detail?.detail.bundle ?? '-'} valueClassName="followup-muted" />
                  <DetailLine label="STYLE" value={detail?.detail.style || '-'} />
                  <DetailLine label="COLOR" value={detail?.detail.color || '-'} valueClassName="followup-muted" />
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
