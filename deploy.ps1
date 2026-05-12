# ── Config ────────────────────────────────────────────────────────────────────
$PROJECT  = "cloud-project-486410"
$REGION   = "europe-west1"
$SERVICE  = "zubro-food-cost"
$REPO     = "zubro"
$IMAGE    = "$REGION-docker.pkg.dev/$PROJECT/$REPO/app:latest"
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "==> [1/3] Building and pushing image..."
gcloud builds submit --tag $IMAGE --project $PROJECT
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "==> [2/3] Deploying to Cloud Run..."
gcloud run deploy $SERVICE `
  --image $IMAGE `
  --region $REGION `
  --platform managed `
  --port 8000 `
  --memory 512Mi `
  --cpu 1 `
  --min-instances 1 `
  --max-instances 2 `
  --set-env-vars "ENV=production" `
  --set-secrets "DATABASE_URL=DATABASE_URL:latest,GOOGLE_API_KEY=GOOGLE_API_KEY:latest" `
  --allow-unauthenticated `
  --project $PROJECT
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "==> [3/3] Deployed successfully. Service URL:"
gcloud run services describe $SERVICE `
  --region $REGION `
  --project $PROJECT `
  --format "value(status.url)"
