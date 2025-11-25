# 🧪 How to Test Your App Locally

## Method 1: Direct Browser Opening (Simplest)

### Step 1: Open Landing Page
1. Navigate to your project folder: `/Users/okuleyeolalekan/JOB-APP-TRIAL`
2. Double-click `landing.html` OR
3. Right-click → Open With → Your Browser (Chrome, Firefox, Safari, etc.)

### Step 2: Test the App
1. Click "Get Started" or "Sign Up" on the landing page
2. Fill in the signup form:
   - Name: Test User
   - Email: test@example.com
   - Password: test1234
   - Company: Test Company
   - Select a plan (Free, Pro, or Enterprise)
3. Click "Create Account"
4. You'll be redirected to `index.html` (the main app)

### Step 3: Test Features
- ✅ Try adding servers in Assessment
- ✅ Create a migration plan
- ✅ Check cost analysis
- ✅ Generate reports
- ✅ Test subscription limits (try adding more than 5 servers on Free plan)
- ✅ Test upgrade flow

## Method 2: Using Local Server (Recommended)

### Option A: Python Simple Server (Built-in)

```bash
# Navigate to your project
cd /Users/okuleyeolalekan/JOB-APP-TRIAL

# Python 3
python3 -m http.server 8000

# Or Python 2
python -m SimpleHTTPServer 8000
```

Then open: http://localhost:8000/landing.html

### Option B: Node.js http-server

```bash
# Install globally (one time)
npm install -g http-server

# Run server
cd /Users/okuleyeolalekan/JOB-APP-TRIAL
http-server -p 8000
```

Then open: http://localhost:8000/landing.html

### Option C: VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click on `landing.html`
3. Select "Open with Live Server"
4. Browser opens automatically

## 🧪 Testing Checklist

### Landing Page (`landing.html`)
- [ ] Page loads correctly
- [ ] All buttons work
- [ ] Sign up modal opens
- [ ] Login modal opens
- [ ] Can create account
- [ ] Redirects to app after signup

### Main App (`index.html`)
- [ ] Dashboard loads
- [ ] Navigation works
- [ ] Can add servers (test limit: Free = 5 max)
- [ ] Assessment calculates correctly
- [ ] Migration planning works
- [ ] Cost analysis calculates
- [ ] Reports generate
- [ ] Subscription badge shows current plan
- [ ] User menu works
- [ ] Account settings work
- [ ] Billing page shows usage

### Feature Gating Tests
- [ ] Free plan: Can't add more than 5 servers
- [ ] Free plan: Can't create more than 1 migration plan
- [ ] Free plan: Can't generate more than 1 report/month
- [ ] Free plan: PDF export is locked
- [ ] Upgrade prompts appear when limits reached

### Browser Compatibility
Test in:
- [ ] Chrome/Edge
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browser (responsive design)

## 🐛 Common Issues & Fixes

### Issue: "Page not found" or blank page
**Fix**: Make sure you're opening `landing.html` first, or configure redirects

### Issue: Styles not loading
**Fix**: Check browser console (F12) for errors. Make sure CSS files are in same folder

### Issue: Icons not showing
**Fix**: Check internet connection (Font Awesome loads from CDN)

### Issue: localStorage not working
**Fix**: 
- Make sure you're not in incognito/private mode
- Check browser settings allow localStorage
- Try different browser

### Issue: Signup doesn't redirect
**Fix**: Check browser console for JavaScript errors

## 🔍 Debugging Tips

### Open Browser Console
- **Chrome/Edge**: Press `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
- **Firefox**: Press `F12` or `Ctrl+Shift+K`
- **Safari**: Enable Developer menu first, then `Cmd+Option+I`

### Check for Errors
1. Open Console tab
2. Look for red error messages
3. Check Network tab for failed file loads

### Test localStorage
In browser console, type:
```javascript
localStorage.getItem('user')
localStorage.getItem('subscription')
```

## 📱 Mobile Testing

### Option 1: Browser DevTools
1. Open browser DevTools (F12)
2. Click device toggle icon (or `Ctrl+Shift+M`)
3. Select device (iPhone, iPad, etc.)
4. Refresh page

### Option 2: Actual Mobile Device
1. Find your computer's IP address:
   ```bash
   # Mac/Linux
   ifconfig | grep "inet "
   
   # Or use
   ipconfig getifaddr en0
   ```
2. Make sure phone is on same WiFi
3. Open: `http://YOUR_IP:8000/landing.html` on phone

## 🚀 Quick Test Script

Save this as `test.html` in your project:

```html
<!DOCTYPE html>
<html>
<head>
    <title>Quick Test</title>
</head>
<body>
    <h1>Quick Links</h1>
    <ul>
        <li><a href="landing.html">Landing Page</a></li>
        <li><a href="index.html">Main App</a></li>
    </ul>
</body>
</html>
```

## ✅ Pre-Deployment Testing

Before deploying, make sure:
- [ ] All features work locally
- [ ] No console errors
- [ ] Responsive design works
- [ ] All links work
- [ ] Forms submit correctly
- [ ] Data persists (localStorage)
- [ ] Subscription limits enforced
- [ ] Upgrade flow works

---

**Ready to test! Start with Method 1 (simplest) or Method 2 (more realistic).**

