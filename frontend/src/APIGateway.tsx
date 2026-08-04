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
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<APIRoute | null>(null)
  const [boxName, setBoxName] = useState('')
  const [detailID, setDetailID] = useState('')
  const [saving, setSaving] = useState(false)

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
      showToast('เพิ่ม API Gateway เรียบร้อยแล้ว')
      await loadRoutes()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to create API route', 'error')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (route: APIRoute) => {
    setBoxName(route.device_name)
    setEditing(route)
  }

  const updateRoute = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editing || !boxName.trim()) return
    setSaving(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api-routes/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: boxName.trim() }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Failed to update Box name'))
      setEditing(null)
      showToast('แก้ไข Box name เรียบร้อยแล้ว')
      await loadRoutes()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update Box name', 'error')
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
          <button className="btn btn-secondary" onClick={() => void loadRoutes()} disabled={loading}>รีเฟรช</button>
          <button className="btn btn-primary" onClick={openCreate}>+ เพิ่ม API Gateway</button>
        </div>
      </div>

      <div className="dashboard-card">
        <div className="control-panel gateway-controls">
          <div className="search-wrapper">
            <svg className="search-icon" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.2-5.2m0 0A7.5 7.5 0 105.2 5.2a7.5 7.5 0 0010.6 10.6z" />
            </svg>
            <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา Box, Host, Detail..." />
          </div>
          <span className="gateway-count">ทั้งหมด {filteredRoutes.length} รายการ</span>
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
                {filteredRoutes.map((route) => (
                  <tr key={route.id}>
                    <td><strong>{route.device_name}</strong></td>
                    <td><span className="protocol-badge">{route.protocol || '-'}</span></td>
                    <td><span className="code-text">{route.host}</span></td>
                    <td><span className="code-text">{route.port}</span></td>
                    <td><span className={`route-status ${(route.status || '').toLowerCase()}`}>{route.status || '-'}</span></td>
                    <td className="gateway-detail">{route.detail || '-'}</td>
                    <td><button className="btn btn-secondary gateway-edit" onClick={() => openEdit(route)}>แก้ไข</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => !saving && setShowCreate(false)}>
          <form className="modal-content gateway-modal" onSubmit={createRoute} onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">เพิ่ม API Gateway</h3>
            <p className="modal-desc">ระบุชื่อ Box และเลือก API detail ปลายทาง</p>
            <label className="form-field"><span>Box name</span><input autoFocus value={boxName} onChange={(event) => setBoxName(event.target.value)} placeholder="เช่น TEAM_D" maxLength={100} required /></label>
            <label className="form-field"><span>API detail</span><select value={detailID} onChange={(event) => setDetailID(event.target.value)} required><option value="">เลือกรายละเอียด API</option>{details.map((detail) => <option key={detail.id} value={detail.id}>{detail.detail || `API #${detail.id}`} — {detail.protocol || 'http'}://{detail.host}:{detail.port}</option>)}</select></label>
            {selectedDetail && <div className="selected-endpoint"><span>Endpoint</span><code>{selectedDetail.protocol || 'http'}://{selectedDetail.host}:{selectedDetail.port}</code></div>}
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)} disabled={saving}>ยกเลิก</button><button type="submit" className="btn btn-primary" disabled={saving || !boxName.trim() || !detailID}>{saving ? 'กำลังบันทึก...' : 'เพิ่มข้อมูล'}</button></div>
          </form>
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => !saving && setEditing(null)}>
          <form className="modal-content gateway-modal" onSubmit={updateRoute} onClick={(event) => event.stopPropagation()}>
            <h3 className="modal-title">แก้ไข Box name</h3>
            <p className="modal-desc"><span className="code-text">{editing.protocol || 'http'}://{editing.host}:{editing.port}</span></p>
            <label className="form-field"><span>Box name</span><input autoFocus value={boxName} onChange={(event) => setBoxName(event.target.value)} maxLength={100} required /></label>
            <div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>ยกเลิก</button><button type="submit" className="btn btn-primary" disabled={saving || !boxName.trim()}>{saving ? 'กำลังบันทึก...' : 'บันทึก'}</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
