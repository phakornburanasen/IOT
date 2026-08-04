package repository

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"iot-go/internal/model"
)

type GatewayRepository struct{ db *sql.DB }

func NewGatewayRepository(db *sql.DB) *GatewayRepository { return &GatewayRepository{db: db} }

func (r *GatewayRepository) ListRoutes(ctx context.Context) ([]model.APIRoute, error) {
	const query = `
SELECT r.id, r.device_name, r.protocol, r.host, r.port, r.status, details.detail
FROM dbo.api_routes AS r
OUTER APPLY (
    SELECT TOP (1) d.detail
    FROM dbo.api_details AS d
    WHERE d.host = r.host AND d.port = r.port
    ORDER BY d.id DESC
) AS details
ORDER BY r.id DESC`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list api routes: %w", err)
	}
	defer rows.Close()

	result := make([]model.APIRoute, 0)
	for rows.Next() {
		var item model.APIRoute
		var protocol, status, detail sql.NullString
		if err := rows.Scan(&item.ID, &item.DeviceName, &protocol, &item.Host, &item.Port, &status, &detail); err != nil {
			return nil, fmt.Errorf("scan api route: %w", err)
		}
		item.Protocol = stringPtr(protocol)
		item.Status = stringPtr(status)
		item.Detail = stringPtr(detail)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *GatewayRepository) ListDetails(ctx context.Context) ([]model.APIDetailOption, error) {
	const query = `SELECT id, host, port, protocol, detail FROM dbo.api_details ORDER BY detail, id`
	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list api details: %w", err)
	}
	defer rows.Close()

	result := make([]model.APIDetailOption, 0)
	for rows.Next() {
		var item model.APIDetailOption
		var protocol, detail sql.NullString
		if err := rows.Scan(&item.ID, &item.Host, &item.Port, &protocol, &detail); err != nil {
			return nil, fmt.Errorf("scan api detail: %w", err)
		}
		item.Protocol = stringPtr(protocol)
		item.Detail = stringPtr(detail)
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *GatewayRepository) CreateRoute(ctx context.Context, deviceName string, detailID int64) (model.APIRoute, error) {
	const query = `
INSERT INTO dbo.api_routes (device_name, host, port, protocol)
OUTPUT INSERTED.id, INSERTED.device_name, INSERTED.protocol, INSERTED.host, INSERTED.port, INSERTED.status
SELECT @device_name, host, port, protocol
FROM dbo.api_details
WHERE id = @detail_id`
	var item model.APIRoute
	var protocol, status sql.NullString
	err := r.db.QueryRowContext(ctx, query,
		sql.Named("device_name", strings.TrimSpace(deviceName)),
		sql.Named("detail_id", detailID),
	).Scan(&item.ID, &item.DeviceName, &protocol, &item.Host, &item.Port, &status)
	if err == sql.ErrNoRows {
		return model.APIRoute{}, ErrNotFound
	}
	if err != nil {
		return model.APIRoute{}, fmt.Errorf("create api route: %w", err)
	}
	item.Protocol = stringPtr(protocol)
	item.Status = stringPtr(status)
	return item, nil
}

func (r *GatewayRepository) UpdateDeviceName(ctx context.Context, id int64, deviceName string) error {
	result, err := r.db.ExecContext(ctx, `
UPDATE dbo.api_routes
SET device_name = @device_name, updated_at = GETDATE()
WHERE id = @id`,
		sql.Named("device_name", strings.TrimSpace(deviceName)),
		sql.Named("id", id),
	)
	if err != nil {
		return fmt.Errorf("update api route: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read affected api routes: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}
