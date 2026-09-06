param(
  [string]$OutputPath = (Join-Path $PSScriptRoot "fixtures\beauty-video-content-av.mp4")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$fixtureRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "fixtures")).TrimEnd("\") + "\"
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)
if (-not $resolvedOutput.StartsWith($fixtureRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Fixture output must stay inside scripts/fixtures."
}

$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("beauty-video-content-av-" + [guid]::NewGuid().ToString("N"))
$speechPath = Join-Path $tempRoot "synthetic-speech.wav"
$transcript = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("6L+Z5piv576O5Lia6KeG6aKR5YaF5a655aSN55uY5rWL6K+V5qC35pys77yM5LiN5YyF5ZCr55yf5a6e5a6i5oi35L+h5oGv44CC"))
$visualDescription = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String("5rWF57u/6Imy56uW5bGP6IOM5pmv77yb5LiK5Y2K6YOo5rex57u/6Imy55+p5b2i77yb5LiL5Y2K6YOo6YeR6Imy55+p5b2i77yb5peg5Lq654mp44CB5peg5paH5a2X"))

New-Item -ItemType Directory -Path $tempRoot | Out-Null
try {
  Add-Type -AssemblyName System.Speech
  $synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  try {
    $synthesizer.SelectVoice("Microsoft Huihui Desktop")
    $synthesizer.Rate = -1
    $synthesizer.Volume = 100
    $synthesizer.SetOutputToWaveFile($speechPath)
    $synthesizer.Speak($transcript)
  }
  finally {
    $synthesizer.Dispose()
  }

  & $ffmpeg -y -loglevel error `
    -f lavfi -i "color=c=0xEAF2EF:s=360x640:r=12:d=8" `
    -i $speechPath `
    -vf "drawbox=x=70:y=110:w=220:h=150:color=0x1F5A4A:t=fill,drawbox=x=100:y=390:w=160:h=110:color=0xD7A84B:t=fill" `
    -af "apad=pad_dur=8" `
    -t 8 `
    -map_metadata -1 `
    -c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -r 12 `
    -c:a aac -b:a 64k -ar 22050 -ac 1 `
    -movflags +faststart `
    $resolvedOutput
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg fixture generation failed with exit code $LASTEXITCODE" }

  $hash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash.ToLowerInvariant()
  [pscustomobject]@{
    asset = $resolvedOutput
    generator = "Windows System.Speech / Microsoft Huihui Desktop + local ffmpeg"
    transcript = $transcript
    visual = $visualDescription
    sha256 = $hash
  } | ConvertTo-Json -Depth 3
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
