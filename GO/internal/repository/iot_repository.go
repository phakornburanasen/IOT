package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"iot-go/internal/model"
)

var ErrNotFound = errors.New("record not found")

const columns = `id, Status, Status_Text, Uid, Box, [Order], [Count], [Time], Hour,
Second, PauseTime, SN_mac, Key_button, Ip_address, SSID_wifi, Ref_id, Created_At`

type IOTRepository struct{ db *sql.DB }

func NewIOTRepository(db *sql.DB) *IOTRepository { return &IOTRepository{db: db} }

func (r *IOTRepository) List(ctx context.Context, page, limit int, search string) (model.ListResult, error) {
	where := " WHERE Uid <> ''"
	args := []any{}
	if search != "" {
		where += ` AND (Uid LIKE @search OR Box LIKE @search OR SN_mac LIKE @search OR
Ip_address LIKE @search OR SSID_wifi LIKE @search OR Status_Text LIKE @search OR [Order] LIKE @search)`
		args = append(args, sql.Named("search", "%"+search+"%"))
	}

	var total int64
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM dbo.iot_data"+where, args...).Scan(&total); err != nil {
		return model.ListResult{}, fmt.Errorf("count iot_data: %w", err)
	}

	query := "SELECT " + columns + " FROM dbo.iot_data" + where + " ORDER BY id DESC"
	queryArgs := append([]any{}, args...)
	if limit != -1 {
		query += " OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY"
		queryArgs = append(queryArgs,
			sql.Named("offset", (page-1)*limit),
			sql.Named("limit", limit),
		)
	}

	rows, err := r.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return model.ListResult{}, fmt.Errorf("list iot_data: %w", err)
	}
	defer rows.Close()

	data, err := scanRows(rows)
	if err != nil {
		return model.ListResult{}, err
	}
	totalPages := int64(1)
	if limit != -1 {
		totalPages = (total + int64(limit) - 1) / int64(limit)
	}
	return model.ListResult{Data: data, Total: total, Page: page, Limit: limit, TotalPages: totalPages}, nil
}

func (r *IOTRepository) ListFollowUpWork(ctx context.Context, page, limit int, search string) (model.FollowUpWorkListResult, error) {
	where := " WHERE Uid <> ''"
	args := []any{}
	if search != "" {
		where += " AND Uid LIKE @search"
		args = append(args, sql.Named("search", "%"+search+"%"))
	}

	countQuery := `
SELECT COUNT(*)
FROM (
	SELECT Uid
	FROM dbo.iot_data` + where + `
	GROUP BY Uid
) AS grouped_uid`
	var total int64
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return model.FollowUpWorkListResult{}, fmt.Errorf("count follow-up work: %w", err)
	}

	query := `
WITH filtered AS (
	SELECT id, Uid, Box, SN_mac, Status_Text, Emp_id, Key_button
	FROM dbo.iot_data` + where + `
),
latest AS (
	SELECT
		id,
		Uid,
		Box,
		SN_mac,
		Status_Text,
		Emp_id,
		Key_button,
		ROW_NUMBER() OVER (PARTITION BY Uid ORDER BY
			CASE WHEN Key_button = 7 THEN 0 ELSE 1 END ASC,
			id DESC
		) AS rn
	FROM filtered
),
starts AS (
	SELECT Uid, MIN(Created_At) AS StartAt
	FROM dbo.iot_data
	WHERE Uid <> '' AND Key_button = 1
	GROUP BY Uid
),
finishes AS (
	SELECT Uid, MAX(Created_At) AS FinishAt
	FROM dbo.iot_data
	WHERE Uid <> '' AND Key_button = 7
	GROUP BY Uid
)
SELECT latest.Uid, latest.Box, latest.SN_mac, starts.StartAt, latest.Status_Text, latest.Emp_id, latest.Key_button, finishes.FinishAt
FROM latest
LEFT JOIN starts ON starts.Uid = latest.Uid
LEFT JOIN finishes ON finishes.Uid = latest.Uid
WHERE latest.rn = 1
ORDER BY latest.id DESC`

	queryArgs := append([]any{}, args...)
	if limit != -1 {
		query += " OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY"
		queryArgs = append(queryArgs,
			sql.Named("offset", (page-1)*limit),
			sql.Named("limit", limit),
		)
	}

	rows, err := r.db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return model.FollowUpWorkListResult{}, fmt.Errorf("list follow-up work: %w", err)
	}
	defer rows.Close()

	data := make([]model.FollowUpWorkItem, 0)
	for rows.Next() {
		item, scanErr := scanFollowUpWorkItem(rows)
		if scanErr != nil {
			return model.FollowUpWorkListResult{}, scanErr
		}
		data = append(data, item)
	}
	if err := rows.Err(); err != nil {
		return model.FollowUpWorkListResult{}, err
	}

	totalPages := int64(1)
	if limit != -1 {
		totalPages = (total + int64(limit) - 1) / int64(limit)
	}

	return model.FollowUpWorkListResult{
		Data:       data,
		Total:      total,
		Page:       page,
		Limit:      limit,
		TotalPages: totalPages,
	}, nil
}

