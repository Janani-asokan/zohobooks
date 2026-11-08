package in.corpus360.lite;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

/**
 * What the web view can't do on a phone, done natively:
 *  - print: Android's print screen for the page as it prints (receipts, invoices, labels, reports);
 *  - share: a file (PDF, CSV, Excel) saved on the phone and offered to WhatsApp, Drive, Files…;
 *  - openUrl: links outside the app (website, WhatsApp, maps) in the phone's own apps;
 *  - Bluetooth: paired receipt/label printers, sent the printer's own commands straight away.
 */
@CapacitorPlugin(
    name = "C360Native",
    permissions = {
        @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }),
    }
)
public class C360NativePlugin extends Plugin {

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    @Override
    public void load() {
        // Phones set to a big font made every screen wrap and misalign; the app keeps its own sizes (pinch zoom still works).
        getBridge().executeOnMainThread(() -> getBridge().getWebView().getSettings().setTextZoom(100));
    }

    /* ---------------- Printing ---------------- */

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "Corpus360");
        Double w = call.getDouble("widthMm");
        Double h = call.getDouble("heightMm");
        getBridge().executeOnMainThread(() -> {
            try {
                WebView web = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter inner = web.createPrintDocumentAdapter(name);
                PrintAttributes.Builder attrs = new PrintAttributes.Builder();
                if (w != null && h != null && w > 0 && h > 0) {
                    int wm = (int) Math.round(w / 25.4 * 1000), hm = (int) Math.round(h / 25.4 * 1000);
                    attrs.setMediaSize(new PrintAttributes.MediaSize("c360_" + wm + "x" + hm, "Corpus360 " + Math.round(w) + " × " + Math.round(h) + " mm", wm, hm));
                    attrs.setMinMargins(PrintAttributes.Margins.NO_MARGINS);
                }
                pm.print(name, new Finishing(inner, call), attrs.build());
            } catch (Exception e) {
                call.reject("Printing is not available on this phone: " + e.getMessage());
            }
        });
    }

    /** Prints a PDF (base64), e.g. the invoice PDF made by the server. */
    @PluginMethod
    public void printPdf(PluginCall call) {
        String name = call.getString("name", "Corpus360");
        String data = call.getString("data");
        if (data == null) { call.reject("No PDF"); return; }
        try {
            File f = writeCache("print.pdf", Base64.decode(data, Base64.DEFAULT));
            getBridge().executeOnMainThread(() -> {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                pm.print(name, new PdfAdapter(f, name, call), new PrintAttributes.Builder().build());
            });
        } catch (Exception e) {
            call.reject("Could not print the PDF: " + e.getMessage());
        }
    }

    /** Resolves the JS call once the print screen is closed (printed or cancelled), so the page can tidy up. */
    private static class Finishing extends PrintDocumentAdapter {
        private final PrintDocumentAdapter inner;
        private final PluginCall call;
        Finishing(PrintDocumentAdapter inner, PluginCall call) { this.inner = inner; this.call = call; }
        @Override public void onStart() { inner.onStart(); }
        @Override public void onLayout(PrintAttributes o, PrintAttributes n, CancellationSignal c, LayoutResultCallback cb, Bundle extras) { inner.onLayout(o, n, c, cb, extras); }
        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal c, WriteResultCallback cb) { inner.onWrite(pages, dest, c, cb); }
        @Override public void onFinish() { inner.onFinish(); call.resolve(); }
    }

    private static class PdfAdapter extends PrintDocumentAdapter {
        private final File file; private final String name; private final PluginCall call;
        PdfAdapter(File file, String name, PluginCall call) { this.file = file; this.name = name; this.call = call; }
        @Override public void onLayout(PrintAttributes o, PrintAttributes n, CancellationSignal c, LayoutResultCallback cb, Bundle extras) {
            if (c.isCanceled()) { cb.onLayoutCancelled(); return; }
            cb.onLayoutFinished(new PrintDocumentInfo.Builder(name + ".pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).build(), true);
        }
        @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal c, WriteResultCallback cb) {
            try (InputStream in = new java.io.FileInputStream(file); OutputStream out = new FileOutputStream(dest.getFileDescriptor())) {
                byte[] buf = new byte[16384]; int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                cb.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (Exception e) { cb.onWriteFailed(e.getMessage()); }
        }
        @Override public void onFinish() { call.resolve(); }
    }

    /* ---------------- Files and links ---------------- */

    /** Saves a file on the phone and opens the share screen (WhatsApp, Drive, Files, Gmail…). */
    @PluginMethod
    public void share(PluginCall call) {
        String name = call.getString("name", "file");
        String mime = call.getString("mime", "application/octet-stream");
        String data = call.getString("data");
        if (data == null) { call.reject("Nothing to share"); return; }
        try {
            File f = writeCache(name.replaceAll("[\\\\/:*?\"<>|]", "_"), Base64.decode(data, Base64.DEFAULT));
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, name);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not save the file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("No link"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No app on this phone opens this link");
        }
    }

    private File writeCache(String name, byte[] bytes) throws Exception {
        File dir = new File(getContext().getCacheDir(), "shared");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("no space");
        File f = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
        return f;
    }

    /* ---------------- Bluetooth printers ---------------- */

    private boolean needsBtPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager bm = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return bm == null ? null : bm.getAdapter();
    }

    /** Paired Bluetooth devices (pair the printer once in the phone's Bluetooth settings). */
    @PluginMethod
    public void btList(PluginCall call) {
        if (needsBtPermission()) { requestPermissionForAlias("bluetooth", call, "btListAfterPermission"); return; }
        listPaired(call);
    }

    @PermissionCallback
    private void btListAfterPermission(PluginCall call) {
        if (needsBtPermission()) { call.reject("Allow “Nearby devices” for CorpusLite to use a Bluetooth printer", "permission"); return; }
        listPaired(call);
    }

    @SuppressWarnings("MissingPermission")
    private void listPaired(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("This phone has no Bluetooth", "unsupported"); return; }
        if (!a.isEnabled()) { call.reject("Turn on Bluetooth on this phone", "off"); return; }
        JSArray list = new JSArray();
        Set<BluetoothDevice> devices = a.getBondedDevices();
        for (BluetoothDevice d : devices) {
            JSObject o = new JSObject();
            o.put("address", d.getAddress());
            o.put("name", d.getName() == null ? d.getAddress() : d.getName());
            o.put("printer", d.getBluetoothClass() != null && d.getBluetoothClass().getMajorDeviceClass() == android.bluetooth.BluetoothClass.Device.Major.IMAGING);
            list.put(o);
        }
        JSObject res = new JSObject();
        res.put("devices", list);
        call.resolve(res);
    }

    /** Sends bytes (base64: ESC/POS for receipts, TSPL/ZPL for labels) to a paired printer. */
    @PluginMethod
    public void btPrint(PluginCall call) {
        if (needsBtPermission()) { requestPermissionForAlias("bluetooth", call, "btPrintAfterPermission"); return; }
        sendBt(call);
    }

    @PermissionCallback
    private void btPrintAfterPermission(PluginCall call) {
        if (needsBtPermission()) { call.reject("Allow “Nearby devices” for CorpusLite to use a Bluetooth printer", "permission"); return; }
        sendBt(call);
    }

    @SuppressWarnings("MissingPermission")
    private void sendBt(PluginCall call) {
        String address = call.getString("address");
        String data = call.getString("data");
        if (address == null || data == null) { call.reject("Choose a printer"); return; }
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("This phone has no Bluetooth", "unsupported"); return; }
        if (!a.isEnabled()) { call.reject("Turn on Bluetooth on this phone", "off"); return; }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        new Thread(() -> {
            BluetoothSocket socket = null;
            try {
                a.cancelDiscovery();
                BluetoothDevice d = a.getRemoteDevice(address);
                socket = d.createRfcommSocketToServiceRecord(SPP);
                try {
                    socket.connect();
                } catch (Exception first) {
                    // Some cheap printers only answer on the insecure channel.
                    try { socket.close(); } catch (Exception ignored) {}
                    socket = d.createInsecureRfcommSocketToServiceRecord(SPP);
                    socket.connect();
                }
                OutputStream out = socket.getOutputStream();
                // Small chunks with a pause: printers with a tiny buffer drop bytes otherwise.
                for (int i = 0; i < bytes.length; i += 512) {
                    out.write(bytes, i, Math.min(512, bytes.length - i));
                    out.flush();
                    Thread.sleep(20);
                }
                Thread.sleep(400);
                call.resolve();
            } catch (Exception e) {
                call.reject("The printer didn’t answer. Check it is on, paired and not printing for another phone.", "connect");
            } finally {
                if (socket != null) try { socket.close(); } catch (Exception ignored) {}
            }
        }).start();
    }
}
