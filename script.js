// Application State
const appState = {
    assessment: {
        physicalServers: 0,
        virtualMachines: 0,
        totalStorage: 0,
        avgCpuCores: 4,
        avgRam: 16,
        numDatabases: 0,
        databaseTypes: [],
        numApplications: 0,
        applicationTypes: [],
        monthlyBandwidth: 0,
        securityRequirements: [],
        currentCost: 0
    },
    planning: {
        cloudProvider: '',
        migrationStrategy: '',
        migrationPriority: 'medium',
        startDate: '',
        endDate: '',
        teamSize: 5
    },
    cost: {
        currentTotal: 0,
        cloudTotal: 0
    },
    user: null,
    subscription: {
        plan: 'free',
        status: 'active',
        startDate: null,
        trialEnds: null
    },
    usage: {
        servers: 0,
        plans: 0,
        reportsThisMonth: 0,
        lastReportDate: null
    },
    checklist: {
        tasks: [],
        currentFilter: 'all'
    }
};

// -------------------------
// API helper (cookie-based session)
// -------------------------
async function api(path, options = {}) {
    const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
        const err = (json && json.error) ? json.error : `http_${res.status}`;
        throw new Error(err);
    }
    return json;
}

function parseHashRoute() {
    // Supports "#billing?success=1" style hashes.
    const raw = window.location.hash || '';
    const h = raw.startsWith('#') ? raw.slice(1) : raw;
    const [route, queryString] = h.split('?');
    const params = new URLSearchParams(queryString || '');
    return { route: route || '', params };
}

function applyMeToAppState(me, { loadAppState = false } = {}) {
    appState.user = {
        ...me.user,
        // keep legacy field name used by UI
        company: me.user.companyName
    };
    appState.subscription = {
        plan: me.subscription?.plan || 'free',
        status: me.subscription?.status || 'active',
        trialEnds: me.subscription?.trialEndsAt || null
    };
    appState.usage = {
        ...appState.usage,
        servers: me.usage?.servers || 0,
        plans: me.usage?.plans || 0,
        reportsThisMonth: me.usage?.reportsThisMonth || 0,
        lastReportDate: me.usage?.lastReportAt || null
    };

    if (loadAppState && me.appState && typeof me.appState === 'object') {
        if (me.appState.assessment) appState.assessment = { ...appState.assessment, ...me.appState.assessment };
        if (me.appState.planning) appState.planning = { ...appState.planning, ...me.appState.planning };
        if (me.appState.cost) appState.cost = { ...appState.cost, ...me.appState.cost };
        if (me.appState.checklist) appState.checklist = { ...appState.checklist, ...me.appState.checklist };
    }
}

async function refreshMe({ loadAppState = false } = {}) {
    const me = await api('/api/me');
    applyMeToAppState(me, { loadAppState });
    updateSubscriptionUI();
    updateDashboard();
    updateUsageUI();
    return me;
}

// Subscription Plans Configuration
const subscriptionPlans = {
    free: {
        name: 'Free',
        price: 0,
        limits: {
            maxServers: 5,
            maxPlans: 1,
            maxReportsPerMonth: 1,
            pdfExport: false,
            excelExport: false,
            apiAccess: false,
            prioritySupport: false
        }
    },
    starter: {
        name: 'Starter',
        price: 29,
        limits: {
            maxServers: 20,
            maxPlans: 3,
            maxReportsPerMonth: 5,
            pdfExport: false,
            excelExport: false,
            apiAccess: false,
            prioritySupport: false
        }
    },
    pro: {
        name: 'Pro',
        price: 49,
        limits: {
            maxServers: 100,
            maxPlans: -1, // unlimited
            maxReportsPerMonth: -1, // unlimited
            pdfExport: true,
            excelExport: false,
            apiAccess: false,
            prioritySupport: false
        }
    },
    enterprise: {
        name: 'Enterprise',
        price: 199,
        limits: {
            maxServers: -1, // unlimited
            maxPlans: -1, // unlimited
            maxReportsPerMonth: -1, // unlimited
            pdfExport: true,
            excelExport: true,
            apiAccess: true,
            prioritySupport: true
        }
    }
};

// Check if user is authenticated (localStorage-based for frontend-only app)
function checkAuth() {
    try {
        const userStr = localStorage.getItem('user');
        const subscriptionStr = localStorage.getItem('subscription');
        
        // Check if data exists
        if (!userStr || !subscriptionStr) {
            // Redirect to landing page if not authenticated
            if (!window.location.href.includes('landing.html')) {
                window.location.href = 'landing.html';
            }
            return false;
        }
        
        // Parse the data
        let user, subscription;
        try {
            user = JSON.parse(userStr);
            subscription = JSON.parse(subscriptionStr);
        } catch (parseError) {
            console.error('Error parsing localStorage data:', parseError);
            // Clear corrupted data
            localStorage.removeItem('user');
            localStorage.removeItem('subscription');
            if (!window.location.href.includes('landing.html')) {
                window.location.href = 'landing.html';
            }
            return false;
        }
        
        // Validate that we have required fields
        if (!user || !user.email || !subscription || !subscription.plan) {
            if (!window.location.href.includes('landing.html')) {
                window.location.href = 'landing.html';
            }
            return false;
        }
        
        // Load user data into app state
        appState.user = user;
        appState.subscription = subscription;
        
        // Load app state from localStorage if available
        loadProgress();
        
        return true;
    } catch (error) {
        console.error('Auth check error:', error);
        if (!window.location.href.includes('landing.html')) {
            window.location.href = 'landing.html';
        }
        return false;
    }
}

// Get current subscription plan
function getCurrentPlan() {
    return subscriptionPlans[appState.subscription.plan] || subscriptionPlans.free;
}

// Check if feature is available
function hasFeature(feature) {
    const plan = getCurrentPlan();
    return plan.limits[feature] === true || plan.limits[feature] === -1;
}

// Check usage limits
function checkUsageLimit(limitType, usageKey = limitType) {
    const plan = getCurrentPlan();
    const limit = plan.limits[limitType];
    
    if (limit === -1) return true; // unlimited
    
    const currentUsage = appState.usage[usageKey] || 0;
    return currentUsage < limit;
}

// Show feature lock
function showFeatureLock(message) {
    const lock = document.getElementById('featureLock');
    const lockMessage = document.getElementById('lockMessage');
    lockMessage.textContent = message || 'This feature is not available in your current plan.';
    lock.style.display = 'flex';
}

// Hide feature lock
function hideFeatureLock() {
    document.getElementById('featureLock').style.display = 'none';
}

