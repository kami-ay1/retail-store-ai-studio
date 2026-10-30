param()

$ErrorActionPreference = "Stop"
$qdrantRoot = Join-Path "$PSScriptRoot" ".data/qdrant"
$qdrantExecutable = Join-Path "$qdrantRoot" "bin/qdrant.exe"
$qdrantArchive = Join-Path "$qdrantRoot" "qdrant-1.20.0-windows.zip"
$qdrantAddress = "http://127.0.0.1:6333"
$qdrantListening = Get-NetTCPConnection -State Listen -LocalPort 6333 -ErrorAction SilentlyContinue

if ($qdrantListening) {
    $qdrantInfo = Invoke-RestMethod -Uri "$qdrantAddress/" -TimeoutSec 5
    if ($qdrantInfo.title -ne "qdrant - vector search engine") {
        throw "6333 端口已被其他服务占用。"
    }
    Write-Host "Qdrant 已运行：$qdrantAddress"
    return
}

New-Item -ItemType Directory -Path "$qdrantRoot" -Force | Out-Null
if (-not (Test-Path -LiteralPath "$qdrantExecutable")) {
    Write-Host "正在下载 Qdrant 官方 Windows 版本 1.20.0……"
    Invoke-WebRequest -Uri "https://github.com/qdrant/qdrant/releases/download/v1.20.0/qdrant-x86_64-pc-windows-msvc.zip" -OutFile "$qdrantArchive"
    $qdrantDigest = (Get-FileHash -LiteralPath "$qdrantArchive" -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($qdrantDigest -ne "6d13553584fd0411f00637519e293331ff0aa1fb79bd9e30db45839bb75de2be") {
        throw "Qdrant 安装包校验失败，请检查下载内容。"
    }
    Expand-Archive -LiteralPath "$qdrantArchive" -DestinationPath "$qdrantRoot/bin" -Force
}

# 扩展路径只传给本次子进程，支持 Windows 深层目录中的真实索引文件。
$qdrantPreviousStorage = $env:QDRANT__STORAGE__STORAGE_PATH
$qdrantPreviousSnapshots = $env:QDRANT__STORAGE__SNAPSHOTS_PATH
try {
    $env:QDRANT__STORAGE__STORAGE_PATH = "\\?\$([System.IO.Path]::GetFullPath((Join-Path "$qdrantRoot" "storage")))"
    $env:QDRANT__STORAGE__SNAPSHOTS_PATH = "\\?\$([System.IO.Path]::GetFullPath((Join-Path "$qdrantRoot" "snapshots")))"
    $qdrantProcess = Start-Process -FilePath "$qdrantExecutable" -ArgumentList @("--config-path", "config/qdrant.yaml") -WorkingDirectory "$PSScriptRoot" -WindowStyle Hidden -RedirectStandardOutput "$qdrantRoot/stdout.log" -RedirectStandardError "$qdrantRoot/stderr.log" -PassThru
} finally {
    $env:QDRANT__STORAGE__STORAGE_PATH = $qdrantPreviousStorage
    $env:QDRANT__STORAGE__SNAPSHOTS_PATH = $qdrantPreviousSnapshots
}
$qdrantDeadline = (Get-Date).AddSeconds(20)
while (-not (Get-NetTCPConnection -State Listen -LocalPort 6333 -ErrorAction SilentlyContinue)) {
    $qdrantProcess.Refresh()
    if ($qdrantProcess.HasExited) {
        throw "Qdrant 启动失败，请查看 .data/qdrant/stderr.log。"
    }
    if ((Get-Date) -gt $qdrantDeadline) {
        throw "Qdrant 未在 20 秒内启动，请查看 .data/qdrant/stdout.log。"
    }
    Start-Sleep -Milliseconds 250
}
Invoke-RestMethod -Uri "$qdrantAddress/healthz" -TimeoutSec 5 | Out-Null
Write-Host "Qdrant 已启动，进程编号：$($qdrantProcess.Id)，地址：$qdrantAddress"
