import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE_URL } from './config'

interface APIRoute {
  id: number
  device_name: string
  protocol: string | null
  host: string
  port: number
  status: string | null
  detail: string | null
}

interface APIDetail {
  id: number
  host: string
  port: number
  protocol: string | null
  detail: string | null
}

interface Props {
  showToast: (message: string, type?: 'success' | 'error') => void
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json()
    return body.detail || fallback
  } catch {
    return fallback
  }
}

export default function APIGateway({ showToast }: Props) {
  const [routes, setRoutes] = useState<APIRoute[]>([])
  const [details, setDetails] = useState<APIDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<APIRoute | null>(null)
  const [boxName, setBoxName] = useState('')
  const [detailID, setDetailID] = useState('')
  const [editStatus, setEditStatus] = useState('ACTIVE')
  const [saving, setSaving] = useState(false)
  const [updatedRouteID, setUpdatedRouteID] = useState<number | null>(null)

  const loadRoutes = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api-routes`)
      if (!response.ok) throw new Error(await responseError(response, 'Failed to load API routes'))
      const body = await response.json()
      setRoutes(body.data || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load API routes', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  const loadDetails = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api-details`)
      if (!response.ok) throw new Error(await responseError(response, 'Failed to load API details'))
      const body = await response.json()
      setDetails(body.data || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load API details', 'error')
    }
  }, [showToast])

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void loadRoutes()
      void loadDetails()
    }, 0)
    return () => window.clearTimeout(initialLoad)
  }, [loadRoutes, loadDetails])

  const filteredRoutes = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return routes
    return routes.filter((route) =>
      [route.device_name, route.protocol, route.host, route.port, route.status, route.detail]
        .some((value) => String(value ?? '').toLowerCase().includes(term)),
    )
  }, [routes, search])

  const totalPages = Math.max(1, Math.ceil(filteredRoutes.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRoutes = useMemo(
    () => filteredRoutes.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredRoutes, currentPage, pageSize],
  )

  const pageNumbers = useMemo(() => {
    const pages: number[] = []
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4))
    const end = Math.min(totalPages, start + 4)
    for (let value = Math.max(1, end - 4); value <= end; value += 1) pages.push(value)
    return pages
  }, [currentPage, totalPages])

  const openCreate = () => {
    setBoxName('')
    setDetailID('')
    setShowCreate(true)
  }

  const createRoute = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!boxName.trim() || !detailID) return
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api-routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: boxName.trim(), api_detail_id: Number(detailID) }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Failed to create API route'))
      setShowCreate(false)
      showToast('Box added successfully')
      await loadRoutes()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to create API route', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (route: APIRoute) => {
    const currentDetail = details.find((detail) =>
      detail.host === route.host && detail.port === route.port &&
      (detail.protocol || '') === (route.protocol || ''),
    )
    setDetailID(currentDetail ? String(currentDetail.id) : '')
    setEditStatus((route.status || 'ACTIVE').toUpperCase())
    setEditing(route)
  }

  const updateRoute = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing || !detailID) return
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api-routes/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_detail_id: Number(detailID), status: editStatus }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Failed to update API route'))
      const updatedRoute: APIRoute = await response.json()
      setRoutes((current) => current.map((route) => route.id === updatedRoute.id ? updatedRoute : route))
      setEditing(null)
      setUpdatedRouteID(updatedRoute.id)
      window.setTimeout(() => setUpdatedRouteID(null), 1800)
      showToast(`API route for ${updatedRoute.device_name} updated successfully`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update API route', 'error')
    } finally {
      setSaving(false)
    }
  }

  const selectedDetail = details.find((detail) => detail.id === Number(detailID))

  return (
    <div className="dashboard gateway-page">
      <div className="dashboard-header">
        <div className="dashboard-title-group">
          <h1>API Gateway</h1>
          <p className="dashboard-subtitle">จัดการ API ปลายทางสำหรับ Box IoT</p>
        </div>
        <div className="action-buttons">
          <button className="btn btn-secondary" onClick={openCreate}>+ Add Box</button>
        </div>
      </div>

      <div className="dashboard-card">
        <div className="control-panel gateway-controls">
          <div className="search-wrapper">
            <svg className="search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 105.2 5.2a7.5 7.5 0 0010.6 10.6z" />
            </svg>
            <input className="search-input" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search ..." />
          </div>
          <div className="gateway-table-options">
            <span className="gateway-count">{filteredRoutes.length} records</span>
            <label className="limit-selector"><span>Show:</span><select className="limit-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}><option value={5}>5 rows</option><option value={10}>10 rows</option><option value={25}>25 rows</option><option value={50}>50 rows</option></select></label>
          </div>
        </div>

        <div className="table-responsive gateway-table-wrap" aria-busy={loading}>
          {loading ? (
            <div className="loading-overlay"><div className="spinner" /><span>กำลังโหลด API routes...</span></div>
          ) : filteredRoutes.length === 0 ? (
            <div className="empty-state"><h3>ไม่พบข้อมูล API Gateway</h3><p>เพิ่มรายการใหม่โดยเลือก API detail ที่ต้องการ</p></div>
          ) : (
            <table className="premium-table gateway-table">
              <thead><tr><th>Box name</th><th>Protocol</th><th>Host</th><th>Port</th><th>Status</th><th>Detail</th><th>จัดการ</th></tr></thead>
              <tbody>
                {pageRoutes.map((route) => (
                  <tr key={route.id} className={updatedRouteID === route.id ? 'gateway-row-updated' : ''}>
                    <td><strong>{route.device_name}</strong></td>
                    <td><span className="protocol-badge">{route.protocol || '-'}</span></td>
                    <td><span className="code-text">{route.host}</span></td>
                    <td><span className="code-text">{route.port}</span></td>
                    <td><span className={`route-status ${(route.status || '').toLowerCase()}`}>{route.status || '-'}</span></td>
                    <td className="gateway-detail">{route.detail || '-'}</td>
                    <td><button className="btn btn-secondary gateway-edit" onClick={() => openEdit(route)}><svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M16.86 3.49a2.1 2.1 0 113 3L8.25 18.1 4.5 19.5l1.4-3.75L16.86 3.49z" /></svg><span>แก้ไข</span></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!loading && filteredRoutes.length > 0 && (
          <div className="pagination-container">
            <div className="pagination-info">
              Showing <span className="pagination-highlight">{((currentPage - 1) * pageSize) + 1}</span> to <span className="pagination-highlight">{Math.min(currentPage * pageSize, filteredRoutes.length)}</span> of <span className="pagination-highlight">{filteredRoutes.length}</span> records
            </div>
            {totalPages > 1 && (
              <div className="pagination-buttons">
                <button className={`page-btn ${currentPage === 1 ? 'disabled' : ''}`} disabled={currentPage === 1} onClick={() => setPage(1)} title="First page">«</button>
                <button className={`page-btn ${currentPage === 1 ? 'disabled' : ''}`} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} title="Previous page">‹</button>
                {pageNumbers.map((number) => <button key={number} className={`page-btn ${number === currentPage ? 'active' : ''}`} onClick={() => setPage(number)}>{number}</button>)}
                <button className={`page-btn ${currentPage === totalPages ? 'disabled' : ''}`} disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)} title="Next page">›</button>
                <button className={`page-btn ${currentPage === totalPages ? 'disabled' : ''}`} disabled={currentPage === totalPages} onClick={() => setPage(totalPages)} title="Last page">»</button>
              </div>
            )}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => !saving && setShowCreate(false)}>
          <form className="modal-content gateway-modal" onSubmit={createRoute} onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">Add Box</h3>
            <p className="modal-desc">Enter a Box name and select the destination API detail.</p>
            <label className="form-field"><span>Box name</span><input autoFocus value={boxName} onChange={(event) => setBoxName(event.target.value)} placeholder="e.g. TEAM_D" maxLength={100} required /></label>
            <label className="form-field"><span>API detail</span><select value={detailID} onChange={(event) => setDetailID(event.target.value)} required><option value="">Select an API detail</option>{details.map((detail) => <option key={detail.id} value={detail.id}>{detail.detail || `API #${detail.id}`} — {detail.protocol || 'http'}://{detail.host}:{detail.port}</option>)}</select></label>
            {selectedDetail && <div className="selected-endpoint"><span>Endpoint</span><code>{selectedDetail.protocol || 'http'}://{selectedDetail.host}:{selectedDetail.port}</code></div>}
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={saving}>Cancel</button><button type="submit" className="btn btn-secondary gateway-submit" disabled={saving || !boxName.trim() || !detailID}>{saving ? 'Saving...' : 'Add Box'}</button></div>
          </form>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => !saving && setEditing(null)}>
          <form className="modal-content gateway-modal" onSubmit={updateRoute} onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">Edit API Gateway</h3>
            <p className="modal-desc">Select a new API detail for <strong>{editing.device_name}</strong>.</p>
            <div className="gateway-readonly"><span>Box name</span><strong>{editing.device_name}</strong></div>
            <label className="form-field"><span>API detail</span><select autoFocus value={detailID} onChange={(event) => setDetailID(event.target.value)} required><option value="">Select an API detail</option>{details.map((detail) => <option key={detail.id} value={detail.id}>{detail.detail || `API #${detail.id}`} — {detail.protocol || 'http'}://{detail.host}:{detail.port}</option>)}</select></label>
            <label className="form-field"><span>Status</span><select value={editStatus} onChange={(event) => setEditStatus(event.target.value)}><option value="ACTIVE">ACTIVE</option><option value="INACTIVE">INACTIVE</option></select></label>
            {selectedDetail && <div className="selected-endpoint"><span>New endpoint</span><code>{selectedDetail.protocol || 'http'}://{selectedDetail.host}:{selectedDetail.port}</code></div>}
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>Cancel</button><button type="submit" className="btn btn-secondary gateway-submit" disabled={saving || !detailID}>{saving ? 'Updating...' : 'Update'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
