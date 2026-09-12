# 临时助手：把 .docx 的正文抽成纯文本，便于只读核对 WorkBuddy 报告。用完删除，不提交、不入发布包。
param([Parameter(Mandatory=$true)][string]$Docx, [Parameter(Mandatory=$true)][string]$Out)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Docx).Path)
try {
  $entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" } | Select-Object -First 1
  if (-not $entry) { throw "word/document.xml not found in $Docx" }
  $reader = New-Object System.IO.StreamReader($entry.Open(), [System.Text.Encoding]::UTF8)
  try { $xml = $reader.ReadToEnd() } finally { $reader.Dispose() }
  $text = $xml -replace "</w:p>", "`n"
  $text = $text -replace "</w:tr>", "`n"
  $text = $text -replace "<[^>]+>", ""
  $text = [System.Net.WebUtility]::HtmlDecode($text)
  $text = ($text -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }) -join "`n"
  [IO.File]::WriteAllText($Out, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output ("dumped {0} lines -> {1}" -f (($text -split "`n").Count), $Out)
} finally {
  $zip.Dispose()
}
