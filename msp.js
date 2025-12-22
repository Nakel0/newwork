function $(id) {
  return document.getElementById(id);
}

function showToast(message, { ms = 2600 } = {}) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.style.display = 'none';
  }, ms);
}

async function api(path, options = {}) {
  if (api._demo) {
    return demoApi(path, options);
  }
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const err = (json && json.error) ? json.error : `http_${res.status}`;
    const e = new Error(err);
    e.status = res.status;
    e.body = json;
    throw e;
  }
  return json;
}

function enableDemoMode() {
  api._demo = true;
  try { localStorage.setItem('mspDemoMode', '1'); } catch {}
  const banner = $('demoBanner');
  if (banner) banner.style.display = 'block';
}

function getDemoStore() {
  const key = 'mspDemoStoreV1';
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { orgs: [], clients: [], projects: [], proposals: [] };
}

function setDemoStore(store) {
  const key = 'mspDemoStoreV1';
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {}
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function jsonBody(options) {
  try {
    return options && options.body ? JSON.parse(options.body) : {};
  } catch {
    return {};
  }
}

async function demoApi(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const store = getDemoStore();

  // /api/me
  if (path === '/api/me' && method === 'GET') {
    return {
      user: { id: 'demo_user', name: 'Demo MSP', email: 'demo@example.com', companyName: 'Demo MSP' },
      subscription: { plan: 'enterprise', status: 'active', trialEndsAt: null },
      usage: { yearMonth: 209901, servers: 0, plans: 0, reportsThisMonth: 0, lastReportAt: null },
      appState: {}
    };
  }

  // /api/auth/logout
  if (path === '/api/auth/logout' && method === 'POST') {
    return { ok: true };
  }

  // /api/msp/orgs
  if (path === '/api/msp/orgs' && method === 'GET') {
    return {
      organizations: store.orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role: 'owner',
        brandName: o.brandName,
        brandPrimaryColor: o.brandPrimaryColor,
        brandWebsite: o.brandWebsite,
        brandEmail: o.brandEmail
      }))
    };
  }
  if (path === '/api/msp/orgs' && method === 'POST') {
    const body = jsonBody(options);
    const org = {
      id: uid('org'),
      name: body.name || 'Demo Org',
      slug: body.slug || null,
      brandName: body.brandName || body.name || 'Demo Org',
      brandPrimaryColor: body.brandPrimaryColor || '#667eea',
      brandLogoDataUrl: body.brandLogoDataUrl || null,
      brandWebsite: body.brandWebsite || null,
      brandEmail: body.brandEmail || null,
      createdAt: new Date().toISOString()
    };
    store.orgs.unshift(org);
    setDemoStore(store);
    return { organization: org };
  }

  const brandingMatch = path.match(/^\/api\/msp\/orgs\/([^/]+)\/branding$/);
  if (brandingMatch && method === 'PUT') {
    const orgId = brandingMatch[1];
    const body = jsonBody(options);
    const org = store.orgs.find((o) => o.id === orgId);
    if (!org) throw new Error('not_found');
    if ('brandName' in body) org.brandName = body.brandName;
    if ('brandPrimaryColor' in body) org.brandPrimaryColor = body.brandPrimaryColor;
    if ('brandLogoDataUrl' in body) org.brandLogoDataUrl = body.brandLogoDataUrl;
    if ('brandWebsite' in body) org.brandWebsite = body.brandWebsite;
    if ('brandEmail' in body) org.brandEmail = body.brandEmail;
    setDemoStore(store);
    return { organization: org };
  }

  // /api/msp/clients?organizationId=...
  const clientsMatch = path.match(/^\/api\/msp\/clients\?organizationId=([^&]+)$/);
  if (clientsMatch && method === 'GET') {
    const orgId = decodeURIComponent(clientsMatch[1]);
    return { clients: store.clients.filter((c) => c.organizationId === orgId) };
  }
  if (path === '/api/msp/clients' && method === 'POST') {
    const body = jsonBody(options);
    const client = {
      id: uid('client'),
      organizationId: body.organizationId,
      name: body.name,
      industry: body.industry || null,
      contactEmail: body.contactEmail || null,
      createdAt: new Date().toISOString()
    };
    store.clients.unshift(client);
    setDemoStore(store);
    return { client };
  }

  // /api/msp/projects?clientId=...
  const projectsMatch = path.match(/^\/api\/msp\/projects\?clientId=([^&]+)$/);
  if (projectsMatch && method === 'GET') {
    const clientId = decodeURIComponent(projectsMatch[1]);
    const projects = store.projects
      .filter((p) => p.clientId === clientId)
      .map((p) => ({ ...p, client: store.clients.find((c) => c.id === p.clientId) || null }));
    return { projects };
  }
  if (path === '/api/msp/projects' && method === 'POST') {
    const body = jsonBody(options);
    const project = {
      id: uid('project'),
      organizationId: body.organizationId,
      clientId: body.clientId,
      name: body.name,
      status: body.status || 'lead',
      intake: body.intake || {},
      createdAt: new Date().toISOString()
    };
    store.projects.unshift(project);
    setDemoStore(store);
    return { project: { ...project, client: store.clients.find((c) => c.id === project.clientId) || null } };
  }

  // /api/msp/proposals?projectId=...
  const proposalsMatch = path.match(/^\/api\/msp\/proposals\?projectId=([^&]+)$/);
  if (proposalsMatch && method === 'GET') {
    const projectId = decodeURIComponent(proposalsMatch[1]);
    const proposals = store.proposals
      .filter((p) => p.projectId === projectId)
      .sort((a, b) => (b.version || 0) - (a.version || 0));
    return { proposals };
  }
  if (path === '/api/msp/proposals' && method === 'POST') {
    const body = jsonBody(options);
    const versions = store.proposals.filter((p) => p.projectId === body.projectId).map((p) => p.version);
    const nextVersion = (versions.length ? Math.max(...versions) : 0) + 1;
    const proposal = {
      id: uid('proposal'),
      organizationId: body.organizationId,
      projectId: body.projectId,
      version: nextVersion,
      title: body.title || 'Proposal',
      status: 'draft',
      sentAt: null,
      data: body.data || {},
      createdAt: new Date().toISOString()
    };
    store.proposals.unshift(proposal);
    setDemoStore(store);
    return { proposal };
  }

  const versionMatch = path.match(/^\/api\/msp\/proposals\/([^/]+)\/versions$/);
  if (versionMatch && method === 'POST') {
    const baseId = versionMatch[1];
    const base = store.proposals.find((p) => p.id === baseId);
    if (!base) throw new Error('not_found');
    const body = jsonBody(options);
    const versions = store.proposals.filter((p) => p.projectId === base.projectId).map((p) => p.version);
    const nextVersion = (versions.length ? Math.max(...versions) : 0) + 1;
    const proposal = {
      id: uid('proposal'),
      organizationId: base.organizationId,
      projectId: base.projectId,
      version: nextVersion,
      title: body.title || base.title,
      status: 'draft',
      sentAt: null,
      data: body.data || base.data || {},
      createdAt: new Date().toISOString()
    };
    store.proposals.unshift(proposal);
    setDemoStore(store);
    return { proposal };
  }

  const sendMatch = path.match(/^\/api\/msp\/proposals\/([^/]+)\/send$/);
  if (sendMatch && method === 'POST') {
    const id = sendMatch[1];
    const proposal = store.proposals.find((p) => p.id === id);
    if (!proposal) throw new Error('not_found');
    proposal.status = 'sent';
    proposal.sentAt = proposal.sentAt || new Date().toISOString();
    setDemoStore(store);
    return { proposal };
  }

  throw new Error('not_implemented');
}

