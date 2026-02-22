#!/bin/sh
# Production startup script
# Runs unit tests, database migrations, then starts the server

echo "Running unit tests..."
npm test
if [ $? -ne 0 ]; then
  echo "ERROR: Unit tests failed. Aborting startup."
  exit 1
fi

echo "Running database migrations..."
npx prisma db push --accept-data-loss

echo "Starting Next.js server..."
npm start
