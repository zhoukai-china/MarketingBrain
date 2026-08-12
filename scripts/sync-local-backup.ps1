param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [Parameter(Mandatory = $true)]
  [string]$BackupRoot
)

$ErrorActionPreference = "Stop"

$resolvedSource = (Resolve-Path -LiteralPath $SourceRoot).Path
$resolvedBackup = [System.IO.Path]::GetFullPath($BackupRoot).TrimEnd('\')

if ([System.IO.Path]::GetPathRoot($resolvedSource) -ne "F:\") {
  throw "Backup refused: source must be on drive F. Actual: $resolvedSource"
}

if (-not (Test-Path -LiteralPath (Join-Path $resolvedSource "baolu-os-v2-source\package.json"))) {
  throw "Backup refused: source is not the approved workspace root. Actual: $resolvedSource"
}

if ([System.IO.Path]::GetPathRoot($resolvedBackup) -ne "D:\" -or $resolvedBackup -eq "D:") {
  throw "Backup refused: destination must be a specific directory on drive D. Actual: $resolvedBackup"
}

New-Item -ItemType Directory -Path $resolvedBackup -Force | Out-Null

& robocopy $resolvedSource $resolvedBackup /E /XJ /R:2 /W:1 /COPY:DAT /DCOPY:DAT /XD node_modules /NFL /NDL /NJH /NJS /NP
$robocopyCode = $LASTEXITCODE

if ($robocopyCode -gt 7) {
  throw "Local backup failed. Robocopy exit code: $robocopyCode"
}

Write-Host "Local backup complete: $resolvedSource -> $resolvedBackup (Robocopy exit code: $robocopyCode)"
exit 0
