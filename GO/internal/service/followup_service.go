package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"iot-go/internal/model"
	"iot-go/internal/repository"
)

var errBundleDetailNotFound = errors.New("bundle detail not found")

type FollowUpService struct {
	repository       *repository.IOTRepository
	client           *http.Client
	employeeAPIURL   string
	bundleAPIBaseURL string
}

func NewFollowUpService(repository *repository.IOTRepository, timeout time.Duration, employeeAPIURL, bundleAPIBaseURL string) *FollowUpService {
	return &FollowUpService{
		repository:       repository,
		client:           &http.Client{Timeout: timeout},
		employeeAPIURL:   strings.TrimSpace(employeeAPIURL),
		bundleAPIBaseURL: strings.TrimRight(strings.TrimSpace(bundleAPIBaseURL), "/"),
	}
}

func (s *FollowUpService) List(ctx context.Context, page, limit int, search string) (model.FollowUpWorkListResult, error) {
	result, err := s.repository.ListFollowUpWork(ctx, page, limit, search)
	if err != nil {
		return model.FollowUpWorkListResult{}, err
	}
	for index := range result.Data {
		s.enrichUser(ctx, &result.Data[index])
	}
	return result, nil
}

func (s *FollowUpService) Detail(ctx context.Context, uid string) (model.FollowUpDetailResponse, error) {
	summary, err := s.repository.FollowUpWorkByUID(ctx, strings.TrimSpace(uid))
	if err != nil {
		return model.FollowUpDetailResponse{}, err
	}
	s.enrichUser(ctx, &summary)

	detail, err := s.fetchBundleDetail(ctx, summary)
	if err != nil {
		if !errors.Is(err, errBundleDetailNotFound) {
			return model.FollowUpDetailResponse{}, err
		}
		detail = model.FollowUpBundleDetail{}
	}

	return model.FollowUpDetailResponse{
		Summary: summary,
		Detail:  detail,
	}, nil
}

func (s *FollowUpService) enrichUser(ctx context.Context, item *model.FollowUpWorkItem) {
	if item.EmpID == nil || strings.TrimSpace(*item.EmpID) == "" || s.employeeAPIURL == "" {
		return
	}
	userName, err := s.fetchEmployeeName(ctx, strings.TrimSpace(*item.EmpID))
	if err != nil || userName == "" {
		return
	}
	item.UserName = &userName
	item.User = strings.TrimSpace(strings.Join([]string{strings.TrimSpace(*item.EmpID), userName}, " "))
}

func (s *FollowUpService) fetchEmployeeName(ctx context.Context, empID string) (string, error) {
	token := base64.StdEncoding.EncodeToString([]byte(empID))
	query := url.Values{
		"Action": {"GetEmployeeData"},
		"emp_id": {empID},
		"token":  {token},
	}
	requestURL := s.employeeAPIURL + "?" + query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return "", fmt.Errorf("create employee request: %w", err)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("employee request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("employee request returned %d", resp.StatusCode)
	}

	var payload []struct {
		InfoName    string `json:"info_name"`
		InfoSurname string `json:"info_surname"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return "", fmt.Errorf("decode employee response: %w", err)
	}
	if len(payload) == 0 {
		return "", nil
	}

	fullName := strings.TrimSpace(strings.Join([]string{
		strings.TrimSpace(payload[0].InfoName),
		strings.TrimSpace(payload[0].InfoSurname),
	}, " "))
	return fullName, nil
}

func (s *FollowUpService) fetchBundleDetail(ctx context.Context, summary model.FollowUpWorkItem) (model.FollowUpBundleDetail, error) {
	candidates := bundleSourceCandidates(summary)
	if len(candidates) == 0 {
		return model.FollowUpBundleDetail{}, fmt.Errorf("no team or sn_mac available for UID %s", summary.UID)
	}

	var lastErr error
	for _, candidate := range candidates {
		detail, err := s.fetchBundleDetailWithSource(ctx, summary.UID, candidate)
		if err == nil {
			return detail, nil
		}
		lastErr = err
	}
	return model.FollowUpBundleDetail{}, lastErr
}

func (s *FollowUpService) fetchBundleDetailWithSource(ctx context.Context, uid, source string) (model.FollowUpBundleDetail, error) {
	if s.bundleAPIBaseURL == "" {
		return model.FollowUpBundleDetail{}, fmt.Errorf("bundle api base url is not configured")
	}

	requestURL := fmt.Sprintf("%s/bundle/qty/barcode/%s?sn_mac=%s",
		s.bundleAPIBaseURL,
		url.PathEscape(uid),
		url.QueryEscape(source),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return model.FollowUpBundleDetail{}, fmt.Errorf("create bundle request: %w", err)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return model.FollowUpBundleDetail{}, fmt.Errorf("bundle request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusNotFound {
			return model.FollowUpBundleDetail{}, errBundleDetailNotFound
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return model.FollowUpBundleDetail{}, fmt.Errorf("bundle request returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var payload struct {
		RFID      *string `json:"rfid"`
		Barcode   *string `json:"barcode"`
		BundleQty *int64  `json:"bundle_qty"`
		SAPOrder  *string `json:"saporder"`
		Bundle    *int64  `json:"bundle"`
		Style     *string `json:"style"`
		Color     *string `json:"color"`
		Progress  *string `json:"progress"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return model.FollowUpBundleDetail{}, fmt.Errorf("decode bundle response: %w", err)
	}

	return model.FollowUpBundleDetail{
		RFID:      payload.RFID,
		Barcode:   payload.Barcode,
		QTY:       payload.BundleQty,
		SAPOrder:  payload.SAPOrder,
		Bundle:    payload.Bundle,
		Style:     payload.Style,
		Color:     payload.Color,
		Progress:  payload.Progress,
		SourceKey: &source,
	}, nil
}

func uniqueNonEmpty(values ...*string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == nil {
			continue
		}
		candidate := strings.TrimSpace(*value)
		if candidate == "" {
			continue
		}
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		result = append(result, candidate)
	}
	return result
}

func bundleSourceCandidates(summary model.FollowUpWorkItem) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, 4)

	add := func(raw string) {
		candidate := strings.TrimSpace(raw)
		if candidate == "" {
			return
		}
		if _, exists := seen[candidate]; exists {
			return
		}
		seen[candidate] = struct{}{}
		result = append(result, candidate)
	}

	if summary.BoxNo != nil {
		boxNo := strings.TrimSpace(*summary.BoxNo)
		add(boxNo)
		add(strings.ReplaceAll(boxNo, "_", " "))
		add(strings.ReplaceAll(boxNo, " ", "_"))
	}

	if summary.Team != nil {
		team := strings.TrimSpace(*summary.Team)
		if looksLikeBundleTeamName(team) {
			add(team)
			add(strings.ReplaceAll(team, "_", " "))
			add(strings.ReplaceAll(team, " ", "_"))
		}
	}

	return result
}

func looksLikeBundleTeamName(value string) bool {
	upper := strings.ToUpper(strings.TrimSpace(value))
	return strings.HasPrefix(upper, "TEAM")
}
