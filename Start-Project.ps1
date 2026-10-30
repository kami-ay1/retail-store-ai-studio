param(
    [string]$NodeExecutable = "$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath "$NodeExecutable")) {
    throw "请通过 -NodeExecutable 指定已安装的 Node.js 24 可执行文件。"
}
if (-not (Test-Path -LiteralPath "$PSScriptRoot/node_modules/vite/bin/vite.js")) {
    throw "项目依赖尚未安装，请使用 Node.js 24 环境执行 pnpm install。"
}
& "$PSScriptRoot/Start-Qdrant.ps1"
& "$NodeExecutable" "$PSScriptRoot/scripts/dev.mjs"
