using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace AbeerSuite.Downloader
{
    static class Program
    {
        // Embedded token placeholder (replaced at build time with XOR encoded bytes if present)
        public static byte[] EmbeddedTokenBytes = new byte[] { /* TOKEN_BYTES */ };
        public static byte TokenXorKey = 0x5A;

        public static string RepoOwner = "devloperakramul";
        public static string RepoName = "abeersuite-networkservice-update";

        [STAThread]
        static void Main(string[] args)
        {
            // Ensure TLS 1.2 is enabled for GitHub API
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11 | SecurityProtocolType.Tls;
            ServicePointManager.DefaultConnectionLimit = 10;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string customToken = null;
            string targetVersion = null; // null means universal latest release
            bool isSilent = false;

            foreach (var arg in args)
            {
                if (arg.StartsWith("--token=", StringComparison.OrdinalIgnoreCase))
                {
                    customToken = arg.Substring(8).Trim('"', '\'');
                }
                else if (arg.StartsWith("/token=", StringComparison.OrdinalIgnoreCase))
                {
                    customToken = arg.Substring(7).Trim('"', '\'');
                }
                else if (arg.StartsWith("--version=", StringComparison.OrdinalIgnoreCase))
                {
                    targetVersion = arg.Substring(10).Trim('"', '\'');
                }
                else if (arg.StartsWith("/version=", StringComparison.OrdinalIgnoreCase))
                {
                    targetVersion = arg.Substring(9).Trim('"', '\'');
                }
                else if (arg.Equals("--silent", StringComparison.OrdinalIgnoreCase) || arg.Equals("/s", StringComparison.OrdinalIgnoreCase))
                {
                    isSilent = true;
                }
            }

            string token = customToken;
            if (string.IsNullOrEmpty(token) && EmbeddedTokenBytes != null && EmbeddedTokenBytes.Length > 0)
            {
                byte[] decoded = new byte[EmbeddedTokenBytes.Length];
                for (int i = 0; i < EmbeddedTokenBytes.Length; i++)
                {
                    decoded[i] = (byte)(EmbeddedTokenBytes[i] ^ TokenXorKey);
                }
                token = Encoding.UTF8.GetString(decoded);
            }

            Application.Run(new MainForm(token, targetVersion, isSilent));
        }
    }

    public class MainForm : Form
    {
        private string _token;
        private string _targetVersion;
        private bool _isSilent;
        private Label _statusLabel;
        private Label _detailLabel;
        private ProgressBar _progressBar;
        private Button _actionButton;
        private CancellationTokenSource _cts;
        private Thread _workerThread;

        public MainForm(string token, string targetVersion, bool isSilent)
        {
            _token = token;
            _targetVersion = targetVersion;
            _isSilent = isSilent;
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "AbeerSuite Setup";
            this.Size = new Size(460, 240);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.MinimizeBox = true;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            // Top Header Panel
            Panel headerPanel = new Panel();
            headerPanel.Dock = DockStyle.Top;
            headerPanel.Height = 65;
            headerPanel.BackColor = Color.FromArgb(1, 51, 255); // Brand Blue

            Label appHeader = new Label();
            appHeader.Text = "AbeerSuite";
            appHeader.Font = new Font("Segoe UI", 16F, FontStyle.Bold, GraphicsUnit.Point);
            appHeader.ForeColor = Color.White;
            appHeader.Location = new Point(20, 8);
            appHeader.AutoSize = true;

            Label appSub = new Label();
            appSub.Text = "Desktop Operating System Installer Downloader";
            appSub.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            appSub.ForeColor = Color.FromArgb(220, 230, 255);
            appSub.Location = new Point(22, 38);
            appSub.AutoSize = true;

            headerPanel.Controls.Add(appHeader);
            headerPanel.Controls.Add(appSub);
            this.Controls.Add(headerPanel);

            // Body Controls
            _statusLabel = new Label();
            _statusLabel.Text = "Initializing...";
            _statusLabel.Font = new Font("Segoe UI", 10F, FontStyle.Bold, GraphicsUnit.Point);
            _statusLabel.ForeColor = Color.FromArgb(30, 41, 59);
            _statusLabel.Location = new Point(20, 78);
            _statusLabel.Size = new Size(405, 22);

            _progressBar = new ProgressBar();
            _progressBar.Location = new Point(20, 105);
            _progressBar.Size = new Size(405, 24);
            _progressBar.Style = ProgressBarStyle.Marquee;
            _progressBar.MarqueeAnimationSpeed = 30;

            _detailLabel = new Label();
            _detailLabel.Text = "Connecting to repository...";
            _detailLabel.Font = new Font("Segoe UI", 8.5F, FontStyle.Regular, GraphicsUnit.Point);
            _detailLabel.ForeColor = Color.FromArgb(100, 116, 139);
            _detailLabel.Location = new Point(20, 134);
            _detailLabel.Size = new Size(405, 20);

            _actionButton = new Button();
            _actionButton.Text = "Cancel";
            _actionButton.Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
            _actionButton.Size = new Size(95, 28);
            _actionButton.Location = new Point(330, 160);
            _actionButton.BackColor = Color.White;
            _actionButton.FlatStyle = FlatStyle.System;
            _actionButton.Click += ActionButton_Click;

            this.Controls.Add(_statusLabel);
            this.Controls.Add(_progressBar);
            this.Controls.Add(_detailLabel);
            this.Controls.Add(_actionButton);

            this.Shown += MainForm_Shown;
            this.FormClosing += MainForm_FormClosing;
        }

        private void MainForm_Shown(object sender, EventArgs e)
        {
            StartDownload();
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            CancelDownload();
        }

        private void ActionButton_Click(object sender, EventArgs e)
        {
            if (_actionButton.Text == "Retry")
            {
                _actionButton.Text = "Cancel";
                StartDownload();
            }
            else if (_actionButton.Text == "Enter Token")
            {
                PromptForToken();
            }
            else
            {
                CancelDownload();
                this.Close();
            }
        }

        private void CancelDownload()
        {
            if (_cts != null)
            {
                _cts.Cancel();
            }
        }

        private void StartDownload()
        {
            _cts = new CancellationTokenSource();
            _workerThread = new Thread(WorkerProc) { IsBackground = true };
            _workerThread.Start();
        }

        private void PromptForToken()
        {
            using (Form prompt = new Form())
            {
                prompt.Width = 420;
                prompt.Height = 180;
                prompt.FormBorderStyle = FormBorderStyle.FixedDialog;
                prompt.Text = "GitHub Access Token Required";
                prompt.StartPosition = FormStartPosition.CenterParent;
                prompt.MaximizeBox = false;
                prompt.MinimizeBox = false;

                Label lbl = new Label() { Left = 20, Top = 15, Width = 360, Height = 35, Text = "Enter your GitHub Personal Access Token (PAT) with read permission for the repository:" };
                TextBox txt = new TextBox() { Left = 20, Top = 55, Width = 360, UseSystemPasswordChar = true };
                Button ok = new Button() { Text = "Save & Continue", Left = 230, Width = 150, Top = 95, DialogResult = DialogResult.OK };
                Button cancel = new Button() { Text = "Cancel", Left = 145, Width = 75, Top = 95, DialogResult = DialogResult.Cancel };

                prompt.Controls.Add(lbl);
                prompt.Controls.Add(txt);
                prompt.Controls.Add(ok);
                prompt.Controls.Add(cancel);
                prompt.AcceptButton = ok;
                prompt.CancelButton = cancel;

                if (prompt.ShowDialog(this) == DialogResult.OK && !string.IsNullOrWhiteSpace(txt.Text))
                {
                    _token = txt.Text.Trim();
                    _actionButton.Text = "Cancel";
                    StartDownload();
                }
            }
        }

        private void WorkerProc()
        {
            try
            {
                if (string.IsNullOrEmpty(_token))
                {
                    this.Invoke((Action)(() =>
                    {
                        _statusLabel.Text = "Authentication Required";
                        _detailLabel.Text = "No GitHub PAT token configured.";
                        _progressBar.Style = ProgressBarStyle.Blocks;
                        _progressBar.Value = 0;
                        _actionButton.Text = "Enter Token";
                    }));
                    return;
                }

                SetStatus("Checking for updates...", "Fetching release metadata from repository...", true, 0);

                // 1. Get Release Info (Latest release or specific tag)
                string endpoint = string.IsNullOrEmpty(_targetVersion) 
                    ? "releases/latest" 
                    : string.Format("releases/tags/{0}", _targetVersion.StartsWith("v", StringComparison.OrdinalIgnoreCase) ? _targetVersion : ("v" + _targetVersion));

                string apiUrl = string.Format("https://api.github.com/repos/{0}/{1}/{2}", Program.RepoOwner, Program.RepoName, endpoint);
                HttpWebRequest releaseReq = (HttpWebRequest)WebRequest.Create(apiUrl);
                releaseReq.UserAgent = "AbeerSuite-Downloader";
                releaseReq.Headers["Authorization"] = "Bearer " + _token;
                releaseReq.Accept = "application/vnd.github+json";
                releaseReq.Timeout = 15000;

                string releaseJson = null;
                using (HttpWebResponse resp = (HttpWebResponse)releaseReq.GetResponse())
                using (StreamReader reader = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                {
                    releaseJson = reader.ReadToEnd();
                }

                // 2. Parse Asset ID and Asset Name
                string tagName = ExtractJsonValue(releaseJson, "tag_name");
                string assetId = null;
                string assetName = null;
                long assetSize = 0;

                int assetsIdx = releaseJson.IndexOf("\"assets\":");
                if (assetsIdx > 0)
                {
                    int exeIdx = releaseJson.IndexOf(".exe\"", assetsIdx);
                    if (exeIdx > 0)
                    {
                        // Find asset name
                        int nameKeyIdx = releaseJson.LastIndexOf("\"name\":", exeIdx);
                        if (nameKeyIdx > assetsIdx)
                        {
                            int valStart = releaseJson.IndexOf("\"", nameKeyIdx + 7) + 1;
                            int valEnd = releaseJson.IndexOf("\"", valStart);
                            assetName = releaseJson.Substring(valStart, valEnd - valStart);
                        }

                        // Find asset id
                        int idKeyIdx = releaseJson.LastIndexOf("\"id\":", exeIdx);
                        if (idKeyIdx > assetsIdx)
                        {
                            int numStart = idKeyIdx + 5;
                            while (numStart < releaseJson.Length && (releaseJson[numStart] == ' ' || releaseJson[numStart] == ':')) numStart++;
                            int numEnd = numStart;
                            while (numEnd < releaseJson.Length && char.IsDigit(releaseJson[numEnd])) numEnd++;
                            assetId = releaseJson.Substring(numStart, numEnd - numStart);
                        }

                        // Find asset size
                        int sizeKeyIdx = releaseJson.IndexOf("\"size\":", nameKeyIdx);
                        if (sizeKeyIdx > 0 && sizeKeyIdx < exeIdx + 100)
                        {
                            int sStart = sizeKeyIdx + 7;
                            while (sStart < releaseJson.Length && (releaseJson[sStart] == ' ' || releaseJson[sStart] == ':')) sStart++;
                            int sEnd = sStart;
                            while (sEnd < releaseJson.Length && char.IsDigit(releaseJson[sEnd])) sEnd++;
                            long.TryParse(releaseJson.Substring(sStart, sEnd - sStart), out assetSize);
                        }
                    }
                }

                if (string.IsNullOrEmpty(assetId) || string.IsNullOrEmpty(assetName))
                {
                    throw new Exception("Could not find an installer executable (.exe) in latest release (" + (tagName ?? "unknown") + ").");
                }

                SetStatus("Downloading " + assetName + "...", "Preparing download...", false, 0);

                // 3. Request download from GitHub Asset API with Accept: application/octet-stream
                // GitHub will respond with HTTP 302 Found redirecting to AWS S3.
                // We MUST disable AllowAutoRedirect so we don't send Authorization header to S3 (which causes HTTP 400).
                string assetApiUrl = string.Format("https://api.github.com/repos/{0}/{1}/releases/assets/{2}", Program.RepoOwner, Program.RepoName, assetId);
                HttpWebRequest assetReq = (HttpWebRequest)WebRequest.Create(assetApiUrl);
                assetReq.UserAgent = "AbeerSuite-Downloader";
                assetReq.Headers["Authorization"] = "Bearer " + _token;
                assetReq.Accept = "application/octet-stream";
                assetReq.AllowAutoRedirect = false;

                string downloadUrl = null;
                using (HttpWebResponse assetResp = (HttpWebResponse)assetReq.GetResponse())
                {
                    if (assetResp.StatusCode == HttpStatusCode.Found ||
                        assetResp.StatusCode == HttpStatusCode.Moved ||
                        assetResp.StatusCode == HttpStatusCode.Redirect ||
                        assetResp.StatusCode == HttpStatusCode.TemporaryRedirect ||
                        (int)assetResp.StatusCode == 308)
                    {
                        downloadUrl = assetResp.Headers["Location"];
                    }
                    else if (assetResp.StatusCode == HttpStatusCode.OK)
                    {
                        downloadUrl = assetApiUrl;
                    }
                }

                if (string.IsNullOrEmpty(downloadUrl))
                {
                    throw new Exception("Did not receive download redirect location from GitHub.");
                }

                // 4. Download file from storage URL (no Authorization header sent to AWS S3)
                string tempDir = Path.GetTempPath();
                string targetFilePath = Path.Combine(tempDir, assetName);

                HttpWebRequest s3Req = (HttpWebRequest)WebRequest.Create(downloadUrl);
                s3Req.UserAgent = "AbeerSuite-Downloader";
                s3Req.AllowAutoRedirect = true;

                using (HttpWebResponse s3Resp = (HttpWebResponse)s3Req.GetResponse())
                {
                    long totalBytes = s3Resp.ContentLength > 0 ? s3Resp.ContentLength : assetSize;
                    byte[] buffer = new byte[65536];

                    using (Stream respStream = s3Resp.GetResponseStream())
                    using (FileStream fileStream = new FileStream(targetFilePath, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        long totalRead = 0;
                        DateTime startTime = DateTime.Now;
                        DateTime lastUpdate = DateTime.MinValue;

                        int bytesRead;
                        while ((bytesRead = respStream.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            if (_cts.IsCancellationRequested)
                            {
                                fileStream.Close();
                                try { File.Delete(targetFilePath); } catch { }
                                return;
                            }

                            fileStream.Write(buffer, 0, bytesRead);
                            totalRead += bytesRead;

                            if ((DateTime.Now - lastUpdate).TotalMilliseconds > 150 || totalRead == totalBytes)
                            {
                                lastUpdate = DateTime.Now;
                                double elapsedSec = (DateTime.Now - startTime).TotalSeconds;
                                double speedMBps = elapsedSec > 0 ? (totalRead / (1024.0 * 1024.0)) / elapsedSec : 0;
                                int percent = totalBytes > 0 ? (int)((totalRead * 100) / totalBytes) : 0;

                                string downloadedMB = (totalRead / (1024.0 * 1024.0)).ToString("0.0");
                                string totalMB = totalBytes > 0 ? (totalBytes / (1024.0 * 1024.0)).ToString("0.0") + " MB" : "Unknown";

                                string detail = string.Format("{0} MB / {1} ({2}%) - {3:0.0} MB/s", downloadedMB, totalMB, percent, speedMBps);

                                SetStatus("Downloading " + assetName + " (" + percent + "%)...", detail, false, Math.Min(100, percent));
                            }
                        }
                    }
                }

                // 5. Launch downloaded installer
                SetStatus("Starting installer...", "Launching " + assetName + "...", true, 100);
                Thread.Sleep(500);

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = targetFilePath;
                psi.UseShellExecute = true;
                if (_isSilent)
                {
                    psi.Arguments = "/S";
                }
                Process.Start(psi);

                // Exit downloader cleanly
                this.Invoke((Action)(() =>
                {
                    this.Close();
                }));
            }
            catch (ThreadAbortException) { }
            catch (Exception ex)
            {
                if (_cts.IsCancellationRequested) return;

                this.Invoke((Action)(() =>
                {
                    _statusLabel.Text = "Download Failed";
                    _detailLabel.Text = ex.Message;
                    _progressBar.Style = ProgressBarStyle.Blocks;
                    _progressBar.Value = 0;
                    _actionButton.Text = ex.Message.Contains("401") || ex.Message.Contains("403") || ex.Message.Contains("404") ? "Enter Token" : "Retry";
                }));
            }
        }

        private void SetStatus(string status, string detail, bool isMarquee, int progressVal)
        {
            if (this.IsDisposed || !this.IsHandleCreated) return;

            this.Invoke((Action)(() =>
            {
                _statusLabel.Text = status;
                _detailLabel.Text = detail;
                if (isMarquee)
                {
                    _progressBar.Style = ProgressBarStyle.Marquee;
                }
                else
                {
                    _progressBar.Style = ProgressBarStyle.Blocks;
                    _progressBar.Value = Math.Max(0, Math.Min(100, progressVal));
                }
            }));
        }

        private string ExtractJsonValue(string json, string key)
        {
            string searchKey = "\"" + key + "\":";
            int idx = json.IndexOf(searchKey);
            if (idx < 0) return null;

            int valStart = json.IndexOf("\"", idx + searchKey.Length);
            if (valStart < 0) return null;
            valStart++;

            int valEnd = json.IndexOf("\"", valStart);
            if (valEnd < 0) return null;

            return json.Substring(valStart, valEnd - valStart);
        }
    }
}
