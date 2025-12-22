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
    row.innerHTML = `
      <div>
        <div><strong>v${pr.version}</strong> — ${pr.title}</div>
        <div class="meta">Status: ${String(pr.status || '').replaceAll('_', ' ')}</div>
      </div>
      <div class="msp-actions">
        <a class="msp-btn secondary" href="/api/msp/proposals/${pr.id}/pdf" target="_blank" rel="noopener">
          <i class="fas fa-file-pdf"></i> PDF
        </a>
      </div>
    `;
    list.appendChild(row);
  }
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

async function onLogout() {
  setDisabled($('logoutBtn'), true);
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {}
  window.location.href = 'landing.html';
}

async function boot() {
  try {
    await loadMe();
  } catch {
    window.location.href = 'login.html';
    return;
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
  $('refreshProposalsBtn').addEventListener('click', () => loadProposals().catch(() => {}));

  $('logoutBtn').addEventListener('click', () => onLogout().catch(() => {}));

  await onOrgChanged();
  showToast('MSP dashboard ready.');
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((e) => {
    console.error(e);
    showToast('Failed to initialize MSP dashboard.');
  });
});

