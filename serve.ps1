# PowerShell HTTP Server for MangaCloud Reader
# Run: powershell -ExecutionPolicy Bypass -File serve.ps1

param([int]$Port = 3000)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://+:$Port/")
$listener.Start()

$networkIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "  MangaCloud Reader Server" -ForegroundColor Magenta
Write-Host "  ========================" -ForegroundColor DarkMagenta
Write-Host "  Local:   http://localhost:$Port" -ForegroundColor Cyan
if ($networkIp) { Write-Host "  Network: http://${networkIp}:$Port" -ForegroundColor Cyan }
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

# MIME types lookup
$mimeTypes = @{
    '.html'  = 'text/html; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.js'    = 'application/javascript; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.svg'   = 'image/svg+xml'
    '.ico'   = 'image/x-icon'
    '.webp'  = 'image/webp'
    '.woff2' = 'font/woff2'
    '.woff'  = 'font/woff'
    '.webmanifest' = 'application/manifest+json'
}

# Pre-encode 404 response
$notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes('Not Found')

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $localPath = $req.Url.LocalPath
        if ($localPath -eq '/') { $localPath = '/index.html' }

        $filePath = Join-Path $root ($localPath.TrimStart('/').Replace('/', '\'))

        # Add CORS headers for local development
        $res.Headers.Add('Access-Control-Allow-Origin', '*')
        $res.Headers.Add('Cache-Control', 'no-cache')

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $res.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            $res.StatusCode = 200

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)

            Write-Host "  200 $localPath" -ForegroundColor Green
        }
        else {
            $res.StatusCode = 404
            $res.ContentType = 'text/plain'
            $res.ContentLength64 = $notFoundBytes.Length
            $res.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
            Write-Host "  404 $localPath" -ForegroundColor Red
        }

        $res.Close()
    }
}
finally {
    $listener.Stop()
    Write-Host "`n  Server stopped." -ForegroundColor Yellow
}
