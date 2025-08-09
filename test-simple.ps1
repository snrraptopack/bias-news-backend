# Test health endpoint first
Write-Host "1. Testing health endpoint..."
$health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get
$health | ConvertTo-Json

# Test a simple article fetch
Write-Host "`n2. Fetching a single article about technology..."
$body = @{
    topic = "artificial intelligence"
    sources = @("reuters.com")
} | ConvertTo-Json

try {
    $articles = Invoke-RestMethod -Uri "http://localhost:3001/api/articles/fetch" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body
    Write-Host "Success! Retrieved $($articles.articles.Count) articles"
    $articles.articles[0] | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Error details:"
    Write-Host $_.Exception.Response.StatusCode
    $errorDetails = $_.ErrorDetails.Message
    if ($errorDetails) {
        Write-Host $errorDetails
    }
    Write-Host $_.Exception.Message
}
