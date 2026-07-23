package service

import (
	"context"
	"os/exec"
	"runtime"
	"strconv"
	"sync"
	"time"

	"iot-go/internal/model"
)

type PingService struct {
	timeout time.Duration
	workers int
}

func NewPingService(timeout time.Duration, workers int) *PingService {
	return &PingService{timeout: timeout, workers: workers}
}

func (s *PingService) CheckAll(ctx context.Context, boxes []model.BoxStatus) []model.BoxStatus {
	result := append([]model.BoxStatus(nil), boxes...)
	jobs := make(chan int)
	workerCount := min(s.workers, len(result))
	var wg sync.WaitGroup

	for range workerCount {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for index := range jobs {
				result[index].Online = s.check(ctx, result[index].IP)
			}
		}()
	}
	for index := range result {
		jobs <- index
	}
	close(jobs)
	wg.Wait()
	return result
}

func (s *PingService) check(parent context.Context, ip string) bool {
	ctx, cancel := context.WithTimeout(parent, s.timeout)
	defer cancel()

	var command *exec.Cmd
	if runtime.GOOS == "windows" {
		milliseconds := strconv.FormatInt(s.timeout.Milliseconds(), 10)
		command = exec.CommandContext(ctx, "ping", "-n", "1", "-w", milliseconds, ip)
	} else {
		seconds := strconv.Itoa(max(1, int(s.timeout.Seconds())))
		command = exec.CommandContext(ctx, "ping", "-c", "1", "-W", seconds, ip)
	}
	return command.Run() == nil
}
