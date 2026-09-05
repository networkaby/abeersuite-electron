// AbeerSuite update splash.
//
// While an update installs, the app is gone. NSIS runs silently (electron-updater
// passes /S, which is what keeps the automatic relaunch working), so the counter
// shows nothing at all for minutes — the cashier cannot tell an update from a
// crash, and on a busy till that matters.
//
// This is the window that fills that gap. It cannot be an Electron window: the
// Electron binary lives in the folder NSIS is overwriting, so it would be locked
// mid-install and electron-builder's CHECK_APP_RUNNING would fight it. A tiny
// WinForms executable, copied to %TEMP% first, is outside the blast radius.
//
//   AbeerSuiteUpdateSplash.exe <version> <sentinel-file> [timeout-seconds]
//
// It closes when the sentinel file disappears — the newly started app deletes it
// on boot — or when the timeout runs out. The timeout is not optional: a splash
// that outlives a failed update and sits on top of the till forever would be a
// worse bug than the blank screen it replaces.

using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

static class UpdateSplash
{
    const int DefaultTimeoutSeconds = 900; // 15 minutes

    [STAThread]
    static void Main(string[] args)
    {
        string version = args.Length > 0 ? args[0] : "";
        string sentinel = args.Length > 1 ? args[1] : "";
        int timeoutSeconds = DefaultTimeoutSeconds;
        if (args.Length > 2)
        {
            int parsed;
            if (int.TryParse(args[2], out parsed) && parsed > 0) timeoutSeconds = parsed;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SplashForm(version, sentinel, timeoutSeconds));
    }
}

class SplashForm : Form
{
    readonly string _sentinel;
    readonly DateTime _deadline;

    public SplashForm(string version, string sentinel, int timeoutSeconds)
    {
        _sentinel = sentinel;
        _deadline = DateTime.UtcNow.AddSeconds(timeoutSeconds);

        // No control box and no Escape key: closing this window would not stop the
        // install, it would only hide it, and the cashier would be back to a blank
        // screen with no idea what is happening.
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ControlBox = false;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        BackColor = Color.White;
        ClientSize = new Size(460, 190);
        Text = "Updating AbeerSuite";

        Label heading = new Label();
        heading.Text = version.Length > 0 ? "Updating AbeerSuite to " + version : "Updating AbeerSuite";
        heading.Font = new Font("Segoe UI", 13F, FontStyle.Bold);
        heading.AutoSize = false;
        heading.TextAlign = ContentAlignment.MiddleLeft;
        heading.SetBounds(28, 26, 404, 30);
        Controls.Add(heading);

        Label body = new Label();
        body.Text = "Please wait. Do not switch off the PC.\r\n\r\n"
                  + "The counter will start again on its own when the update finishes.";
        body.Font = new Font("Segoe UI", 9.75F);
        body.ForeColor = Color.FromArgb(70, 70, 70);
        body.AutoSize = false;
        body.SetBounds(28, 62, 404, 60);
        Controls.Add(body);

        // Marquee, not a percentage: NSIS gives no progress out of a silent
        // install, and a fake percentage would be a lie the cashier could time.
        ProgressBar bar = new ProgressBar();
        bar.Style = ProgressBarStyle.Marquee;
        bar.MarqueeAnimationSpeed = 30;
        bar.SetBounds(28, 134, 404, 18);
        Controls.Add(bar);

        Timer timer = new Timer();
        timer.Interval = 1000;
        timer.Tick += OnTick;
        timer.Start();
    }

    void OnTick(object sender, EventArgs e)
    {
        // The sentinel is written by updateManager.ts before it quits and deleted
        // by the next version on boot. An empty path, or a file that was never
        // created, means nothing can ever clear it — fall through to the deadline
        // rather than staying up for ever.
        bool done = _sentinel.Length > 0 && !File.Exists(_sentinel);
        if (done || DateTime.UtcNow >= _deadline) Close();
    }
}