func (r *IOTRepository) FollowUpWorkByUID(ctx context.Context, uid string) (model.FollowUpWorkItem, error) {
	const query = `
WITH latest AS (
	SELECT TOP (1) id, Uid, Box, SN_mac, Status_Text, Emp_id, Key_button
	FROM dbo.iot_data
	WHERE Uid = @uid
	ORDER BY
		CASE WHEN Key_button = 7 THEN 0 ELSE 1 END ASC,
		id DESC
),
starts AS (
	SELECT MIN(Created_At) AS StartAt
	FROM dbo.iot_data
	WHERE Uid = @uid AND Key_button = 1
),
finishes AS (
	SELECT MAX(Created_At) AS FinishAt
	FROM dbo.iot_data
	WHERE Uid = @uid AND Key_button = 7
)
SELECT latest.Uid, latest.Box, latest.SN_mac, starts.StartAt, latest.Status_Text, latest.Emp_id, latest.Key_button, finishes.FinishAt
FROM latest
CROSS JOIN starts
CROSS JOIN finishes`

	item, err := scanFollowUpWorkItem(r.db.QueryRowContext(ctx, query, sql.Named("uid", uid)))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return model.FollowUpWorkItem{}, ErrNotFound
		}
		return model.FollowUpWorkItem{}, err
	}
	return item, nil
}

