package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"iot-go/internal/config"
	"iot-go/internal/repository"
	"iot-go/internal/service"
)

type Handler struct {
	iot    *service.IOTService
	ping   *service.PingService
	cfg    config.Config
	logger *slog.Logger
}

func NewHandler(iot *service.IOTService, ping *service.PingService, cfg config.Config, logger *slog.Logger) *Handler {
	return &Handler{iot: iot, ping: ping, cfg: cfg, logger: logger}
}

func (h *Handler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.health)
	mux.HandleFunc("GET "+h.cfg.APIPrefix+"/iot-data", h.list)
	mux.HandleFunc("DELETE "+h.cfg.APIPrefix+"/iot-data/{id}", h.delete)
	mux.HandleFunc("GET "+h.cfg.APIPrefix+"/box-status", h.boxStatus)
	mux.HandleFunc("GET "+h.cfg.APIPrefix+"/iot-stream", h.stream)
	return recoverPanic(cors(h.cfg.AllowedOrigins, mux))
}

func (h *Handler) health(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := h.iot.Ping(ctx); err != nil {
		writeError(w, http.StatusServiceUnavailable, "Database is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "database": "connected"})
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	page, err := positiveQuery(r, "page", 1)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	limit, err := limitQuery(r, 10)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := h.iot.List(r.Context(), page, limit, strings.TrimSpace(r.URL.Query().Get("search")))
	if err != nil {
		h.logger.Error("list iot data failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Database query failed")
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, http.StatusBadRequest, "id must be a positive integer")
		return
	}
	if err := h.iot.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "Record not found")
			return
		}
		h.logger.Error("delete iot data failed", "id", id, "error", err)
		writeError(w, http.StatusInternalServerError, "Failed to delete record")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": fmt.Sprintf("Successfully deleted record with id %d", id)})
}

func (h *Handler) boxStatus(w http.ResponseWriter, r *http.Request) {
	boxes, err := h.iot.LatestBoxes(r.Context())
	if err != nil {
		h.logger.Error("list box status failed", "error", err)
		writeError(w, http.StatusInternalServerError, "Database query failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"boxes": h.ping.CheckAll(r.Context(), boxes)})
}

func (h *Handler) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "Streaming is not supported")
		return
	}
	lastID, err := nonNegativeInt64Query(r, "last_id", 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	h.sendEvent(w, "connected", map[string]string{"status": "connected"})
	flusher.Flush()

	fingerprint, err := h.iot.Fingerprint(r.Context())
	if err != nil {
		h.logger.Warn("initial fingerprint failed", "error", err)
	}
	ticker := time.NewTicker(h.cfg.ChangePollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			newRows, rowsErr := h.iot.RowsAfter(r.Context(), lastID)
			if rowsErr == nil && len(newRows) > 0 {
				lastID = newRows[len(newRows)-1].ID
				h.sendEvent(w, "new_rows", newRows)
			}

			current, fingerprintErr := h.iot.Fingerprint(r.Context())
			if fingerprintErr != nil {
				h.sendEvent(w, "error", map[string]string{"detail": "Database change check failed"})
			} else if current != fingerprint {
				h.sendEvent(w, "data_changed", map[string]any{
					"total": current.Count, "max_id": current.MaxID, "detected_at": time.Now().Format(time.RFC3339),
				})
				fingerprint = current
			} else {
				fmt.Fprintf(w, ": heartbeat %d\n\n", time.Now().Unix())
			}
			flusher.Flush()
		}
	}
}

func (h *Handler) sendEvent(w http.ResponseWriter, event string, value any) {
	payload, err := json.Marshal(value)
	if err == nil {
		fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, payload)
	}
}

func positiveQuery(r *http.Request, name string, fallback int) (int, error) {
	value, err := integerQuery(r, name, fallback)
	if err != nil || value < 1 {
		return 0, fmt.Errorf("%s must be a positive integer", name)
	}
	return value, nil
}

func nonNegativeInt64Query(r *http.Request, name string, fallback int64) (int64, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < 0 {
		return 0, fmt.Errorf("%s must be a non-negative integer", name)
	}
	return value, nil
}

func limitQuery(r *http.Request, fallback int) (int, error) {
	value, err := integerQuery(r, "limit", fallback)
	if err != nil || value == 0 || value < -1 {
		return 0, fmt.Errorf("limit must be -1 or a positive integer")
	}
	return value, nil
}

func integerQuery(r *http.Request, name string, fallback int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(name))
	if raw == "" {
		return fallback, nil
	}
	return strconv.Atoi(raw)
}
