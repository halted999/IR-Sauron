# =============================================================================
# IR-Sauron — Скрипт подготовки системы
# ЗАПУСКАТЬ ОТ ИМЕНИ АДМИНИСТРАТОРА (ПКМ → "Запуск от имени администратора")
# =============================================================================
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"

Write-Host "=== IR-Sauron: подготовка системы ===" -ForegroundColor Cyan

# 1. Включаем WSL2 и Virtual Machine Platform
Write-Host "`n[1/4] Включение компонентов Windows..." -ForegroundColor Yellow
dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart

# 2. Обновляем ядро WSL2
Write-Host "`n[2/4] Установка ядра WSL2..." -ForegroundColor Yellow
$wslKernel = "$env:TEMP\wsl_update.msi"
(New-Object System.Net.WebClient).DownloadFile(
    "https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi",
    $wslKernel
)
Start-Process msiexec.exe -ArgumentList "/i $wslKernel /quiet /norestart" -Wait
wsl --set-default-version 2

# 3. Устанавливаем Docker Desktop (тихий режим)
Write-Host "`n[3/4] Установка Docker Desktop..." -ForegroundColor Yellow
$installer = "$env:USERPROFILE\Downloads\DockerDesktopInstaller.exe"
if (-not (Test-Path $installer)) {
    Write-Host "Установщик не найден: $installer" -ForegroundColor Red
    Write-Host "Скачайте с: https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
    exit 1
}

Start-Process $installer -ArgumentList "install --quiet --accept-license --backend=wsl-2" -Wait
Write-Host "Docker Desktop установлен." -ForegroundColor Green

# 4. Добавляем текущего пользователя в группу docker-users
Write-Host "`n[4/4] Настройка прав пользователя..." -ForegroundColor Yellow
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name.Split("\")[1]
Add-LocalGroupMember -Group "docker-users" -Member $currentUser -ErrorAction SilentlyContinue
Write-Host "Пользователь $currentUser добавлен в группу docker-users." -ForegroundColor Green

Write-Host "`n=== ГОТОВО ===" -ForegroundColor Green
Write-Host "Необходима ПЕРЕЗАГРУЗКА компьютера." -ForegroundColor Red
Write-Host "После перезагрузки откройте Docker Desktop и запустите:" -ForegroundColor White
Write-Host "  cd $env:USERPROFILE\ir-sauron" -ForegroundColor Cyan
Write-Host "  .\deploy.ps1" -ForegroundColor Cyan

$restart = Read-Host "`nПерезагрузить сейчас? (y/n)"
if ($restart -eq "y") { Restart-Computer -Force }