func (r *IOTRepository) Delete(ctx context.Context, id int64) error {
	result, err := r.db.ExecContext(ctx, "DELETE FROM dbo.iot_data WHERE id = @id", sql.Named("id", id))
	if err != nil {
		return fmt.Errorf("delete iot_data: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected rows: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *IOTRepository) RowsAfter(ctx context.Context, lastID int64) ([]model.IOTData, error) {
	rows, err := r.db.QueryContext(ctx,
		"SELECT "+columns+" FROM dbo.iot_data WHERE id > @id AND Uid <> '' ORDER BY id ASC",
		sql.Named("id", lastID),
	)
	if err != nil {
		return nil, fmt.Errorf("read new iot_data: %w", err)
	}
	defer rows.Close()
	return scanRows(rows)
}

func (r *IOTRepository) LatestBoxes(ctx context.Context) ([]model.BoxStatus, error) {
	const query = `
SELECT t.Box, t.Ip_address, t.SN_mac, t.Uid, t.Created_At
FROM dbo.iot_data AS t
INNER JOIN (
    SELECT Box, MAX(id) AS max_id
    FROM dbo.iot_data
    WHERE Box IS NOT NULL AND Box <> '' AND Ip_address IS NOT NULL AND Ip_address <> ''
    GROUP BY Box
) AS latest ON t.Box = latest.Box AND t.id = latest.max_id
ORDER BY t.Box`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list latest boxes: %w", err)
	}
	defer rows.Close()

	result := make([]model.BoxStatus, 0)
	for rows.Next() {
		var box, ip, uid string
		var sn sql.NullString
		var lastSeen sql.NullTime
		if err := rows.Scan(&box, &ip, &sn, &uid, &lastSeen); err != nil {
			return nil, fmt.Errorf("scan latest box: %w", err)
		}
		result = append(result, model.BoxStatus{
			Box: box, IP: ip, SNMac: stringPtr(sn), UID: uid, LastSeen: timePtr(lastSeen),
		})
	}
	return result, rows.Err()
}

func (r *IOTRepository) Fingerprint(ctx context.Context) (model.DataFingerprint, error) {
	const query = `
SELECT COUNT_BIG(*), ISNULL(MAX(id), 0),
       ISNULL(CHECKSUM_AGG(BINARY_CHECKSUM(id, Status, Status_Text, Uid, Box, [Order], [Count],
           [Time], Hour, Second, PauseTime, SN_mac, Key_button, Ip_address, SSID_wifi, Ref_id, Created_At)), 0)
FROM dbo.iot_data
WHERE Uid <> ''`
	var fingerprint model.DataFingerprint
	if err := r.db.QueryRowContext(ctx, query).Scan(&fingerprint.Count, &fingerprint.MaxID, &fingerprint.Checksum); err != nil {
		return model.DataFingerprint{}, fmt.Errorf("fingerprint iot_data: %w", err)
	}
	return fingerprint, nil
}

func (r *IOTRepository) Ping(ctx context.Context) error { return r.db.PingContext(ctx) }

type scanner interface{ Scan(dest ...any) error }

func scanRows(rows *sql.Rows) ([]model.IOTData, error) {
	result := make([]model.IOTData, 0)
	for rows.Next() {
		item, err := scanIOTData(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func scanIOTData(row scanner) (model.IOTData, error) {
	var item model.IOTData
	var status, count, hour, second, keyButton, refID sql.NullInt64
	var statusText, uid, box, order, snMac, ip, ssid sql.NullString
	var eventTime, pauseTime, createdAt sql.NullTime
	if err := row.Scan(
		&item.ID, &status, &statusText, &uid, &box, &order, &count,
		&eventTime, &hour, &second, &pauseTime, &snMac, &keyButton,
		&ip, &ssid, &refID, &createdAt,
	); err != nil {
		return model.IOTData{}, fmt.Errorf("scan iot_data: %w", err)
	}
	item.Status = intPtr(status)
	item.StatusText = stringPtr(statusText)
	item.UID = uid.String
	item.Box = stringPtr(box)
	item.Order = stringPtr(order)
	item.Count = intPtr(count)
	item.Time = timePtr(eventTime)
	item.Hour = intPtr(hour)
	item.Second = intPtr(second)
	item.PauseTime = timePtr(pauseTime)
	item.SNMac = stringPtr(snMac)
	item.KeyButton = intPtr(keyButton)
	item.IPAddress = stringPtr(ip)
	item.SSIDWiFi = stringPtr(ssid)
	item.RefID = intPtr(refID)
	item.CreatedAt = timePtr(createdAt)
	return item, nil
}

func stringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	cleaned := strings.TrimSpace(value.String)
	return &cleaned
}

func intPtr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func timePtr(value sql.NullTime) *string {
	if !value.Valid {
		return nil
	}
	formatted := value.Time.Format("02/01/2006 15:04:05")
	return &formatted
}

func scanFollowUpWorkItem(row scanner) (model.FollowUpWorkItem, error) {
	var item model.FollowUpWorkItem
	var team, boxNo, status, empID sql.NullString
	var startAt, finishAt sql.NullTime
	var keyButton sql.NullInt64
	if err := row.Scan(&item.UID, &team, &boxNo, &startAt, &status, &empID, &keyButton, &finishAt); err != nil {
		return model.FollowUpWorkItem{}, fmt.Errorf("scan follow-up work: %w", err)
	}
	item.Team = stringPtr(team)
	item.BoxNo = stringPtr(boxNo)
	item.Start = timePtr(startAt)
	item.Status = stringPtr(status)
	item.EmpID = stringPtr(empID)
	item.KeyButton = intPtr(keyButton)
	item.FinishAt = timePtr(finishAt)
	if item.EmpID != nil {
		item.User = strings.TrimSpace(*item.EmpID)
	}
	return item, nil
}
