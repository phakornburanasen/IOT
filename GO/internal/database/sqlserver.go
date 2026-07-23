package database

import (
	"context"
	"database/sql"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"time"

	_ "github.com/microsoft/go-mssqldb"

	"iot-go/internal/config"
)

func Open(cfg config.Database) (*sql.DB, error) {
	query := url.Values{}
	query.Set("database", cfg.Name)
	query.Set("encrypt", strconv.FormatBool(cfg.Encrypt))
	query.Set("TrustServerCertificate", strconv.FormatBool(cfg.TrustServerCertificate))

	dsn := (&url.URL{
		Scheme:   "sqlserver",
		User:     url.UserPassword(cfg.User, cfg.Password),
		Host:     net.JoinHostPort(cfg.Server, cfg.Port),
		RawQuery: query.Encode(),
	}).String()

	db, err := sql.Open("sqlserver", dsn)
	if err != nil {
		return nil, fmt.Errorf("open SQL Server: %w", err)
	}
	db.SetMaxOpenConns(cfg.MaxOpenConnections)
	db.SetMaxIdleConns(cfg.MaxIdleConnections)
	db.SetConnMaxLifetime(cfg.ConnectionMaxLifetime)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping SQL Server: %w", err)
	}
	return db, nil
}
