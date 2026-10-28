// bridge.cpp - QoderMod bridge DLL (x64)
// Injected into the Qoder CN main process by QoderModLauncher.
// Waits for the local CDP endpoint opened by --remote-debugging-port,
// injects hook.js + config into every page target, hot-reloads config.
//
// Build (MinGW):  g++ -std=c++11 -O2 -shared -static -static-libgcc -static-libstdc++ -o bridge.dll bridge.cpp -lws2_32

#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <string>
#include <vector>
#include <map>
#include <cstdio>
#include <cstdlib>
#include <cctype>

#ifdef _MSC_VER
#pragma comment(lib, "ws2_32.lib")
#endif

// globals
static HINSTANCE g_hSelf = NULL;
static std::wstring g_dir; // directory of this DLL (set by worker)

// utils
static std::string Itoa(unsigned long v)
{
    char b[32];
    sprintf(b, "%lu", v);
    return std::string(b);
}

static std::string WideToUtf8(const std::wstring& w)
{
    if (w.empty()) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), NULL, 0, NULL, NULL);
    if (n <= 0) return std::string();
    std::string s((size_t)n, 0);
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, NULL, NULL);
    return s;
}

static std::wstring Utf8ToWide(const std::string& s)
{
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), NULL, 0);
    if (n <= 0) return std::wstring();
    std::wstring w((size_t)n, 0);
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n);
    return w;
}

static void LogA(const std::string& msg)
{
    std::wstring dir = g_dir + L"\\logs";
    CreateDirectoryW(dir.c_str(), NULL);
    std::wstring path = dir + L"\\bridge.log";
    HANDLE h = CreateFileW(path.c_str(), FILE_APPEND_DATA,
                           FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                           OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h != INVALID_HANDLE_VALUE)
    {
        SYSTEMTIME st;
        GetLocalTime(&st);
        char head[64];
        sprintf(head, "[%02d:%02d:%02d] ", (int)st.wHour, (int)st.wMinute, (int)st.wSecond);
        DWORD written = 0;
        WriteFile(h, head, (DWORD)strlen(head), &written, NULL);
        WriteFile(h, msg.c_str(), (DWORD)msg.size(), &written, NULL);
        WriteFile(h, "\r\n", 2, &written, NULL);
        CloseHandle(h);
    }
    std::wstring w = std::wstring(L"[QMod] ") + Utf8ToWide(msg) + L"\n";
    OutputDebugStringW(w.c_str());
}

static std::string ReadAllBytes(const std::wstring& path)
{
    HANDLE h = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return std::string();
    LARGE_INTEGER sz;
    std::string data;
    if (GetFileSizeEx(h, &sz) && sz.QuadPart > 0 && sz.QuadPart < 64 * 1024 * 1024)
    {
        data.resize((size_t)sz.QuadPart);
        DWORD rd = 0;
        if (!ReadFile(h, &data[0], (DWORD)data.size(), &rd, NULL)) data.clear();
        else data.resize(rd);
    }
    CloseHandle(h);
    return data;
}

static ULONGLONG FileMtime(const std::wstring& path)
{
    WIN32_FILE_ATTRIBUTE_DATA fad;
    if (!GetFileAttributesExW(path.c_str(), GetFileExInfoStandard, &fad)) return 0;
    return ((ULONGLONG)fad.ftLastWriteTime.dwHighDateTime << 32) | fad.ftLastWriteTime.dwLowDateTime;
}

// config
// mod.ini format (UTF-8, prompt section must be last):
//   port=9333
//   enabled=1
//   mode=append|prepend|replace
//   debuglog=1
//   prompt=<<<
//   ...multi-line prompt...
//   >>>
struct Config
{
    int port;
    bool enabled;
    bool debuglog;
    bool secResearch;
    bool injectTool;
    bool forceTool;
    bool capture;
    std::string mode;
    std::string prompt;
    std::string theme;
    std::string lang;
    std::vector<std::string> rules;
    Config() : port(9333), enabled(false), debuglog(false), secResearch(false),
               injectTool(false), forceTool(true), capture(true),
               mode("append"), theme("auto"), lang("auto") {}
};

static std::string Trim(const std::string& s)
{
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return std::string();
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

static Config LoadConfig(const std::wstring& path)
{
    Config c;
    std::string raw = ReadAllBytes(path);
    if (raw.empty()) return c;

    size_t pm = raw.find("prompt=<<<");
    std::string header = (pm == std::string::npos) ? raw : raw.substr(0, pm);
    if (pm != std::string::npos)
    {
        size_t start = pm + 10; // strlen("prompt=<<<")
        while (start < raw.size() && (raw[start] == '\r' || raw[start] == '\n')) start++;
        size_t end = raw.find("\n>>>", start);
        std::string body = (end == std::string::npos) ? raw.substr(start) : raw.substr(start, end - start);
        while (!body.empty() && (body[body.size() - 1] == '\r' || body[body.size() - 1] == '\n'))
            body.erase(body.size() - 1);
        c.prompt = body;
    }

    size_t pos = 0;
    while (pos <= header.size())
    {
        size_t e = header.find('\n', pos);
        size_t lineEnd = (e == std::string::npos) ? header.size() : e;
        std::string line = Trim(header.substr(pos, lineEnd - pos));
        pos = (e == std::string::npos) ? header.size() + 1 : e + 1;
        if (line.empty()) continue;
        size_t eq = line.find('=');
        if (eq == std::string::npos) continue;
        std::string k = Trim(line.substr(0, eq));
        std::string v = Trim(line.substr(eq + 1));
        if (k == "port")
        {
            int pv = atoi(v.c_str());
            if (pv > 0 && pv < 65536) c.port = pv;
        }
        else if (k == "enabled") c.enabled = (v == "1");
        else if (k == "debuglog") c.debuglog = (v == "1");
        else if (k == "mode")
        {
            if (v == "append" || v == "prepend" || v == "replace") c.mode = v;
        }
    }
    return c;
}

// escape a UTF-8 string into a double-quoted JS/JSON string literal
static std::string JsQuote(const std::string& s)
{
    std::string o;
    o.reserve(s.size() + 16);
    o += '"';
    for (size_t i = 0; i < s.size(); ++i)
    {
        unsigned char ch = (unsigned char)s[i];
        switch (ch)
        {
        case '\\': o += "\\\\"; break;
        case '"':  o += "\\\""; break;
        case '\n': o += "\\n"; break;
        case '\r': o += "\\r"; break;
        case '\t': o += "\\t"; break;
        default:
            if (ch < 0x20)
            {
                char buf[8];
                sprintf(buf, "\\u%04x", (unsigned int)ch);
                o += buf;
            }
            else
            {
                o += (char)ch;
            }
        }
    }
    o += '"';
    return o;
}

static std::string ConfigToJs(const Config& c)
{
    std::string js = "{enabled:";
    js += c.enabled ? "true" : "false";
    js += ",mode:\"";
    js += c.mode;
    js += "\",debuglog:";
    js += c.debuglog ? "true" : "false";
    js += ",prompt:";
    js += JsQuote(c.prompt);
    js += ",rules:[";
    for (size_t i = 0; i < c.rules.size(); ++i)
    {
        if (i) js += ",";
        js += JsQuote(c.rules[i]);
    }
    js += "],secResearch:";
    js += c.secResearch ? "true" : "false";
    js += ",injectTool:";
    js += c.injectTool ? "true" : "false";
    js += ",forceTool:";
    js += c.forceTool ? "true" : "false";
    js += ",capture:";
    js += c.capture ? "true" : "false";
    js += ",theme:\"";
    js += c.theme;
    js += "\",lang:\"";
    js += c.lang;
    js += "\"}";
    return js;
}

// sockets
static bool g_wsa = false;

static SOCKET TcpConnect(int port, int timeoutMs)
{
    if (!g_wsa)
    {
        WSADATA w;
        if (WSAStartup(MAKEWORD(2, 2), &w) != 0) return INVALID_SOCKET;
        g_wsa = true;
    }
    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) return INVALID_SOCKET;
    sockaddr_in a;
    ZeroMemory(&a, sizeof(a));
    a.sin_family = AF_INET;
    a.sin_port = htons((u_short)port);
    a.sin_addr.s_addr = inet_addr("127.0.0.1");
    if (connect(s, (sockaddr*)&a, sizeof(a)) != 0)
    {
        closesocket(s);
        return INVALID_SOCKET;
    }
    DWORD t = (DWORD)timeoutMs;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&t, sizeof(t));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char*)&t, sizeof(t));
    return s;
}

