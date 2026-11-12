//go:build windows

package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

var (
	winspool              = syscall.NewLazyDLL("winspool.drv")
	procOpenPrinter       = winspool.NewProc("OpenPrinterW")
	procClosePrinter      = winspool.NewProc("ClosePrinter")
	procStartDocPrinter   = winspool.NewProc("StartDocPrinterW")
	procEndDocPrinter     = winspool.NewProc("EndDocPrinter")
	procStartPagePrinter  = winspool.NewProc("StartPagePrinter")
	procEndPagePrinter    = winspool.NewProc("EndPagePrinter")
	procWritePrinter      = winspool.NewProc("WritePrinter")
	procEnumPrinters      = winspool.NewProc("EnumPrintersW")
	procGetDefaultPrinter = winspool.NewProc("GetDefaultPrinterW")

	user32         = syscall.NewLazyDLL("user32.dll")
	procMessageBox = user32.NewProc("MessageBoxW")

	advapi32           = syscall.NewLazyDLL("advapi32.dll")
	procRegCreateKeyEx = advapi32.NewProc("RegCreateKeyExW")
	procRegSetValueEx  = advapi32.NewProc("RegSetValueExW")
	procRegDeleteValue = advapi32.NewProc("RegDeleteValueW")
	procRegCloseKey    = advapi32.NewProc("RegCloseKey")
)

const (
	printerEnumLocal       = 0x2
	printerEnumConnections = 0x4
	hkeyCurrentUser        = 0x80000001
	keyWrite               = 0x20006
	regSZ                  = 1
	runKey                 = `Software\Microsoft\Windows\CurrentVersion\Run`
	runName                = "Corpus360PrintHelper"
)

type docInfo1 struct {
	DocName    *uint16
	OutputFile *uint16
	Datatype   *uint16
}

type printerInfo4 struct {
	PrinterName *uint16
	ServerName  *uint16
	Attributes  uint32
}

type spooler struct{}

func platformPrinter() Printer { return spooler{} }

func u16(s string) *uint16 { p, _ := syscall.UTF16PtrFromString(s); return p }

func defaultPrinter() string {
	var n uint32 = 512
	buf := make([]uint16, n)
	if r, _, _ := procGetDefaultPrinter.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&n))); r == 0 {
		return ""
	}
	return syscall.UTF16ToString(buf)
}

