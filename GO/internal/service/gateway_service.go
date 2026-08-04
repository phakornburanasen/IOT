package service

import (
	"context"

	"iot-go/internal/model"
	"iot-go/internal/repository"
)

type GatewayService struct{ repository *repository.GatewayRepository }

func NewGatewayService(repository *repository.GatewayRepository) *GatewayService {
	return &GatewayService{repository: repository}
}

func (s *GatewayService) ListRoutes(ctx context.Context) ([]model.APIRoute, error) {
	return s.repository.ListRoutes(ctx)
}

func (s *GatewayService) ListDetails(ctx context.Context) ([]model.APIDetailOption, error) {
	return s.repository.ListDetails(ctx)
}

func (s *GatewayService) CreateRoute(ctx context.Context, deviceName string, detailID int64) (model.APIRoute, error) {
	return s.repository.CreateRoute(ctx, deviceName, detailID)
}

func (s *GatewayService) UpdateDeviceName(ctx context.Context, id int64, deviceName string) error {
	return s.repository.UpdateDeviceName(ctx, id, deviceName)
}