static bool SendAll(SOCKET s, const std::string& data)
{
    size_t off = 0;
    while (off < data.size())
    {
        int n = send(s, data.c_str() + off, (int)(data.size() - off), 0);
        if (n <= 0) return false;
        off += (size_t)n;
    }
    return true;
}

static bool RecvExact(SOCKET s, char* buf, int len)
{
    int got = 0;
    while (got < len)
    {
        int n = recv(s, buf + got, len - got, 0);
        if (n <= 0) return false;
        got += n;
    }
    return true;
}

// HTTP (/json/list)
static std::string Lower(std::string s)
{
    for (size_t i = 0; i < s.size(); ++i)
        if (s[i] >= 'A' && s[i] <= 'Z') s[i] = (char)(s[i] - 'A' + 'a');
    return s;
}

static std::string Dechunk(const std::string& in)
{
    std::string out;
    size_t p = 0;
    while (p < in.size())
    {
        size_t e = in.find("\r\n", p);
        if (e == std::string::npos) break;
        std::string hex = in.substr(p, e - p);
        size_t sc = hex.find(';');
        if (sc != std::string::npos) hex = hex.substr(0, sc);
        unsigned long sz = strtoul(hex.c_str(), NULL, 16);
        if (sz == 0) break;
        p = e + 2;
        if (p + sz > in.size())
        {
            out.append(in, p, std::string::npos);
            break;
        }
        out.append(in, p, sz);
        p += sz + 2;
    }
    return out;
}

static std::string HttpGet(int port, const std::string& path)
{
    SOCKET s = TcpConnect(port, 3000);
    if (s == INVALID_SOCKET) return std::string();
    std::string req = "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + Itoa((unsigned long)port) +
                      "\r\nConnection: close\r\n\r\n";
    std::string raw;
    if (SendAll(s, req))
    {
        char buf[8192];
        int n;
        while ((n = recv(s, buf, sizeof(buf), 0)) > 0)
        {
            raw.append(buf, (size_t)n);
            if (raw.size() > 8 * 1024 * 1024) break;
        }
    }
    closesocket(s);

    size_t lineEnd = raw.find("\r\n");
    if (lineEnd == std::string::npos) return std::string();
    if (raw.substr(0, lineEnd).find(" 200") == std::string::npos) return std::string();

    size_t hdr = raw.find("\r\n\r\n");
    if (hdr == std::string::npos) return std::string();
    std::string headers = raw.substr(0, hdr);
    std::string body = raw.substr(hdr + 4);
    if (Lower(headers).find("transfer-encoding: chunked") != std::string::npos)
        body = Dechunk(body);
    return body;
}

static void ExtractPageUrls(const std::string& json, std::vector<std::string>& urls)
{
    size_t p = 0;
    const std::string key = "\"webSocketDebuggerUrl\"";
    for (;;)
    {
        size_t k = json.find(key, p);
        if (k == std::string::npos) break;
        size_t q = json.find("\"ws://", k);
        if (q == std::string::npos) break;
        size_t e = json.find('"', q + 1);
        if (e == std::string::npos) break;
        std::string url = json.substr(q + 1, e - q - 1);
        p = e;
        if (url.find("/devtools/page/") != std::string::npos) urls.push_back(url);
    }
}

// 主进程 inspector 的 ws 地址不带 /devtools/page/ 前缀
static void ExtractWsUrls(const std::string& json, std::vector<std::string>& urls)
{
    size_t p = 0;
    const std::string key = "\"webSocketDebuggerUrl\"";
    for (;;)
    {
        size_t k = json.find(key, p);
        if (k == std::string::npos) break;
        size_t q = json.find("\"ws://", k);
        if (q == std::string::npos) break;
        size_t e = json.find('"', q + 1);
        if (e == std::string::npos) break;
        urls.push_back(json.substr(q + 1, e - q - 1));
        p = e;
    }
}

// WebSocket client
static std::string B64(const unsigned char* d, int n)
{
    static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string o;
    int i = 0;
    while (i + 2 < n)
    {
        unsigned v = ((unsigned)d[i] << 16) | ((unsigned)d[i + 1] << 8) | d[i + 2];
        o += T[(v >> 18) & 63];
        o += T[(v >> 12) & 63];
        o += T[(v >> 6) & 63];
        o += T[v & 63];
        i += 3;
    }
    if (i + 1 == n)
    {
        unsigned v = (unsigned)d[i] << 16;
        o += T[(v >> 18) & 63];
        o += T[(v >> 12) & 63];
        o += "==";
    }
    else if (i + 2 == n)
    {
        unsigned v = ((unsigned)d[i] << 16) | ((unsigned)d[i + 1] << 8);
        o += T[(v >> 18) & 63];
        o += T[(v >> 12) & 63];
        o += T[(v >> 6) & 63];
        o += '=';
    }
    return o;
}

static bool ParseWsUrl(const std::string& url, int& port, std::string& path)
{
    const std::string p1 = "ws://";
    if (url.compare(0, p1.size(), p1) != 0) return false;
    size_t hostEnd = url.find('/', p1.size());
    if (hostEnd == std::string::npos) return false;
    std::string host = url.substr(p1.size(), hostEnd - p1.size());
    size_t colon = host.find(':');
    if (colon == std::string::npos) return false;
    port = atoi(host.substr(colon + 1).c_str());
    path = url.substr(hostEnd);
    return port > 0;
}

