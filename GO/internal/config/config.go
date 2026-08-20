package config

import (
	"bufio"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Database struct {
	Server                 string
	Port                   string
	Name                   string
	User                   string
	Password               string
	Encrypt                bool
	TrustServerCertificate bool
	MaxOpenConnections     int
	MaxIdleConnections     int
	ConnectionMaxLifetime  time.Duration
}

type Config struct {
	Host               string
	Port               string
	APIPrefix          string
	AllowedOrigins     []string
	ReadTimeout        time.Duration
	WriteTimeout       time.Duration
	IdleTimeout        time.Duration
	ShutdownTimeout    time.Duration
	ChangePollInterval time.Duration
	PingTimeout        time.Duration
	PingWorkers        int
	ExternalAPITimeout time.Duration
	EmployeeAPIURL     string
	BundleAPIBaseURL   string
	Database           Database
}

func Load() (Config, error) {
	if err := loadEnvFile(".env"); err != nil {
		return Config{}, fmt.Errorf("load .env: %w", err)
	}
	if executable, err := os.Executable(); err == nil {
		executableEnv := filepath.Join(filepath.Dir(executable), ".env")
		if err := loadEnvFile(executableEnv); err != nil {
			return Config{}, fmt.Errorf("load %s: %w", executableEnv, err)
		}
	}

	cfg := Config{
		Host:               env("APP_HOST", "0.0.0.0"),
		Port:               env("APP_PORT", "5108"),
		APIPrefix:          normalizePrefix(env("API_PREFIX", "/api")),
		AllowedOrigins:     csvEnv("ALLOWED_ORIGINS", "*"),
		ReadTimeout:        durationEnv("READ_TIMEOUT", 15*time.Second),
		WriteTimeout:       durationEnv("WRITE_TIMEOUT", 30*time.Second),
		IdleTimeout:        durationEnv("IDLE_TIMEOUT", 60*time.Second),
		ShutdownTimeout:    durationEnv("SHUTDOWN_TIMEOUT", 10*time.Second),
		ChangePollInterval: durationEnv("CHANGE_POLL_INTERVAL", 2*time.Second),
		PingTimeout:        durationEnv("PING_TIMEOUT", 2*time.Second),
		PingWorkers:        intEnv("PING_WORKERS", 16),
		ExternalAPITimeout: durationEnv("EXTERNAL_API_TIMEOUT", 8*time.Second),
		EmployeeAPIURL:     env("EMPLOYEE_API_URL", "http://10.0.32.202:3030/api_local/_survey_employee.php"),
		BundleAPIBaseURL:   strings.TrimRight(env("BUNDLE_API_BASE_URL", "http://10.0.32.70:50000/api/TEAM_A/api"), "/"),
		Database: Database{
			Server:                 strings.TrimSpace(os.Getenv("DB_SERVER")),
			Port:                   env("DB_PORT", "1433"),
			Name:                   strings.TrimSpace(os.Getenv("DB_NAME")),
			User:                   strings.TrimSpace(os.Getenv("DB_USER")),
			Password:               os.Getenv("DB_PASSWORD"),
			Encrypt:                boolEnv("DB_ENCRYPT", true),
			TrustServerCertificate: boolEnv("DB_TRUST_SERVER_CERTIFICATE", true),
			MaxOpenConnections:     intEnv("DB_MAX_OPEN_CONNS", 20),
			MaxIdleConnections:     intEnv("DB_MAX_IDLE_CONNS", 10),
			ConnectionMaxLifetime:  durationEnv("DB_CONN_MAX_LIFETIME", 30*time.Minute),
		},
	}

	if cfg.Database.Server == "" || cfg.Database.Name == "" || cfg.Database.User == "" || cfg.Database.Password == "" {
		return Config{}, fmt.Errorf("DB_SERVER, DB_NAME, DB_USER and DB_PASSWORD are required")
	}
	if cfg.ChangePollInterval < 500*time.Millisecond {
		return Config{}, fmt.Errorf("CHANGE_POLL_INTERVAL must be at least 500ms")
	}
	if cfg.PingWorkers < 1 {
		return Config{}, fmt.Errorf("PING_WORKERS must be at least 1")
	}
	return cfg, nil
}

// loadEnvFile loads local deployment settings without overwriting variables
// already supplied by the operating system or service manager.
func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		if !found {
			return fmt.Errorf("invalid line %q", line)
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), "\"'")
		if key == "" {
			return fmt.Errorf("environment key cannot be empty")
		}
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, value); err != nil {
				return fmt.Errorf("set %s: %w", key, err)
			}
		}
	}
	return scanner.Err()
}

func (c Config) Address() string { return net.JoinHostPort(c.Host, c.Port) }

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func normalizePrefix(value string) string {
	value = "/" + strings.Trim(value, "/")
	if value == "/" {
		return ""
	}
	return value
}

func csvEnv(key, fallback string) []string {
	parts := strings.Split(env(key, fallback), ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func intEnv(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil {
		return fallback
	}
	return value
}

func boolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
