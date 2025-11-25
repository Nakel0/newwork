#!/bin/bash

# Local Testing Server Script
# This script helps you test your app locally

echo "🧪 CloudMigrate Pro - Local Testing Server"
echo "==========================================="
echo ""

# Check if Python is available
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
    SERVER_CMD="python3 -m http.server"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
    SERVER_CMD="python -m SimpleHTTPServer"
else
    echo "❌ Python not found. Please install Python or use another method."
    echo ""
    echo "Alternative: Just open landing.html in your browser!"
    exit 1
fi

echo "✅ Python found: $PYTHON_CMD"
echo ""
echo "Starting local server on port 8000..."
echo ""
echo "📱 Your app will be available at:"
echo "   http://localhost:8000/landing.html"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start server
cd "$(dirname "$0")"
$SERVER_CMD 8000

