import UIKit
import WebKit
import Capacitor

/// The app's web view, with the CorpusLite native plugin added.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(C360NativePlugin())
    }
}

/// What the web view can't do on a phone, done natively: print the page (receipts, invoices, labels, reports),
/// print a PDF, save/share a file (PDF, CSV, Excel) and open links in the phone's own apps.
/// Bluetooth printers are Android-only (iPhones only talk to certified accessories); iPhones print through AirPrint.
@objc(C360NativePlugin)
public class C360NativePlugin: CAPPlugin, CAPBridgedPlugin, UIPrintInteractionControllerDelegate {
    public let identifier = "C360NativePlugin"
    public let jsName = "C360Native"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printPdf", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "btPrint", returnType: CAPPluginReturnPromise),
    ]

    private var pageSize: CGSize?

    private func present(_ pc: UIPrintInteractionController, _ call: CAPPluginCall) {
        pc.delegate = self
        let done: UIPrintInteractionController.CompletionHandler = { _, completed, error in
            self.pageSize = nil
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve(["completed": completed]) }
        }
        if UIDevice.current.userInterfaceIdiom == .pad, let view = bridge?.viewController?.view {
            pc.present(from: CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), in: view, animated: true, completionHandler: done)
        } else {
            pc.present(animated: true, completionHandler: done)
        }
    }

    /// Picks the printer's paper closest to the page the app asked for (receipt roll, label, A4).
    public func printInteractionController(_ pc: UIPrintInteractionController, choosePaper paperList: [UIPrintPaper]) -> UIPrintPaper {
        guard let size = pageSize else { return paperList[0] }
        return UIPrintPaper.bestPaper(forPageSize: size, withPapersFrom: paperList)
    }

    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView else { call.reject("Printing is not available"); return }
            if let w = call.getDouble("widthMm"), let h = call.getDouble("heightMm"), w > 0, h > 0 {
                self.pageSize = CGSize(width: w / 25.4 * 72, height: h / 25.4 * 72)
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("name") ?? "Corpus360"
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printingItem = nil
            pc.printFormatter = web.viewPrintFormatter()
            self.present(pc, call)
        }
    }

    @objc func printPdf(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else { call.reject("No PDF"); return }
        DispatchQueue.main.async {
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("name") ?? "Corpus360"
            let pc = UIPrintInteractionController.shared
            pc.printInfo = info
            pc.printFormatter = nil
            pc.printingItem = data
            self.present(pc, call)
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else { call.reject("Nothing to share"); return }
        let name = (call.getString("name") ?? "file").replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do { try data.write(to: url, options: .atomic) } catch { call.reject("Could not save the file"); return }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else { call.reject("Sharing is not available"); return }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let pop = sheet.popoverPresentationController {
                pop.sourceView = vc.view
                pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.midY, width: 1, height: 1)
            }
            sheet.completionWithItemsHandler = { _, completed, _, _ in call.resolve(["completed": completed]) }
            vc.present(sheet, animated: true)
        }
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { call.reject("No link"); return }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { ok in ok ? call.resolve() : call.reject("No app on this phone opens this link") }
        }
    }

    @objc func btList(_ call: CAPPluginCall) {
        call.reject("On iPhone, print through AirPrint or a printer app; Bluetooth printers work with the Android app", "unsupported")
    }

    @objc func btPrint(_ call: CAPPluginCall) {
        call.reject("On iPhone, print through AirPrint or a printer app; Bluetooth printers work with the Android app", "unsupported")
    }
}