// Update subscription UI
function updateSubscriptionUI() {
    const plan = getCurrentPlan();
    document.getElementById('subscriptionPlan').textContent = plan.name;
    document.getElementById('currentPlanName').textContent = `${plan.name} Plan`;
    document.getElementById('currentPlanPrice').textContent = `$${plan.price}/month`;

    if (document.getElementById('currentPlanStatus')) {
        const statusRaw = (appState.subscription?.status || 'active');
        const status = statusRaw.replaceAll('_', ' ');
        document.getElementById('currentPlanStatus').textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
    
    // Update usage displays
    updateUsageUI();
}

// Update usage UI
function updateUsageUI() {
    const plan = getCurrentPlan();
    
    // Server usage
    const maxServers = plan.limits.maxServers === -1 ? appState.usage.servers : plan.limits.maxServers;
    const serverPercent = maxServers > 0 ? (appState.usage.servers / maxServers) * 100 : 0;
    document.getElementById('serverUsage').style.width = `${Math.min(serverPercent, 100)}%`;
    document.getElementById('serverUsageText').textContent = 
        `${appState.usage.servers} / ${maxServers === -1 ? '∞' : maxServers}`;
    
    // Plan usage
    const maxPlans = plan.limits.maxPlans === -1 ? appState.usage.plans : plan.limits.maxPlans;
    const planPercent = maxPlans > 0 ? (appState.usage.plans / maxPlans) * 100 : 0;
    document.getElementById('planUsage').style.width = `${Math.min(planPercent, 100)}%`;
    document.getElementById('planUsageText').textContent = 
        `${appState.usage.plans} / ${maxPlans === -1 ? '∞' : maxPlans}`;
    
    // Report usage
    const maxReports = plan.limits.maxReportsPerMonth === -1 ? appState.usage.reportsThisMonth : plan.limits.maxReportsPerMonth;
    const reportPercent = maxReports > 0 ? (appState.usage.reportsThisMonth / maxReports) * 100 : 0;
    document.getElementById('reportUsage').style.width = `${Math.min(reportPercent, 100)}%`;
    document.getElementById('reportUsageText').textContent = 
        `${appState.usage.reportsThisMonth} / ${maxReports === -1 ? '∞' : maxReports}`;
}

// Upgrade plan (frontend-only - in production, this would integrate with Stripe)
function upgradePlan(planName) {
    // Update subscription in localStorage
    appState.subscription.plan = planName;
    appState.subscription.status = 'active';
    localStorage.setItem('subscription', JSON.stringify(appState.subscription));
    
    // Update UI
    updateSubscriptionUI();
    updateUsageUI();
    
    showToast(`Upgraded to ${subscriptionPlans[planName].name} plan!`, 'success');
    closeUpgradeModal();
    
    // In production, this would redirect to Stripe Checkout:
    // window.location.href = `/checkout?plan=${planName}`;
}

function openBillingPortal() {
    showToast('Billing portal requires Stripe integration. For demo, manage your plan in the Billing section.', 'info');
    showSection('billing');
}

async function handlePostCheckoutReturn() {
    const { route, params } = parseHashRoute();
    if (route !== 'billing') return;

    if (params.get('canceled') === '1') {
        showSection('billing');
        showToast('Checkout canceled.', 'error');
        return;
    }

    if (params.get('success') !== '1') return;

    showSection('billing');
    showToast('Payment received — syncing your subscription…');

    const startedAt = Date.now();
    const maxMs = 30000;
    const initialPlan = appState.subscription?.plan || 'free';

    // Poll until webhook updates DB
    while (Date.now() - startedAt < maxMs) {
        try {
            await refreshMe({ loadAppState: false });
            const currentPlan = appState.subscription?.plan || 'free';
            if (currentPlan !== initialPlan) break;
        } catch {
            // ignore transient errors during deploy/restart
        }
        await new Promise((r) => setTimeout(r, 1000));
    }

    // Clean up hash query so refresh doesn't re-run forever
    if (window.location.hash.includes('?')) {
        window.location.hash = '#billing';
    }
}

// Show upgrade modal
function showUpgradeModal() {
    const modal = document.getElementById('upgradeModal');
    const currentPlan = appState.subscription.plan;
    
    let content = '<div class="upgrade-options">';
    let defaultPlan = 'starter';
    
    if (currentPlan === 'free') {
        content += `
            <div class="upgrade-option">
                <h3>Starter Plan - $29/month</h3>
                <ul>
                    <li>Up to 20 servers</li>
                    <li>3 migration plans</li>
                    <li>5 reports per month</li>
                    <li>Migration checklist</li>
                </ul>
            </div>
            <div class="upgrade-option">
                <h3>Pro Plan - $49/month</h3>
                <ul>
                    <li>Up to 100 servers</li>
                    <li>Unlimited migration plans</li>
                    <li>Unlimited reports</li>
                    <li>PDF export</li>
                    <li>Migration checklist</li>
                </ul>
            </div>
            <div class="upgrade-option">
                <h3>Enterprise Plan - $199/month</h3>
                <ul>
                    <li>Unlimited everything</li>
                    <li>PDF + Excel export</li>
                    <li>API access</li>
                    <li>Priority support</li>
                </ul>
            </div>
        `;
        defaultPlan = 'starter';
    } else if (currentPlan === 'starter') {
        content += `
            <div class="upgrade-option">
                <h3>Pro Plan - $49/month</h3>
                <ul>
                    <li>Up to 100 servers</li>
                    <li>Unlimited migration plans</li>
                    <li>Unlimited reports</li>
                    <li>PDF export</li>
                </ul>
            </div>
            <div class="upgrade-option">
                <h3>Enterprise Plan - $199/month</h3>
                <ul>
                    <li>Unlimited servers</li>
                    <li>Excel export</li>
                    <li>API access</li>
                    <li>Priority support</li>
                </ul>
            </div>
        `;
        defaultPlan = 'pro';
    } else if (currentPlan === 'pro') {
        content += `
            <div class="upgrade-option">
                <h3>Enterprise Plan - $199/month</h3>
                <ul>
                    <li>Unlimited servers</li>
                    <li>Excel export</li>
                    <li>API access</li>
                    <li>Priority support</li>
                    <li>Dedicated account manager</li>
                </ul>
            </div>
        `;
        defaultPlan = 'enterprise';
    }
    
    content += '</div>';
    document.getElementById('upgradeModalContent').innerHTML = content;
    document.getElementById('confirmUpgradeBtn').setAttribute('data-plan', defaultPlan);
    modal.style.display = 'block';
}

// Close upgrade modal
function closeUpgradeModal() {
    document.getElementById('upgradeModal').style.display = 'none';
}

// Process upgrade (in production, this would integrate with Stripe)
function processUpgrade() {
    const plan = document.getElementById('confirmUpgradeBtn').getAttribute('data-plan');
    
    // For demo: upgrade directly (in production, redirect to Stripe)
    if (confirm(`Upgrade to ${subscriptionPlans[plan].name} plan for $${subscriptionPlans[plan].price}/month?`)) {
        upgradePlan(plan);
    }
}

// Handle logout
function handleLogout() {
    if (confirm('Are you sure you want to sign out?')) {
        // Clear localStorage (frontend-only app)
        localStorage.removeItem('user');
        localStorage.removeItem('subscription');
        localStorage.removeItem('cloudMigrationData');
        localStorage.removeItem('usage');
        
        // Redirect to landing page
        window.location.href = 'landing.html';
    }
}

// User menu toggle
function toggleUserMenu() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('show');
}

// Close user menu when clicking outside
document.addEventListener('click', (e) => {
    const userMenu = document.getElementById('userMenuBtn');
    const dropdown = document.getElementById('userDropdown');
    
    if (userMenu && dropdown && !userMenu.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.remove('show');
    }
});

// Navigation
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(sectionId).classList.add('active');
    
    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-section') === sectionId) {
            link.classList.add('active');
        }
    });
    
    // Update dashboard if needed
    if (sectionId === 'dashboard') {
        updateDashboard();
    }
    
    // Initialize TCO calculator when section is shown
    if (sectionId === 'tco') {
        initializeTCO();
    }

    // Refresh billing/subscription when billing section is shown (helps after portal changes)
    if (sectionId === 'billing') {
        refreshMe({ loadAppState: false }).catch(() => {});
    }
    
    // Generate timeline if planning is complete
    if (sectionId === 'timeline' && appState.planning.migrationStrategy) {
        generateVisualTimeline();
    }
}

// Navigation event listeners
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.getAttribute('data-section');
        showSection(section);
    });
});

