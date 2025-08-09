# Test script for Bias News API (Node.js version)
Write-Host "🧪 Testing Bias News API..." -ForegroundColor Green

# Test health endpoint
Write-Host "`n📊 Testing health endpoint..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3001/api/health" -Method Get
    Write-Host "✅ Health check passed:" -ForegroundColor Green
    $health | ConvertTo-Json -Depth 2
} catch {
    Write-Host "❌ Health check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Test article fetch
Write-Host "`n📰 Fetching articles about AI regulation..." -ForegroundColor Yellow
try {
    $body = @{
        topic = "AI regulation 2025"
        sources = @("reuters.com", "theguardian.com")
    } | ConvertTo-Json

    $articles = Invoke-RestMethod -Uri "http://localhost:3001/api/articles/fetch" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body
    
    Write-Host "✅ Fetched articles: $($articles.articles.Count)" -ForegroundColor Green
    Write-Host "Topic: $($articles.topic)" -ForegroundColor Cyan
    Write-Host "Timestamp: $($articles.timestamp)" -ForegroundColor Cyan
    
    # Show first article details
    if ($articles.articles.Count -gt 0) {
        $firstArticle = $articles.articles[0]
        Write-Host "`n📄 First article:" -ForegroundColor Yellow
        Write-Host "  Headline: $($firstArticle.headline)" -ForegroundColor White
        Write-Host "  Source: $($firstArticle.source)" -ForegroundColor White
        Write-Host "  Has bias scores: $($firstArticle.biasScores -ne $null)" -ForegroundColor White
    }
} catch {
    Write-Host "❌ Article fetch failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response: $responseBody" -ForegroundColor Red
    }
}

# Test articles list
Write-Host "`n📋 Testing articles list endpoint..." -ForegroundColor Yellow
try {
    $articlesList = Invoke-RestMethod -Uri "http://localhost:3001/api/articles?limit=5" -Method Get
    Write-Host "✅ Articles list: $($articlesList.articles.Count) articles" -ForegroundColor Green
} catch {
    Write-Host "❌ Articles list failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test narratives endpoint
Write-Host "`n🔍 Testing narratives endpoint..." -ForegroundColor Yellow
try {
    $narratives = Invoke-RestMethod -Uri "http://localhost:3001/api/narratives" -Method Get
    Write-Host "✅ Narratives: $($narratives.clusters.Count) clusters" -ForegroundColor Green
    Write-Host "Total articles: $($narratives.totalArticles)" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Narratives failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n🎉 Testing completed!" -ForegroundColor Green
