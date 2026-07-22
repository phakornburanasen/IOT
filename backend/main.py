import logging
import json
import subprocess
import platform
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Optional, AsyncGenerator
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import pyodbc

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("backend")

app = FastAPI(title="IOT Data API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONN_STR = (
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=10.0.32.70;"
    "DATABASE=LPMS_ALL;"
    "UID=IOT;"
    "PWD=shop#floor;"
    "TrustServerCertificate=yes;"
)

# Prefix ที่ frontend ใช้
PREFIX = "/api"


def get_db_connection():
    try:
        return pyodbc.connect(CONN_STR)
    except Exception as e:
        logger.error(f"Database connection error: {e}")
        raise HTTPException(status_code=500, detail="Cannot connect to the database")


def format_dt(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.strftime("%d/%m/%Y %H:%M:%S")


# ─────────────────────────────────────────────
# Ping helper — sync, ใช้ subprocess.run ธรรมดา
# รัน concurrent ผ่าน ThreadPoolExecutor
# ─────────────────────────────────────────────
def ping_host_sync(ip: str) -> bool:
    """Ping ip หนึ่งครั้ง คืน True ถ้า reachable"""
    try:
        ip = ip.strip()
        if not ip:
            return False
        if platform.system().lower() == "windows":
            cmd = ["ping", "-n", "1", "-w", "1500", ip]
        else:
            cmd = ["ping", "-c", "1", "-W", "2", ip]

        result = subprocess.run(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        online = result.returncode == 0
        logger.info(f"ping {ip} -> {'online' if online else 'offline'}")
        return online
    except Exception as e:
        logger.warning(f"ping {ip} exception: {e}")
        return False


def ping_all(boxes_info: list) -> dict:
    """Ping ทุก IP พร้อมกัน คืน dict {ip: bool}"""
    results: dict = {}
    with ThreadPoolExecutor(max_workers=min(32, len(boxes_info))) as executor:
        future_to_ip = {
            executor.submit(ping_host_sync, b["ip"]): b["ip"]
            for b in boxes_info
        }
        for future in as_completed(future_to_ip):
            ip = future_to_ip[future]
            try:
                results[ip] = future.result()
            except Exception:
                results[ip] = False
    return results


# ─────────────────────────────────────────────
# GET /api/RFID/api/iot-data
# ─────────────────────────────────────────────
@app.get(f"{PREFIX}/iot-data")
def get_iot_data(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=-1),
    search: Optional[str] = Query(None),
):
    conn = get_db_connection()
    cursor = conn.cursor()

    conditions = ["Uid <> ''"]
    params: list = []

    if search:
        search_pattern = f"%{search}%"
        conditions.append(
            "(Uid LIKE ? OR Box LIKE ? OR SN_mac LIKE ? OR Ip_address LIKE ?"
            " OR SSID_wifi LIKE ? OR Status_Text LIKE ? OR [Order] LIKE ?)"
        )
        params.extend([search_pattern] * 7)

    where_str = " WHERE " + " AND ".join(conditions)

    columns = [
        "id", "Status", "Status_Text", "Uid", "Box", "[Order]", "Count",
        "Time", "Hour", "Second", "PauseTime", "SN_mac", "Key_button",
        "Ip_address", "SSID_wifi", "Ref_id", "Created_At",
    ]

    select_query = f"SELECT {', '.join(columns)} FROM dbo.iot_data" + where_str
    count_query  = "SELECT COUNT(*) FROM dbo.iot_data" + where_str

    try:
        cursor.execute(count_query, params)
        total_items = cursor.fetchone()[0]
    except Exception as e:
        conn.close()
        logger.error(f"Count query error: {e}")
        raise HTTPException(status_code=500, detail=f"Database query error: {str(e)}")

    if limit == -1:
        select_query += " ORDER BY id DESC"
    else:
        offset = (page - 1) * limit
        select_query += " ORDER BY id DESC OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
        params.extend([offset, limit])

    try:
        cursor.execute(select_query, params)
        rows = cursor.fetchall()
    except Exception as e:
        conn.close()
        logger.error(f"Select query error: {e}")
        raise HTTPException(status_code=500, detail=f"Database query error: {str(e)}")

    data = []
    for r in rows:
        data.append({
            "id": r[0], "Status": r[1], "Status_Text": r[2], "Uid": r[3],
            "Box": r[4], "Order": r[5], "Count": r[6],
            "Time": format_dt(r[7]), "Hour": r[8], "Second": r[9],
            "PauseTime": format_dt(r[10]), "SN_mac": r[11],
            "Key_button": r[12], "Ip_address": r[13], "SSID_wifi": r[14],
            "Ref_id": r[15], "Created_At": format_dt(r[16]),
        })

    conn.close()
    return {
        "data": data, "total": total_items, "page": page, "limit": limit,
        "total_pages": 1 if limit == -1 else (total_items + limit - 1) // limit,
    }


# ─────────────────────────────────────────────
# DELETE /api/RFID/api/iot-data/{id}
# ─────────────────────────────────────────────
@app.delete(f"{PREFIX}/iot-data/{{id}}")
def delete_iot_data(id: int):
    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT COUNT(*) FROM dbo.iot_data WHERE id = ?", (id,))
        if cursor.fetchone()[0] == 0:
            conn.close()
            raise HTTPException(status_code=404, detail="Record not found")
    except HTTPException:
        raise
    except Exception as e:
        conn.close()
        logger.error(f"Existence check error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    try:
        cursor.execute("DELETE FROM dbo.iot_data WHERE id = ?", (id,))
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        logger.error(f"Delete error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete record: {str(e)}")

    conn.close()
    return {"message": f"Successfully deleted record with id {id}"}


# ─────────────────────────────────────────────
# GET /api/RFID/api/box-status
# ดึง IP ล่าสุดของแต่ละ Box แล้ว ping พร้อมกัน
# ─────────────────────────────────────────────
@app.get(f"{PREFIX}/box-status")
def get_box_status():
    conn = get_db_connection()
    cursor = conn.cursor()

    # ดึง row ล่าสุด (MAX id) ของแต่ละ Box ที่มี IP address
    query = """
        SELECT t.Box, t.Ip_address, t.SN_mac, t.Uid, t.Created_At
        FROM dbo.iot_data AS t
        INNER JOIN (
            SELECT Box, MAX(id) AS max_id
            FROM dbo.iot_data
            WHERE Box        IS NOT NULL AND Box        <> ''
              AND Ip_address IS NOT NULL AND Ip_address <> ''
            GROUP BY Box
        ) AS latest
          ON t.Box = latest.Box
         AND t.id  = latest.max_id
        ORDER BY t.Box
    """

    try:
        cursor.execute(query)
        rows = cursor.fetchall()
    except Exception as e:
        conn.close()
        logger.error(f"Box status query error: {e}")
        raise HTTPException(status_code=500, detail=f"Database query error: {str(e)}")

    conn.close()

    if not rows:
        return {"boxes": []}

    boxes_info = [
        {
            "box":      r[0],
            "ip":       r[1],
            "sn_mac":   r[2],
            "uid":      r[3],
            "last_seen": format_dt(r[4]) if isinstance(r[4], datetime) else str(r[4]) if r[4] else None,
        }
        for r in rows
    ]

    logger.info(f"Pinging {len(boxes_info)} boxes: {[b['ip'] for b in boxes_info]}")

    # Ping ทุก IP พร้อมกัน (ThreadPoolExecutor)
    ping_results = ping_all(boxes_info)

    result = [
        {
            "box":      info["box"],
            "ip":       info["ip"],
            "sn_mac":   info["sn_mac"],
            "uid":      info["uid"],
            "last_seen": info["last_seen"],
            "online":   ping_results.get(info["ip"], False),
        }
        for info in boxes_info
    ]

    online_count  = sum(1 for r in result if r["online"])
    offline_count = len(result) - online_count
    logger.info(f"Ping done — online: {online_count}, offline: {offline_count}")

    return {"boxes": result}


# ─────────────────────────────────────────────
# GET /api/iot-stream  — Server-Sent Events
# Push rows ใหม่ทันทีที่ id > last_id ที่ client ส่งมา
# ─────────────────────────────────────────────
def row_to_dict(r) -> dict:
    return {
        "id": r[0], "Status": r[1], "Status_Text": r[2], "Uid": r[3],
        "Box": r[4], "Order": r[5], "Count": r[6],
        "Time": format_dt(r[7]), "Hour": r[8], "Second": r[9],
        "PauseTime": format_dt(r[10]), "SN_mac": r[11],
        "Key_button": r[12], "Ip_address": r[13], "SSID_wifi": r[14],
        "Ref_id": r[15], "Created_At": format_dt(r[16]),
    }


def fetch_new_rows(last_id: int) -> list:
    """ดึง rows ที่มี id > last_id เรียงจากเก่าไปใหม่"""
    columns = [
        "id", "Status", "Status_Text", "Uid", "Box", "[Order]", "Count",
        "Time", "Hour", "Second", "PauseTime", "SN_mac", "Key_button",
        "Ip_address", "SSID_wifi", "Ref_id", "Created_At",
    ]
    query = (
        f"SELECT {', '.join(columns)} FROM dbo.iot_data "
        f"WHERE id > ? AND Uid <> '' ORDER BY id ASC"
    )
    try:
        conn = pyodbc.connect(CONN_STR, timeout=5)
        cursor = conn.cursor()
        cursor.execute(query, (last_id,))
        rows = cursor.fetchall()
        conn.close()
        return [row_to_dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"SSE fetch error: {e}")
        return []


async def sse_generator(last_id: int) -> AsyncGenerator[str, None]:
    # ส่ง heartbeat แรกให้ connection ไม่ timeout
    yield "event: connected\ndata: {}\n\n"

    current_last_id = last_id
    poll_interval = 2  # วินาที

    while True:
        await asyncio.sleep(poll_interval)
        try:
            new_rows = await asyncio.get_event_loop().run_in_executor(
                None, fetch_new_rows, current_last_id
            )
            if new_rows:
                current_last_id = new_rows[-1]["id"]
                payload = json.dumps(new_rows, ensure_ascii=False)
                yield f"event: new_rows\ndata: {payload}\n\n"
            else:
                # heartbeat ทุก poll เพื่อให้ connection ยังอยู่
                yield f": heartbeat {int(time.time())}\n\n"
        except asyncio.CancelledError:
            logger.info("SSE client disconnected")
            break
        except Exception as e:
            logger.warning(f"SSE generator error: {e}")
            yield f"event: error\ndata: {json.dumps({'detail': str(e)})}\n\n"
            await asyncio.sleep(5)


@app.get(f"{PREFIX}/iot-stream")
async def iot_stream(last_id: int = Query(0, ge=0)):
    """
    Server-Sent Events endpoint
    Client ส่ง ?last_id=<id ล่าสุดที่มีอยู่>
    Backend push rows ใหม่ทุกครั้งที่มี id > last_id
    """
    return StreamingResponse(
        sse_generator(last_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # สำหรับ nginx/IIS reverse proxy
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5108, reload=True)
