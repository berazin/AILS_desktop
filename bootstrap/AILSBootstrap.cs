using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AILSBootstrap
{
    internal static class Program
    {
#if AILS_COMMERCIAL
        internal const string InstallerAssetPrefix = "AILS-Commercial-Setup-";
#elif AILS_GENERAL
        internal const string InstallerAssetPrefix = "AILS-General-Setup-";
#else
        internal const string InstallerAssetPrefix = "AILS-Setup-";
#endif
        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new BootstrapForm());
        }
    }

    internal sealed class GitHubRequestException : Exception
    {
        public int StatusCode { get; private set; }

        public GitHubRequestException(string message, int statusCode) : base(message)
        {
            StatusCode = statusCode;
        }
    }

    internal sealed class BootstrapForm : Form
    {
        private const string RepositoryOwner = "berazin";
        private const string RepositoryName = "AILS_desktop";
        private const string ApiVersion = "2022-11-28";

        private readonly HttpClient httpClient;
        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private readonly Label statusLabel = new Label();
        private readonly ProgressBar progressBar = new ProgressBar();
        private readonly Button cancelButton = new Button();

        public BootstrapForm()
        {
            HttpClientHandler handler = new HttpClientHandler();
            handler.AllowAutoRedirect = true;
            httpClient = new HttpClient(handler);
            httpClient.Timeout = TimeSpan.FromMinutes(30);

            Text = "AILS 설치";
            ClientSize = new Size(520, 270);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);

            Label titleLabel = new Label();
            titleLabel.Text = "AILS 설치";
            titleLabel.Font = new Font("Segoe UI", 15F, FontStyle.Bold, GraphicsUnit.Point);
            titleLabel.AutoSize = true;
            titleLabel.Location = new Point(24, 22);
            Controls.Add(titleLabel);

            Label descriptionLabel = new Label();
            descriptionLabel.Text = "최신 AILS 설치 파일을 다운로드합니다.";
            descriptionLabel.AutoSize = true;
            descriptionLabel.Location = new Point(27, 61);
            Controls.Add(descriptionLabel);

            statusLabel.Text = "최신 버전을 확인하고 있습니다...";
            statusLabel.AutoEllipsis = true;
            statusLabel.Location = new Point(29, 145);
            statusLabel.Size = new Size(459, 38);
            Controls.Add(statusLabel);

            progressBar.Location = new Point(29, 190);
            progressBar.Size = new Size(459, 18);
            progressBar.Style = ProgressBarStyle.Marquee;
            Controls.Add(progressBar);

            cancelButton.Text = "취소";
            cancelButton.Location = new Point(388, 222);
            cancelButton.Size = new Size(100, 30);
            cancelButton.Click += delegate { Close(); };
            Controls.Add(cancelButton);

            Shown += async delegate { await RunBootstrapAsync(); };
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                httpClient.Dispose();
            }
            base.Dispose(disposing);
        }

        private async Task RunBootstrapAsync()
        {
            try
            {
                Dictionary<string, object> release = await GetLatestReleaseAsync();
                string releaseTag = GetString(release, "tag_name");
                string releaseVersion = releaseTag.StartsWith("v", StringComparison.OrdinalIgnoreCase)
                    ? releaseTag.Substring(1)
                    : releaseTag;
                if (releaseVersion.EndsWith("-dev", StringComparison.OrdinalIgnoreCase))
                    releaseVersion = releaseVersion.Substring(0, releaseVersion.Length - 4);
                Dictionary<string, object> installerAsset = FindAsset(release, Program.InstallerAssetPrefix + releaseVersion + ".exe");
                Dictionary<string, object> checksumAsset = FindAsset(release, GetString(installerAsset, "name") + ".sha256");

                string expectedHash = await DownloadChecksumAsync(checksumAsset);
                string installerPath = await DownloadInstallerAsync(installerAsset);
                VerifySha256(installerPath, expectedHash);

                statusLabel.Text = "다운로드가 완료되었습니다. 설치 프로그램을 시작합니다.";
                progressBar.Value = 100;
                ProcessStartInfo startInfo = new ProcessStartInfo(installerPath);
                startInfo.UseShellExecute = true;
                Process.Start(startInfo);
                Close();
            }
            catch (Exception error)
            {
                ShowFailure(error.Message);
            }
        }

        private void ShowFailure(string message)
        {
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Value = 0;
            statusLabel.Text = "설치를 계속할 수 없습니다.";
            MessageBox.Show(this, message, "AILS 설치 오류", MessageBoxButtons.OK, MessageBoxIcon.Error);
            cancelButton.Text = "닫기";
        }

        private async Task<Dictionary<string, object>> GetLatestReleaseAsync()
        {
            string url = "https://api.github.com/repos/" + RepositoryOwner + "/" + RepositoryName + "/releases/latest";
            using (HttpRequestMessage request = CreateApiRequest(HttpMethod.Get, url, "application/vnd.github+json"))
            {
                return await SendJsonAsync(request);
            }
        }

        private HttpRequestMessage CreateApiRequest(HttpMethod method, string url, string accept)
        {
            HttpRequestMessage request = new HttpRequestMessage(method, url);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(accept));
            request.Headers.UserAgent.ParseAdd("AILS-Bootstrap/1.0");
            request.Headers.Add("X-GitHub-Api-Version", ApiVersion);
            return request;
        }

        private async Task<Dictionary<string, object>> SendJsonAsync(HttpRequestMessage request)
        {
            using (HttpResponseMessage response = await httpClient.SendAsync(request))
            {
                string text = await response.Content.ReadAsStringAsync();
                Dictionary<string, object> payload = serializer.Deserialize<Dictionary<string, object>>(text);
                if (!response.IsSuccessStatusCode)
                {
                    string message = payload != null ? GetOptionalString(payload, "message") : null;
                    throw new GitHubRequestException(message ?? "GitHub 요청에 실패했습니다.", (int)response.StatusCode);
                }
                return payload ?? new Dictionary<string, object>();
            }
        }

        private Dictionary<string, object> FindAsset(Dictionary<string, object> release, string expectedName)
        {
            foreach (Dictionary<string, object> asset in GetAssets(release))
            {
                if (String.Equals(GetOptionalString(asset, "name"), expectedName, StringComparison.OrdinalIgnoreCase))
                {
                    return asset;
                }
            }
            throw new Exception("최신 Release에서 " + expectedName + " 파일을 찾지 못했습니다.");
        }

        private IEnumerable<Dictionary<string, object>> GetAssets(Dictionary<string, object> release)
        {
            object assetsValue;
            if (!release.TryGetValue("assets", out assetsValue) || !(assetsValue is IEnumerable))
            {
                yield break;
            }
            foreach (object value in (IEnumerable)assetsValue)
            {
                Dictionary<string, object> asset = value as Dictionary<string, object>;
                if (asset != null)
                {
                    yield return asset;
                }
            }
        }

        private async Task<string> DownloadChecksumAsync(Dictionary<string, object> asset)
        {
            byte[] data = await DownloadAssetBytesAsync(asset);
            string checksum = Encoding.ASCII.GetString(data).Trim().Split((char[])null, StringSplitOptions.RemoveEmptyEntries)[0];
            if (!Regex.IsMatch(checksum, "^[A-Fa-f0-9]{64}$"))
            {
                throw new Exception("설치 파일 체크섬 형식이 올바르지 않습니다.");
            }
            return checksum.ToUpperInvariant();
        }

        private async Task<byte[]> DownloadAssetBytesAsync(Dictionary<string, object> asset)
        {
            using (HttpRequestMessage request = CreateApiRequest(HttpMethod.Get, GetString(asset, "browser_download_url"), "application/octet-stream"))
            using (HttpResponseMessage response = await httpClient.SendAsync(request))
            {
                if (!response.IsSuccessStatusCode)
                {
                    throw new GitHubRequestException("Release 자산 다운로드에 실패했습니다.", (int)response.StatusCode);
                }
                return await response.Content.ReadAsByteArrayAsync();
            }
        }

        private async Task<string> DownloadInstallerAsync(Dictionary<string, object> asset)
        {
            string assetName = Path.GetFileName(GetString(asset, "name"));
            string downloadDirectory = Path.Combine(Path.GetTempPath(), "AILS", "updates");
            Directory.CreateDirectory(downloadDirectory);
            string outputPath = Path.Combine(downloadDirectory, assetName);

            using (HttpRequestMessage request = CreateApiRequest(HttpMethod.Get, GetString(asset, "browser_download_url"), "application/octet-stream"))
            using (HttpResponseMessage response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead))
            {
                if (!response.IsSuccessStatusCode)
                {
                    throw new GitHubRequestException("AILS 설치 파일 다운로드에 실패했습니다.", (int)response.StatusCode);
                }
                long total = response.Content.Headers.ContentLength.GetValueOrDefault(-1);
                progressBar.Style = total > 0 ? ProgressBarStyle.Continuous : ProgressBarStyle.Marquee;
                statusLabel.Text = "최신 AILS 설치 파일을 다운로드하고 있습니다...";
                using (Stream input = await response.Content.ReadAsStreamAsync())
                using (FileStream output = new FileStream(outputPath, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    byte[] buffer = new byte[1024 * 128];
                    long received = 0;
                    int read;
                    while ((read = await input.ReadAsync(buffer, 0, buffer.Length)) > 0)
                    {
                        await output.WriteAsync(buffer, 0, read);
                        received += read;
                        if (total > 0)
                        {
                            int percent = (int)Math.Min(100, received * 100L / total);
                            progressBar.Value = percent;
                            statusLabel.Text = "최신 AILS를 다운로드하고 있습니다... " + percent + "%";
                        }
                    }
                }
            }
            return outputPath;
        }

        private void VerifySha256(string path, string expectedHash)
        {
            progressBar.Style = ProgressBarStyle.Marquee;
            statusLabel.Text = "다운로드한 설치 파일의 무결성을 확인하고 있습니다...";
            using (SHA256 sha256 = SHA256.Create())
            using (FileStream input = File.OpenRead(path))
            {
                string actualHash = BitConverter.ToString(sha256.ComputeHash(input)).Replace("-", "");
                if (!String.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
                {
                    File.Delete(path);
                    throw new Exception("설치 파일의 SHA-256 검증에 실패했습니다.");
                }
            }
        }

        private static string GetString(Dictionary<string, object> payload, string key)
        {
            string value = GetOptionalString(payload, key);
            if (String.IsNullOrEmpty(value))
            {
                throw new Exception("GitHub 응답에 " + key + " 값이 없습니다.");
            }
            return value;
        }

        private static string GetOptionalString(Dictionary<string, object> payload, string key)
        {
            object value;
            return payload != null && payload.TryGetValue(key, out value) && value != null
                ? Convert.ToString(value)
                : null;
        }

    }
}