func (spooler) List() ([]PrinterInfo, error) {
	flags := uintptr(printerEnumLocal | printerEnumConnections)
	var needed, returned uint32
	procEnumPrinters.Call(flags, 0, 4, 0, 0, uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if needed == 0 {
		return []PrinterInfo{}, nil
	}
	buf := make([]byte, needed)
	r, _, err := procEnumPrinters.Call(flags, 0, 4, uintptr(unsafe.Pointer(&buf[0])), uintptr(needed), uintptr(unsafe.Pointer(&needed)), uintptr(unsafe.Pointer(&returned)))
	if r == 0 {
		return nil, fmt.Errorf("could not list printers: %v", err)
	}
	def := defaultPrinter()
	out := make([]PrinterInfo, 0, returned)
	size := unsafe.Sizeof(printerInfo4{})
	for i := uint32(0); i < returned; i++ {
		info := (*printerInfo4)(unsafe.Pointer(&buf[uintptr(i)*size]))
		name := utf16PtrToString(info.PrinterName)
		out = append(out, PrinterInfo{Name: name, Default: name == def})
	}
	return out, nil
}

func utf16PtrToString(p *uint16) string {
	if p == nil {
		return ""
	}
	var s []uint16
	for ptr := unsafe.Pointer(p); ; ptr = unsafe.Add(ptr, 2) {
		c := *(*uint16)(ptr)
		if c == 0 {
			break
		}
		s = append(s, c)
	}
	return syscall.UTF16ToString(s)
}

// Raw sends the bytes to the printer as a RAW job: the driver passes them on untouched, so the printer gets the exact
// label size and gap in its own language and no Windows paper size is involved.
func (spooler) Raw(printer, docName string, data []byte) error {
	var h syscall.Handle
	if r, _, err := procOpenPrinter.Call(uintptr(unsafe.Pointer(u16(printer))), uintptr(unsafe.Pointer(&h)), 0); r == 0 {
		return fmt.Errorf("could not open printer %q: %v", printer, err)
	}
	defer procClosePrinter.Call(uintptr(h))
	di := docInfo1{DocName: u16(docName), Datatype: u16("RAW")}
	if r, _, err := procStartDocPrinter.Call(uintptr(h), 1, uintptr(unsafe.Pointer(&di))); r == 0 {
		return fmt.Errorf("could not start the print job: %v", err)
	}
	defer procEndDocPrinter.Call(uintptr(h))
	if r, _, err := procStartPagePrinter.Call(uintptr(h)); r == 0 {
		return fmt.Errorf("could not start the page: %v", err)
	}
	defer procEndPagePrinter.Call(uintptr(h))
	for off := 0; off < len(data); {
		var written uint32
		chunk := data[off:]
		if r, _, err := procWritePrinter.Call(uintptr(h), uintptr(unsafe.Pointer(&chunk[0])), uintptr(len(chunk)), uintptr(unsafe.Pointer(&written))); r == 0 || written == 0 {
			return fmt.Errorf("could not send to the printer: %v", err)
		}
		off += int(written)
	}
	return nil
}

func appDir() string {
	d := os.Getenv("LOCALAPPDATA")
	if d == "" {
		d = os.TempDir()
	}
	return filepath.Join(d, "Corpus360")
}

func setupLog() {
	_ = os.MkdirAll(appDir(), 0o755)
	if f, err := os.OpenFile(filepath.Join(appDir(), "print-helper.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		log.SetOutput(f)
	}
}

func notify(title, msg string) {
	procMessageBox.Call(0, uintptr(unsafe.Pointer(u16(msg))), uintptr(unsafe.Pointer(u16(title))), 0x40 /* MB_ICONINFORMATION */)
}

// install copies the helper to %LOCALAPPDATA%\Corpus360 and starts it with Windows (for this user, no admin rights).
func install() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	target := filepath.Join(appDir(), "Corpus360PrintHelper.exe")
	if !strings.EqualFold(filepath.Clean(self), filepath.Clean(target)) {
		if err := copyFile(self, target); err != nil {
			log.Printf("copy to %s failed: %v", target, err)
			target = self
		}
	}
	if err := setRun(`"` + target + `" --quiet`); err != nil {
		log.Printf("start with Windows: %v", err)
	}
}

func uninstall() {
	var k syscall.Handle
	if r, _, _ := procRegCreateKeyEx.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(u16(runKey))), 0, 0, 0, keyWrite, 0, uintptr(unsafe.Pointer(&k)), 0); r == 0 {
		procRegDeleteValue.Call(uintptr(k), uintptr(unsafe.Pointer(u16(runName))))
		procRegCloseKey.Call(uintptr(k))
	}
	notify("Corpus360 Print Helper", "The print helper will no longer start with Windows. You can delete it from "+appDir()+".")
}

func setRun(cmd string) error {
	var k syscall.Handle
	if r, _, _ := procRegCreateKeyEx.Call(hkeyCurrentUser, uintptr(unsafe.Pointer(u16(runKey))), 0, 0, 0, keyWrite, 0, uintptr(unsafe.Pointer(&k)), 0); r != 0 {
		return fmt.Errorf("open Run key: error %d", r)
	}
	defer procRegCloseKey.Call(uintptr(k))
	v, _ := syscall.UTF16FromString(cmd)
	if r, _, _ := procRegSetValueEx.Call(uintptr(k), uintptr(unsafe.Pointer(u16(runName))), 0, regSZ, uintptr(unsafe.Pointer(&v[0])), uintptr(len(v)*2)); r != 0 {
		return fmt.Errorf("set Run value: error %d", r)
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	_ = os.MkdirAll(filepath.Dir(dst), 0o755)
	tmp := dst + ".new"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}