static bool WsHandshake(SOCKET s, int port, const std::string& path)
{
    unsigned char key[16];
    for (int i = 0; i < 16; ++i) key[i] = (unsigned char)(rand() & 0xFF);
    std::string req = "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + Itoa((unsigned long)port) +
        "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + B64(key, 16) +
        "\r\nSec-WebSocket-Version: 13\r\n\r\n";
    if (!SendAll(s, req)) return false;
    std::string resp;
    char buf[1024];
    int n;
    DWORD start = GetTickCount();
    while (resp.find("\r\n\r\n") == std::string::npos)
    {
        n = recv(s, buf, sizeof(buf), 0);
        if (n <= 0) return false;
        resp.append(buf, (size_t)n);
        if (resp.size() > 65536 || GetTickCount() - start > 5000) return false;
    }
    return resp.find(" 101") != std::string::npos;
}

static bool WsSendFrame(SOCKET s, unsigned char opcode, const std::string& payload)
{
    std::string f;
    f += (char)(0x80 | opcode);
    size_t n = payload.size();
    unsigned char mk[4];
    for (int i = 0; i < 4; ++i) mk[i] = (unsigned char)(rand() & 0xFF);
    if (n < 126)
    {
        f += (char)(0x80 | (unsigned char)n);
    }
    else if (n < 65536)
    {
        f += (char)(0x80 | 126);
        f += (char)((n >> 8) & 0xFF);
        f += (char)(n & 0xFF);
    }
    else
    {
        f += (char)(0x80 | 127);
        for (int i = 7; i >= 0; --i)
            f += (char)(((unsigned long long)n >> (i * 8)) & 0xFF);
    }
    f.append((const char*)mk, 4);
    size_t base = f.size();
    f.resize(base + n);
    for (size_t i = 0; i < n; ++i)
        f[base + i] = (char)((unsigned char)payload[i] ^ mk[i & 3]);
    return SendAll(s, f);
}

static bool WsRecvMessage(SOCKET s, std::string& out, int timeoutMs)
{
    DWORD t = (DWORD)timeoutMs;
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char*)&t, sizeof(t));
    out.clear();
    for (;;)
    {
        unsigned char h[2];
        if (!RecvExact(s, (char*)h, 2)) return false;
        bool fin = (h[0] & 0x80) != 0;
        unsigned char op = (unsigned char)(h[0] & 0x0F);
        bool masked = (h[1] & 0x80) != 0;
        unsigned long long len = (unsigned long long)(h[1] & 0x7F);
        if (len == 126)
        {
            unsigned char e[2];
            if (!RecvExact(s, (char*)e, 2)) return false;
            len = ((unsigned long long)e[0] << 8) | e[1];
        }
        else if (len == 127)
        {
            unsigned char e[8];
            if (!RecvExact(s, (char*)e, 8)) return false;
            len = 0;
            for (int i = 0; i < 8; ++i) len = (len << 8) | e[i];
        }
        if (len > 32ull * 1024 * 1024) return false;
        unsigned char mk[4] = {0, 0, 0, 0};
        if (masked && !RecvExact(s, (char*)mk, 4)) return false;
        std::string pay;
        if (len > 0)
        {
            pay.resize((size_t)len);
            if (!RecvExact(s, &pay[0], (int)len)) return false;
            if (masked)
                for (size_t i = 0; i < pay.size(); ++i)
                    pay[i] = (char)((unsigned char)pay[i] ^ mk[i & 3]);
        }
        if (op == 0x9) // ping -> pong
        {
            WsSendFrame(s, 0xA, pay);
            continue;
        }
        if (op == 0x8) return false; // close
        out += pay;
        if (fin) return true;
    }
}

static bool CdpCall(const std::string& wsUrl, const std::string& method,
                    const std::string& paramsJson, int timeoutMs)
{
    int port = 0;
    std::string path;
    if (!ParseWsUrl(wsUrl, port, path)) return false;
    SOCKET s = TcpConnect(port, 3000);
    if (s == INVALID_SOCKET) return false;
    bool ok = false;
    if (WsHandshake(s, port, path))
    {
        std::string msg = "{\"id\":1,\"method\":\"" + method + "\",\"params\":" + paramsJson + "}";
        if (WsSendFrame(s, 0x1, msg))
        {
            std::string reply;
            for (int i = 0; i < 6; ++i)
            {
                if (!WsRecvMessage(s, reply, timeoutMs)) break;
                if (reply.find("\"id\":1") != std::string::npos)
                {
                    ok = reply.find("\"error\"") == std::string::npos;
                    break;
                }
            }
        }
    }
    closesocket(s);
    return ok;
}

// 工具服务: 极简 JSON
struct J
{
    int t; // 0 null, 1 bool, 2 num, 3 str, 4 arr, 5 obj
    bool b;
    double n;
    std::string s;
    std::vector<J> a;
    std::vector<std::pair<std::string, J> > o;
    J() : t(0), b(false), n(0) {}
};

struct JParser
{
    const std::string& src;
    size_t p;
    bool ok;
    JParser(const std::string& s) : src(s), p(0), ok(true) {}

    void ws()
    {
        while (p < src.size() && (src[p] == ' ' || src[p] == '\t' || src[p] == '\r' || src[p] == '\n')) p++;
    }

    bool lit(const char* w)
    {
        size_t n = strlen(w);
        if (src.compare(p, n, w) == 0) { p += n; return true; }
        return false;
    }

    std::string parseStr()
    {
        std::string out;
        if (p >= src.size() || src[p] != '"') { ok = false; return out; }
        p++;
        while (p < src.size())
        {
            char c = src[p++];
            if (c == '"') return out;
            if (c == '\\')
            {
                if (p >= src.size()) break;
                char e = src[p++];
                if (e == '"' || e == '\\' || e == '/') out += e;
                else if (e == 'n') out += '\n';
                else if (e == 't') out += '\t';
                else if (e == 'r') out += '\r';
                else if (e == 'b') out += '\b';
                else if (e == 'f') out += '\f';
                else if (e == 'u')
                {
                    if (p + 4 <= src.size())
                    {
                        unsigned cp = (unsigned)strtoul(src.substr(p, 4).c_str(), NULL, 16);
                        p += 4;
                        if (cp < 0x80) out += (char)cp;
                        else if (cp < 0x800)
                        {
                            out += (char)(0xC0 | (cp >> 6));
                            out += (char)(0x80 | (cp & 0x3F));
                        }
                        else
                        {
                            out += (char)(0xE0 | (cp >> 12));
                            out += (char)(0x80 | ((cp >> 6) & 0x3F));
                            out += (char)(0x80 | (cp & 0x3F));
                        }
                    }
                    else ok = false;
                }
                else out += e;
            }
            else out += c;
        }
        ok = false;
        return out;
    }

