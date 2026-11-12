package main

import (
	"bytes"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func setup(t *testing.T) (http.Handler, string) {
	dir := t.TempDir()
	t.Setenv("C360_FAKE_PRINTERS", "TVS LP 46 Lite,Office")
	t.Setenv("C360_SPOOL_DIR", dir)
	return newHandler(platformPrinter()), dir
}

func do(h http.Handler, method, path, origin, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestStatusListsPrinters(t *testing.T) {
	h, _ := setup(t)
	w := do(h, "GET", "/status", "https://ledgerly-books.onrender.com", "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"TVS LP 46 Lite"`)) || w.Header().Get("Access-Control-Allow-Origin") != "https://ledgerly-books.onrender.com" {
		t.Fatalf("status: %d %s %v", w.Code, w.Body, w.Header())
	}
}

func TestOtherWebsitesCannotPrint(t *testing.T) {
	h, dir := setup(t)
	job := `{"printer":"TVS LP 46 Lite","data":"` + base64.StdEncoding.EncodeToString([]byte("SIZE 80 mm,25 mm\r\n")) + `"}`
	for _, o := range []string{"https://evil.example", "https://ledgerly-books.onrender.com.evil.example", "http://localhost.evil.example"} {
		if w := do(h, "POST", "/print", o, job); w.Code != 403 {
			t.Fatalf("%s got %d", o, w.Code)
		}
		if w := do(h, "OPTIONS", "/print", o, ""); w.Code != 403 || w.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Fatalf("preflight %s got %d", o, w.Code)
		}
	}
	if w := do(h, "POST", "/print", "", job); w.Code != 403 {
		t.Fatalf("no origin got %d", w.Code)
	}
	if m, _ := filepath.Glob(filepath.Join(dir, "*.bin")); len(m) != 0 {
		t.Fatalf("a refused job was printed")
	}
}

func TestPreflightAllowsPrivateNetwork(t *testing.T) {
	h, _ := setup(t)
	w := do(h, "OPTIONS", "/print", "https://ledgerly-books.onrender.com", "")
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Private-Network") != "true" {
		t.Fatalf("preflight: %d %v", w.Code, w.Header())
	}
}

func TestPrintSendsExactBytes(t *testing.T) {
	h, dir := setup(t)
	data := []byte("SIZE 80 mm,25 mm\r\nGAP 3 mm,0 mm\r\nCLS\r\nBITMAP 0,0,80,200,0,\x00\xff\x10\r\nPRINT 1,1\r\n")
	w := do(h, "POST", "/print", "http://localhost:5173", `{"printer":"TVS LP 46 Lite","name":"Labels","data":"`+base64.StdEncoding.EncodeToString(data)+`"}`)
	if w.Code != 200 {
		t.Fatalf("print: %d %s", w.Code, w.Body)
	}
	got, err := os.ReadFile(filepath.Join(dir, "job-001.bin"))
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("spooled bytes differ: %q", got)
	}
}

func TestUnknownPrinterAndBadData(t *testing.T) {
	h, _ := setup(t)
	if w := do(h, "POST", "/print", "http://localhost:4000", `{"printer":"Nope","data":"QUJD"}`); w.Code != 502 {
		t.Fatalf("unknown printer got %d", w.Code)
	}
	if w := do(h, "POST", "/print", "http://localhost:4000", `{"printer":"Office","data":"***"}`); w.Code != 400 {
		t.Fatalf("bad data got %d", w.Code)
	}
}