// Assessment Functions
function updateAssessment() {
    // Get form values
    const physicalServers = parseInt(document.getElementById('physicalServers').value) || 0;
    const virtualMachines = parseInt(document.getElementById('virtualMachines').value) || 0;
    const totalServers = physicalServers + virtualMachines;
    
    // Check server limit
    const plan = getCurrentPlan();
    if (plan.limits.maxServers !== -1 && totalServers > plan.limits.maxServers) {
        showFeatureLock(`Your ${plan.name} plan allows up to ${plan.limits.maxServers} servers. Please upgrade to add more.`);
        // Reset to max allowed
        if (physicalServers + virtualMachines > plan.limits.maxServers) {
            const maxPhysical = Math.min(physicalServers, plan.limits.maxServers);
            const maxVirtual = Math.min(virtualMachines, plan.limits.maxServers - maxPhysical);
            document.getElementById('physicalServers').value = maxPhysical;
            document.getElementById('virtualMachines').value = maxVirtual;
        }
        return;
    }
    
    appState.assessment.physicalServers = physicalServers;
    appState.assessment.virtualMachines = virtualMachines;
    appState.usage.servers = totalServers;
    appState.assessment.totalStorage = parseFloat(document.getElementById('totalStorage').value) || 0;
    appState.assessment.avgCpuCores = parseInt(document.getElementById('avgCpuCores').value) || 4;
    appState.assessment.avgRam = parseInt(document.getElementById('avgRam').value) || 16;
    appState.assessment.numDatabases = parseInt(document.getElementById('numDatabases').value) || 0;
    appState.assessment.numApplications = parseInt(document.getElementById('numApplications').value) || 0;
    appState.assessment.monthlyBandwidth = parseInt(document.getElementById('monthlyBandwidth').value) || 0;
    appState.assessment.currentCost = parseFloat(document.getElementById('currentCost').value) || 0;
    
    // Get checkboxes
    appState.assessment.databaseTypes = Array.from(document.querySelectorAll('input[type="checkbox"][value*="SQL"], input[type="checkbox"][value="MongoDB"], input[type="checkbox"][value="Oracle"]'))
        .filter(cb => cb.checked).map(cb => cb.value);
    
    appState.assessment.applicationTypes = Array.from(document.querySelectorAll('input[type="checkbox"][value="Web"], input[type="checkbox"][value="API"], input[type="checkbox"][value="Desktop"], input[type="checkbox"][value="Mobile"]'))
        .filter(cb => cb.checked).map(cb => cb.value);
    
    appState.assessment.securityRequirements = Array.from(document.querySelectorAll('input[type="checkbox"][value="HIPAA"], input[type="checkbox"][value="PCI"], input[type="checkbox"][value="GDPR"], input[type="checkbox"][value="SOC2"]'))
        .filter(cb => cb.checked).map(cb => cb.value);
    
    // Calculate assessment results
    calculateAssessmentResults();
    updateCostAnalysis();
    updateDashboard();
    
    // Auto-update TCO if section is visible
    if (document.getElementById('tco') && document.getElementById('tco').classList.contains('active')) {
        initializeTCO();
    }
}

function calculateAssessmentResults() {
    const a = appState.assessment;
    const totalServers = a.physicalServers + a.virtualMachines;
    
    // Migration Complexity
    let complexityScore = 0;
    complexityScore += totalServers * 2;
    complexityScore += a.numDatabases * 3;
    complexityScore += a.numApplications * 2;
    complexityScore += a.securityRequirements.length * 5;
    
    let complexity = 'Low';
    if (complexityScore > 50) complexity = 'High';
    else if (complexityScore > 20) complexity = 'Medium';
    
    // Estimated Effort
    let effortWeeks = Math.ceil((totalServers * 0.5) + (a.numDatabases * 1) + (a.numApplications * 0.5));
    if (effortWeeks < 4) effortWeeks = 4;
    if (effortWeeks > 52) effortWeeks = 52;
    
    // Risk Level
    let riskScore = 0;
    riskScore += a.securityRequirements.length * 3;
    riskScore += (a.numDatabases > 5 ? 2 : 0);
    riskScore += (totalServers > 10 ? 2 : 0);
    
    let riskLevel = 'Low';
    if (riskScore > 8) riskLevel = 'High';
    else if (riskScore > 4) riskLevel = 'Medium';
    
    // Readiness Score
    let readinessScore = 100;
    readinessScore -= (a.securityRequirements.length > 0 ? 10 : 0);
    readinessScore -= (totalServers > 20 ? 15 : 0);
    readinessScore -= (a.numDatabases > 10 ? 10 : 0);
    if (readinessScore < 50) readinessScore = 50;
    
    // Update UI
    document.getElementById('migrationComplexity').textContent = complexity;
    document.getElementById('migrationComplexity').className = `result-value ${complexity.toLowerCase()}`;
    
    document.getElementById('estimatedEffort').textContent = `${effortWeeks} weeks`;
    
    document.getElementById('riskLevel').textContent = riskLevel;
    document.getElementById('riskLevel').className = `result-value ${riskLevel.toLowerCase()}`;
    
    document.getElementById('readinessScore').textContent = `${readinessScore}%`;
    document.getElementById('readinessScore').className = `result-value ${readinessScore >= 70 ? 'high' : readinessScore >= 50 ? 'medium' : 'low'}`;
    
    // Store for planning
    appState.planning.migrationTimeline = effortWeeks;
}

// Migration Planning Functions
function updateMigrationPlan() {
    // Check plan limit
    if (!checkUsageLimit('maxPlans', 'plans')) {
        const plan = getCurrentPlan();
        showFeatureLock(`Your ${plan.name} plan allows ${plan.limits.maxPlans} migration plan(s). Please upgrade for unlimited plans.`);
        return;
    }
    
    appState.planning.cloudProvider = document.getElementById('cloudProvider').value;
    appState.planning.migrationStrategy = document.getElementById('migrationStrategy').value;
    appState.planning.migrationPriority = document.getElementById('migrationPriority').value;
    appState.planning.startDate = document.getElementById('startDate').value;
    appState.planning.endDate = document.getElementById('endDate').value;
    appState.planning.teamSize = parseInt(document.getElementById('teamSize').value) || 5;
    
    // Increment plan usage if this is a new plan
    if (appState.planning.cloudProvider && appState.planning.migrationStrategy) {
        appState.usage.plans = Math.max(appState.usage.plans, 1);
    }
    
    calculateTimeline();
    updateDashboard();
    updateUsageUI();
}

function calculateTimeline() {
    const a = appState.assessment;
    const totalServers = a.physicalServers + a.virtualMachines;
    const baseWeeks = Math.ceil((totalServers * 0.5) + (a.numDatabases * 1) + (a.numApplications * 0.5));
    
    // Adjust based on priority
    let multiplier = 1;
    switch(appState.planning.migrationPriority) {
        case 'low': multiplier = 1.5; break;
        case 'medium': multiplier = 1; break;
        case 'high': multiplier = 0.75; break;
        case 'critical': multiplier = 0.5; break;
    }
    
    const totalWeeks = Math.ceil(baseWeeks * multiplier);
    const weeksPerPhase = Math.ceil(totalWeeks / 5);
    
    // Update phase durations
    document.getElementById('phase1Duration').textContent = `Duration: ${weeksPerPhase} weeks`;
    document.getElementById('phase2Duration').textContent = `Duration: ${weeksPerPhase} weeks`;
    document.getElementById('phase3Duration').textContent = `Duration: ${weeksPerPhase} weeks`;
    document.getElementById('phase4Duration').textContent = `Duration: ${weeksPerPhase * 2} weeks`;
    document.getElementById('phase5Duration').textContent = `Duration: ${weeksPerPhase} weeks`;
    
    // Update tasks based on strategy
    updatePhaseTasks();
}

function updatePhaseTasks() {
    const strategy = appState.planning.migrationStrategy;
    const provider = appState.planning.cloudProvider;
    
    let phase2Tasks = ['Cloud architecture design', 'Security planning', 'Network configuration'];
    let phase3Tasks = ['Migrate test environment', 'Validate functionality', 'Performance testing'];
    
    if (strategy === 'lift-shift') {
        phase2Tasks.push('VM replication setup');
        phase3Tasks.push('Lift-and-shift validation');
    } else if (strategy === 'refactor') {
        phase2Tasks.push('Application refactoring plan');
        phase3Tasks.push('Refactored app testing');
    } else if (strategy === 'rearchitect') {
        phase2Tasks.push('Cloud-native architecture design');
        phase3Tasks.push('New architecture validation');
    }
    
    if (provider) {
        phase2Tasks.push(`${provider} resource provisioning`);
    }
    
    // Update phase 2 and 3 tasks
    const phase2List = document.getElementById('phase2Tasks');
    phase2List.innerHTML = phase2Tasks.map(task => `<li>${task}</li>`).join('');
    
    const phase3List = document.getElementById('phase3Tasks');
    phase3List.innerHTML = phase3Tasks.map(task => `<li>${task}</li>`).join('');
}

