package main

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"syscall"
	"time"
)

func main() {
	setupLog()
	quiet := len(os.Args) > 1 && os.Args[1] == "--quiet" // started by Windows at sign-in: no message
	if len(os.Args) > 1 && os.Args[1] == "--uninstall" {
		uninstall()
		return
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		if isAddrInUse(err) && helperRunning() {
			if !quiet {
				notify("Corpus360 Print Helper", "The print helper is already running. Labels print straight to your label printer from the Corpus360 website.")
			}
			return
		}
		notify("Corpus360 Print Helper", "Could not start: "+err.Error())
		log.Fatal(err)
	}
	install() // copy to the user's app folder and start with Windows (Windows only; nothing elsewhere)
	if !quiet {
		go notify("Corpus360 Print Helper", "The print helper is running.\n\nOn the Corpus360 label screen choose \"Send labels → This PC (print helper)\" and pick your label printer. It starts by itself with Windows.")
	}
	log.Printf("%s %s listening on %s", appID, version, addr)
	srv := &http.Server{Handler: newHandler(platformPrinter()), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.Serve(ln))
}

func isAddrInUse(err error) bool {
	var op *net.OpError
	if errors.As(err, &op) {
		var se *os.SyscallError
		if errors.As(op.Err, &se) {
			return se.Err == syscall.EADDRINUSE || se.Err == syscall.Errno(10048) // WSAEADDRINUSE
		}
	}
	return false
}

func helperRunning() bool {
	c := http.Client{Timeout: 2 * time.Second}
	res, err := c.Get("http://" + addr + "/status")
	if err != nil {
		return false
	}
	defer res.Body.Close()
	var s struct{ App string }
	_ = json.NewDecoder(res.Body).Decode(&s)
	return s.App == appID
}