    J parse()
    {
        ws();
        J v;
        if (p >= src.size()) { ok = false; return v; }
        char c = src[p];
        if (c == '{')
        {
            v.t = 5;
            p++;
            ws();
            if (p < src.size() && src[p] == '}') { p++; return v; }
            for (;;)
            {
                ws();
                std::string k = parseStr();
                ws();
                if (p >= src.size() || src[p] != ':') { ok = false; break; }
                p++;
                J val = parse();
                v.o.push_back(std::make_pair(k, val));
                ws();
                if (p < src.size() && src[p] == ',') { p++; continue; }
                if (p < src.size() && src[p] == '}') { p++; break; }
                ok = false;
                break;
            }
            return v;
        }
        if (c == '[')
        {
            v.t = 4;
            p++;
            ws();
            if (p < src.size() && src[p] == ']') { p++; return v; }
            for (;;)
            {
                J val = parse();
                v.a.push_back(val);
                ws();
                if (p < src.size() && src[p] == ',') { p++; continue; }
                if (p < src.size() && src[p] == ']') { p++; break; }
                ok = false;
                break;
            }
            return v;
        }
        if (c == '"') { v.t = 3; v.s = parseStr(); return v; }
        if (c == 't') { if (lit("true")) { v.t = 1; v.b = true; } else ok = false; return v; }
        if (c == 'f') { if (lit("false")) { v.t = 1; v.b = false; } else ok = false; return v; }
        if (c == 'n') { if (lit("null")) v.t = 0; else ok = false; return v; }
        v.t = 2;
        std::string num;
        while (p < src.size() && (isdigit((unsigned char)src[p]) || src[p] == '-' || src[p] == '+' ||
                                   src[p] == '.' || src[p] == 'e' || src[p] == 'E'))
        {
            num += src[p];
            p++;
        }
        if (num.empty()) { ok = false; return v; }
        v.n = strtod(num.c_str(), NULL);
        return v;
    }
};

static const J* JGet(const J& obj, const char* key)
{
    for (size_t i = 0; i < obj.o.size(); ++i)
        if (obj.o[i].first == key) return &obj.o[i].second;
    return NULL;
}

// qcmod.json: %USERPROFILE%\.qoder-cn\qcmod.json
static std::wstring QcmodPath()
{
    wchar_t buf[MAX_PATH * 2];
    DWORD n = GetEnvironmentVariableW(L"USERPROFILE", buf, MAX_PATH * 2);
    std::wstring base = (n > 0 && n < MAX_PATH * 2) ? std::wstring(buf, n) : g_dir;
    std::wstring dir = base + L"\\.qoder-cn";
    CreateDirectoryW(dir.c_str(), NULL);
    return dir + L"\\qcmod.json";
}

static bool ApplyConfigJson(Config& c, const std::string& raw)
{
    if (raw.empty()) return false;
    JParser jp(raw);
    J j = jp.parse();
    if (!jp.ok || j.t != 5) return false;
    const J* pc = JGet(j, "config");
    const J* o = (pc && pc->t == 5) ? pc : &j;
    const J* v;
    if ((v = JGet(*o, "enabled")) && v->t == 1) c.enabled = v->b;
    if ((v = JGet(*o, "debuglog")) && v->t == 1) c.debuglog = v->b;
    if ((v = JGet(*o, "secResearch")) && v->t == 1) c.secResearch = v->b;
    if ((v = JGet(*o, "injectTool")) && v->t == 1) c.injectTool = v->b;
    if ((v = JGet(*o, "capture")) && v->t == 1) c.capture = v->b;
    if ((v = JGet(*o, "forceTool")) && v->t == 1) c.forceTool = v->b;
    if ((v = JGet(*o, "mode")) && v->t == 3)
    {
        if (v->s == "append" || v->s == "prepend" || v->s == "replace") c.mode = v->s;
    }
    if ((v = JGet(*o, "prompt")) && v->t == 3) c.prompt = v->s;
    if ((v = JGet(*o, "theme")) && v->t == 3) c.theme = v->s;
    if ((v = JGet(*o, "lang")) && v->t == 3) c.lang = v->s;
    if ((v = JGet(*o, "rules")) && v->t == 4)
    {
        c.rules.clear();
        for (size_t i = 0; i < v->a.size(); ++i)
            if (v->a[i].t == 3) c.rules.push_back(v->a[i].s);
    }
    return true;
}

static std::string ConfigToJsonFile(const Config& c)
{
    std::string j = "{\n";
    j += "  \"enabled\": "; j += c.enabled ? "true" : "false"; j += ",\n";
    j += "  \"mode\": " + JsQuote(c.mode) + ",\n";
    j += "  \"prompt\": " + JsQuote(c.prompt) + ",\n";
    j += "  \"rules\": [";
    for (size_t i = 0; i < c.rules.size(); ++i)
    {
        if (i) j += ", ";
        j += JsQuote(c.rules[i]);
    }
    j += "],\n";
    j += "  \"debuglog\": "; j += c.debuglog ? "true" : "false"; j += ",\n";
    j += "  \"secResearch\": "; j += c.secResearch ? "true" : "false"; j += ",\n";
    j += "  \"injectTool\": "; j += c.injectTool ? "true" : "false"; j += ",\n";
    j += "  \"forceTool\": "; j += c.forceTool ? "true" : "false"; j += ",\n";
    j += "  \"capture\": "; j += c.capture ? "true" : "false"; j += ",\n";
    j += "  \"theme\": " + JsQuote(c.theme) + ",\n";
    j += "  \"lang\": " + JsQuote(c.lang) + "\n}\n";
    return j;
}

// 工具服务: token 与文件操作
static std::string g_token;

static bool WriteAllBytes(const std::wstring& path, const std::string& data)
{
    HANDLE h = CreateFileW(path.c_str(), GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                           FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return false;
    DWORD wr = 0;
    bool ok = WriteFile(h, data.data(), (DWORD)data.size(), &wr, NULL) &&
              wr == (DWORD)data.size();
    CloseHandle(h);
    return ok;
}

static bool FileExistsW(const std::wstring& path)
{
    DWORD attr = GetFileAttributesW(path.c_str());
    return attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY);
}

static void InitToken()
{
    if (!g_token.empty()) return;
    std::wstring path = g_dir + L"\\mod.token";
    std::string t = ReadAllBytes(path);
    while (!t.empty() && (t[t.size() - 1] == '\r' || t[t.size() - 1] == '\n' || t[t.size() - 1] == ' '))
        t.erase(t.size() - 1);
    if (t.size() < 8)
    {
        t.clear();
        srand((unsigned)GetTickCount());
        const char* H = "0123456789abcdef";
        for (int i = 0; i < 32; ++i) t += H[rand() & 15];
        WriteAllBytes(path, t);
    }
    g_token = t;
    LogA("工具令牌已就绪 (mod.token)");
}

static std::string ToolPrefix()
{
    return "window.__QMOD_TOOL__={port:9334,token:" + JsQuote(g_token) + "};\n";
}