// Cost Analysis Functions
function updateCostAnalysis() {
    const a = appState.assessment;
    const totalServers = a.physicalServers + a.virtualMachines;
    
    // Current Infrastructure Costs
    const hardwareCost = totalServers * 200; // $200/month per server
    const maintenanceCost = totalServers * 50; // $50/month maintenance
    const powerCost = totalServers * 30; // $30/month power/cooling
    const staffCost = a.currentCost > 0 ? a.currentCost * 0.3 : totalServers * 100; // 30% of total or $100/server
    
    const currentTotal = a.currentCost > 0 ? a.currentCost : (hardwareCost + maintenanceCost + powerCost + staffCost);
    
    // Cloud Infrastructure Costs
    // Compute: Based on servers (assuming 2 vCPU, 8GB RAM per server average)
    const computeInstances = totalServers;
    const computeCost = computeInstances * 80; // $80/month per instance (t3.medium equivalent)
    
    // Storage: $0.023 per GB per month
    const storageCost = a.totalStorage * 1000 * 0.023; // Convert TB to GB
    
    // Network: $0.09 per GB after first 1TB free
    const networkCost = a.monthlyBandwidth > 1000 ? (a.monthlyBandwidth - 1000) * 0.09 : 0;
    
    // Database: $50-200 per database depending on type
    const databaseCost = a.numDatabases * 100;
    
    const cloudTotal = computeCost + storageCost + networkCost + databaseCost;
    
    // Update app state
    appState.cost.currentTotal = currentTotal;
    appState.cost.cloudTotal = cloudTotal;
    
    // Update UI
    document.getElementById('currentHardware').textContent = `$${hardwareCost.toLocaleString()}`;
    document.getElementById('currentMaintenance').textContent = `$${maintenanceCost.toLocaleString()}`;
    document.getElementById('currentPower').textContent = `$${powerCost.toLocaleString()}`;
    document.getElementById('currentStaff').textContent = `$${staffCost.toLocaleString()}`;
    document.getElementById('currentTotal').textContent = `$${currentTotal.toLocaleString()}`;
    
    document.getElementById('cloudCompute').textContent = `$${computeCost.toLocaleString()}`;
    document.getElementById('cloudStorage').textContent = `$${storageCost.toLocaleString()}`;
    document.getElementById('cloudNetwork').textContent = `$${networkCost.toLocaleString()}`;
    document.getElementById('cloudDatabase').textContent = `$${databaseCost.toLocaleString()}`;
    document.getElementById('cloudTotal').textContent = `$${cloudTotal.toLocaleString()}`;
    
    // Calculate savings
    const monthlySavings = currentTotal - cloudTotal;
    const annualSavings = monthlySavings * 12;
    const threeYearSavings = annualSavings * 3;
    
    document.getElementById('monthlySavings').textContent = `$${monthlySavings.toLocaleString()}`;
    document.getElementById('annualSavings').textContent = `$${annualSavings.toLocaleString()}`;
    document.getElementById('threeYearSavings').textContent = `$${threeYearSavings.toLocaleString()}`;
    
    // ROI Timeline (assuming $10k migration cost)
    const migrationCost = 10000;
    const roiMonths = monthlySavings > 0 ? Math.ceil(migrationCost / monthlySavings) : 0;
    document.getElementById('roiTimeline').textContent = roiMonths > 0 ? `${roiMonths} months` : 'N/A';
    
    // Update recommendations
    updateCostRecommendations(monthlySavings);
    
    // Update chart
    updateCostChart();
}

function updateCostRecommendations(savings) {
    const recommendations = [];
    
    if (savings > 0) {
        recommendations.push({
            icon: 'fa-check-circle',
            text: `Potential monthly savings of $${savings.toLocaleString()} identified`
        });
    }
    
    if (appState.assessment.totalStorage > 10) {
        recommendations.push({
            icon: 'fa-database',
            text: 'Consider using object storage (S3/Blob) for archival data to reduce costs'
        });
    }
    
    if (appState.assessment.monthlyBandwidth > 5000) {
        recommendations.push({
            icon: 'fa-network-wired',
            text: 'Implement CDN to reduce bandwidth costs'
        });
    }
    
    if (appState.assessment.totalServers > 10) {
        recommendations.push({
            icon: 'fa-server',
            text: 'Use reserved instances for predictable workloads to save up to 40%'
        });
    }
    
    if (appState.assessment.numDatabases > 5) {
        recommendations.push({
            icon: 'fa-database',
            text: 'Consider managed database services to reduce operational overhead'
        });
    }
    
    recommendations.push({
        icon: 'fa-chart-line',
        text: 'Implement auto-scaling to optimize costs based on actual usage'
    });
    
    const recommendationsHTML = recommendations.map(rec => `
        <div class="recommendation-item">
            <i class="fas ${rec.icon}"></i>
            <span>${rec.text}</span>
        </div>
    `).join('');
    
    document.getElementById('costRecommendations').innerHTML = recommendationsHTML;
}

function updateCostChart() {
    const canvas = document.getElementById('costChartCanvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    canvas.width = 400;
    canvas.height = 400;
    
    const current = appState.cost.currentTotal;
    const cloud = appState.cost.cloudTotal;
    
    // Simple bar chart
    const max = Math.max(current, cloud) * 1.2;
    const barWidth = 150;
    const spacing = 50;
    const startX = 50;
    const chartHeight = 300;
    const startY = 50;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw bars
    const currentHeight = (current / max) * chartHeight;
    const cloudHeight = (cloud / max) * chartHeight;
    
    // Current bar
    ctx.fillStyle = '#667eea';
    ctx.fillRect(startX, startY + chartHeight - currentHeight, barWidth, currentHeight);
    ctx.fillStyle = '#333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Current', startX + barWidth / 2, startY + chartHeight + 20);
    ctx.fillText(`$${current.toLocaleString()}`, startX + barWidth / 2, startY + chartHeight - currentHeight - 10);
    
    // Cloud bar
    ctx.fillStyle = '#48bb78';
    ctx.fillRect(startX + barWidth + spacing, startY + chartHeight - cloudHeight, barWidth, cloudHeight);
    ctx.fillStyle = '#333';
    ctx.fillText('Cloud', startX + barWidth + spacing + barWidth / 2, startY + chartHeight + 20);
    ctx.fillText(`$${cloud.toLocaleString()}`, startX + barWidth + spacing + barWidth / 2, startY + chartHeight - cloudHeight - 10);
}

// Dashboard Functions
function updateDashboard() {
    const a = appState.assessment;
    const totalServers = a.physicalServers + a.virtualMachines;
    
    // Update stats
    document.getElementById('totalServers').textContent = totalServers;
    
    const savings = appState.cost.currentTotal - appState.cost.cloudTotal;
    document.getElementById('estimatedSavings').textContent = `$${savings > 0 ? savings.toLocaleString() : '0'}`;
    
    const timeline = appState.planning.migrationTimeline || Math.ceil((totalServers * 0.5) + (a.numDatabases * 1));
    document.getElementById('migrationTimeline').textContent = timeline || 0;
    
    // Calculate completion progress
    let progress = 0;
    if (totalServers > 0) progress += 25; // Assessment started
    if (appState.planning.cloudProvider) progress += 25; // Provider selected
    if (appState.planning.migrationStrategy) progress += 25; // Strategy selected
    if (appState.planning.startDate && appState.planning.endDate) progress += 25; // Timeline set
    
    document.getElementById('completionProgress').textContent = `${progress}%`;
    document.getElementById('progressFill').style.width = `${progress}%`;
    
    // Update progress steps
    if (progress >= 25) {
        document.getElementById('step-planning').classList.add('completed');
        document.getElementById('step-planning').querySelector('i').classList.remove('fa-circle');
        document.getElementById('step-planning').querySelector('i').classList.add('fa-check-circle');
    }
    if (progress >= 50) {
        document.getElementById('step-execution').classList.add('completed');
        document.getElementById('step-execution').querySelector('i').classList.remove('fa-circle');
        document.getElementById('step-execution').querySelector('i').classList.add('fa-check-circle');
    }
    if (progress >= 75) {
        document.getElementById('step-complete').classList.add('completed');
        document.getElementById('step-complete').querySelector('i').classList.remove('fa-circle');
        document.getElementById('step-complete').querySelector('i').classList.add('fa-check-circle');
    }
    
    // Update provider recommendation
    updateProviderRecommendation();
}

