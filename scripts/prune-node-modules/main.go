// Prune runtime-dead files from a node_modules tree.
//
// On Windows this is gated by Defender real-time scanning: every unlink
// on a freshly-installed dist-server tree costs ~5-22 ms because Defender
// reads the file content to vet it before allowing the syscall to
// complete. This binary exists so you can run it OUTSIDE build:server
// (e.g. as a manual one-off after `npm install`, or with the dist-server
// directory added to Defender's exclusion list). It will NOT magically
// make unlink faster — Go's os.Remove hits the same kernel path as
// Node's fs.unlink — but it gives you a standalone tool that doesn't
// require Node on the host.
//
// Usage:
//   go run scripts/prune-node-modules -root <node_modules_dir> [-concurrency N] [-dry-run]
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var deadExts = map[string]bool{
	".ts": true, ".mts": true, ".cts": true,
	".map": true, ".md": true,
}

// Basename prefixes that must be kept even when their extension matches
// deadExts, to preserve third-party license/notice compliance.
func isProtected(name string) bool {
	lower := strings.ToLower(name)
	return strings.HasPrefix(lower, "license") ||
		strings.HasPrefix(lower, "licence") ||
		strings.HasPrefix(lower, "copying") ||
		strings.HasPrefix(lower, "notice")
}

func isDead(name string) bool {
	if isProtected(name) {
		return false
	}
	ext := strings.ToLower(filepath.Ext(name))
	return deadExts[ext]
}

func walkDead(dir string, out *[]string, mu *sync.Mutex) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		full := filepath.Join(dir, e.Name())
		if e.IsDir() {
			walkDead(full, out, mu)
		} else if e.IsFile() && isDead(e.Name()) {
			mu.Lock()
			*out = append(*out, full)
			mu.Unlock()
		}
	}
}

func main() {
	var (
		root        = flag.String("root", "", "node_modules root to prune")
		concurrency = flag.Int("concurrency", runtime.NumCPU(), "parallel walkers")
		dryRun      = flag.Bool("dry-run", false, "list first 20 dead files but don't delete")
		showExts    = flag.Bool("ext-stats", false, "after scan, print count per extension")
	)
	flag.Parse()

	if *root == "" {
		fmt.Fprintln(os.Stderr, "usage: prune [-root <path>] [-concurrency N] [-dry-run] [-ext-stats]")
		flag.PrintDefaults()
		os.Exit(2)
	}

	absRoot, err := filepath.Abs(*root)
	if err != nil {
		fmt.Fprintln(os.Stderr, "resolve:", err)
		os.Exit(1)
	}

	fmt.Printf("[prune-go] root=%s concurrency=%d\n", absRoot, *concurrency)

	// ── Phase 1: scan ──
	scanStart := time.Now()
	topEntries, err := os.ReadDir(absRoot)
	if err != nil {
		fmt.Fprintln(os.Stderr, "readdir root:", err)
		os.Exit(1)
	}

	var topDirs []string
	for _, e := range topEntries {
		full := filepath.Join(absRoot, e.Name())
		if e.IsDir() {
			topDirs = append(topDirs, full)
		}
	}

	var (
		allPaths []string
		scanMu   sync.Mutex
		scanWg   sync.WaitGroup
	)
	for _, d := range topDirs {
		scanWg.Add(1)
		go func(dir string) {
			defer scanWg.Done()
			walkDead(dir, &allPaths, &scanMu)
		}(d)
	}
	scanWg.Wait()
	scanDur := time.Since(scanStart)
	fmt.Printf("[prune-go] scan: %d dead files in %s\n", len(allPaths), scanDur.Round(time.Millisecond))

	if *showExts {
		stats := map[string]int{}
		for _, p := range allPaths {
			stats[strings.ToLower(filepath.Ext(p))]++
		}
		fmt.Printf("[prune-go] ext stats: %v\n", stats)
	}

	if *dryRun {
		fmt.Printf("[prune-go] dry-run, not deleting. First 20:\n")
		for _, p := range allPaths {
			if len(p) == 0 {
				break
			}
		}
		limit := 20
		if len(allPaths) < limit {
			limit = len(allPaths)
		}
		for _, p := range allPaths[:limit] {
			fmt.Println("  ", p)
		}
		if len(allPaths) > limit {
			fmt.Printf("  ... and %d more\n", len(allPaths)-limit)
		}
		return
	}

	if len(allPaths) == 0 {
		fmt.Printf("[prune-go] nothing to delete\n")
		return
	}

	// ── Phase 2: parallel unlink ──
	deleteStart := time.Now()
	total := uint64(len(allPaths))
	var done uint64

	var deleteWg sync.WaitGroup
	jobs := make(chan string, total)
	for _, p := range allPaths {
		jobs <- p
	}
	close(jobs)

	for i := 0; i < *concurrency; i++ {
		deleteWg.Add(1)
		go func() {
			defer deleteWg.Done()
			for p := range jobs {
				_ = os.Remove(p)
				n := atomic.AddUint64(&done, 1)
				if n%500 == 0 || n == total {
					dt := time.Since(deleteStart)
					rate := float64(n) / dt.Seconds()
					fmt.Printf("[prune-go] %d/%d (%.1f%%) %.1fs %.0f files/s\n",
						n, total, float64(n)/float64(total)*100, dt.Seconds(), rate)
				}
			}
		}()
	}
	deleteWg.Wait()

	totalDur := time.Since(scanStart) + time.Since(deleteStart)
	deleteDur := time.Since(deleteStart)
	rate := float64(len(allPaths)) / deleteDur.Seconds()
	fmt.Printf("[prune-go] done: %d removed (delete phase %s, %.1f files/s; total %s)\n",
		len(allPaths), deleteDur.Round(time.Millisecond), rate, totalDur.Round(time.Millisecond))
}