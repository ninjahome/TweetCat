param(
    [string]$Root = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

$manifestPath = Join-Path $Root 'native-messaging-manifest.json'
$installRoot = Split-Path -Parent $Root
$hostExe = Join-Path $installRoot 'src/TweetCat.NativeMessagingHost/bin/Release/net8.0-windows/TweetCat.NativeMessagingHost.exe'

if (-not (Test-Path $manifestPath)) {
    Write-Error "Manifest not found: $manifestPath"
    exit 1
}

if (-not (Test-Path $hostExe)) {
    Write-Warning "Host executable not found. Build TweetCat.NativeMessagingHost in Release mode first."
}

$chromeKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.tweetcat.host'
$edgeKey = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.tweetcat.host'

Write-Host "Registering manifest for Chrome..."
New-Item -Path $chromeKey -Force | Out-Null
Set-ItemProperty -Path $chromeKey -Name '(Default)' -Value $manifestPath

Write-Host "Registering manifest for Edge..."
New-Item -Path $edgeKey -Force | Out-Null
Set-ItemProperty -Path $edgeKey -Name '(Default)' -Value $manifestPath

Write-Host "Registration complete."