function updateProviderRecommendation() {
    const a = appState.assessment;
    const provider = appState.planning.cloudProvider;
    
    if (provider) {
        document.getElementById('recommendedProvider').textContent = provider;
        let reason = '';
        
        switch(provider) {
            case 'AWS':
                reason = 'Best for scalability and wide service selection';
                break;
            case 'Azure':
                reason = 'Ideal for Microsoft ecosystem integration';
                break;
            case 'GCP':
                reason = 'Excellent for data analytics and ML workloads';
                break;
            case 'Multi':
                reason = 'Optimal for high availability and vendor diversification';
                break;
        }
        
        document.getElementById('providerReason').textContent = reason;
    } else {
        // Auto-recommend based on assessment
        let recommendation = 'AWS';
        let reason = 'Recommended for most SME workloads';
        
        if (a.securityRequirements.includes('HIPAA') || a.securityRequirements.includes('PCI')) {
            recommendation = 'AWS';
            reason = 'Strong compliance certifications and security features';
        } else if (a.applicationTypes.includes('Desktop') || a.databaseTypes.includes('SQL Server')) {
            recommendation = 'Azure';
            reason = 'Best Microsoft ecosystem integration';
        } else if (a.numDatabases > 10) {
            recommendation = 'GCP';
            reason = 'Excellent for data-intensive workloads';
        }
        
        document.getElementById('recommendedProvider').textContent = recommendation;
        document.getElementById('providerReason').textContent = reason;
    }
}

// Report Generation
function generateReport(type = 'full') {
    // Check report limit
    if (!checkUsageLimit('maxReportsPerMonth', 'reportsThisMonth')) {
        const plan = getCurrentPlan();
        showFeatureLock(`Your ${plan.name} plan allows ${plan.limits.maxReportsPerMonth} report(s) per month. Please upgrade for unlimited reports.`);
        return;
    }
    
    // Check PDF export permission
    const plan = getCurrentPlan();
    const canExportPDF = plan.limits.pdfExport;
    
    const reportContent = generateReportContent(type);
    const preview = document.getElementById('reportPreview');
    
    let downloadButton = '';
    if (canExportPDF) {
        downloadButton = `<button class="btn-download" onclick="downloadReport('${type}')">
            <i class="fas fa-download"></i> Download PDF
        </button>`;
            } else {
        downloadButton = `<button class="btn-download disabled" onclick="showUpgradeModal()" title="Upgrade to export PDF">
            <i class="fas fa-lock"></i> PDF Export (Upgrade Required)
        </button>`;
    }
    
    preview.innerHTML = `
        <div class="report-content">
            <div class="report-header">
                <h2>${getReportTitle(type)}</h2>
                ${downloadButton}
            </div>
            ${reportContent}
        </div>
    `;
    
    // Increment report usage
    appState.usage.reportsThisMonth++;
    updateUsageUI();
    saveProgress();
    
    showToast('Report generated successfully!');
}

function generateReportContent(type) {
    const a = appState.assessment;
    const p = appState.planning;
    const c = appState.cost;
    const totalServers = a.physicalServers + a.virtualMachines;
    
    let content = '';
    
    if (type === 'executive' || type === 'full') {
        content += `
            <div class="report-section">
                <h3>Executive Summary</h3>
                <p><strong>Total Infrastructure:</strong> ${totalServers} servers, ${a.numDatabases} databases, ${a.numApplications} applications</p>
                <p><strong>Current Monthly Cost:</strong> $${c.currentTotal.toLocaleString()}</p>
                <p><strong>Projected Cloud Cost:</strong> $${c.cloudTotal.toLocaleString()}</p>
                <p><strong>Estimated Monthly Savings:</strong> $${(c.currentTotal - c.cloudTotal).toLocaleString()}</p>
                <p><strong>Recommended Provider:</strong> ${p.cloudProvider || 'AWS'}</p>
                <p><strong>Migration Timeline:</strong> ${p.migrationTimeline || 'TBD'} weeks</p>
            </div>
        `;
    }
    
    if (type === 'technical' || type === 'full') {
        content += `
            <div class="report-section">
                <h3>Technical Assessment</h3>
                <ul>
                    <li>Physical Servers: ${a.physicalServers}</li>
                    <li>Virtual Machines: ${a.virtualMachines}</li>
                    <li>Total Storage: ${a.totalStorage} TB</li>
                    <li>Average CPU Cores: ${a.avgCpuCores}</li>
                    <li>Average RAM: ${a.avgRam} GB</li>
                    <li>Databases: ${a.numDatabases} (${a.databaseTypes.join(', ') || 'None specified'})</li>
                    <li>Applications: ${a.numApplications} (${a.applicationTypes.join(', ') || 'None specified'})</li>
                    <li>Monthly Bandwidth: ${a.monthlyBandwidth} GB</li>
                    <li>Security Requirements: ${a.securityRequirements.join(', ') || 'None'}</li>
                </ul>
            </div>
        `;
    }
    
    if (type === 'cost' || type === 'full') {
        content += `
            <div class="report-section">
                <h3>Cost Analysis</h3>
                <table class="report-table">
                    <tr>
                        <th>Cost Category</th>
                        <th>Current</th>
                        <th>Cloud</th>
                        <th>Savings</th>
                    </tr>
                    <tr>
                        <td>Monthly Cost</td>
                        <td>$${c.currentTotal.toLocaleString()}</td>
                        <td>$${c.cloudTotal.toLocaleString()}</td>
                        <td>$${(c.currentTotal - c.cloudTotal).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <td>Annual Cost</td>
                        <td>$${(c.currentTotal * 12).toLocaleString()}</td>
                        <td>$${(c.cloudTotal * 12).toLocaleString()}</td>
                        <td>$${((c.currentTotal - c.cloudTotal) * 12).toLocaleString()}</td>
                    </tr>
                </table>
            </div>
        `;
    }
    
    if (type === 'full') {
        content += `
            <div class="report-section">
                <h3>Migration Plan</h3>
                <p><strong>Strategy:</strong> ${p.migrationStrategy || 'Not selected'}</p>
                <p><strong>Provider:</strong> ${p.cloudProvider || 'Not selected'}</p>
                <p><strong>Priority:</strong> ${p.migrationPriority}</p>
                <p><strong>Team Size:</strong> ${p.teamSize}</p>
                <p><strong>Start Date:</strong> ${p.startDate || 'Not set'}</p>
                <p><strong>End Date:</strong> ${p.endDate || 'Not set'}</p>
            </div>
        `;
    }
    
    return content;
}

function getReportTitle(type) {
    const titles = {
        'executive': 'Executive Summary Report',
        'technical': 'Technical Assessment Report',
        'cost': 'Cost Analysis Report',
        'full': 'Complete Migration Report'
    };
    return titles[type] || 'Migration Report';
}

function downloadReport(type) {
    const plan = getCurrentPlan();
    
    if (!plan.limits.pdfExport) {
        showUpgradeModal();
        return;
    }
    
    showToast('PDF download feature requires backend integration. In production, this would generate a PDF.');
    // In a real implementation, this would call a backend API to generate PDF
    // Example: fetch('/api/generate-pdf', { method: 'POST', body: JSON.stringify({ type, data: appState }) })
}

// Save/Load Functions
function saveProgress(options = {}) {
    const { silent = false } = options;
    const data = {
        assessment: appState.assessment,
        planning: appState.planning,
        cost: appState.cost,
        checklist: appState.checklist
    };

    // Keep last report timestamp consistent
    if (appState.usage.reportsThisMonth > 0 && !appState.usage.lastReportDate) {
        appState.usage.lastReportDate = new Date().toISOString();
    }

    try {
        // Save to localStorage (frontend-only app)
        localStorage.setItem('cloudMigrationData', JSON.stringify(data));
        localStorage.setItem('usage', JSON.stringify({
            servers: appState.usage.servers,
            plans: appState.usage.plans,
            reportsThisMonth: appState.usage.reportsThisMonth,
            lastReportDate: appState.usage.lastReportDate || null
        }));
        
        if (!silent) showToast('Progress saved successfully!');
    } catch (error) {
        console.error('Save error:', error);
        if (!silent) showToast('Save failed. Please try again.', 'error');
    }
}