static std::string HttpResp(int code, const std::string& body)
{
    const char* st = "400 Bad Request";
    if (code == 200) st = "200 OK";
    else if (code == 204) st = "204 No Content";
    else if (code == 401) st = "401 Unauthorized";
    else if (code == 404) st = "404 Not Found";
    std::string h = std::string("HTTP/1.1 ") + st + "\r\n";
    h += "Content-Type: application/json; charset=utf-8\r\n";
    h += "Content-Length: " + Itoa((unsigned long)body.size()) + "\r\n";
    h += "Access-Control-Allow-Origin: *\r\n";
    h += "Access-Control-Allow-Headers: X-QMod-Token, Content-Type\r\n";
    h += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n";
    h += "Connection: close\r\n\r\n";
    return h + body;
}

static void SendJson(SOCKET c, int code, const std::string& body)
{
    SendAll(c, HttpResp(code, body));
}

static void HandleToolClient(SOCKET c)
{
    DWORD t = 5000;
    setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, (const char*)&t, sizeof(t));
    std::string req;
    char buf[8192];
    int n;
    size_t hdrEnd = std::string::npos;
    size_t needBody = 0;
    while ((n = recv(c, buf, sizeof(buf), 0)) > 0)
    {
        req.append(buf, (size_t)n);
        if (hdrEnd == std::string::npos)
        {
            hdrEnd = req.find("\r\n\r\n");
            if (hdrEnd != std::string::npos)
            {
                std::string head = Lower(req.substr(0, hdrEnd));
                size_t cp = head.find("content-length:");
                if (cp != std::string::npos) needBody = (size_t)atoi(head.c_str() + cp + 15);
            }
        }
        if (hdrEnd != std::string::npos && req.size() >= hdrEnd + 4 + needBody) break;
        if (req.size() > 32 * 1024 * 1024) break;
    }
    if (req.empty()) return;

    size_t le = req.find("\r\n");
    std::string line0 = (le == std::string::npos) ? req : req.substr(0, le);
    std::string method, path;
    size_t sp1 = line0.find(' ');
    size_t sp2 = (sp1 == std::string::npos) ? std::string::npos : line0.find(' ', sp1 + 1);
    if (sp1 != std::string::npos)
    {
        method = line0.substr(0, sp1);
        path = (sp2 == std::string::npos) ? line0.substr(sp1 + 1) : line0.substr(sp1 + 1, sp2 - sp1 - 1);
    }
    std::string headers = (hdrEnd == std::string::npos) ? req : req.substr(0, hdrEnd);
    std::string body = (hdrEnd == std::string::npos) ? std::string() : req.substr(hdrEnd + 4);

    if (method == "OPTIONS")
    {
        SendJson(c, 204, "");
        return;
    }

    std::string lh = Lower(headers);
    std::string tok;
    size_t tp = lh.find("x-qmod-token:");
    if (tp != std::string::npos)
    {
        size_t vs = tp + 13;
        while (vs < headers.size() && headers[vs] == ' ') vs++;
        size_t ve = headers.find("\r\n", vs);
        tok = headers.substr(vs, (ve == std::string::npos ? headers.size() : ve) - vs);
    }
    if (tok != g_token)
    {
        SendJson(c, 401, "{\"ok\":false,\"error\":\"unauthorized\"}");
        return;
    }

    if (method == "GET" && path == "/health")
    {
        SendJson(c, 200, "{\"ok\":true,\"port\":9334}");
        return;
    }

    if (method == "POST" && path == "/fs/read_range")
    {
        JParser jp(body);
        J j = jp.parse();
        const J* pp = JGet(j, "path");
        if (!jp.ok || !pp || pp->t != 3)
        {
            SendJson(c, 400, "{\"ok\":false,\"error\":\"bad request\"}");
            return;
        }
        std::wstring wp = Utf8ToWide(pp->s);
        if (!FileExistsW(wp))
        {
            SendJson(c, 400, "{\"ok\":false,\"error\":\"file not found\"}");
            return;
        }
        std::string data = ReadAllBytes(wp);
        int start = 1, end = 0;
        const J* ps = JGet(j, "start");
        const J* pe = JGet(j, "end");
        if (ps && ps->t == 2) start = (int)ps->n;
        if (pe && pe->t == 2) end = (int)pe->n;
        if (start < 1) start = 1;
        std::string out;
        int lineNo = 0, lastLine = 0;
        size_t pos = 0;
        while (pos <= data.size())
        {
            size_t nl = data.find('\n', pos);
            std::string line = (nl == std::string::npos) ? data.substr(pos) : data.substr(pos, nl - pos);
            if (!line.empty() && line[line.size() - 1] == '\r') line.erase(line.size() - 1);
            lineNo++;
            bool take = (lineNo >= start) && (end == 0 || lineNo <= end);
            if ((lineNo >= start) && (end == 0 || lineNo <= end)) lastLine = lineNo;
            if (take)
            {
                if (!out.empty()) out += "\n";
                out += line;
            }
            if (nl == std::string::npos) break;
            pos = nl + 1;
        }
        std::string resp = "{\"ok\":true,\"start\":" + Itoa((unsigned long)start) +
                           ",\"end\":" + Itoa((unsigned long)lastLine) +
                           ",\"total\":" + Itoa((unsigned long)lineNo) +
                           ",\"content\":" + JsQuote(out) + "}";
        SendJson(c, 200, resp);
        return;
    }

    if (method == "POST" && path == "/fs/batch_patch")
    {
        JParser jp(body);
        J j = jp.parse();
        const J* pp = JGet(j, "path");
        const J* pq = JGet(j, "patches");
        if (!jp.ok || !pp || pp->t != 3 || !pq || pq->t != 4)
        {
            SendJson(c, 400, "{\"ok\":false,\"error\":\"bad request\"}");
            return;
        }
        std::wstring wp = Utf8ToWide(pp->s);
        if (!FileExistsW(wp))
        {
            SendJson(c, 400, "{\"ok\":false,\"error\":\"file not found\"}");
            return;
        }
        std::string content = ReadAllBytes(wp);
        int applied = 0;
        std::string fails;
        for (size_t i = 0; i < pq->a.size(); ++i)
        {
            const J& p = pq->a[i];
            const J* po = JGet(p, "old");
            const J* pn = JGet(p, "new");
            if (!po || po->t != 3 || !pn || pn->t != 3 || po->s.empty())
            {
                if (!fails.empty()) fails += ",";
                fails += Itoa((unsigned long)i);
                continue;
            }
            size_t found = content.find(po->s);
            if (found == std::string::npos)
            {
                if (!fails.empty()) fails += ",";
                fails += Itoa((unsigned long)i);
                continue;
            }
            content.replace(found, po->s.size(), pn->s);
            applied++;
        }
        if (applied > 0) WriteAllBytes(wp, content);
        LogA("工具 batch_patch: " + pp->s + " applied=" + Itoa((unsigned long)applied) +
             " failed=[" + fails + "]");
        std::string resp = "{\"ok\":true,\"applied\":" + Itoa((unsigned long)applied) +
                           ",\"failed\":[" + fails + "]}";
        SendJson(c, 200, resp);
        return;
    }

    if (method == "POST" && path == "/fs/write")
    {
        JParser jp(body);
        J j = jp.parse();
        const J* pp = JGet(j, "path");
        const J* pc = JGet(j, "content");
        if (!jp.ok || !pp || pp->t != 3 || !pc || pc->t != 3)
        {
            SendJson(c, 400, "{\"ok\":false,\"error\":\"bad request\"}");
            return;
        }
        bool ok = WriteAllBytes(Utf8ToWide(pp->s), pc->s);
        LogA("工具 write: " + pp->s + (ok ? " ok" : " failed"));
        SendJson(c, ok ? 200 : 400, ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"write failed\"}");
        return;
    }

    SendJson(c, 404, "{\"ok\":false,\"error\":\"not found\"}");
}

