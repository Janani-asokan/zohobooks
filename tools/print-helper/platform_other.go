//go:build !windows

package main

// Not Windows: used for tests. Printers come from C360_FAKE_PRINTERS ("A,B"); jobs are written to C360_SPOOL_DIR.

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
)

type filePrinter struct{ n atomic.Int64 }

func (f *filePrinter) List() ([]PrinterInfo, error) {
	var out []PrinterInfo
	for i, n := range strings.Split(os.Getenv("C360_FAKE_PRINTERS"), ",") {
		if n = strings.TrimSpace(n); n != "" {
			out = append(out, PrinterInfo{Name: n, Default: i == 0})
		}
	}
	return out, nil
}

func (f *filePrinter) Raw(printer, doc string, data []byte) error {
	ok := false
	list, _ := f.List()
	for _, p := range list {
		ok = ok || p.Name == printer
	}
	if !ok {
		return fmt.Errorf("printer %q not found", printer)
	}
	dir := os.Getenv("C360_SPOOL_DIR")
	if dir == "" {
		dir = os.TempDir()
	}
	name := filepath.Join(dir, fmt.Sprintf("job-%03d.bin", f.n.Add(1)))
	if err := os.WriteFile(name, data, 0o644); err != nil {
		return err
	}
	return os.WriteFile(name+".txt", []byte(printer+"\n"+doc+"\n"), 0o644)
}

func platformPrinter() Printer { return &filePrinter{} }
func setupLog()                { log.SetFlags(log.LstdFlags) }
func install()                 {}
func uninstall()               { fmt.Println("nothing to uninstall here") }
func notify(title, msg string) { log.Printf("%s: %s", title, msg) }