function loadProgress() {
    // Load data from localStorage
    const saved = localStorage.getItem('cloudMigrationData');
    const savedUsage = localStorage.getItem('usage');
    
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.assessment) appState.assessment = { ...appState.assessment, ...data.assessment };
            if (data.planning) appState.planning = { ...appState.planning, ...data.planning };
            if (data.cost) appState.cost = { ...appState.cost, ...data.cost };
            if (data.checklist) appState.checklist = { ...appState.checklist, ...data.checklist };
        } catch (e) {
            console.error('Error loading progress:', e);
        }
    }
    
    if (savedUsage) {
        try {
            const usage = JSON.parse(savedUsage);
            appState.usage = { ...appState.usage, ...usage };
            // Handle legacy field name
            if (usage.lastReportAt) {
                appState.usage.lastReportDate = usage.lastReportAt;
            }
        } catch (e) {
            console.error('Error loading usage:', e);
        }
    }
    
    populateForms();
    updateAssessment();
    updateMigrationPlan();
    updateCostAnalysis();
}

function populateForms() {
    const a = appState.assessment;
    const p = appState.planning;
    
    // Populate assessment form
    document.getElementById('physicalServers').value = a.physicalServers || 0;
    document.getElementById('virtualMachines').value = a.virtualMachines || 0;
    document.getElementById('totalStorage').value = a.totalStorage || 0;
    document.getElementById('avgCpuCores').value = a.avgCpuCores || 4;
    document.getElementById('avgRam').value = a.avgRam || 16;
    document.getElementById('numDatabases').value = a.numDatabases || 0;
    document.getElementById('numApplications').value = a.numApplications || 0;
    document.getElementById('monthlyBandwidth').value = a.monthlyBandwidth || 0;
    document.getElementById('currentCost').value = a.currentCost || 0;
    
    // Populate planning form
    if (p.cloudProvider) document.getElementById('cloudProvider').value = p.cloudProvider;
    if (p.migrationStrategy) document.getElementById('migrationStrategy').value = p.migrationStrategy;
    if (p.migrationPriority) document.getElementById('migrationPriority').value = p.migrationPriority;
    if (p.startDate) document.getElementById('startDate').value = p.startDate;
    if (p.endDate) document.getElementById('endDate').value = p.endDate;
    if (p.teamSize) document.getElementById('teamSize').value = p.teamSize;
}

