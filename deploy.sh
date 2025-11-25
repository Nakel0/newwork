#!/bin/bash

# CloudMigrate Pro - Deployment Helper Script
# This script helps you push your code to GitHub and deploy

echo "🚀 CloudMigrate Pro - Deployment Helper"
echo "========================================"
echo ""

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git not initialized. Run: git init"
    exit 1
fi

# Check if remote is set
if ! git remote | grep -q origin; then
    echo "📝 No GitHub remote set yet."
    echo ""
    echo "To set up GitHub:"
    echo "1. Go to https://github.com and create a new repository"
    echo "2. Then run:"
    echo "   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git"
    echo "   git branch -M main"
    echo "   git push -u origin main"
    echo ""
    read -p "Press Enter to continue or Ctrl+C to exit..."
    exit 0
fi

# Show current status
echo "📊 Current Git Status:"
git status --short
echo ""

# Ask if user wants to commit changes
read -p "Do you want to commit and push changes? (y/n) " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Add all changes
    git add .
    
    # Commit
    read -p "Enter commit message (or press Enter for default): " commit_msg
    if [ -z "$commit_msg" ]; then
        commit_msg="Update CloudMigrate Pro SaaS"
    fi
    
    git commit -m "$commit_msg"
    
    # Push
    echo ""
    echo "📤 Pushing to GitHub..."
    git push
    
    echo ""
    echo "✅ Code pushed to GitHub!"
    echo ""
    echo "🌐 Next steps to deploy:"
    echo "1. Go to https://app.netlify.com/drop"
    echo "2. Drag your project folder"
    echo "3. Or connect GitHub for auto-deployment"
    echo ""
else
    echo "Skipped commit. Your code is ready to deploy manually."
fi