function splitLines(value) {
  return String(value || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function toDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file_read_failed'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

const state = {
  me: null,
  orgs: [],
  selectedOrgId: null,
  selectedOrgRole: null,
  selectedOrg: null,
  clients: [],
  selectedClientId: null,
  projects: [],
  selectedProjectId: null,
  proposals: [],
  selectedProposalId: null,
  selectedProposal: null,
  brandLogoDataUrl: undefined
};

function setDisabled(el, disabled) {
  if (!el) return;
  el.disabled = !!disabled;
}

function renderOrgSelect() {
  const sel = $('orgSelect');
  sel.innerHTML = '';
  if (!state.orgs.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No organizations yet — create one above';
    sel.appendChild(opt);
    $('orgRole').textContent = '-';
    return;
  }

  for (const o of state.orgs) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = `${o.name}${o.slug ? ` (${o.slug})` : ''}`;
    sel.appendChild(opt);
  }

  sel.value = state.selectedOrgId || state.orgs[0].id;
}

function renderBrandingForm() {
  const org = state.selectedOrg;
  $('brandName').value = org?.brandName || '';
  $('brandPrimaryColor').value = org?.brandPrimaryColor || '#667eea';
  $('brandWebsite').value = org?.brandWebsite || '';
  $('brandEmail').value = org?.brandEmail || '';
  state.brandLogoDataUrl = undefined; // only set when user picks a file
}

function renderClients() {
  const list = $('clientsList');
  list.innerHTML = '';

  const clientSelect = $('clientSelect');
  clientSelect.innerHTML = '';

  if (!state.clients.length) {
    list.innerHTML = `<div class="msp-muted">No clients yet.</div>`;
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Select a client…';
    clientSelect.appendChild(opt);
    state.selectedClientId = null;
    return;
  }

  for (const c of state.clients) {
    const row = document.createElement('div');
    row.className = 'msp-item';
    row.innerHTML = `
      <div>
        <div><strong>${c.name}</strong></div>
        <div class="meta">${[c.industry, c.contactEmail].filter(Boolean).join(' • ') || '—'}</div>
      </div>
      <div class="msp-actions">
        <button class="msp-btn secondary" data-client-id="${c.id}"><i class="fas fa-folder-open"></i> Use</button>
      </div>
    `;
    row.querySelector('button')?.addEventListener('click', () => {
      state.selectedClientId = c.id;
      $('clientSelect').value = c.id;
      loadProjects().catch(() => {});
    });
    list.appendChild(row);

    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    clientSelect.appendChild(opt);
  }

  if (!state.selectedClientId) state.selectedClientId = state.clients[0].id;
  clientSelect.value = state.selectedClientId;
}

function renderProjects() {
  const list = $('projectsList');
  list.innerHTML = '';

  const projectSelect = $('projectSelect');
  projectSelect.innerHTML = '';

  if (!state.projects.length) {
    list.innerHTML = `<div class="msp-muted">No projects yet.</div>`;
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Select a project…';
    projectSelect.appendChild(opt);
    state.selectedProjectId = null;
    return;
  }

  for (const p of state.projects) {
    const row = document.createElement('div');
    row.className = 'msp-item';
    row.innerHTML = `
      <div>
        <div><strong>${p.name}</strong></div>
        <div class="meta">${p.client?.name || '—'} • ${String(p.status || '').replaceAll('_', ' ')}</div>
      </div>
      <div class="msp-actions">
        <button class="msp-btn secondary" data-project-id="${p.id}"><i class="fas fa-file-signature"></i> Proposals</button>
      </div>
    `;
    row.querySelector('button')?.addEventListener('click', () => {
      state.selectedProjectId = p.id;
      $('projectSelect').value = p.id;
      loadProposals().catch(() => {});
    });
    list.appendChild(row);

    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.client?.name ? `${p.client.name} — ` : ''}${p.name}`;
    projectSelect.appendChild(opt);
  }

  if (!state.selectedProjectId) state.selectedProjectId = state.projects[0].id;
  projectSelect.value = state.selectedProjectId;
}

function renderProposals() {
  const list = $('proposalsList');
  list.innerHTML = '';

  if (!state.proposals.length) {
    list.innerHTML = `<div class="msp-muted">No proposals yet.</div>`;
    return;
  }

  for (const pr of state.proposals) {
    const row = document.createElement('div');
    row.className = 'msp-item';
    const sentMeta = pr.sentAt ? ` • Sent: ${new Date(pr.sentAt).toLocaleDateString()}` : '';
    row.innerHTML = `
      <div>
        <div><strong>v${pr.version}</strong> — ${pr.title}</div>
        <div class="meta">Status: ${String(pr.status || '').replaceAll('_', ' ')}${sentMeta}</div>
      </div>
      <div class="msp-actions">
        <button class="msp-btn secondary" data-edit="${pr.id}">
          <i class="fas fa-pen-to-square"></i> Edit
        </button>
        ${
          api._demo
            ? `<button class="msp-btn secondary" data-pdf="${pr.id}" title="PDF requires backend">
                <i class="fas fa-file-pdf"></i> PDF
              </button>`
            : `<a class="msp-btn secondary" href="/api/msp/proposals/${pr.id}/pdf" target="_blank" rel="noopener">
                <i class="fas fa-file-pdf"></i> PDF
              </a>`
        }
        <button class="msp-btn" data-send="${pr.id}" ${pr.status === 'sent' ? 'disabled' : ''}>
          <i class="fas fa-paper-plane"></i> Send
        </button>
      </div>
    `;
    row.querySelector('[data-edit]')?.addEventListener('click', () => {
      selectProposal(pr.id);
    });
    row.querySelector('[data-send]')?.addEventListener('click', () => {
      sendProposal(pr.id).catch(() => {});
    });
    row.querySelector('[data-pdf]')?.addEventListener('click', () => {
      showToast('PDF export requires the backend. This is a Netlify demo view.');
    });
    list.appendChild(row);
  }
}

function normalizeProposalData(raw) {
  const d = (raw && typeof raw === 'object') ? raw : {};
  const pricing = (d.pricing && typeof d.pricing === 'object') ? d.pricing : {};
  return {
    overview: typeof d.overview === 'string' ? d.overview : '',
    scope: Array.isArray(d.scope) ? d.scope : [],
    pricing: {
      currency: typeof pricing.currency === 'string' ? pricing.currency : '$',
      oneTime: typeof pricing.oneTime === 'number' ? pricing.oneTime : undefined,
      monthly: typeof pricing.monthly === 'number' ? pricing.monthly : undefined,
      notes: typeof pricing.notes === 'string' ? pricing.notes : undefined
    },
    assumptions: Array.isArray(d.assumptions) ? d.assumptions : [],
    nextSteps: Array.isArray(d.nextSteps) ? d.nextSteps : []
  };
}

function setSelectedProposalLabel() {
  const el = $('selectedProposalLabel');
  if (!el) return;
  if (!state.selectedProposal) {
    el.textContent = 'None';
    return;
  }
  el.textContent = `v${state.selectedProposal.version} — ${state.selectedProposal.title}`;
}

function setEditorButtonsEnabled() {
  const hasSelected = !!state.selectedProposalId;
  $('saveNewVersionBtn').disabled = !hasSelected;
  $('clearSelectedProposalBtn').disabled = !hasSelected;
  // Only owner/admin can send
  const canSend = hasSelected && (state.selectedOrgRole === 'owner' || state.selectedOrgRole === 'admin');
  $('sendProposalBtn').disabled = !canSend || state.selectedProposal?.status === 'sent';
}

function selectProposal(proposalId) {
  const pr = state.proposals.find((p) => p.id === proposalId) || null;
  state.selectedProposalId = pr?.id || null;
  state.selectedProposal = pr;
  setSelectedProposalLabel();
  setEditorButtonsEnabled();

  if (!pr) return;

  $('proposalTitle').value = pr.title || '';

  const d = normalizeProposalData(pr.data);
  $('proposalOverview').value = d.overview;
  $('proposalScope').value = (d.scope || []).join('\n');
  $('pricingCurrency').value = d.pricing.currency || '$';
  $('pricingOneTime').value = typeof d.pricing.oneTime === 'number' ? String(d.pricing.oneTime) : '';
  $('pricingMonthly').value = typeof d.pricing.monthly === 'number' ? String(d.pricing.monthly) : '';
  $('proposalAssumptions').value = (d.assumptions || []).join('\n');
  $('proposalNextSteps').value = (d.nextSteps || []).join('\n');

  showToast('Loaded proposal into editor. Edit fields and “Save as new version”.');
}

function clearSelectedProposal() {
  state.selectedProposalId = null;
  state.selectedProposal = null;
  setSelectedProposalLabel();
  setEditorButtonsEnabled();
}

async function loadMe() {
  const me = await api('/api/me');
  state.me = me;
  $('whoami').querySelector('span').textContent = `${me.user.name} (${me.user.email})`;
}

async function loadOrgs() {
  const res = await api('/api/msp/orgs');
  state.orgs = res.organizations || [];
  if (!state.selectedOrgId && state.orgs.length) state.selectedOrgId = state.orgs[0].id;
  state.selectedOrg = state.orgs.find((o) => o.id === state.selectedOrgId) || null;
  state.selectedOrgRole = state.selectedOrg?.role || null;
  $('orgRole').textContent = state.selectedOrgRole || '-';
  renderOrgSelect();
  renderBrandingForm();
  setEditorButtonsEnabled();
}

async function loadClients() {
  if (!state.selectedOrgId) return;
  const res = await api(`/api/msp/clients?organizationId=${encodeURIComponent(state.selectedOrgId)}`);
  state.clients = res.clients || [];
  if (!state.selectedClientId && state.clients.length) state.selectedClientId = state.clients[0].id;
  renderClients();
}

async function loadProjects() {
  if (!state.selectedOrgId) return;
  const clientId = $('clientSelect').value;
  state.selectedClientId = clientId || null;

  if (!clientId) {
    state.projects = [];
    renderProjects();
    return;
  }

  const res = await api(`/api/msp/projects?clientId=${encodeURIComponent(clientId)}`);
  state.projects = res.projects || [];
  if (!state.selectedProjectId && state.projects.length) state.selectedProjectId = state.projects[0].id;
  renderProjects();
}

async function loadProposals() {
  const projectId = $('projectSelect').value;
  state.selectedProjectId = projectId || null;
  if (!projectId) {
    state.proposals = [];
    renderProposals();
    return;
  }
  const res = await api(`/api/msp/proposals?projectId=${encodeURIComponent(projectId)}`);
  state.proposals = res.proposals || [];
  if (state.selectedProposalId && !state.proposals.some((p) => p.id === state.selectedProposalId)) {
    clearSelectedProposal();
  } else if (state.selectedProposalId) {
    state.selectedProposal = state.proposals.find((p) => p.id === state.selectedProposalId) || null;
    setSelectedProposalLabel();
    setEditorButtonsEnabled();
  }
  renderProposals();
}

async function onCreateOrg() {
  const name = $('newOrgName').value.trim();
  const slug = $('newOrgSlug').value.trim();
  if (!name) return showToast('Please enter an organization name.');
  setDisabled($('createOrgBtn'), true);
  try {
    const org = await api('/api/msp/orgs', {
      method: 'POST',
      body: JSON.stringify({
        name,
        slug: slug || undefined,
        brandName: name,
        brandPrimaryColor: '#667eea'
      })
    });
    showToast('Organization created.');
    $('newOrgName').value = '';
    $('newOrgSlug').value = '';
    await loadOrgs();
    state.selectedOrgId = org.organization.id;
    $('orgSelect').value = state.selectedOrgId;
    await onOrgChanged();
  } catch (e) {
    console.error(e);
    showToast(`Failed to create org: ${e.message}`);
  } finally {
    setDisabled($('createOrgBtn'), false);
  }
}

async function onOrgChanged() {
  state.selectedOrgId = $('orgSelect').value || null;
  state.selectedOrg = state.orgs.find((o) => o.id === state.selectedOrgId) || null;
  state.selectedOrgRole = state.selectedOrg?.role || null;
  $('orgRole').textContent = state.selectedOrgRole || '-';
  renderBrandingForm();
  await loadClients();
  await loadProjects();
  await loadProposals();
}

async function onSaveBranding() {
  if (!state.selectedOrgId) return;
  setDisabled($('saveBrandingBtn'), true);
  try {
    const payload = {
      brandName: $('brandName').value.trim() || null,
      brandPrimaryColor: $('brandPrimaryColor').value.trim() || null,
      brandWebsite: $('brandWebsite').value.trim() || null,
      brandEmail: $('brandEmail').value.trim() || null
    };
    if (state.brandLogoDataUrl !== undefined) {
      payload.brandLogoDataUrl = state.brandLogoDataUrl;
    }
    await api(`/api/msp/orgs/${encodeURIComponent(state.selectedOrgId)}/branding`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast('Branding saved.');
    await loadOrgs();
  } catch (e) {
    console.error(e);
    showToast(`Branding save failed: ${e.message}`);
  } finally {
    setDisabled($('saveBrandingBtn'), false);
  }
}

async function onCreateClient() {
  if (!state.selectedOrgId) return showToast('Create/select an organization first.');
  const name = $('clientName').value.trim();
  if (!name) return showToast('Please enter a client name.');
  setDisabled($('createClientBtn'), true);
  try {
    await api('/api/msp/clients', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: state.selectedOrgId,
        name,
        industry: $('clientIndustry').value.trim() || undefined,
        contactEmail: $('clientEmail').value.trim() || undefined
      })
    });
    $('clientName').value = '';
    $('clientIndustry').value = '';
    $('clientEmail').value = '';
    showToast('Client added.');
    await loadClients();
    await loadProjects();
  } catch (e) {
    console.error(e);
    showToast(`Failed to add client: ${e.message}`);
  } finally {
    setDisabled($('createClientBtn'), false);
  }
}

async function onCreateProject() {
  if (!state.selectedOrgId) return showToast('Create/select an organization first.');
  const clientId = $('clientSelect').value;
  if (!clientId) return showToast('Select a client first.');
  const name = $('projectName').value.trim();
  if (!name) return showToast('Please enter a project name.');
  setDisabled($('createProjectBtn'), true);
  try {
    await api('/api/msp/projects', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: state.selectedOrgId,
        clientId,
        name,
        status: $('projectStatus').value
      })
    });
    $('projectName').value = '';
    showToast('Project added.');
    await loadProjects();
  } catch (e) {
    console.error(e);
    showToast(`Failed to add project: ${e.message}`);
  } finally {
    setDisabled($('createProjectBtn'), false);
  }
}

async function onCreateProposal() {
  if (!state.selectedOrgId) return showToast('Create/select an organization first.');
  const projectId = $('projectSelect').value;
  if (!projectId) return showToast('Select a project first.');
  const title = $('proposalTitle').value.trim() || 'Proposal';

  const pricingOneTime = $('pricingOneTime').value.trim();
  const pricingMonthly = $('pricingMonthly').value.trim();
  const oneTime = pricingOneTime ? Number(pricingOneTime) : undefined;
  const monthly = pricingMonthly ? Number(pricingMonthly) : undefined;

  const data = {
    overview: $('proposalOverview').value.trim(),
    scope: splitLines($('proposalScope').value),
    pricing: {
      currency: $('pricingCurrency').value.trim() || '$',
      oneTime: Number.isFinite(oneTime) ? oneTime : undefined,
      monthly: Number.isFinite(monthly) ? monthly : undefined
    },
    assumptions: splitLines($('proposalAssumptions').value),
    nextSteps: splitLines($('proposalNextSteps').value)
  };

  setDisabled($('createProposalBtn'), true);
  try {
    await api('/api/msp/proposals', {
      method: 'POST',
      body: JSON.stringify({
        organizationId: state.selectedOrgId,
        projectId,
        title,
        data
      })
    });
    showToast('Proposal created.');
    await loadProposals();
  } catch (e) {
    console.error(e);
    showToast(`Failed to create proposal: ${e.message}`);
  } finally {
    setDisabled($('createProposalBtn'), false);
  }
}

async function onSaveAsNewVersion() {
  if (!state.selectedProposalId) return showToast('Select a proposal (Edit) first.');

  const title = $('proposalTitle').value.trim() || (state.selectedProposal?.title || 'Proposal');

  const pricingOneTime = $('pricingOneTime').value.trim();
  const pricingMonthly = $('pricingMonthly').value.trim();
  const oneTime = pricingOneTime ? Number(pricingOneTime) : undefined;
  const monthly = pricingMonthly ? Number(pricingMonthly) : undefined;

  const data = {
    overview: $('proposalOverview').value.trim(),
    scope: splitLines($('proposalScope').value),
    pricing: {
      currency: $('pricingCurrency').value.trim() || '$',
      oneTime: Number.isFinite(oneTime) ? oneTime : undefined,
      monthly: Number.isFinite(monthly) ? monthly : undefined
    },
    assumptions: splitLines($('proposalAssumptions').value),
    nextSteps: splitLines($('proposalNextSteps').value)
  };

  setDisabled($('saveNewVersionBtn'), true);
  try {
    const r = await api(`/api/msp/proposals/${encodeURIComponent(state.selectedProposalId)}/versions`, {
      method: 'POST',
      body: JSON.stringify({ title, data })
    });
    showToast('New version created.');
    await loadProposals();
    if (r?.proposal?.id) selectProposal(r.proposal.id);
  } catch (e) {
    console.error(e);
    showToast(`Failed to create new version: ${e.message}`);
  } finally {
    setDisabled($('saveNewVersionBtn'), false);
    setEditorButtonsEnabled();
  }
}

async function sendProposal(proposalId) {
  const id = proposalId || state.selectedProposalId;
  if (!id) return showToast('Select a proposal to send.');
  if (!confirm('Mark this proposal as sent?')) return;

  setDisabled($('sendProposalBtn'), true);
  try {
    await api(`/api/msp/proposals/${encodeURIComponent(id)}/send`, { method: 'POST', body: '{}' });
    showToast('Proposal marked as sent.');
    await loadProposals();
  } catch (e) {
    console.error(e);
    if (e.message === 'forbidden') showToast('Only org owners/admins can send proposals.');
    else showToast(`Send failed: ${e.message}`);
    throw e;
  } finally {
    setEditorButtonsEnabled();
  }
}

async function onLogout() {
  setDisabled($('logoutBtn'), true);
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {}
  window.location.href = 'landing.html';
}

async function boot() {
  const demoParam = new URLSearchParams(window.location.search).get('demo');
  const demoPersisted = (() => {
    try { return localStorage.getItem('mspDemoMode') === '1'; } catch { return false; }
  })();
  if (demoParam === '1' || demoPersisted) enableDemoMode();

  try {
    await loadMe();
  } catch {
    // No backend available (Netlify preview) → demo mode
    enableDemoMode();
    await loadMe();
  }

  await loadOrgs();
  renderOrgSelect();

  $('orgSelect').addEventListener('change', () => onOrgChanged().catch(() => {}));
  $('refreshOrgsBtn').addEventListener('click', () => loadOrgs().then(onOrgChanged).catch(() => {}));
  $('createOrgBtn').addEventListener('click', () => onCreateOrg().catch(() => {}));

  $('saveBrandingBtn').addEventListener('click', () => onSaveBranding().catch(() => {}));
  $('clearLogoBtn').addEventListener('click', () => {
    $('brandLogoFile').value = '';
    state.brandLogoDataUrl = null; // explicit clear
    showToast('Logo cleared (will save on next "Save Branding").');
  });
  $('brandLogoFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) {
      state.brandLogoDataUrl = undefined;
      return;
    }
    try {
      state.brandLogoDataUrl = await toDataUrl(file);
      showToast('Logo loaded (remember to "Save Branding").');
    } catch {
      showToast('Failed to read logo file.');
    }
  });

  $('createClientBtn').addEventListener('click', () => onCreateClient().catch(() => {}));
  $('clientSelect').addEventListener('change', () => loadProjects().catch(() => {}));

  $('createProjectBtn').addEventListener('click', () => onCreateProject().catch(() => {}));
  $('refreshProjectsBtn').addEventListener('click', () => loadProjects().catch(() => {}));

  $('projectSelect').addEventListener('change', () => loadProposals().catch(() => {}));
  $('createProposalBtn').addEventListener('click', () => onCreateProposal().catch(() => {}));
  $('saveNewVersionBtn').addEventListener('click', () => onSaveAsNewVersion().catch(() => {}));
  $('sendProposalBtn').addEventListener('click', () => sendProposal().catch(() => {}));
  $('clearSelectedProposalBtn').addEventListener('click', () => clearSelectedProposal());
  $('refreshProposalsBtn').addEventListener('click', () => loadProposals().catch(() => {}));

  $('logoutBtn').addEventListener('click', () => onLogout().catch(() => {}));

  await onOrgChanged();
  clearSelectedProposal();
  showToast('MSP dashboard ready.');
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((e) => {
    console.error(e);
    showToast('Failed to initialize MSP dashboard.');
  });
});