// Toast Notifications
function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
        <span>${message}</span>
    `;
    
    const container = document.getElementById('toastContainer');
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            container.removeChild(toast);
        }, 300);
    }, 3000);
}

// Event Listeners
document.getElementById('saveBtn').addEventListener('click', () => saveProgress({ silent: false }));
document.getElementById('exportBtn').addEventListener('click', () => generateReport('full'));

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    console.log('Page loaded, checking authentication...');
    console.log('localStorage user:', localStorage.getItem('user'));
    console.log('localStorage subscription:', localStorage.getItem('subscription'));
    
    // Check authentication (localStorage-based)
    const isAuthenticated = checkAuth();
    console.log('Authentication result:', isAuthenticated);
    
    if (!isAuthenticated) {
        console.log('Not authenticated, redirecting to landing page');
        return;
    }
    
    console.log('User authenticated:', appState.user);
    
    // Initialize user UI
    if (appState.user) {
        document.getElementById('userName').textContent = appState.user.name || 'User';
        document.getElementById('userEmail').textContent = appState.user.email || 'user@example.com';
        
        // Populate account form
        if (document.getElementById('profileName')) {
            document.getElementById('profileName').value = appState.user.name || '';
            document.getElementById('profileEmail').value = appState.user.email || '';
            document.getElementById('profileCompany').value = appState.user.company || '';
        }
    }
    
    // Initialize subscription UI
    updateSubscriptionUI();
    
    // Load progress
    loadProgress();
    
    // Reset monthly report count if new month
    const lastReportDate = appState.usage.lastReportDate;
    if (lastReportDate) {
        const lastDate = new Date(lastReportDate);
        const now = new Date();
        if (lastDate.getMonth() !== now.getMonth() || lastDate.getFullYear() !== now.getFullYear()) {
            appState.usage.reportsThisMonth = 0;
        }
    }
    
    updateDashboard();
    updateCostChart();
    updateUsageUI();

    // If user returned from Stripe checkout, sync subscription immediately
    handlePostCheckoutReturn().catch(() => {});
    
    // Load and render checklist
    if (appState.checklist.tasks && appState.checklist.tasks.length > 0) {
        renderChecklist();
    }
    
    // Set default dates
    const today = new Date();
    const nextMonth = new Date(today);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    
    if (document.getElementById('startDate')) {
        document.getElementById('startDate').value = today.toISOString().split('T')[0];
        document.getElementById('endDate').value = nextMonth.toISOString().split('T')[0];
    }
    
    // Event listeners
    if (document.getElementById('userMenuBtn')) {
        document.getElementById('userMenuBtn').addEventListener('click', toggleUserMenu);
    }
    
    if (document.getElementById('profileForm')) {
        document.getElementById('profileForm').addEventListener('submit', (e) => {
            e.preventDefault();
            appState.user.name = document.getElementById('profileName').value;
            appState.user.email = document.getElementById('profileEmail').value;
            appState.user.company = document.getElementById('profileCompany').value;
            localStorage.setItem('user', JSON.stringify(appState.user));
            updateSubscriptionUI();
            showToast('Profile updated successfully!');
        });
    }
});

// Migration Checklist Functions
function generateChecklist() {
    const p = appState.planning;
    const a = appState.assessment;
    
    if (!p.migrationStrategy || !p.cloudProvider) {
        showToast('Please complete your migration plan first', 'error');
        showSection('planning');
        return;
    }
    
    const tasks = [];
    
    // Phase 1: Assessment & Planning
    tasks.push({
        id: Date.now() + 1,
        title: 'Complete infrastructure assessment',
        phase: 'Phase 1: Assessment & Planning',
        status: 'completed',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 2,
        title: 'Document all servers and applications',
        phase: 'Phase 1: Assessment & Planning',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 3,
        title: 'Map application dependencies',
        phase: 'Phase 1: Assessment & Planning',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    // Phase 2: Design & Preparation
    tasks.push({
        id: Date.now() + 4,
        title: `Design ${p.cloudProvider} architecture`,
        phase: 'Phase 2: Design & Preparation',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 5,
        title: 'Set up cloud account and billing',
        phase: 'Phase 2: Design & Preparation',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 6,
        title: 'Configure network and security groups',
        phase: 'Phase 2: Design & Preparation',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    if (a.securityRequirements.length > 0) {
        tasks.push({
            id: Date.now() + 7,
            title: `Configure compliance: ${a.securityRequirements.join(', ')}`,
            phase: 'Phase 2: Design & Preparation',
            status: 'pending',
            dueDate: null,
            assignee: '',
            notes: ''
        });
    }
    
    // Phase 3: Pilot Migration
    tasks.push({
        id: Date.now() + 8,
        title: 'Set up test environment in cloud',
        phase: 'Phase 3: Pilot Migration',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    if (p.migrationStrategy === 'lift-shift') {
        tasks.push({
            id: Date.now() + 9,
            title: 'Replicate VMs to cloud',
            phase: 'Phase 3: Pilot Migration',
            status: 'pending',
            dueDate: null,
            assignee: '',
            notes: ''
        });
    } else if (p.migrationStrategy === 'refactor') {
        tasks.push({
            id: Date.now() + 9,
            title: 'Refactor applications for cloud',
            phase: 'Phase 3: Pilot Migration',
            status: 'pending',
            dueDate: null,
            assignee: '',
            notes: ''
        });
    } else if (p.migrationStrategy === 'rearchitect') {
        tasks.push({
            id: Date.now() + 9,
            title: 'Build cloud-native architecture',
            phase: 'Phase 3: Pilot Migration',
            status: 'pending',
            dueDate: null,
            assignee: '',
            notes: ''
        });
    }
    
    tasks.push({
        id: Date.now() + 10,
        title: 'Test application functionality',
        phase: 'Phase 3: Pilot Migration',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 11,
        title: 'Performance and load testing',
        phase: 'Phase 3: Pilot Migration',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    // Phase 4: Full Migration
    tasks.push({
        id: Date.now() + 12,
        title: 'Migrate production workloads',
        phase: 'Phase 4: Full Migration',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    if (a.numDatabases > 0) {
        tasks.push({
            id: Date.now() + 13,
            title: `Migrate ${a.numDatabases} database(s)`,
            phase: 'Phase 4: Full Migration',
            status: 'pending',
            dueDate: null,
            assignee: '',
            notes: ''
        });
    }
    
    tasks.push({
        id: Date.now() + 14,
        title: 'Execute cutover plan',
        phase: 'Phase 4: Full Migration',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 15,
        title: 'Verify production systems',
        phase: 'Phase 4: Full Migration',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    // Phase 5: Optimization
    tasks.push({
        id: Date.now() + 16,
        title: 'Optimize cloud resources',
        phase: 'Phase 5: Optimization',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 17,
        title: 'Implement cost optimization',
        phase: 'Phase 5: Optimization',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    tasks.push({
        id: Date.now() + 18,
        title: 'Document migration process',
        phase: 'Phase 5: Optimization',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    });
    
    appState.checklist.tasks = tasks;
    saveProgress();
    renderChecklist();
    showToast('Migration checklist generated successfully!');
}

function addCustomTask() {
    const title = prompt('Enter task title:');
    if (!title) return;
    
    const task = {
        id: Date.now(),
        title: title,
        phase: 'Custom',
        status: 'pending',
        dueDate: null,
        assignee: '',
        notes: ''
    };
    
    appState.checklist.tasks.push(task);
    saveProgress();
    renderChecklist();
    showToast('Custom task added!');
}

function toggleTaskStatus(taskId) {
    const task = appState.checklist.tasks.find(t => t.id === taskId);
    if (!task) return;
    
    if (task.status === 'pending') {
        task.status = 'in-progress';
    } else if (task.status === 'in-progress') {
        task.status = 'completed';
    } else {
        task.status = 'pending';
    }
    
    saveProgress();
    renderChecklist();
}

function deleteTask(taskId) {
    if (confirm('Are you sure you want to delete this task?')) {
        appState.checklist.tasks = appState.checklist.tasks.filter(t => t.id !== taskId);
        saveProgress();
        renderChecklist();
        showToast('Task deleted');
    }
}

function filterChecklist(filter) {
    appState.checklist.currentFilter = filter;
    
    // Update filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-filter') === filter) {
            btn.classList.add('active');
        }
    });
    
    renderChecklist();
}

function renderChecklist() {
    const container = document.getElementById('checklistItems');
    if (!container) return;
    
    let tasks = appState.checklist.tasks;
    
    // Apply filter
    if (appState.checklist.currentFilter !== 'all') {
        tasks = tasks.filter(t => t.status === appState.checklist.currentFilter);
    }
    
    // Group by phase
    const grouped = {};
    tasks.forEach(task => {
        if (!grouped[task.phase]) {
            grouped[task.phase] = [];
        }
        grouped[task.phase].push(task);
    });
    
    // Update stats
    const total = appState.checklist.tasks.length;
    const completed = appState.checklist.tasks.filter(t => t.status === 'completed').length;
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    document.getElementById('totalTasks').textContent = total;
    document.getElementById('completedTasks').textContent = completed;
    document.getElementById('checklistProgress').textContent = `${progress}%`;
    document.getElementById('checklistProgressFill').style.width = `${progress}%`;
    
    if (tasks.length === 0) {
        container.innerHTML = `
            <div class="checklist-empty">
                <i class="fas fa-clipboard-list"></i>
                <p>No tasks found. ${appState.checklist.currentFilter === 'all' ? 'Generate a checklist from your migration plan or add custom tasks.' : 'Try a different filter.'}</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    Object.keys(grouped).forEach(phase => {
        html += `<div class="checklist-phase">
            <h3>${phase}</h3>
            <div class="checklist-phase-tasks">`;
        
        grouped[phase].forEach(task => {
            const statusIcon = task.status === 'completed' ? 'fa-check-circle' : 
                             task.status === 'in-progress' ? 'fa-spinner' : 'fa-circle';
            const statusClass = task.status === 'completed' ? 'completed' : 
                              task.status === 'in-progress' ? 'in-progress' : 'pending';
            
            html += `
                <div class="checklist-item ${statusClass}">
                    <div class="checklist-item-main">
                        <button class="checklist-checkbox" onclick="toggleTaskStatus(${task.id})">
                            <i class="fas ${statusIcon}"></i>
                        </button>
                        <div class="checklist-item-content">
                            <h4>${task.title}</h4>
                            ${task.notes ? `<p class="checklist-notes">${task.notes}</p>` : ''}
                        </div>
                        <button class="checklist-delete" onclick="deleteTask(${task.id})" title="Delete task">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += `</div></div>`;
    });
    
    container.innerHTML = html;
}

// TCO Calculator Functions
function calculateTCO() {
    const period = parseInt(document.getElementById('tcoPeriod').value) || 5;
    const currentMonthly = parseFloat(document.getElementById('tcoCurrentMonthly').value) || 0;
    const growthRate = parseFloat(document.getElementById('tcoGrowthRate').value) || 3;
    const migrationCost = parseFloat(document.getElementById('tcoMigrationCost').value) || 10000;
    const cloudMonthly = parseFloat(document.getElementById('tcoCloudMonthly').value) || 0;
    const cloudReduction = parseFloat(document.getElementById('tcoCloudReduction').value) || 5;
    
    // Auto-populate from cost analysis if available
    if (currentMonthly === 0 && appState.cost.currentTotal > 0) {
        document.getElementById('tcoCurrentMonthly').value = appState.cost.currentTotal;
        document.getElementById('tcoCloudMonthly').value = appState.cost.cloudTotal;
        return calculateTCO(); // Recalculate with new values
    }
    
    let currentTotal = 0;
    let cloudTotal = migrationCost; // Include one-time migration cost
    const breakdown = [];
    
    for (let year = 1; year <= period; year++) {
        // Current infrastructure cost (with growth)
        const currentYearly = currentMonthly * 12 * Math.pow(1 + growthRate / 100, year - 1);
        currentTotal += currentYearly;
        
        // Cloud cost (with optimization reduction)
        const cloudYearly = cloudMonthly * 12 * Math.pow(1 - cloudReduction / 100, year - 1);
        cloudTotal += cloudYearly;
        
        const savings = currentYearly - cloudYearly;
        const cumulativeSavings = currentTotal - cloudTotal;
        
        breakdown.push({
            year,
            currentCost: currentYearly,
            cloudCost: cloudYearly,
            savings,
            cumulativeSavings
        });
    }
    
    const totalSavings = currentTotal - cloudTotal;
    const roi = migrationCost > 0 ? ((totalSavings / migrationCost) * 100).toFixed(1) : 0;
    const paybackMonths = cloudMonthly > 0 && (currentMonthly - cloudMonthly) > 0 
        ? Math.ceil(migrationCost / ((currentMonthly - cloudMonthly) * 12)) 
        : null;
    
    // Update UI
    document.getElementById('tcoCurrentTotal').textContent = `$${currentTotal.toLocaleString()}`;
    document.getElementById('tcoCloudTotal').textContent = `$${cloudTotal.toLocaleString()}`;
    document.getElementById('tcoTotalSavings').textContent = `$${totalSavings.toLocaleString()}`;
    document.getElementById('tcoROI').textContent = `${roi}%`;
    document.getElementById('tcoPayback').textContent = paybackMonths 
        ? `${paybackMonths} months` 
        : 'N/A';
    
    // Update breakdown table
    const tbody = document.getElementById('tcoBreakdownBody');
    tbody.innerHTML = breakdown.map(row => `
        <tr>
            <td>Year ${row.year}</td>
            <td>$${row.currentCost.toLocaleString()}</td>
            <td>$${row.cloudCost.toLocaleString()}</td>
            <td class="${row.savings >= 0 ? 'positive' : 'negative'}">$${row.savings.toLocaleString()}</td>
            <td class="${row.cumulativeSavings >= 0 ? 'positive' : 'negative'}">$${row.cumulativeSavings.toLocaleString()}</td>
        </tr>
    `).join('');
}

function exportTCOReport() {
    const plan = getCurrentPlan();
    if (!plan.limits.pdfExport) {
        showUpgradeModal();
        return;
    }
    
    // Generate PDF using jsPDF
    if (typeof window.jspdf !== 'undefined') {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(20);
        doc.text('TCO Analysis Report', 20, 20);
        
        doc.setFontSize(12);
        doc.text(`Period: ${document.getElementById('tcoPeriod').value} Years`, 20, 40);
        doc.text(`Total Current Cost: ${document.getElementById('tcoCurrentTotal').textContent}`, 20, 50);
        doc.text(`Total Cloud Cost: ${document.getElementById('tcoCloudTotal').textContent}`, 20, 60);
        doc.text(`Total Savings: ${document.getElementById('tcoTotalSavings').textContent}`, 20, 70);
        doc.text(`ROI: ${document.getElementById('tcoROI').textContent}`, 20, 80);
        
        doc.save('tco-analysis-report.pdf');
        showToast('TCO report downloaded successfully!');
    } else {
        showToast('PDF library not loaded. Please refresh the page.');
    }
}

function shareTCO() {
    const data = {
        period: document.getElementById('tcoPeriod').value,
        currentTotal: document.getElementById('tcoCurrentTotal').textContent,
        cloudTotal: document.getElementById('tcoCloudTotal').textContent,
        savings: document.getElementById('tcoTotalSavings').textContent
    };
    
    const shareText = `Cloud Migration TCO Analysis:\nPeriod: ${data.period} Years\nCurrent Cost: ${data.currentTotal}\nCloud Cost: ${data.cloudTotal}\nTotal Savings: ${data.savings}`;
    
    if (navigator.share) {
        navigator.share({
            title: 'Cloud Migration TCO Analysis',
            text: shareText
        });
    } else {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(shareText);
        showToast('TCO data copied to clipboard!');
    }
}

// Migration Timeline Generator Functions
function generateVisualTimeline() {
    const p = appState.planning;
    
    if (!p.migrationStrategy || !p.cloudProvider) {
        showToast('Please complete your migration plan first', 'error');
        showSection('planning');
        return;
    }
    
    const totalServers = appState.assessment.physicalServers + appState.assessment.virtualMachines;
    const baseWeeks = Math.ceil((totalServers * 0.5) + (appState.assessment.numDatabases * 1));
    const totalWeeks = Math.ceil(baseWeeks * (p.migrationPriority === 'high' ? 0.75 : p.migrationPriority === 'critical' ? 0.5 : 1));
    const weeksPerPhase = Math.ceil(totalWeeks / 5);
    
    const phases = [
        { name: 'Assessment & Planning', weeks: weeksPerPhase, color: '#667eea' },
        { name: 'Design & Preparation', weeks: weeksPerPhase, color: '#4299e1' },
        { name: 'Pilot Migration', weeks: weeksPerPhase, color: '#ed8936' },
        { name: 'Full Migration', weeks: weeksPerPhase * 2, color: '#48bb78' },
        { name: 'Optimization', weeks: weeksPerPhase, color: '#764ba2' }
    ];
    
    const container = document.getElementById('visualTimeline');
    let currentWeek = 0;
    
    let html = '<div class="visual-timeline">';
    
    phases.forEach((phase, index) => {
        const startDate = p.startDate ? new Date(p.startDate) : new Date();
        startDate.setDate(startDate.getDate() + (currentWeek * 7));
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + (phase.weeks * 7));
        
        html += `
            <div class="timeline-phase-visual" style="--phase-color: ${phase.color}; --phase-width: ${(phase.weeks / totalWeeks) * 100}%">
                <div class="timeline-phase-bar">
                    <div class="timeline-phase-label">
                        <h4>${phase.name}</h4>
                        <span>${phase.weeks} weeks</span>
                    </div>
                </div>
                <div class="timeline-phase-dates">
                    <span>${startDate.toLocaleDateString()}</span>
                    <span>→</span>
                    <span>${endDate.toLocaleDateString()}</span>
                </div>
            </div>
        `;
        
        currentWeek += phase.weeks;
    });
    
    html += '</div>';
    html += `<div class="timeline-summary">
        <p><strong>Total Duration:</strong> ${totalWeeks} weeks (${Math.round(totalWeeks / 4.33)} months)</p>
        <p><strong>Provider:</strong> ${p.cloudProvider}</p>
        <p><strong>Strategy:</strong> ${p.migrationStrategy}</p>
    </div>`;
    
    container.innerHTML = html;
    showToast('Visual timeline generated!');
}

function exportTimelineImage() {
    const container = document.getElementById('visualTimeline');
    if (!container || container.querySelector('.timeline-empty')) {
        showToast('Please generate a timeline first');
        return;
    }
    
    if (typeof html2canvas !== 'undefined') {
        html2canvas(container).then(canvas => {
            const link = document.createElement('a');
            link.download = 'migration-timeline.png';
            link.href = canvas.toDataURL();
            link.click();
            showToast('Timeline exported as image!');
        });
    } else {
        showToast('Export library not loaded. Please refresh the page.');
    }
}

function shareTimeline() {
    const container = document.getElementById('visualTimeline');
    if (!container || container.querySelector('.timeline-empty')) {
        showToast('Please generate a timeline first');
        return;
    }
    
    if (navigator.share) {
        navigator.share({
            title: 'Cloud Migration Timeline',
            text: 'Check out my cloud migration timeline!'
        });
    } else {
        showToast('Sharing not available. Use export instead.');
    }
}

// PDF Report Download Functions
function downloadPDFReport(type) {
    const plan = getCurrentPlan();
    if (!plan.limits.pdfExport) {
        showUpgradeModal();
        return;
    }
    
    if (typeof window.jspdf === 'undefined') {
        showToast('PDF library not loaded. Please refresh the page.');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Generate report content
    const reportContent = generateReportContent(type);
    
    // Simple PDF generation (in production, use more sophisticated formatting)
    doc.setFontSize(20);
    doc.text(getReportTitle(type), 20, 20);
    
    doc.setFontSize(12);
    const lines = reportContent.replace(/<[^>]*>/g, '').split('\n');
    let y = 40;
    
    lines.forEach(line => {
        if (line.trim()) {
            doc.text(line.substring(0, 80), 20, y);
            y += 7;
            if (y > 280) {
                doc.addPage();
                y = 20;
            }
        }
    });
    
    doc.save(`migration-report-${type}.pdf`);
    showToast('PDF report downloaded successfully!');
}

// Email Course Signup (Landing Page)
function handleEmailCourseSignup(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const email = e.target.querySelector('input[type="email"]').value;
    const name = e.target.querySelector('input[type="text"]').value || 'Subscriber';
    
    // In production, this would send to your email service (Mailchimp, ConvertKit, etc.)
    // For now, save to localStorage
    const subscribers = JSON.parse(localStorage.getItem('emailCourseSubscribers') || '[]');
    subscribers.push({
        email,
        name,
        signupDate: new Date().toISOString()
    });
    localStorage.setItem('emailCourseSubscribers', JSON.stringify(subscribers));
    
    // Show success message
    e.target.innerHTML = `
        <div style="text-align: center; padding: 2rem;">
            <i class="fas fa-check-circle" style="font-size: 3rem; color: #48bb78; margin-bottom: 1rem;"></i>
            <h3>Success! Check your email</h3>
            <p>We've sent you the first lesson. Check your inbox!</p>
        </div>
    `;
    
    // In production, trigger email via API
    // fetch('/api/email-course/signup', { method: 'POST', body: JSON.stringify({ email, name }) });
}

// Initialize TCO calculator with current values
function initializeTCO() {
    if (appState.cost.currentTotal > 0) {
        document.getElementById('tcoCurrentMonthly').value = appState.cost.currentTotal;
        document.getElementById('tcoCloudMonthly').value = appState.cost.cloudTotal;
        calculateTCO();
    }
}

// Auto-save on changes
setInterval(() => {
    if (appState.assessment.physicalServers > 0 || appState.assessment.currentCost > 0) {
        saveProgress({ silent: true });
    }
}, 30000); // Auto-save every 30 seconds
