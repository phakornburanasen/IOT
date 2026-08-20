package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"iot-go/internal/config"
	"iot-go/internal/database"
	"iot-go/internal/httpapi"
	"iot-go/internal/repository"
	"iot-go/internal/service"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	db, err := database.Open(cfg.Database)
	if err != nil {
		logger.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	repo := repository.NewIOTRepository(db)
	gatewayRepo := repository.NewGatewayRepository(db)
	iotService := service.NewIOTService(repo)
	followUpService := service.NewFollowUpService(repo, cfg.ExternalAPITimeout, cfg.EmployeeAPIURL, cfg.BundleAPIBaseURL)
	gatewayService := service.NewGatewayService(gatewayRepo)
	pingService := service.NewPingService(cfg.PingTimeout, cfg.PingWorkers)
	handler := httpapi.NewHandler(iotService, followUpService, gatewayService, pingService, cfg, logger)

	server := &http.Server{
		Addr:         cfg.Address(),
		Handler:      handler.Routes(),
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	go func() {
		logger.Info("Go API started", "address", cfg.Address(), "prefix", cfg.APIPrefix)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("HTTP server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
