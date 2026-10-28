using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace QoderMod
{
    // 控制台 i18n：语言取 qcmod.json 的 lang（auto 时跟随系统）
    internal static class L10n
    {
        public static bool Zh = true;
        public static string T(string zh, string en) { return Zh ? zh : en; }

        public static void Init()
        {
            string lang = "auto";
            try
            {
                string p = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                                        ".qoder-cn", "qcmod.json");
                if (File.Exists(p))
                {
                    string s = File.ReadAllText(p);
                    int i = s.IndexOf("\"lang\"");
                    if (i >= 0)
                    {
                        int c = s.IndexOf(':', i);
                        int q1 = (c > 0) ? s.IndexOf('"', c + 1) : -1;
                        int q2 = (q1 > 0) ? s.IndexOf('"', q1 + 1) : -1;
                        if (q1 > 0 && q2 > q1) lang = s.Substring(q1 + 1, q2 - q1 - 1).Trim();
                    }
                }
            }
            catch { }
            if (lang == "zh") Zh = true;
            else if (lang == "en") Zh = false;
            else
            {
                string c = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
                Zh = (c == "zh");
            }
        }
    }

    // QoderMod 控制台启动器
    // 职责: 自动定位/启动 Qoder、注入 bridge.dll、应用/还原主进程补丁、输出操作日志
    internal static class Program
    {
        private const int CdpPort = 9333;

        private static string T(string zh, string en) { return L10n.T(zh, en); }

        private static void Main(string[] args)
        {
            L10n.Init();
            Log(T("QoderMod Launcher · 控制台模式", "QoderMod Launcher · console mode"));
            Log(T("配置请在 Qoder 内打开 QoderMod 面板修改（保存到 ~/.qoder-cn/qcmod.json）",
                  "Edit settings inside Qoder's QoderMod panel (saved to ~/.qoder-cn/qcmod.json)"));
            if (!Injector.EnableDebugPrivilege())
                Log(T("提示: 未能启用 SeDebugPrivilege；若注入报错误码 5，请以管理员运行本程序",
                      "Note: SeDebugPrivilege not enabled; run as administrator if injection fails with error 5"));

            string mode = args.Length > 0 ? args[0].ToLowerInvariant() : "";
            if (mode == "--inject") { RunInjectOnly(); return; }
            if (mode == "--launch") { RunLaunchInject(); return; }
            if (mode == "--find")
            {
                string p0 = QoderLocator.Find(Log, true);
                Log(p0 == null ? T("未找到 Qoder", "Qoder not found") : "QODER=" + p0);
                return;
            }
            if (mode == "--reqlog")
            {
                PrintReqTail(30);
                return;
            }
            Interactive();
        }

        private static void Log(string msg)
        {
            Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + msg);
        }

        private static void Pause(string msg)
        {
            Console.WriteLine();
            Console.Write(msg);
            Console.ReadLine();
        }

        private static string ReqLogPath()
        {
            return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "logs", "requests.log");
        }

        private static void PrintReqTail(int n)
        {
            string p = ReqLogPath();
            if (!File.Exists(p))
            {
                Log(T("暂无请求记录（仅渲染层请求可见；聊天请求在主进程时不会记录）",
                      "No request records yet (renderer requests only; main-process chat traffic is not captured)"));
                return;
            }
            try
            {
                string[] lines = File.ReadAllLines(p, Encoding.UTF8);
                int start = Math.Max(0, lines.Length - n);
                for (int i = start; i < lines.Length; i++) Console.WriteLine(lines[i]);
            }
            catch (Exception ex)
            {
                Log(ex.Message);
            }
        }

        private static void ViewRequestLogLive()
        {
            PrintReqTail(20);
            Console.WriteLine(T("—— 实时监听新记录（回车返回菜单）——", "—— live view (Enter to return) ——"));
            string p = ReqLogPath();
            long pos = 0;
            try { if (File.Exists(p)) pos = new FileInfo(p).Length; } catch { }
            while (true)
            {
                try
                {
                    if (File.Exists(p))
                    {
                        using (FileStream fs = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                        {
                            if (fs.Length < pos) pos = 0;
                            if (fs.Length > pos)
                            {
                                fs.Seek(pos, SeekOrigin.Begin);
                                byte[] buf = new byte[fs.Length - pos];
                                int rd = fs.Read(buf, 0, buf.Length);
                                pos += rd;
                                Console.Write(Encoding.UTF8.GetString(buf, 0, rd));
                            }
                        }
                    }
                }
                catch { }
                if (Console.KeyAvailable)
                {
                    ConsoleKeyInfo k = Console.ReadKey(true);
                    if (k.Key == ConsoleKey.Enter) break;
                }
                Thread.Sleep(500);
            }
        }

        private static void Interactive()
        {
            while (true)
            {
                QoderProc.Info running = QoderProc.FindPreferredTarget();
                string exePath = ResolveExe(false);
                Console.WriteLine();
                Console.WriteLine("============================================");
                Console.WriteLine(T(" Qoder 路径: ", " Qoder path: ") + (exePath ?? T("未找到（将尝试全盘扫描）", "not found (will scan)")));
                if (running != null)
                    Console.WriteLine(T(" 状态: Qoder 正在运行 (PID ", " Status: Qoder running (PID ") + running.Pid + ")");
                else
                    Console.WriteLine(T(" 状态: Qoder 未运行", " Status: Qoder not running"));
                Console.WriteLine(T(" [1] 启动并注入（若已运行则注入当前实例）", " [1] Launch & inject (inject into running instance if any)"));
                Console.WriteLine(T(" [2] 关闭 Qoder 并重启", " [2] Close Qoder and relaunch"));
                Console.WriteLine(T(" [3] 重新定位 Qoder（全盘扫描）", " [3] Relocate Qoder (full scan)"));
                Console.WriteLine(T(" [4] 查看请求/注入日志（实时）", " [4] View request/injection log (live)"));
                Console.WriteLine(T(" [0] 退出", " [0] Exit"));
                Console.WriteLine("============================================");
                Console.Write(T("请选择: ", "Select: "));
                string line = Console.ReadLine();
                if (line == null) return;
                line = line.Trim();
                Console.WriteLine();

                if (line == "0") return;
                if (line == "1") { RunLaunchInject(); Pause(T("按回车返回菜单...", "Press Enter to return...")); }
                else if (line == "2") { RunRestartInject(); Pause(T("按回车返回菜单...", "Press Enter to return...")); }
                else if (line == "3") { QoderLocator.Find(Log, true); Pause(T("按回车返回菜单...", "Press Enter to return...")); }
                else if (line == "4") { ViewRequestLogLive(); }
                else Log(T("无效选项: ", "Invalid option: ") + line);
            }
        }

        private static string ResolveExe(bool rescan)
        {
            return QoderLocator.Find(Log, rescan);
        }

        private static bool _patchValue = false;

        private static bool WaitForCdp(int timeoutMs)
        {
            return QoderProc.WaitForCdp(CdpPort, timeoutMs);
        }

        private static bool SpawnQoder(bool withInspect)
        {
            try
            {
                string exe = ResolveExe(false);
                if (string.IsNullOrEmpty(exe) || !File.Exists(exe))
                {
                    Log(T("未找到 Qoder CN.exe，请确认已安装（菜单 [6] 可全盘扫描）",
                          "Qoder CN.exe not found; install it or run menu [6]"));
                    return false;
                }
                string args = "--remote-debugging-port=" + CdpPort;
                Process.Start(exe, args);
                Log(T("已启动 Qoder（调试端口 " + CdpPort + "）", "Qoder launched (debug port " + CdpPort + ")"));
                return true;
            }
            catch (Exception ex)
            {
                Log(T("启动失败: ", "Launch failed: ") + ex.Message);
                return false;
            }
        }

        // 单轮启动并注入；失败返回 false
        private static bool TryLaunchCycle(int round)
        {
            QoderProc.Info running = QoderProc.FindPreferredTarget();
            if (running != null)
            {
                Log(T("检测到 Qoder 正在运行 (PID " + running.Pid + ")，注入当前实例（第 " + round + " 轮）",
                      "Qoder running (PID " + running.Pid + "), injecting current instance (round " + round + ")"));
                return InjectWithRetry(running.Pid);
            }

            Log(T("Qoder 未运行，开始启动（第 " + round + " 轮）", "Qoder not running, launching (round " + round + ")"));
            if (!SpawnQoder(true)) return false;
            if (!WaitForCdp(25000))
            {
                Log(T("带 --inspect 启动未就绪，回退普通启动...", "--inspect launch not ready, falling back..."));                if (!SpawnQoder(false)) return false;
                if (!WaitForCdp(40000))
                {
                    Log(T("等待调试端口超时", "Timed out waiting for debug port"));
                    return false;
                }
            }
            return InjectAfterStartup();
        }

        private static void RunLaunchInject()
        {
            if (TryLaunchCycle(1)) { Log(T("完成: 注入成功", "Done: injection succeeded")); return; }
            Log(T("首次启动或注入失败，自动重试一次...", "First attempt failed, retrying once..."));
            Thread.Sleep(1500);
            if (TryLaunchCycle(2)) { Log(T("重试成功", "Retry succeeded")); return; }
            Log(T("重试仍失败：请以管理员运行本程序 / 暂时关闭安全软件 / 先手动打开 Qoder 后用 [3]",
                  "Retry failed: run as admin, disable security software, or open Qoder manually then use [3]"));
        }

        private static void RunRestartInject()
        {
            for (int round = 1; round <= 2; round++)
            {
                QoderProc.KillAll(Log);
                if (SpawnQoder(true))
                {
                    if (WaitForCdp(25000) || (SpawnQoder(false) && WaitForCdp(40000)))
                    {
                        if (InjectAfterStartup())
                        {
                            Log(T("完成: 重启并注入成功", "Done: restarted and injected"));
                            return;
                        }
                    }
                }
                if (round == 1) Log(T("重启流程失败，自动重试一次...", "Restart failed, retrying once..."));
                Thread.Sleep(1500);
            }
            Log(T("重启注入连续失败，请查看日志", "Restart+inject failed repeatedly; check logs"));
        }

        private static bool InjectAfterStartup()
        {
            QoderProc.Info found = null;
            for (int i = 0; i < 30 && found == null; i++)
            {
                found = QoderProc.FindPreferredTarget();
                if (found == null) Thread.Sleep(500);
            }
            if (found == null)
            {
                Log(T("无法定位 Qoder 主进程", "Cannot locate Qoder main process"));
                return false;
            }
            Thread.Sleep(600);
            return InjectWithRetry(found.Pid);
        }

        private static void RunInjectOnly()
        {
            QoderProc.Info running = QoderProc.FindPreferredTarget();
            if (running == null)
            {
                Log(T("未检测到运行中的 Qoder，请先启动 Qoder 或使用菜单 [1]。",
                      "No running Qoder detected; start it or use menu [1]."));
                return;
            }
            Log(T("注入到 PID ", "Injecting into PID ") + running.Pid + " ...");
            if (InjectWithRetry(running.Pid)) Log(T("完成", "Done"));
        }

        private static string PickBridgeDll()
        {
            try
            {
                string dir = AppDomain.CurrentDomain.BaseDirectory;
                string best = null;
                DateTime bestT = DateTime.MinValue;
                foreach (string f in Directory.GetFiles(dir, "bridge*.dll"))
                {
                    string name = Path.GetFileName(f);
                    if (name.IndexOf(".old", StringComparison.OrdinalIgnoreCase) >= 0) continue;
                    DateTime t = File.GetLastWriteTimeUtc(f);
                    if (t > bestT) { bestT = t; best = name; }
                }
                if (best != null) return best;
            }
            catch { }
            return "bridge.dll";
        }

        private static bool InjectWithRetry(int pid)
        {
            Exception last = null;
            for (int attempt = 1; attempt <= 5; attempt++)
            {
                int target = pid;
                if (attempt > 1)
                {
                    QoderProc.Info t = QoderProc.FindPreferredTarget();
                    if (t == null)
                    {
                        Log(T("第 " + attempt + " 次: 暂未找到可注入目标，稍后重试...",
                              "attempt " + attempt + ": no target yet, retrying..."));
                        Thread.Sleep(700);
                        continue;
                    }
                    target = t.Pid;
                }
                try
                {
                    Injector.InjectIntoProcess(target, PickBridgeDll(), Log);
                    if (QoderProc.TcpAlive(CdpPort))
                    {
                        Log(T("完成: 已注入 PID " + target + "，设置中心会在 1-3 秒内在 Qoder 中挂载。",
                              "Done: injected PID " + target + "; panel mounts in 1-3s."));
                        Log(T("请求记录可在菜单 [4] 实时查看（bin\\logs\\requests.log，仅渲染层请求可见）",
                              "Request log: menu [4] live view (bin\\logs\\requests.log, renderer requests only)"));
                    }
                    else
                    {
                        Log(T("已注入 PID " + target + "，但调试端口 9333 未开放：面板无法挂载。",
                              "Injected PID " + target + " but port 9333 is closed: panel cannot mount."));
                        Log(T("请使用 [2] 关闭并重启（会带调试端口启动并注入）。",
                              "Use [2] to close and relaunch with the debug port."));
                    }
                    return true;
                }
                catch (Exception ex)
                {
                    last = ex;
                    Log(T("第 " + attempt + " 次注入失败: ", "attempt " + attempt + " failed: ") + ex.Message);
                    Thread.Sleep(800);
                }
            }
            Log(T("注入失败（已重试 5 次）: ", "Injection failed after 5 attempts: ") +
                (last == null ? "unknown" : last.Message));
            Log(T("提示: 错误码 5 = 拒绝访问，多为目标进程正在退出或安全软件拦截。",
                  "Hint: error 5 = access denied; target may be exiting or blocked by security software."));
            return false;
        }

    }

    internal static class Injector
    {
        private const uint MEM_COMMIT = 0x00001000;
        private const uint MEM_RESERVE = 0x00002000;
        private const uint MEM_RELEASE = 0x00008000;
        private const uint PAGE_READWRITE = 0x04;
        private const uint PROCESS_ALL = 0x1F0FFF;

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint a, bool i, int pid);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr a, uint s, uint t, uint p);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool VirtualFreeEx(IntPtr h, IntPtr a, uint s, uint f);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool WriteProcessMemory(IntPtr h, IntPtr a, byte[] b, uint s, out IntPtr w);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateRemoteThread(IntPtr h, IntPtr a, uint s, IntPtr f, IntPtr p, uint c, IntPtr id);

        [DllImport("kernel32.dll")]
        private static extern uint WaitForSingleObject(IntPtr h, uint ms);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetExitCodeThread(IntPtr h, out uint c);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr h);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]
        private static extern IntPtr GetModuleHandleA(string n);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi)]
        private static extern IntPtr GetProcAddress(IntPtr m, string n);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool OpenProcessToken(IntPtr h, uint acc, out IntPtr tok);

        [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool LookupPrivilegeValue(string system, string name, out long luid);

        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern bool AdjustTokenPrivileges(IntPtr tok, bool disableAll,
            ref TOKEN_PRIVILEGES newState, uint len, IntPtr prev, IntPtr retLen);

        [StructLayout(LayoutKind.Sequential)]
        private struct TOKEN_PRIVILEGES
        {
            public uint PrivilegeCount;
            public long Luid;
            public uint Attributes;
        }

        public static bool EnableDebugPrivilege()
        {
            try
            {
                IntPtr tok;
                if (!OpenProcessToken(GetCurrentProcess(), 0x28, out tok)) return false;
                TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
                tp.PrivilegeCount = 1;
                tp.Attributes = 2;
                long luid;
                bool ok = LookupPrivilegeValue(null, "SeDebugPrivilege", out luid);
                tp.Luid = luid;
                if (ok) ok = AdjustTokenPrivileges(tok, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero);
                CloseHandle(tok);
                return ok;
            }
            catch
            {
                return false;
            }
        }

        public static void InjectIntoProcess(int pid, string dllName, Action<string> log)
        {
            string dllPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, dllName);
            if (!File.Exists(dllPath))
                throw new Exception(L10n.T("找不到 " + dllPath + "，请先运行 build.bat 构建", "missing " + dllPath + "; run build.bat first"));

            IntPtr hProcess = OpenProcess(PROCESS_ALL, false, pid);
            if (hProcess == IntPtr.Zero)
                throw new Exception("OpenProcess 失败/denied (错误码/error " + Marshal.GetLastWin32Error() + ")");
            try
            {
                if (WaitForSingleObject(hProcess, 0) != 0x00000102)
                    throw new Exception(L10n.T("目标进程已退出 (PID " + pid + ")", "target exited (PID " + pid + ")"));
                byte[] bytes = Encoding.Unicode.GetBytes(dllPath + "\0");
                IntPtr remote = VirtualAllocEx(hProcess, IntPtr.Zero, (uint)bytes.Length,
                                               MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
                if (remote == IntPtr.Zero)
                    throw new Exception("VirtualAllocEx 失败/denied (错误码/error " + Marshal.GetLastWin32Error() + ")");
                try
                {
                    IntPtr written;
                    if (!WriteProcessMemory(hProcess, remote, bytes, (uint)bytes.Length, out written) ||
                        (uint)written != (uint)bytes.Length)
                        throw new Exception("WriteProcessMemory 失败/denied (错误码/error " + Marshal.GetLastWin32Error() + ")");

                    IntPtr loadLib = GetProcAddress(GetModuleHandleA("kernel32.dll"), "LoadLibraryW");
                    if (loadLib == IntPtr.Zero)
                        throw new Exception("无法解析 LoadLibraryW");

                    IntPtr hThread = CreateRemoteThread(hProcess, IntPtr.Zero, 0, loadLib, remote, 0, IntPtr.Zero);
                    if (hThread == IntPtr.Zero)
                        throw new Exception("CreateRemoteThread 失败/denied (错误码/error " + Marshal.GetLastWin32Error() + ")");
                    WaitForSingleObject(hThread, 10000);
                    uint exitCode;
                    if (!GetExitCodeThread(hThread, out exitCode) || exitCode == 0)
                        throw new Exception(L10n.T("DLL 加载失败：请确认 bridge.dll 为 x64 且文件存在",
                                                   "DLL load failed: ensure bridge.dll is x64 and present"));
                    CloseHandle(hThread);
                    log(L10n.T("bridge.dll 注入成功 (PID " + pid + ")，模块基址 0x" + exitCode.ToString("X"),
                               "bridge.dll injected (PID " + pid + "), base 0x" + exitCode.ToString("X")));
                }
                finally
                {
                    VirtualFreeEx(hProcess, remote, 0, MEM_RELEASE);
                }
            }
            finally
            {
                CloseHandle(hProcess);
            }
        }
    }

    // Qoder 安装位置自动定位：常见路径 → 注册表 → 全盘扫描（结果缓存到 bin\qoder-exe.txt）
    internal static class QoderLocator
    {
        private static string BaseDir { get { return AppDomain.CurrentDomain.BaseDirectory; } }
        public static string CacheFile { get { return Path.Combine(BaseDir, "qoder-exe.txt"); } }

        public static string Find(Action<string> log, bool rescan)
        {
            if (!rescan)
            {
                try
                {
                    if (File.Exists(CacheFile))
                    {
                        string c = File.ReadAllText(CacheFile).Trim();
                        if (c.Length > 3 && File.Exists(c)) return c;
                    }
                }
                catch { }
            }
            string p = FindFast();
            if (p != null) { Save(p); log(L10n.T("定位 Qoder: ", "Qoder located: ") + p); return p; }
            log(L10n.T("常见路径与注册表均未找到 Qoder，开始全盘扫描（可能耗时数十秒）...",
                       "Not found in common paths/registry; scanning all fixed drives..."));
            p = ScanDrives(log);
            if (p != null) { Save(p); log(L10n.T("全盘扫描完成: ", "Scan complete: ") + p); return p; }
            log(L10n.T("未找到 Qoder CN.exe，请确认已安装", "Qoder CN.exe not found; check installation"));
            return null;
        }

        private static void Save(string p)
        {
            try { File.WriteAllText(CacheFile, p); } catch { }
        }

        private static List<string> FastCandidates()
        {
            List<string> cands = new List<string>();
            try
            {
                DirectoryInfo d = new DirectoryInfo(BaseDir);
                for (int i = 0; i < 5 && d != null; i++)
                {
                    cands.Add(Path.Combine(d.FullName, "Qoder CN.exe"));
                    d = d.Parent;
                }
            }
            catch { }
            string lad = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrEmpty(lad))
            {
                cands.Add(Path.Combine(lad, @"Programs\qoder-cn\Qoder CN.exe"));
                cands.Add(Path.Combine(lad, @"Programs\Qoder CN\Qoder CN.exe"));
                cands.Add(Path.Combine(lad, @"Qoder CN\Qoder CN.exe"));
            }
            string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            foreach (string root in new string[] { pf, pf86, "D:\\", "C:\\" })
            {
                if (string.IsNullOrEmpty(root)) continue;
                cands.Add(Path.Combine(root, "Qoder CN", "Qoder CN.exe"));
                cands.Add(Path.Combine(root, "Qoder", "Qoder CN.exe"));
                cands.Add(Path.Combine(root, "QoderCN", "Qoder CN.exe"));
            }
            foreach (string root in new string[] { pf, pf86 })
            {
                try
                {
                    if (!string.IsNullOrEmpty(root) && Directory.Exists(root))
                        foreach (string dir in Directory.GetDirectories(root, "*Qoder*"))
                            cands.Add(Path.Combine(dir, "Qoder CN.exe"));
                }
                catch { }
            }
            cands.Add(@"D:\Qoder CN\Qoder CN.exe");
            try { cands.AddRange(RegistryCandidates()); } catch { }
            return cands;
        }

        private static string FindFast()
        {
            List<string> cands = FastCandidates();
            foreach (string c in cands)
            {
                try { if (File.Exists(c)) return c; } catch { }
            }
            foreach (string c in cands)
            {
                try
                {
                    string root = Path.GetDirectoryName(c);
                    if (string.IsNullOrEmpty(root)) continue;
                    string verDir = Path.Combine(root, ".qoder-versions");
                    if (!Directory.Exists(verDir)) continue;
                    foreach (string v in Directory.GetDirectories(verDir))
                    {
                        string e = Path.Combine(v, "Qoder CN.exe");
                        if (File.Exists(e)) return e;
                    }
                }
                catch { }
            }
            return null;
        }

        private static IEnumerable<string> RegistryCandidates()
        {
            List<string> list = new List<string>();
            string[] roots = { @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
                               @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall" };
            foreach (RegistryKey hive in new RegistryKey[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                foreach (string r in roots)
                {
                    try
                    {
                        using (RegistryKey k = hive.OpenSubKey(r))
                        {
                            if (k == null) continue;
                            foreach (string sub in k.GetSubKeyNames())
                            {
                                using (RegistryKey sk = k.OpenSubKey(sub))
                                {
                                    if (sk == null) continue;
                                    object name = sk.GetValue("DisplayName");
                                    if (name == null || name.ToString().IndexOf("Qoder", StringComparison.OrdinalIgnoreCase) < 0) continue;
                                    object loc = sk.GetValue("InstallLocation");
                                    if (loc != null && loc.ToString().Trim().Length > 2)
                                        list.Add(Path.Combine(loc.ToString().Trim().Trim('"'), "Qoder CN.exe"));
                                    object icon = sk.GetValue("DisplayIcon");
                                    if (icon != null)
                                    {
                                        string ic = icon.ToString().Trim().Trim('"').Split(',')[0];
                                        if (ic.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) list.Add(ic);
                                    }
                                }
                            }
                        }
                    }
                    catch { }
                }
            }
            return list;
        }

        private static string ScanDrives(Action<string> log)
        {
            Stopwatch sw = Stopwatch.StartNew();
            List<string> found = new List<string>();
            int visited = 0;
            foreach (DriveInfo drv in DriveInfo.GetDrives())
            {
                if (drv.DriveType != DriveType.Fixed || !drv.IsReady) continue;
                log(L10n.T("扫描磁盘: ", "Scanning drive: ") + drv.Name);
                Queue<KeyValuePair<string, int>> queue = new Queue<KeyValuePair<string, int>>();
                queue.Enqueue(new KeyValuePair<string, int>(drv.RootDirectory.FullName, 0));
                while (queue.Count > 0)
                {
                    if (sw.Elapsed.TotalSeconds > 90) break;
                    KeyValuePair<string, int> cur = queue.Dequeue();
                    string p = cur.Key;
                    int depth = cur.Value;
                    visited++;
                    if ((visited % 4000) == 0)
                        log(L10n.T("扫描中... 已访问 " + visited + " 个目录", "Scanning... " + visited + " dirs"));
                    try
                    {
                        if (File.Exists(Path.Combine(p, "Qoder CN.exe"))) found.Add(Path.Combine(p, "Qoder CN.exe"));
                    }
                    catch { }
                    if (depth >= 7) continue;
                    try
                    {
                        foreach (string sub in Directory.GetDirectories(p))
                        {
                            string ls = sub.ToLowerInvariant();
                            if (ls.EndsWith("\\windows") || ls.EndsWith("\\$recycle.bin") ||
                                ls.EndsWith("\\system volume information") || ls.EndsWith("\\windows\\winsxs") ||
                                ls.Contains("\\node_modules") || ls.Contains("\\.git\\")) continue;
                            queue.Enqueue(new KeyValuePair<string, int>(sub, depth + 1));
                        }
                    }
                    catch { }
                }
                if (found.Count > 0) break;
            }
            log(L10n.T("全盘扫描结束: 访问 " + visited + " 个目录, 命中 " + found.Count + " 个候选",
                       "Scan done: " + visited + " dirs, " + found.Count + " candidates"));

            string best = null;
            int bestScore = -1;
            foreach (string f in found)
            {
                int score = 0;
                try
                {
                    string dir = Path.GetDirectoryName(f);
                    if (Directory.Exists(Path.Combine(dir, "resources"))) score += 100;
                    if (Directory.Exists(Path.Combine(dir, ".qoder-versions"))) score += 80;
                    score += Math.Max(0, 30 - f.Length / 10);
                }
                catch { }
                if (score > bestScore) { bestScore = score; best = f; }
            }
            return best;
        }
    }

    internal static class QoderProc
    {
        public class Info
        {
            public int Pid;
            public string Cmd = "";
        }

        public static List<Info> FindMain()
        {
            List<Info> list = new List<Info>();
            try
            {
                using (ManagementObjectSearcher searcher = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='Qoder CN.exe'"))
                {
                    foreach (ManagementObject o in searcher.Get())
                    {
                        try
                        {
                            object pidObj = o["ProcessId"];
                            if (pidObj == null) continue;
                            object cmdObj = o["CommandLine"];
                            string cmd = cmdObj == null ? "" : cmdObj.ToString();
                            if (cmd.IndexOf("--type=") >= 0) continue;
                            Info info = new Info();
                            info.Pid = Convert.ToInt32(pidObj);
                            info.Cmd = cmd;
                            list.Add(info);
                        }
                        catch { }
                    }
                }
            }
            catch { }
            return list;
        }

        public static Info FindPreferredTarget()
        {
            List<Info> list = FindMain();
            foreach (Info it in list)
            {
                if (it.Cmd.IndexOf("--remote-debugging-port=") >= 0) return it;
            }
            return list.Count > 0 ? list[0] : null;
        }

        public static bool TcpAlive(int port)
        {
            try
            {
                using (TcpClient c = new TcpClient())
                {
                    IAsyncResult ar = c.BeginConnect("127.0.0.1", port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(500)) return false;
                    c.EndConnect(ar);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        public static bool WaitForCdp(int port, int timeoutMs)
        {
            int waited = 0;
            while (waited < timeoutMs)
            {
                if (TcpAlive(port)) return true;
                Thread.Sleep(500);
                waited += 500;
            }
            return false;
        }

        public static void KillAll(Action<string> log)
        {
            Process[] ps = Process.GetProcessesByName("Qoder CN");
            log(L10n.T("正在关闭 " + ps.Length + " 个 Qoder 进程...", "Closing " + ps.Length + " Qoder processes..."));
            foreach (Process p in ps)
            {
                try { p.CloseMainWindow(); } catch { }
            }
            for (int i = 0; i < 20; i++)
            {
                Thread.Sleep(300);
                if (Process.GetProcessesByName("Qoder CN").Length == 0) break;
            }
            ps = Process.GetProcessesByName("Qoder CN");
            foreach (Process p in ps)
            {
                try { p.Kill(); } catch { }
            }
            Thread.Sleep(800);
            log(L10n.T("Qoder 进程已全部关闭", "All Qoder processes closed"));
        }
    }
}