static std::string ExecReadRange(const J& j)
{
    const J* pp = JGet(j, "path");
    if (!pp || pp->t != 3) return "{\"ok\":false,\"error\":\"bad request\"}";
    std::wstring wp = Utf8ToWide(pp->s);
    if (!FileExistsW(wp)) return "{\"ok\":false,\"error\":\"file not found\"}";
    std::string data = ReadAllBytes(wp);
    int start = 1, end = 0;
    const J* ps = JGet(j, "start");
    const J* pe = JGet(j, "end");
    if (ps && ps->t == 2) start = (int)ps->n;
    if (pe && pe->t == 2) end = (int)pe->n;
    if (start < 1) start = 1;
    std::string out;
    int lineNo = 0, lastLine = 0;
    size_t pos = 0;
    while (pos <= data.size())
    {
        size_t nl = data.find('\n', pos);
        std::string line = (nl == std::string::npos) ? data.substr(pos) : data.substr(pos, nl - pos);
        if (!line.empty() && line[line.size() - 1] == '\r') line.erase(line.size() - 1);
        lineNo++;
        bool take = (lineNo >= start) && (end == 0 || lineNo <= end);
        if (take) lastLine = lineNo;
        if (take)
        {
            if (!out.empty()) out += "\n";
            out += line;
        }
        if (nl == std::string::npos) break;
        pos = nl + 1;
    }
    return "{\"ok\":true,\"start\":" + Itoa((unsigned long)start) +
           ",\"end\":" + Itoa((unsigned long)lastLine) +
           ",\"total\":" + Itoa((unsigned long)lineNo) +
           ",\"content\":" + JsQuote(out) + "}";
}

static std::string ExecBatchPatch(const J& j)
{
    const J* pp = JGet(j, "path");
    const J* pq = JGet(j, "patches");
    if (!pp || pp->t != 3 || !pq || pq->t != 4) return "{\"ok\":false,\"error\":\"bad request\"}";
    std::wstring wp = Utf8ToWide(pp->s);
    if (!FileExistsW(wp)) return "{\"ok\":false,\"error\":\"file not found\"}";
    std::string content = ReadAllBytes(wp);
    int applied = 0;
    std::string fails;
    for (size_t i = 0; i < pq->a.size(); ++i)
    {
        const J& p = pq->a[i];
        const J* po = JGet(p, "old");
        const J* pn = JGet(p, "new");
        if (!po || po->t != 3 || !pn || pn->t != 3 || po->s.empty())
        {
            if (!fails.empty()) fails += ",";
            fails += Itoa((unsigned long)i);
            continue;
        }
        size_t found = content.find(po->s);
        if (found == std::string::npos)
        {
            if (!fails.empty()) fails += ",";
            fails += Itoa((unsigned long)i);
            continue;
        }
        content.replace(found, po->s.size(), pn->s);
        applied++;
    }
    if (applied > 0) WriteAllBytes(wp, content);
    LogA("工具 batch_patch: " + pp->s + " applied=" + Itoa((unsigned long)applied) +
         " failed=[" + fails + "]");
    return "{\"ok\":true,\"applied\":" + Itoa((unsigned long)applied) +
           ",\"failed\":[" + fails + "]}";
}

static std::string ExecWrite(const J& j)
{
    const J* pp = JGet(j, "path");
    const J* pc = JGet(j, "content");
    if (!pp || pp->t != 3 || !pc || pc->t != 3) return "{\"ok\":false,\"error\":\"bad request\"}";
    bool ok = WriteAllBytes(Utf8ToWide(pp->s), pc->s);
    LogA("工具 write: " + pp->s + (ok ? " ok" : " failed"));
    return ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"write failed\"}";
}

static bool CdpEvalValue(const std::string& wsUrl, const std::string& expr,
                         std::string& out, int timeoutMs)
{
    int port = 0;
    std::string path;
    if (!ParseWsUrl(wsUrl, port, path)) return false;
    SOCKET s = TcpConnect(port, 3000);
    if (s == INVALID_SOCKET) return false;
    bool ok = false;
    out.clear();
    if (WsHandshake(s, port, path))
    {
        std::string msg = "{\"id\":1,\"method\":\"Runtime.evaluate\",\"params\":{\"expression\":" +
                          JsQuote(expr) + ",\"returnByValue\":true}}";
        if (WsSendFrame(s, 0x1, msg))
        {
            std::string reply;
            for (int i = 0; i < 6; ++i)
            {
                if (!WsRecvMessage(s, reply, timeoutMs)) break;
                if (reply.find("\"id\":1") != std::string::npos)
                {
                    JParser jp(reply);
                    J j = jp.parse();
                    const J* res = JGet(j, "result");
                    const J* inner = res ? JGet(*res, "result") : NULL;
                    const J* val = inner ? JGet(*inner, "value") : NULL;
                    if (val && val->t == 3) { out = val->s; ok = true; }
                    break;
                }
            }
        }
    }
    closesocket(s);
    return ok;
}

static DWORD WINAPI HttpWorker(LPVOID)
{
    if (!g_wsa)
    {
        WSADATA w;
        if (WSAStartup(MAKEWORD(2, 2), &w) != 0) return 0;
        g_wsa = true;
    }
    InitToken();
    SOCKET srv = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (srv == INVALID_SOCKET) return 0;
    int yes = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, (const char*)&yes, sizeof(yes));
    sockaddr_in a;
    ZeroMemory(&a, sizeof(a));
    a.sin_family = AF_INET;
    a.sin_port = htons(9334);
    a.sin_addr.s_addr = inet_addr("127.0.0.1");
    if (bind(srv, (sockaddr*)&a, sizeof(a)) != 0 || listen(srv, 8) != 0)
    {
        LogA("工具服务: 端口 9334 绑定失败");
        closesocket(srv);
        return 0;
    }
    LogA("工具服务已启动 127.0.0.1:9334");
    for (;;)
    {
        SOCKET c = accept(srv, NULL, NULL);
        if (c == INVALID_SOCKET) continue;
        HandleToolClient(c);
        closesocket(c);
    }
    return 0;
}

