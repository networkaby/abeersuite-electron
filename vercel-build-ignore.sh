#!/bin/bash

# Check if NEXTAUTH_URL is https://shop.networkservice.in
if [[ "$NEXTAUTH_URL" == "https://shop.networkservice.in" ]]; then
  echo "🛑 shop.networkservice.in detected - webhook only (skipping automatic Git builds)"
  exit 0  # Skip automatic builds
else
  echo "✅ Other URL detected - proceeding with automatic builds"
  exit 1  # Proceed with automatic builds
fi