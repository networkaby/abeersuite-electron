

#!/bin/bash

# Check if this is the webhook-only project (shop.networkservice.in)
if [[ "$NEXTAUTH_URL" == "https://shop.networkservice.in" ]]; then
  # This is the webhook-only project
  if [[ -z "$VERCEL_GIT_COMMIT_MESSAGE" ]] || [[ "$VERCEL_GIT_COMMIT_MESSAGE" == "" ]]; then
    echo "✅ Webhook deployment detected - proceeding with build"
    exit 1  # Proceed with build
  else
    echo "🛑 Git commit detected - skipping build"
    exit 0  # Skip build
  fi
else
  # This is the auto-deploy project - always build
  echo "✅ Auto-deploy project - proceeding with build"
  exit 1
fi