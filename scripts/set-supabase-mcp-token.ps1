$ErrorActionPreference = "Stop"

Write-Host "Create a project-scoped token at https://supabase.com/dashboard/account/tokens"
$secureToken = Read-Host "Paste the token (input is hidden)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
try {
  $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($plainToken)) { throw "Token cannot be empty." }
  [Environment]::SetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", $plainToken, "User")
  Write-Host "SUPABASE_ACCESS_TOKEN saved to your Windows user environment. Restart Codex, then run: codex mcp list"
} finally {
  if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  Remove-Variable plainToken -ErrorAction SilentlyContinue
}
