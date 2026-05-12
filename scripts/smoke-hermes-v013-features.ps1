param(
  [string]$HermesCommand = $env:HERMES_COMMAND
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($HermesCommand)) {
  $HermesCommand = "hermes"
}

$previousHome = $env:HERMES_HOME
$smokeHome = Join-Path $env:TEMP ("forge-hermes-v013-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $smokeHome | Out-Null
$env:HERMES_HOME = $smokeHome

function Invoke-HermesSmoke {
  param([string[]]$ArgsList)
  $output = & $HermesCommand @ArgsList 2>&1
  $text = ($output | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "hermes $($ArgsList -join ' ') failed with exit $LASTEXITCODE`n$text"
  }
  return $text
}

function Assert-Json {
  param([string]$Text, [string]$Label)
  try {
    return $Text | ConvertFrom-Json
  } catch {
    throw "$Label did not return valid JSON:`n$Text"
  }
}

try {
  Write-Host "[smoke] HERMES_HOME=$smokeHome"

  try {
    Assert-Json (Invoke-HermesSmoke -ArgsList @("capabilities", "--json")) "capabilities" | Out-Null
  } catch {
    $versionText = Invoke-HermesSmoke -ArgsList @("--version")
    Write-Host "[smoke] capabilities --json unavailable on this Hermes CLI; continuing after version check: $versionText"
  }
  Assert-Json (Invoke-HermesSmoke -ArgsList @("kanban", "boards", "list", "--json")) "kanban boards list" | Out-Null

  $board = "forge-smoke-" + (Get-Date -Format "yyyyMMddHHmmss")
  Invoke-HermesSmoke -ArgsList @("kanban", "boards", "create", $board, "--name", "Forge Smoke", "--switch") | Out-Null

  $taskPayload = Assert-Json (Invoke-HermesSmoke -ArgsList @("kanban", "--board", $board, "create", "Verify Forge Kanban", "--body", "Smoke task created by Forge", "--json")) "kanban task create"
  $taskId = [string]$taskPayload.id
  if ([string]::IsNullOrWhiteSpace($taskId) -and $taskPayload.task) {
    $taskId = [string]$taskPayload.task.id
  }
  if ([string]::IsNullOrWhiteSpace($taskId)) {
    throw "Could not read task id from create payload"
  }

  $tasks = Assert-Json (Invoke-HermesSmoke -ArgsList @("kanban", "--board", $board, "list", "--json")) "kanban list"
  if (-not ($tasks | Where-Object { $_.id -eq $taskId })) {
    throw "created task was not found in kanban list"
  }

  Assert-Json (Invoke-HermesSmoke -ArgsList @("kanban", "--board", $board, "show", $taskId, "--json")) "kanban show" | Out-Null
  Invoke-HermesSmoke -ArgsList @("kanban", "--board", $board, "complete", $taskId, "--result", "FORGE_KANBAN_OK") | Out-Null
  Assert-Json (Invoke-HermesSmoke -ArgsList @("kanban", "--board", $board, "diagnostics", "--json")) "kanban diagnostics" | Out-Null

  $scriptsDir = Join-Path $smokeHome "scripts"
  New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null
  Set-Content -Path (Join-Path $scriptsDir "forge_smoke_watchdog.py") -Encoding UTF8 -Value "print('FORGE_CRON_NO_AGENT_OK')"
  Invoke-HermesSmoke -ArgsList @("cron", "create", "--name", "Forge no_agent smoke", "--script", "forge_smoke_watchdog.py", "--no-agent", "every 1m") | Out-Null

  $jobsPath = Join-Path $smokeHome "cron\jobs.json"
  $jobsPayload = Get-Content -Raw -Path $jobsPath | ConvertFrom-Json
  $job = @($jobsPayload.jobs)[0]
  if (-not $job.id) {
    throw "no cron job id found in jobs.json"
  }

  $runOutput = Invoke-HermesSmoke -ArgsList @("cron", "run", [string]$job.id)
  $tickOutput = Invoke-HermesSmoke -ArgsList @("cron", "tick")
  $combinedCronOutput = "$runOutput`n$tickOutput"
  $outputDir = Join-Path $smokeHome ("cron\output\" + [string]$job.id)
  $savedOutput = ""
  if (Test-Path $outputDir) {
    $savedOutput = (Get-ChildItem -Path $outputDir -Filter "*.md" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content -Raw -ErrorAction SilentlyContinue)
  }
  $jobsAfterRun = Get-Content -Raw -Path $jobsPath | ConvertFrom-Json
  $jobAfterRun = @($jobsAfterRun.jobs | Where-Object { $_.id -eq $job.id })[0]
  if ($combinedCronOutput -notmatch "FORGE_CRON_NO_AGENT_OK" -and $savedOutput -notmatch "FORGE_CRON_NO_AGENT_OK") {
    throw "cron no_agent output did not contain FORGE_CRON_NO_AGENT_OK`n$combinedCronOutput`n$savedOutput"
  }
  if ($jobAfterRun.last_status -ne "ok" -or -not $jobAfterRun.no_agent) {
    throw "cron no_agent job did not finish ok or lost no_agent flag"
  }

  try {
    Invoke-HermesSmoke -ArgsList @("chat", "/goal status") | Out-Null
    Write-Host "[smoke] /goal status ok"
  } catch {
    Write-Host "[smoke] /goal status skipped: model runtime is not configured or chat command is unavailable"
  }

  Write-Host "[smoke] Hermes 0.13.0 Kanban + no_agent cron smoke passed"
} finally {
  $env:HERMES_HOME = $previousHome
}
