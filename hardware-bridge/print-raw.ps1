# Sends a file's bytes to a Windows printer as a RAW job (winspool), so ESC/POS
# reaches a USB thermal printer installed through its Windows driver unchanged.
# Called by thermal.js sendWindows() with arguments, never through a shell string.
# Prints "OK" on success; anything else is the reason it failed (exit 1).
param(
    [string]$PrinterName,
    [string]$FilePath
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinter {
    [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
    public static extern bool OpenPrinter(string printerName, out IntPtr handle, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool ClosePrinter(IntPtr handle);

    [DllImport("winspool.drv", CharSet=CharSet.Auto, SetLastError=true)]
    public static extern int StartDocPrinter(IntPtr handle, int level, ref DocInfo1 di);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndDocPrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool StartPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool EndPagePrinter(IntPtr handle);

    [DllImport("winspool.drv", SetLastError=true)]
    public static extern bool WritePrinter(IntPtr handle, IntPtr buf, int len, out int written);

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Auto)]
    public struct DocInfo1 {
        public string docName;
        public string outputFile;
        public string dataType;
    }

    public static string SendRaw(string printerName, byte[] data) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            return "OpenPrinter failed for: " + printerName;

        DocInfo1 di = new DocInfo1 { docName = "Voucher", outputFile = null, dataType = "RAW" };
        if (StartDocPrinter(hPrinter, 1, ref di) == 0) {
            ClosePrinter(hPrinter);
            return "StartDocPrinter failed";
        }

        StartPagePrinter(hPrinter);

        IntPtr buf = Marshal.AllocHGlobal(data.Length);
        Marshal.Copy(data, 0, buf, data.Length);
        int written;
        bool ok = WritePrinter(hPrinter, buf, data.Length, out written);
        Marshal.FreeHGlobal(buf);

        EndPagePrinter(hPrinter);
        EndDocPrinter(hPrinter);
        ClosePrinter(hPrinter);

        if (!ok) return "WritePrinter failed";
        return "OK";
    }
}
"@

$bytes  = [System.IO.File]::ReadAllBytes($FilePath)
$result = [RawPrinter]::SendRaw($PrinterName, $bytes)
Write-Output $result
if ($result -ne "OK") { exit 1 }
