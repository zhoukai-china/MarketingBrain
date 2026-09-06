param(
  [Parameter(Mandatory = $true)][string]$ManifestPath,
  [Parameter(Mandatory = $true)][string]$DesktopRoot,
  [Parameter(Mandatory = $true)][string]$ArchiveRoot
)

$ErrorActionPreference = 'Stop'
$desktop = (Resolve-Path -LiteralPath $DesktopRoot).Path
$archive = [System.IO.Path]::GetFullPath($ArchiveRoot)
$manifest = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json

function Assert-ChildPath([string]$Parent, [string]$Child) {
  $normalizedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $normalizedChild = [System.IO.Path]::GetFullPath($Child)
  if (-not $normalizedChild.StartsWith($normalizedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes approved root: $normalizedChild"
  }
}

New-Item -ItemType Directory -Force -Path $archive | Out-Null
foreach ($skill in $manifest.skills) {
  $source = [System.IO.Path]::GetFullPath($skill.sourcePath)
  $target = [System.IO.Path]::GetFullPath($skill.recoveryPath)
  Assert-ChildPath $desktop $source
  Assert-ChildPath $archive $target
  if (-not (Test-Path -LiteralPath $source -PathType Container)) { throw "Missing Desktop source: $($skill.id)" }
  if (Test-Path -LiteralPath $target) { throw "Archive target already exists: $($skill.id)" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Move-Item -LiteralPath $source -Destination $target
  $actual = (Get-FileHash -LiteralPath (Join-Path $target 'SKILL.md') -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $skill.skillMdSha256) { throw "Post-move hash mismatch: $($skill.id)" }
  [PSCustomObject]@{ id = $skill.id; archivedPath = $target; sha256 = $actual }
}
