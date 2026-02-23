# PowerShell HTTP Server for MangaCloud Reader
# Run: powershell -ExecutionPolicy Bypass -File serve.ps1

$port = 3000
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  MangaCloud Reader Server" -ForegroundColor Magenta
Write-Host "  ========================" -ForegroundColor DarkMagenta
Write-Host "  Local:   http://localhost:$port" -ForegroundColor Cyan
Write-Host "  Network: http://$((Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -ne '127.0.0.1'} | Select-Object -First 1).IPAddress):$port" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host ""

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8' 
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.webp' = 'image/webp'
    '.woff2'= 'font/woff2'
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $localPath = $request.Url.LocalPath
        if ($localPath -eq '/') { $localPath = '/index.html' }
        
        $filePath = Join-Path $root ($localPath.TrimStart('/').Replace('/', '\'))
        
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
            
            $response.ContentType = $contentType
            $response.StatusCode = 200
            
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            
            Write-Host "  200 $localPath" -ForegroundColor Green
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
            $response.ContentLength64 = $msg.Length
            $response.OutputStream.Write($msg, 0, $msg.Length)
            Write-Host "  404 $localPath" -ForegroundColor Red
        }
        
        $response.Close()
    }
} finally {
    $listener.Stop()
}
