#!/bin/sh
# Production startup script
# Runs database migrations before starting the server

echo "Running database migrations..."
npx prisma db push --accept-data-loss

echo "Starting Next.js server..."
npm start
