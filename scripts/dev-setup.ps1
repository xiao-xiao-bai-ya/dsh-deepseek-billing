# dsh-deepseek-billing 本地开发环境搭建（幂等，可重复运行）
#
# 原理：profile 用 link: 安装本插件时，Node 从插件「真实路径」（本仓库）向上解析依赖，
#       走不到 DSH 主安装的依赖树。本脚本在 repo\node_modules 里建 Junction 指向主安装
#       嵌套树——与 DSH 自带的 $DSH_HOME/profiles/node_modules 回退层同一机制；
#       Node 按 realpath 解析，插件与宿主加载的是同一物理实例，不会出现双副本。
#
# 用法：powershell -ExecutionPolicy Bypass -File scripts\dev-setup.ps1
# 何时重跑：全局 dsh 升级后 / node_modules 丢失或被 pnpm install 覆盖后。
param(
    [string]$DshModules = ""
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

if (-not $DshModules) {
    $npmRoot = (& npm root -g 2>$null | Select-Object -First 1)
    if ($npmRoot) { $npmRoot = $npmRoot.Trim() }
    if (-not $npmRoot) { Write-Error 'npm root -g 失败：请确认 npm 在 PATH 里，或用 -DshModules 显式指定' }
    $DshModules = Join-Path $npmRoot '@deepseek-ai\dsh\node_modules'
}
if (-not (Test-Path $DshModules)) {
    Write-Error "找不到 DSH 主安装依赖树：$DshModules（确认已 npm i -g @deepseek-ai/dsh，或用 -DshModules 指定）"
}

# 插件 host 端 (lib/index.js) 实际 import 的三个包（peer 两个 + 真依赖一个）
$targets = @(
    @{ Link = 'node_modules\@deepseek-ai\dsh-tools';      Rel = '@deepseek-ai\dsh-tools' },
    @{ Link = 'node_modules\@deepseek-ai\dsh-home-paths'; Rel = '@deepseek-ai\dsh-home-paths' },
    @{ Link = 'node_modules\@deepseek-ai\schemastery';   Rel = '@deepseek-ai\schemastery' },
    @{ Link = 'node_modules\ws';                          Rel = 'ws' }
)
foreach ($t in $targets) {
    $link = Join-Path $repo $t.Link
    $target = Join-Path $DshModules $t.Rel
    if (-not (Test-Path $target)) { Write-Warning "跳过（主安装里没有）：$($t.Rel)"; continue }
    $parent = Split-Path $link -Parent
    if (-not (Test-Path $parent)) { New-Item $parent -ItemType Directory -Force | Out-Null }
    if (Test-Path $link) { Remove-Item $link -Recurse -Force }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "已链接 $($t.Link) -> $target"
}

# 自检：用与 DSH loader 相同的标准 ESM 解析直接 import 插件
$entry = (Join-Path $repo 'lib\index.js') -replace '\\', '/'
& node -e "import('file:///$entry').then(()=>console.log('IMPORT OK')).catch(e=>{console.error('IMPORT FAIL:',e.message);process.exit(1)})"
if ($LASTEXITCODE -ne 0) { Write-Error '自检失败：插件仍无法从本仓库解析依赖' }
Write-Host '完成。注意：不要在本仓库里跑 pnpm install——它会把 junction 覆盖成物理副本（旧病根源）。'
