package service

import (
	"context"

	"iot-go/internal/model"
	"iot-go/internal/repository"
)

type IOTService struct{ repository *repository.IOTRepository }

func NewIOTService(repository *repository.IOTRepository) *IOTService {
	return &IOTService{repository: repository}
}

func (s *IOTService) List(ctx context.Context, page, limit int, search string) (model.ListResult, error) {
	return s.repository.List(ctx, page, limit, search)
}

func (s *IOTService) Delete(ctx context.Context, id int64) error {
	return s.repository.Delete(ctx, id)
}

func (s *IOTService) RowsAfter(ctx context.Context, id int64) ([]model.IOTData, error) {
	return s.repository.RowsAfter(ctx, id)
}

func (s *IOTService) LatestBoxes(ctx context.Context) ([]model.BoxStatus, error) {
	return s.repository.LatestBoxes(ctx)
}

func (s *IOTService) Fingerprint(ctx context.Context) (model.DataFingerprint, error) {
	return s.repository.Fingerprint(ctx)
}

func (s *IOTService) Ping(ctx context.Context) error { return s.repository.Ping(ctx) }
