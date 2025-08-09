# Test sequence
Write-Host "1. Testing health endpoint..."
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get
    Write-Host "Health check successful:" -ForegroundColor Green
    $health | ConvertTo-Json
} catch {
    Write-Host "Health check failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host "`n2. Fetching articles about AI..."
$body = @{
    topic = "artificial intelligence"
    sources = @("reuters.com")
} | ConvertTo-Json

try {
    Write-Host "Making request with body:" -ForegroundColor Yellow
    Write-Host $body

    $articles = Invoke-RestMethod -Uri "http://localhost:3001/api/articles/fetch" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body
    
    Write-Host "Successfully fetched articles:" -ForegroundColor Green
    Write-Host "Total articles: $($articles.articles.Count)"
    
    if ($articles.articles.Count -gt 0) {
        Write-Host "`nFirst article preview:" -ForegroundColor Yellow
        $firstArticle = $articles.articles[0]
        @{
            headline = $firstArticle.headline
            source = $firstArticle.source
            publishedAt = $firstArticle.publishedAt
        } | ConvertTo-Json
    }
} catch {
    Write-Host "Error fetching articles:" -ForegroundColor Red
    Write-Host "Status code: $($_.Exception.Response.StatusCode)"
    try {
        $rawResponse = $_.ErrorDetails.Message
        if ($rawResponse) {
            $errorDetails = $rawResponse | ConvertFrom-Json
            Write-Host "Error details:" -ForegroundColor Red
            $errorDetails | ConvertTo-Json
        }
    } catch {
        Write-Host $_.Exception.Message
    }
}

Write-Host "`n3. Checking existing articles..."
try {
    $allArticles = Invoke-RestMethod -Uri "http://localhost:3001/api/articles" -Method Get
    Write-Host "Successfully retrieved articles:" -ForegroundColor Green
    Write-Host "Total stored articles: $($allArticles.total)"
} catch {
    Write-Host "Error retrieving articles:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}

Write-Host "`n4. Checking narrative clusters..."
try {
    $narratives = Invoke-RestMethod -Uri "http://localhost:3001/api/narratives" -Method Get
    Write-Host "Successfully retrieved narratives:" -ForegroundColor Green
    Write-Host "Total clusters: $($narratives.clusters.Count)"
    
    if ($narratives.clusters.Count -gt 0) {
        Write-Host "`nFirst cluster preview:" -ForegroundColor Yellow
        $narratives.clusters[0] | ConvertTo-Json -Depth 2
    }
} catch {
    Write-Host "Error retrieving narratives:" -ForegroundColor Red
    Write-Host $_.Exception.Message
}