// worker
static volatile LONG g_mainHookState = 0;
static LONG g_mainHookPushed = -1;

static bool PortOpen(int port)
{
    SOCKET s = TcpConnect(port, 300);
    if (s == INVALID_SOCKET) return false;
    closesocket(s);
    return true;
}

// 判断当前运行实例的 asar 是否已打补丁（头部前 4MB 查找 qmod-boot.js）
static bool MainPatchApplied()
{
    static int cached = -1;
    if (cached >= 0) return cached == 1;
    bool val = false;
    wchar_t buf[MAX_PATH * 2];
    DWORD n = GetModuleFileNameW(NULL, buf, MAX_PATH * 2);
    if (n > 0)
    {
        std::wstring exe(buf, n);
        size_t sl = exe.find_last_of(L"\\/");
        if (sl != std::wstring::npos)
        {
            std::wstring asar = exe.substr(0, sl) + L"\\resources\\app.asar";
            HANDLE h = CreateFileW(asar.c_str(), GENERIC_READ,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
                                   OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
            if (h != INVALID_HANDLE_VALUE)
            {
                std::string head;
                head.resize(4 * 1024 * 1024);
                DWORD rd = 0;
                if (ReadFile(h, &head[0], (DWORD)head.size(), &rd, NULL))
                {
                    head.resize(rd);
                    val = head.find("qmod-boot.js") != std::string::npos;
                }
                CloseHandle(h);
            }
        }
    }
    cached = val ? 1 : 0;
    return val;
}

// 主进程钩子: 探测 --inspect 调试口(9335)，把 qmod-main.js 装载进主进程
static DWORD WINAPI MainHookWorker(LPVOID)
{
    Sleep(1200);
    std::string src = ReadAllBytes(g_dir + L"\\qmod-main.js");
    if (src.empty())
    {
        LogA("主进程钩子: qmod-main.js 缺失，跳过");
        g_mainHookState = 2;
        return 0;
    }
    for (int attempt = 0; attempt < 10; ++attempt)
    {
        if (!PortOpen(9335))
        {
            Sleep(1000);
            continue;
        }
        std::string body = HttpGet(9335, "/json/list");
        if (!body.empty())
        {
            std::vector<std::string> urls;
            ExtractWsUrls(body, urls);
            if (!urls.empty())
            {
                if (CdpCall(urls[0], "Runtime.evaluate",
                            "{\"expression\":" + JsQuote(src) + "}", 8000))
                {
                    g_mainHookState = 1;
                    LogA("主进程钩子已安装 (inspector 9335)");
                    return 0;
                }
            }
        }
        Sleep(1000);
    }
    g_mainHookState = 2;
    LogA("主进程钩子: 端口 9335 未开放（Qoder 禁用 --inspect），主进程级功能暂不可用");
    return 0;
}

static DWORD WINAPI Worker(LPVOID)
{
    // resolve own directory
    {
        wchar_t buf[MAX_PATH];
        DWORD n = GetModuleFileNameW(g_hSelf, buf, MAX_PATH);
        g_dir.assign(buf, n);
        size_t slash = g_dir.find_last_of(L"\\/");
        if (slash != std::wstring::npos) g_dir = g_dir.substr(0, slash);
    }
    srand((unsigned)GetTickCount());
    LogA("bridge 已加载, pid=" + Itoa((unsigned long)GetCurrentProcessId()) +
         ", dir=" + WideToUtf8(g_dir));

    std::wstring cfgPath = g_dir + L"\\mod.ini";
    std::wstring hookPath = g_dir + L"\\hook.js";

    Config cfg = LoadConfig(cfgPath);
    std::wstring qcPath = QcmodPath();
    std::string qcRaw = ReadAllBytes(qcPath);
    if (!ApplyConfigJson(cfg, qcRaw))
    {
        WriteAllBytes(qcPath, ConfigToJsonFile(cfg));
        qcRaw = ReadAllBytes(qcPath);
        LogA("已创建配置文件: " + WideToUtf8(qcPath));
    }
    ULONGLONG qcMtime = FileMtime(qcPath);
    ULONGLONG cfgMtime = FileMtime(cfgPath);
    std::string hookJs = ReadAllBytes(hookPath);
    if (hookJs.empty())
        LogA("警告: hook.js 未找到或为空: " + WideToUtf8(hookPath));
    std::wstring uiPath = g_dir + L"\\ui.js";
    std::string uiJs = ReadAllBytes(uiPath);
    if (uiJs.empty())
        LogA("警告: ui.js 未找到或为空: " + WideToUtf8(uiPath));
    ULONGLONG hookMtime = FileMtime(hookPath);
    ULONGLONG uiMtime = FileMtime(uiPath);

    std::map<std::string, std::string> injected; // targetId -> wsUrl
    bool waitedLogged = false;
    DWORD lastWaitLog = 0;

    for (;;)
    {
        // config hot reload
        ULONGLONG mt = FileMtime(cfgPath);
        if (mt != 0 && mt != cfgMtime)
        {
            cfgMtime = mt;
            cfg = LoadConfig(cfgPath);
            ApplyConfigJson(cfg, ReadAllBytes(qcPath));
            std::string cfgJs = ConfigToJs(cfg);
            std::string expr = "window.__QMOD_SET_CONFIG__&&window.__QMOD_SET_CONFIG__(" + cfgJs + ");"
                               "try{(function(n){var k='__QMOD_CONFIG__';var o={};"
                               "try{o=JSON.parse(localStorage.getItem(k)||'{}')}catch(e){};"
                               "for(var p in n)o[p]=n[p];localStorage.setItem(k,JSON.stringify(o));})(" + cfgJs + ")}catch(e){}";
            int okCount = 0;
            for (std::map<std::string, std::string>::iterator it = injected.begin();
                 it != injected.end(); ++it)
            {
                if (CdpCall(it->second, "Runtime.evaluate",
                            "{\"expression\":" + JsQuote(expr) + "}", 3000))
                    okCount++;
            }
            LogA("配置已热更新 (推送成功 " + Itoa((unsigned long)okCount) + "/" +
                 Itoa((unsigned long)injected.size()) + " 个页面)");
        }

        // qcmod.json 变化（UI 保存或外部编辑）→ 重新加载并推送
        ULONGLONG qmt = FileMtime(qcPath);
        if (qmt != 0 && qmt != qcMtime)
        {
            qcMtime = qmt;
            if (ApplyConfigJson(cfg, ReadAllBytes(qcPath)))
            {
                std::string cfgJs2 = ConfigToJs(cfg);
                std::string expr2 = "window.__QMOD_SET_CONFIG__&&window.__QMOD_SET_CONFIG__(" + cfgJs2 + ");"
                                    "try{(function(n){var k='__QMOD_CONFIG__';var o={};"
                                    "try{o=JSON.parse(localStorage.getItem(k)||'{}')}catch(e){};"
                                    "for(var p in n)o[p]=n[p];localStorage.setItem(k,JSON.stringify(o));})(" + cfgJs2 + ")}catch(e){}";
                int okN = 0;
                for (std::map<std::string, std::string>::iterator it = injected.begin();
                     it != injected.end(); ++it)
                {
                    if (CdpCall(it->second, "Runtime.evaluate",
                                "{\"expression\":" + JsQuote(expr2) + "}", 3000))
                        okN++;
                }
                LogA("qcmod.json 已变更，推送 " + Itoa((unsigned long)okN) + "/" +
                     Itoa((unsigned long)injected.size()) + " 个页面");
            }
        }

        // 设置中心保存通道: 页面写入 __QMOD_SAVE__ → 落盘 qcmod.json
        {
            static DWORD lastSave = 0;
            if (!injected.empty() && GetTickCount() - lastSave > 400)
            {
                lastSave = GetTickCount();
                for (std::map<std::string, std::string>::iterator it = injected.begin();
                     it != injected.end(); ++it)
                {
                    std::string sv;
                    if (!CdpEvalValue(it->second, "localStorage.getItem('__QMOD_SAVE__')", sv, 2000))
                        continue;
                    if (sv.size() < 3 || sv == "null") continue;
                    CdpCall(it->second, "Runtime.evaluate",
                            "{\"expression\":" + JsQuote("localStorage.setItem('__QMOD_SAVE__','')") + "}", 2000);
                    if (ApplyConfigJson(cfg, sv))
                    {
                        WriteAllBytes(qcPath, sv + "\n");
                        qcMtime = FileMtime(qcPath);
                        LogA("配置已保存到 qcmod.json (" + Itoa((unsigned long)sv.size()) + " bytes)");
                    }
                    break;
                }
            }
        }

        // hook.js / ui.js 更新后自动重载，并热推送到已注入页面
        ULONGLONG hm = FileMtime(hookPath);
        ULONGLONG um = FileMtime(uiPath);
        if ((hm != 0 && hm != hookMtime) || (um != 0 && um != uiMtime))
        {
            hookMtime = hm;
            uiMtime = um;
            hookJs = ReadAllBytes(hookPath);
            uiJs = ReadAllBytes(uiPath);
            std::string hot = hookJs + "\n" + uiJs;
            int pushed = 0;
            for (std::map<std::string, std::string>::iterator it = injected.begin();
                 it != injected.end(); ++it)
            {
                if (CdpCall(it->second, "Runtime.evaluate",
                            "{\"expression\":" + JsQuote(hot) + "}", 8000))
                    pushed++;
            }
            LogA("hook.js / ui.js 已更新，热推送 " + Itoa((unsigned long)pushed) + "/" +
                 Itoa((unsigned long)injected.size()) + " 个页面");
        }

        // discover page targets
        std::string list = HttpGet(cfg.port, "/json/list");
        if (list.empty())
        {
            if (!waitedLogged || GetTickCount() - lastWaitLog > 10000)
            {
                LogA("等待 CDP 就绪 (127.0.0.1:" + Itoa((unsigned long)cfg.port) + ") ...");
                lastWaitLog = GetTickCount();
                waitedLogged = true;
            }
            Sleep(1000);
            continue;
        }

        std::vector<std::string> urls;
        ExtractPageUrls(list, urls);
        for (size_t i = 0; i < urls.size(); ++i)
        {
            const std::string& url = urls[i];
            size_t idPos = url.find("/devtools/page/");
            std::string id = (idPos == std::string::npos) ? url : url.substr(idPos + 15);
            if (injected.find(id) != injected.end()) continue;

            std::string src = "window.__QMOD__=" + ConfigToJs(cfg) + ";\n" + hookJs + "\n" + uiJs +
                              "\nwindow.__QMOD_SET_CONFIG__&&window.__QMOD_SET_CONFIG__(window.__QMOD__);";
            bool a = CdpCall(url, "Page.addScriptToEvaluateOnNewDocument",
                             "{\"source\":" + JsQuote(src) + "}", 6000);
            bool b = CdpCall(url, "Runtime.evaluate",
                             "{\"expression\":" + JsQuote(src) + "}", 6000);
            if (a || b)
            {
                injected[id] = url;
                LogA("已注入页面 target " + id + (a ? " [新文档]" : "") + (b ? " [当前页面]" : ""));
            }
        }
        // 工具信箱: 轮询页面 localStorage，执行后写回结果（不受页面 CSP 限制）
        {
            static DWORD lastMail = 0;
            if (!injected.empty() && GetTickCount() - lastMail > 400)
            {
                lastMail = GetTickCount();
                for (std::map<std::string, std::string>::iterator it = injected.begin();
                     it != injected.end(); ++it)
                {
                    std::string req;
                    if (!CdpEvalValue(it->second, "localStorage.getItem('__QMOD_TOOLREQ__')", req, 2000))
                        continue;
                    if (req.size() < 3 || req == "null") continue;
                    JParser jp(req);
                    J j = jp.parse();
                    const J* pid = JGet(j, "id");
                    const J* pname = JGet(j, "name");
                    const J* pargs = JGet(j, "args");
                    if (!jp.ok || !pid || pid->t != 3 || !pname || pname->t != 3) continue;
                    CdpCall(it->second, "Runtime.evaluate",
                            "{\"expression\":" + JsQuote("localStorage.setItem('__QMOD_TOOLREQ__','')") + "}", 2000);
                    std::string name = pname->s;
                    std::string resJson;
                    J args = pargs ? *pargs : J();
                    if (name == "__ping__") resJson = "{\"ok\":true,\"pong\":true}";
                    else if (name == "qmod_read_range") resJson = ExecReadRange(args);
                    else if (name == "qmod_batch_patch") resJson = ExecBatchPatch(args);
                    else if (name == "qmod_write_file") resJson = ExecWrite(args);
                    else resJson = "{\"ok\":false,\"error\":\"unknown tool\"}";
                    LogA("工具信箱执行: " + name + " -> " + (resJson.find("\"ok\":true") != std::string::npos ? "ok" : "fail"));
                    std::string wrapped = "{\"id\":" + JsQuote(pid->s) + ",\"ok\":" +
                        (resJson.find("\"ok\":true") != std::string::npos ? "true" : "false") +
                        ",\"result\":" + resJson + "}";
                    CdpCall(it->second, "Runtime.evaluate",
                            "{\"expression\":" + JsQuote("localStorage.setItem('__QMOD_TOOLRES__'," + JsQuote(wrapped) + ");1") + "}", 2000);
                }
            }
        }

        Sleep(800);
    }
    return 0;
}

// entry
extern "C" BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH)
    {
        g_hSelf = hinst;
        DisableThreadLibraryCalls(hinst);
        HANDLE t = CreateThread(NULL, 0, Worker, NULL, 0, NULL);
        if (t) CloseHandle(t);
    }
    return TRUE;
}
