// Corpus360 Print Helper: a small local program that lets the Corpus360 website send label jobs straight to a label
// printer on this PC, in the printer's own language (TSPL / ZPL / ESC-POS), bypassing the Windows paper size.
//
// It listens only on 127.0.0.1 and accepts print jobs only from the Corpus360 website (checked by the browser's
// Origin header), so other websites can't use the printer.
package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const (
	appID   = "corpus360-print-helper"
	version = "1.0.0"
	addr    = "127.0.0.1:17361"
	maxBody = 16 << 20 // 16 MB: a few hundred label rows
)

// Printer is what the platform provides: list printers, and send raw bytes to one.
type Printer interface {
	List() ([]PrinterInfo, error)
	Raw(printer, docName string, data []byte) error
}

type PrinterInfo struct {
	Name    string `json:"name"`
	Default bool   `json:"default"`
}

// Websites allowed to print. Extra ones (e.g. a shop's own domain) can be added in CORPUS360_ORIGINS, comma separated.
var allowedOrigins = []*regexp.Regexp{
	regexp.MustCompile(`^https://ledgerly-books\.onrender\.com$`),
	regexp.MustCompile(`^https://([a-z0-9-]+\.)*corpus360\.in$`),
	regexp.MustCompile(`^http://(localhost|127\.0\.0\.1)(:\d+)?$`),
}

func init() {
	for _, o := range strings.Split(os.Getenv("CORPUS360_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			allowedOrigins = append(allowedOrigins, regexp.MustCompile("^"+regexp.QuoteMeta(strings.TrimRight(o, "/"))+"$"))
		}
	}
}

func originAllowed(o string) bool {
	for _, re := range allowedOrigins {
		if re.MatchString(o) {
			return true
		}
	}
	return false
}

func newHandler(p Printer) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		list, err := p.List()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"app": appID, "version": version, "printers": list})
	})
	mux.HandleFunc("/print", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "POST only"})
			return
		}
		var job struct {
			Printer string `json:"printer"`
			Data    string `json:"data"` // base64
			Name    string `json:"name"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, maxBody)).Decode(&job); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bad request"})
			return
		}
		data, err := base64.StdEncoding.DecodeString(job.Data)
		if err != nil || len(data) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "no print data"})
			return
		}
		if job.Printer == "" {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "choose a printer"})
			return
		}
		if job.Name == "" {
			job.Name = "Corpus360 labels"
		}
		start := time.Now()
		if err := p.Raw(job.Printer, job.Name, data); err != nil {
			log.Printf("print to %q failed: %v", job.Printer, err)
			writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		log.Printf("printed %d bytes to %q in %s", len(data), job.Printer, time.Since(start).Round(time.Millisecond))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "bytes": len(data)})
	})
	return withCORS(mux)
}

// withCORS answers only the allowed websites, including Chrome's private / local network access preflight.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && !originAllowed(origin) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "this website may not use the printer"})
			return
		}
		// A request with no Origin is not from a web page (e.g. curl on this PC): fine for /status only.
		if origin == "" && r.URL.Path != "/status" {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "print jobs come from the Corpus360 website"})
			return
		}
		if origin != "" {
			h := w.Header()
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type")
			h.Set("Access-Control-Allow-Private-Network", "true")
			h.Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
