// ════════════════════════════════════════════════
// ⚙️  CONFIG
// ════════════════════════════════════════════════
const SUPABASE_URL     = 'https://lmblgotwdbpkobstftxn.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtYmxnb3R3ZGJwa29ic3RmdHhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDMxOTQsImV4cCI6MjA5MDQ3OTE5NH0.fLDICEceTqZCFCgzII572vyaYuPU_9cDnkm0ICwdjV8';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.sessionStorage,
  },
});
// ════════════════════════════════════════════════

// ── ROUTING : token dans l'URL → formulaire témoignage ──
const _params = new URLSearchParams(window.location.search);
const _token  = _params.get('token');

if (_token) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('testimonial-screen').style.display = 'flex';
  initTestimonial(_token);
} else {
  document.getElementById('testimonial-screen').style.display = 'none';
}

// ════════════════════════════════════════════════
// FORMULAIRE TÉMOIGNAGE
// ════════════════════════════════════════════════
let _rating = 0;
let _invitation = null;

function tShow(id) {
  ['t-form','t-success','t-invalid','t-loading'].forEach(x => {
    document.getElementById(x).style.display = x === id ? 'block' : 'none';
  });
}

async function initTestimonial(token) {
  tShow('t-loading');
  try {
    const { data, error } = await supabaseClient.functions.invoke('get-testimonial-invitation', {
      body: { token }
    });
    if (error || !data?.invitation || data.invitation.used) { tShow('t-invalid'); return; }
    _invitation = data.invitation;

    // Charger le prénom du sitter
    try {
      if (_invitation.sitter?.first_name) {
        document.getElementById('t-subtitle').textContent = `Partage ton expérience avec ${_invitation.sitter.first_name} !`;
      }
    } catch(e) {}

    tShow('t-form');
  } catch(e) {
    tShow('t-invalid');
  }
}

function setRating(v) {
  _rating = v;
  document.querySelectorAll('.star-btn').forEach(s => {
    s.classList.toggle('on', parseInt(s.dataset.v) <= v);
  });
}

async function submitTestimonial() {
  const first_name    = document.getElementById('t-first').value.trim();
  const last_name     = document.getElementById('t-last').value.trim();
  const comment       = document.getElementById('t-comment').value.trim();
  const animal_species = document.getElementById('t-species').value.trim();
  const animal_age    = document.getElementById('t-age').value || null;
  const animal_weight = document.getElementById('t-weight').value || null;
  const errEl         = document.getElementById('t-error');

  if (!first_name || !last_name || !comment || !animal_species || _rating === 0) {
    errEl.textContent = '⚠️ Remplis tous les champs obligatoires et choisis une note.';
    return;
  }
  errEl.textContent = '';

  const btn = document.getElementById('t-btn');
  btn.disabled = true;
  btn.textContent = 'Envoi en cours...';

  try {
    const { error } = await supabaseClient.functions.invoke('submit-external-review', {
      body: {
        token: _token,
        firstName: first_name,
        lastName: last_name,
        comment,
        rating: _rating,
        animalSpecies: animal_species,
        animalAge: animal_age,
        animalWeight: animal_weight,
      }
    });
    if (error) throw error;

    tShow('t-success');
  } catch(e) {
    errEl.textContent = 'Erreur lors de l\'envoi. Réessaie.';
    btn.disabled = false;
    btn.textContent = 'Envoyer mon avis ✅';
  }
}

// ════════════════════════════════════════════════
// ADMIN
// ════════════════════════════════════════════════
let allVerifications = [], allReports = [], allBetaFeedback = [];
let verifFilter = 'all', reportFilter = 'all', betaFilter = 'all';
let currentVerifId = null, currentReportId = null, currentBetaId = null;
let pendingMfaFactorId = null;

function setLoginError(message = '') {
  const error = document.getElementById('login-error');
  error.textContent = message;
  error.style.display = message ? 'block' : 'none';
}

async function adminAction(action, body = {}) {
  const { data, error } = await supabaseClient.functions.invoke('admin-moderation', {
    body: { action, ...body }
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function showAdminApp(email) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('admin-login').textContent = email || 'Administrateur';
  refreshAll();
}

async function doLogin() {
  const email = document.getElementById('admin-email-input').value.trim().toLowerCase();
  const password = document.getElementById('pw-input').value;
  setLoginError();

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    document.getElementById('pw-input').value = '';
    if (error || !data.session) throw error || new Error('Connexion impossible');
  } catch(e) {
    setLoginError('Adresse email ou mot de passe incorrect.');
    document.getElementById('pw-input').value = '';
    return;
  }

  try {
    await prepareMfa();
  } catch (error) {
    setLoginError('Connexion réussie, mais la double authentification n’a pas pu être préparée. Réessaie dans un instant.');
  }
}
document.getElementById('pw-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('admin-email-input').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('mfa-code').addEventListener('keydown', e => { if (e.key === 'Enter') verifyMfaCode(); });

async function prepareMfa() {
  setLoginError();
  const { data: assurance, error: assuranceError } = await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw assuranceError;

  if (assurance.currentLevel === 'aal2') {
    await finishSecureLogin();
    return;
  }

  const { data: factorsData, error: factorsError } = await supabaseClient.auth.mfa.listFactors();
  if (factorsError) throw factorsError;
  const factors = factorsData?.totp || [];
  const verifiedFactor = factors.find(factor => factor.status === 'verified');

  document.getElementById('credentials-panel').style.display = 'none';
  document.getElementById('mfa-panel').style.display = 'block';
  document.getElementById('mfa-code').value = '';

  if (verifiedFactor) {
    pendingMfaFactorId = verifiedFactor.id;
    document.getElementById('mfa-title').textContent = 'Code de sécurité';
    document.getElementById('mfa-help').textContent = 'Entre le code à six chiffres de ton application d’authentification.';
    document.getElementById('mfa-qr').style.display = 'none';
    document.getElementById('mfa-secret').style.display = 'none';
    document.getElementById('mfa-code').focus();
    return;
  }

  for (const factor of factors.filter(item => item.status !== 'verified')) {
    await supabaseClient.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data: enrollment, error: enrollError } = await supabaseClient.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'FenuaPet Administration',
    issuer: 'FenuaPet',
  });
  if (enrollError || !enrollment?.id || !enrollment?.totp?.qr_code || !enrollment?.totp?.secret) {
    throw enrollError || new Error('Configuration MFA impossible');
  }

  pendingMfaFactorId = enrollment.id;
  document.getElementById('mfa-title').textContent = 'Configurer la double authentification';
  document.getElementById('mfa-help').textContent = 'Scanne ce QR code avec Google Authenticator, Microsoft Authenticator ou 1Password, puis entre le code affiché.';
  const qr = document.getElementById('mfa-qr');
  qr.src = enrollment.totp.qr_code;
  qr.style.display = 'block';
  const secret = document.getElementById('mfa-secret');
  secret.textContent = `Clé manuelle : ${enrollment.totp.secret}`;
  secret.style.display = 'block';
  document.getElementById('mfa-code').focus();
}

async function verifyMfaCode() {
  const code = document.getElementById('mfa-code').value.replace(/\D/g, '').slice(0, 6);
  setLoginError();
  if (!pendingMfaFactorId || code.length !== 6) {
    setLoginError('Entre le code de sécurité à six chiffres.');
    return;
  }

  try {
    const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({
      factorId: pendingMfaFactorId,
    });
    if (challengeError || !challenge?.id) throw challengeError || new Error('Challenge MFA impossible');

    const { error: verifyError } = await supabaseClient.auth.mfa.verify({
      factorId: pendingMfaFactorId,
      challengeId: challenge.id,
      code,
    });
    if (verifyError) throw verifyError;
    await finishSecureLogin();
  } catch (_) {
    document.getElementById('mfa-code').value = '';
    setLoginError('Code incorrect ou expiré. Réessaie avec le nouveau code affiché.');
  }
}

async function finishSecureLogin() {
  const sessionData = await adminAction('getSession');
  pendingMfaFactorId = null;
  showAdminApp(sessionData.admin?.email);
}

async function doLogout() {
  await supabaseClient.auth.signOut();
  pendingMfaFactorId = null;
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  document.getElementById('credentials-panel').style.display = 'block';
  document.getElementById('mfa-panel').style.display = 'none';
  document.getElementById('pw-input').value = '';
  document.getElementById('mfa-code').value = '';
  setLoginError();
}

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  el.classList.add('active');
}
function jumpToPage(name) {
  const nav = [...document.querySelectorAll('.nav-item')].find(item => item.getAttribute('onclick')?.includes(`'${name}'`));
  if (nav) showPage(name, nav);
}
async function refreshAll() {
  document.getElementById('dash-spin')?.classList.add('spinning');
  await Promise.all([loadVerifications(), loadReports(), loadBetaFeedback()]);
  updateDashboard();
  document.getElementById('dash-spin')?.classList.remove('spinning');
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function fmtMoney(value) {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  if (Number.isNaN(amount)) return '—';
  return `${amount.toLocaleString('fr-FR')} XPF`;
}
function serviceLabel(value) {
  const map = {
    overnight: 'Nuit',
    boarding: 'Hébergement',
    home_sitting: 'Garde à domicile',
    visit: 'Visite',
    walk: 'Promenade',
    daycare: 'Garde de jour',
  };
  return map[value] || value || '—';
}
function userDetailsCard(title, user) {
  if (!user) return `<div class="detail-card"><div class="detail-title">${title}</div><div class="detail-line">Aucun utilisateur trouvé</div></div>`;
  return `
    <div class="detail-card">
      <div class="detail-title">${title}</div>
      <div class="detail-line"><strong>${escapeHtml(user.full_name || 'Sans nom')}</strong></div>
      <div class="detail-line">${escapeHtml(user.email || 'Email inconnu')}</div>
      <div class="detail-line">Téléphone : ${escapeHtml(user.phone || '—')}</div>
      <div class="detail-line">Île : ${escapeHtml(user.island || '—')}</div>
      <div class="detail-line">Note : ${user.avg_rating ?? '—'} (${user.total_reviews || 0} avis)</div>
      <div class="detail-line">Identité : ${escapeHtml(user.identity_status || '—')}</div>
      ${user.is_suspended ? '<div class="detail-line" style="color:var(--danger);"><strong>Compte suspendu</strong></div>' : ''}
    </div>
  `;
}
function mediaCard(item, label) {
  const deleted = !!item.deleted_at;
  const url = escapeHtml(item.url || '');
  const type = item.type === 'video' ? 'Vidéo' : 'Photo';
  const date = fmtDate(item.taken_at || item.created_at);
  if (deleted || !url) {
    return `
      <div class="media-card">
        <div class="media-deleted">${deleted ? 'Média supprimé' : 'Média indisponible'}</div>
        <div class="media-meta">${escapeHtml(label)} · ${type}<br>${date}</div>
      </div>
    `;
  }
  return `
    <div class="media-card">
      <a href="${url}" target="_blank" rel="noopener">
        ${item.type === 'video'
          ? `<video src="${url}" controls></video>`
          : `<img src="${url}" alt="${escapeHtml(label)}" />`}
      </a>
      <div class="media-meta">${escapeHtml(label)} · ${type}<br>${date}</div>
    </div>
  `;
}
function mediaSection(title, items, label) {
  const list = items || [];
  return `
    <div class="detail-card full">
      <div class="detail-title">${title} (${list.length})</div>
      ${list.length
        ? `<div class="media-grid">${list.map(item => mediaCard(item, label)).join('')}</div>`
        : '<div class="detail-line">Aucun média trouvé</div>'}
    </div>
  `;
}
function walkMapUrl(walk) {
  const points = walk.sample_points || [];
  if (!points.length && !walk.first_point) return '';
  const first = points[0] || walk.first_point;
  const last = points[points.length - 1] || walk.last_point || first;
  if (!first?.lat || !first?.lng) return '';
  if (!last?.lat || !last?.lng || first === last) {
    return `https://www.google.com/maps/search/?api=1&query=${first.lat},${first.lng}`;
  }
  const middle = points.slice(1, -1).filter(point => point?.lat && point?.lng).slice(0, 8);
  const waypoints = middle.length ? `&waypoints=${encodeURIComponent(middle.map(point => `${point.lat},${point.lng}`).join('|'))}` : '';
  return `https://www.google.com/maps/dir/?api=1&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}${waypoints}`;
}
function walkSection(walks) {
  const list = walks || [];
  return `
    <div class="detail-card full">
      <div class="detail-title">Trajets GPS (${list.length})</div>
      ${list.length ? list.map(walk => {
        const url = walkMapUrl(walk);
        return `
          <div class="walk-card">
            <div class="detail-line"><strong>${escapeHtml(walk.status || 'Trajet')}</strong> · ${fmtDate(walk.started_at)} → ${fmtDate(walk.ended_at)}</div>
            <div class="detail-line">Distance : ${Math.round(walk.distance_meters || 0)} m · Durée : ${Math.round((walk.duration_seconds || 0) / 60)} min · Points : ${walk.points_count || 0}</div>
            <div class="detail-line">Conservation : ${walk.points_deleted_at ? 'points supprimés' : 'points conservés'}</div>
            ${url ? `<a class="map-link" href="${escapeHtml(url)}" target="_blank" rel="noopener">Voir sur la carte</a>` : ''}
          </div>
        `;
      }).join('') : '<div class="detail-line">Aucun trajet GPS trouvé</div>'}
    </div>
  `;
}
function petsSection(pets) {
  const list = pets || [];
  return `
    <div class="detail-card full">
      <div class="detail-title">Animaux concernés (${list.length})</div>
      ${list.length ? `<div class="pet-list">${list.map(pet => `
        <div class="pet-card">
          ${pet.photo_url ? `<img src="${escapeHtml(pet.photo_url)}" alt="${escapeHtml(pet.name || 'Animal')}" />` : ''}
          <div class="detail-line"><strong>${escapeHtml(pet.name || 'Animal')}</strong></div>
          <div class="detail-line">${escapeHtml([pet.species, pet.breed].filter(Boolean).join(' · ') || 'Espèce inconnue')}</div>
          <div class="detail-line">Âge : ${pet.age ?? '—'} · Poids : ${pet.weight ?? '—'} kg</div>
          ${pet.notes ? `<div class="detail-line">Notes : ${escapeHtml(pet.notes)}</div>` : ''}
          ${(pet.reviews || []).map(review => `
            <div class="detail-line" style="margin-top:6px;">Avis : ${review.rating_global ?? '—'}/5${review.comment ? ` · ${escapeHtml(review.comment)}` : ''}</div>
          `).join('')}
        </div>
      `).join('')}</div>` : '<div class="detail-line">Aucun animal trouvé</div>'}
    </div>
  `;
}
function logbookSection(entries) {
  const list = entries || [];
  return `
    <div class="detail-card full">
      <div class="detail-title">Carnet de route (${list.length})</div>
      ${list.length ? list.map(entry => `
        <div class="walk-card">
          <div class="detail-line"><strong>${escapeHtml(entry.moment || 'Entrée')}</strong> · ${fmtDate(entry.created_at)}</div>
          <div class="detail-line">Repas : ${escapeHtml(entry.meal_status || '—')} · Humeur : ${escapeHtml(entry.mood || '—')} · Sorties : ${entry.outing_count ?? '—'}</div>
          ${entry.notes ? `<div class="detail-line">Notes : ${escapeHtml(entry.notes)}</div>` : ''}
          ${(entry.photos || []).length ? `<div class="media-grid" style="margin-top:8px;">${entry.photos.map(photo => mediaCard(photo, 'Carnet')).join('')}</div>` : ''}
        </div>
      `).join('') : '<div class="detail-line">Aucune entrée de carnet trouvée</div>'}
    </div>
  `;
}
function missionDetailsHtml(report) {
  const booking = report?.booking;
  const details = report?.mission_details;
  if (!booking || !details) {
    return '<div class="detail-card"><div class="detail-line">Aucune mission liée à ce signalement.</div></div>';
  }
  const service = details.service || {};
  return `
    <div class="mission-grid">
      <div class="detail-card">
        <div class="detail-title">Réservation</div>
        <div class="detail-line">Statut : <strong>${escapeHtml(booking.status || '—')}</strong></div>
        <div class="detail-line">Dates : ${fmtDate(booking.start_date)} → ${fmtDate(booking.end_date)}</div>
        <div class="detail-line">Montant : ${fmtMoney(booking.total_amount)} · Paiement : ${escapeHtml(booking.payment_status || '—')}</div>
        <div class="detail-line">Lieu : ${escapeHtml(booking.location_type || '—')}</div>
        ${booking.notes ? `<div class="detail-line">Notes : ${escapeHtml(booking.notes)}</div>` : ''}
      </div>
      <div class="detail-card">
        <div class="detail-title">Service</div>
        <div class="detail-line">Type : <strong>${escapeHtml(serviceLabel(service.type))}</strong></div>
        <div class="detail-line">Lieu service : ${escapeHtml(service.location_type || '—')}</div>
        <div class="detail-line">Prix : ${fmtMoney(service.price_per_day)} · Animal sup. : ${fmtMoney(service.extra_animal_price)}</div>
        ${service.description ? `<div class="detail-line">Description : ${escapeHtml(service.description)}</div>` : ''}
      </div>
      ${userDetailsCard('Propriétaire', details.owner)}
      ${userDetailsCard('Petsitter', details.sitter)}
      ${petsSection(details.pets)}
      ${mediaSection('Preuves de mission', details.mission_proofs, 'Mission')}
      ${mediaSection('Médias de discussion', details.chat_media, 'Discussion')}
      ${logbookSection(details.logbook_entries)}
      ${walkSection(details.walk_trackings)}
    </div>
  `;
}
function chipVerif(status) {
  const map = { pending: ['chip-pending','⏳ En attente'], approved: ['chip-approved','✅ Approuvé'], verified: ['chip-approved','✅ Approuvé'], rejected: ['chip-rejected','❌ Refusé'] };
  const [cls, label] = map[status] || ['chip-pending', status];
  return `<span class="chip ${cls}">${label}</span>`;
}
function chipReport(status) {
  const map = { open: ['chip-open','🚨 Ouvert'], resolved: ['chip-resolved','✅ Résolu'], dismissed: ['chip-dismissed','— Ignoré'], warned: ['chip-warned','⚠️ Averti'], suspended: ['chip-suspended','🔴 Suspendu'] };
  const [cls, label] = map[status] || ['chip-open', status];
  return `<span class="chip ${cls}">${label}</span>`;
}
function chipBeta(status) {
  const map = { open: ['chip-open','Ouvert'], in_progress: ['chip-warned','En cours'], resolved: ['chip-resolved','Traité'], dismissed: ['chip-dismissed','Ignoré'] };
  const [cls, label] = map[status] || ['chip-open', status];
  return `<span class="chip ${cls}">${label}</span>`;
}
function betaStatus(item) {
  return ['open', 'in_progress', 'resolved', 'dismissed'].includes(item?.status) ? item.status : 'open';
}
function betaCategoryLabel(category) {
  const map = { bug: 'Bug', ux: 'Design / UX', booking: 'Réservation', payment: 'Paiement', notification: 'Notification', idea: 'Idée', other: 'Autre' };
  return map[category] || category || 'Autre';
}
function deviceSummary(item) {
  const info = item?.device_info || {};
  const version = info.version ? ` ${info.version}` : '';
  const app = item?.app_version ? ` · v${item.app_version}` : '';
  return `${item?.platform || info.os || 'app'}${version}${app}`;
}
function reportStatus(report) {
  return report?.status === 'pending' ? 'open' : report?.status;
}
function retentionBadge(report) {
  if (!report?.booking_id) return '<span class="chip chip-dismissed">— Non liée</span>';
  if (report.retention?.frozen) return '<span class="chip chip-warned">🔒 Preuves gelées</span>';
  return '<span class="chip chip-resolved">✅ Rétention normale</span>';
}
function retentionDetails(report) {
  const retention = report?.retention || {};
  const booking = report?.booking;
  const cls = retention.frozen ? 'frozen' : 'normal';
  const title = retention.frozen ? '🔒 Conservation gelée' : report?.booking_id ? '✅ Rétention automatique normale' : '— Aucune réservation liée';
  const text = retention.reason || (report?.booking_id ? 'Les règles de suppression automatique suivent leur cycle normal.' : 'Ce signalement ne bloque pas de preuves de mission.');
  const mediaCount = retention.retained_media_count || 0;
  const walkCount = retention.retained_walk_tracks || 0;
  return `
    <div class="retention-box ${cls}">
      <div class="retention-title">${title}</div>
      <div class="retention-text">${text}</div>
      ${booking ? `<div class="retention-text" style="margin-top:6px;">Mission : ${booking.status || '—'} · ${fmtDate(booking.start_date)} → ${fmtDate(booking.end_date)}</div>` : ''}
      <div class="retention-grid">
        <div class="retention-stat"><span>Preuves mission</span><strong>${retention.mission_proofs || 0}</strong></div>
        <div class="retention-stat"><span>Carnet</span><strong>${retention.logbook_media || 0}</strong></div>
        <div class="retention-stat"><span>Discussion</span><strong>${retention.chat_media || 0}</strong></div>
        <div class="retention-stat"><span>Trajets GPS</span><strong>${walkCount}</strong></div>
      </div>
      <div class="retention-text" style="margin-top:8px;">Total média conservé : ${mediaCount}</div>
    </div>
  `;
}

async function loadVerifications() {
  document.getElementById('verif-spin').classList.add('spinning');
  try {
    const data = await adminAction('listVerifications');
    allVerifications = data.verifications || [];
    renderVerifications(); updateVerifStats(); updateBadges(); updateDashboard();
  } catch(e) {
    document.getElementById('verif-tbody').innerHTML = `<tr><td colspan="4" style="padding:32px;text-align:center;color:var(--danger);">❌ Erreur : ${e.message}</td></tr>`;
  }
  document.getElementById('verif-spin').classList.remove('spinning');
}

function updateVerifStats() {
  document.getElementById('s-pending').textContent  = allVerifications.filter(v => v.status === 'pending').length;
  document.getElementById('s-approved').textContent = allVerifications.filter(v => v.status === 'approved' || v.status === 'verified').length;
  document.getElementById('s-rejected').textContent = allVerifications.filter(v => v.status === 'rejected').length;
  document.getElementById('s-total').textContent    = allVerifications.length;
}
function setVerifFilter(f, el) {
  verifFilter = f;
  document.querySelectorAll('#page-verifications .filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active'); renderVerifications();
}
function filterVerifications() { renderVerifications(); }
function renderVerifications() {
  const search = document.getElementById('verif-search').value.toLowerCase();
  const data = allVerifications.filter(v => {
    const matchFilter = verifFilter === 'all' || v.status === verifFilter || (verifFilter === 'approved' && v.status === 'verified');
    const matchSearch = !search || v.full_name.toLowerCase().includes(search) || v.email.toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });
  const tbody = document.getElementById('verif-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">Aucune vérification trouvée</td></tr>'; return; }
  tbody.innerHTML = data.map(v => `
    <tr>
      <td><div class="user-cell"><div class="avatar">${initials(v.full_name)}</div><div><div class="user-name">${v.full_name}</div><div class="user-email">${v.email}</div></div></div></td>
      <td>${chipVerif(v.status)}</td>
      <td><span class="date">${fmtDate(v.created_at)}</span></td>
      <td><div class="actions">
        <button class="btn-sm btn-view" data-command="open-verification" data-id="${escapeHtml(v.id)}">👁 Voir</button>
        ${v.status === 'pending' ? `
          <button class="btn-sm btn-approve" data-command="update-verification" data-id="${escapeHtml(v.id)}" data-status="approved">✅ Approuver</button>
          <button class="btn-sm btn-reject" data-command="update-verification" data-id="${escapeHtml(v.id)}" data-status="rejected">❌ Refuser</button>
        ` : ''}
      </div></td>
    </tr>
  `).join('');
}

async function openVerifModal(id) {
  const v = allVerifications.find(x => x.id === id);
  if (!v) return;
  currentVerifId = id;
  document.getElementById('mv-user').textContent = v.full_name;
  document.getElementById('mv-email').textContent = v.email;
  document.getElementById('mv-status').innerHTML = chipVerif(v.status);
  document.getElementById('mv-note').value = v.notes || '';
  function photoCard(url, label) {
    const safeLabel = escapeHtml(label);
    if (!url) return `<div class="doc-card"><div class="doc-label">${safeLabel}</div><div class="doc-empty"><span style="font-size:22px">📄</span><span>Document non fourni</span></div></div>`;
    const safeUrl = escapeHtml(url);
    return `<div class="doc-card"><div class="doc-label">${safeLabel}</div><img src="${safeUrl}" alt="${safeLabel}" /><div class="doc-actions"><a href="${safeUrl}" target="_blank" rel="noopener">Ouvrir</a></div></div>`;
  }
  document.getElementById('mv-doc').innerHTML = `<div class="evidence-banner normal"><div class="evidence-icon">🪪</div><div><div class="evidence-title">Contrôle identité</div><div class="evidence-text">Compare le selfie avec la carte d'identité. Les liens sont signés temporairement et ne sont pas publics.</div></div></div><div class="doc-grid">${photoCard(v.id_card_front_url,'Carte identité recto')}${photoCard(v.id_card_back_url,'Carte identité verso')}${photoCard(v.selfie_url,'Selfie inscription')}</div>`;
  const actions = document.getElementById('mv-actions');
  if (v.status === 'pending') {
    actions.innerHTML = `
      <button class="btn-sm btn-approve" data-command="update-verification-modal" data-status="approved">✅ Approuver</button>
      <button class="btn-sm btn-reject" data-command="update-verification-modal" data-status="rejected">❌ Refuser</button>
    `;
  } else {
    actions.innerHTML = `<button class="btn-sm btn-warn" data-command="update-verification-modal" data-status="pending">↩ Remettre en attente</button>`;
  }
  openModal('modal-verif');
}

async function updateVerifModal(status) {
  await updateVerif(currentVerifId, status, document.getElementById('mv-note').value);
  closeModal('modal-verif');
}

async function updateVerif(id, status, note = '') {
  try {
    const dbStatus = status === 'approved' ? 'verified' : status;
    const data = await adminAction('updateVerification', { userId: id, status: dbStatus, note });
    const idx = allVerifications.findIndex(v => v.id === id);
    if (idx !== -1) {
      allVerifications[idx] = { ...allVerifications[idx], ...(data.verification || {}), status: dbStatus, notes: note };
    }
    renderVerifications(); updateVerifStats(); updateBadges();
    updateDashboard();
    showToast(dbStatus === 'verified' ? '✅ Vérification approuvée' : dbStatus === 'rejected' ? '❌ Vérification refusée' : '↩ Remis en attente', dbStatus === 'verified' ? 'success' : dbStatus === 'rejected' ? 'error' : 'warn');
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}

async function loadReports() {
  document.getElementById('report-spin').classList.add('spinning');
  try {
    const data = await adminAction('listReports');
    allReports = data.reports || [];
    renderReports(); updateReportStats(); updateBadges(); updateDashboard();
  } catch(e) {
    document.getElementById('report-tbody').innerHTML = `<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--warn);">⚠️ Erreur : ${e.message}</td></tr>`;
  }
  document.getElementById('report-spin').classList.remove('spinning');
}

function updateReportStats() {
  document.getElementById('r-open').textContent      = allReports.filter(r => reportStatus(r) === 'open').length;
  document.getElementById('r-resolved').textContent  = allReports.filter(r => reportStatus(r) === 'resolved').length;
  document.getElementById('r-dismissed').textContent = allReports.filter(r => reportStatus(r) === 'dismissed').length;
  document.getElementById('r-total').textContent     = allReports.length;
}
function setReportFilter(f, el) {
  reportFilter = f;
  document.querySelectorAll('#page-reports .filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active'); renderReports();
}
function filterReports() { renderReports(); }
function renderReports() {
  const search = document.getElementById('report-search').value.toLowerCase();
  const data = allReports.filter(r => {
    const status = reportStatus(r);
    const bookingId = r.booking_id || '';
    const matchFilter = reportFilter === 'all' || status === reportFilter;
    const matchSearch = !search || r.reporter.full_name.toLowerCase().includes(search) || r.reported.full_name.toLowerCase().includes(search) || r.reason.toLowerCase().includes(search) || bookingId.toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });
  const tbody = document.getElementById('report-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Aucun signalement trouvé</td></tr>'; return; }
  tbody.innerHTML = data.map(r => {
    const status = reportStatus(r);
    const reporter = r.reporter || {};
    const reported = r.reported || {};
    const adminMeta = r.admin_note
      ? `<div class="report-note-meta">Note admin${r.admin_updated_at ? ` <span>· ${fmtDate(r.admin_updated_at)}</span>` : ''}</div>`
      : '';
    return `
    <tr>
      <td><div class="user-cell"><div class="avatar">${initials(reporter.full_name || '')}</div><div><div class="user-name">${escapeHtml(reporter.full_name || 'Utilisateur')}</div><div class="user-email">${escapeHtml(reporter.email || 'Email inconnu')}</div></div></div></td>
      <td><div class="user-cell"><div class="avatar" style="border-color:var(--danger);color:var(--danger);background:var(--danger-dim)">${initials(reported.full_name || '')}</div><div><div class="user-name">${escapeHtml(reported.full_name || 'Utilisateur')}</div><div class="user-email">${escapeHtml(reported.email || 'Email inconnu')}</div></div></div></td>
      <td><div class="report-reason">${escapeHtml(r.reason || 'Raison inconnue')}${adminMeta}</div></td>
      <td>${chipReport(status)}</td>
      <td>${retentionBadge(r)}</td>
      <td><span class="date">${fmtDate(r.created_at)}</span></td>
      <td><div class="actions">
        <button class="btn-sm btn-view" data-command="open-report" data-id="${escapeHtml(r.id)}">👁 Voir</button>
        ${status === 'open' ? `
          <button class="btn-sm btn-warn" data-command="open-report" data-id="${escapeHtml(r.id)}">⚠️ Traiter</button>
          <button class="btn-sm btn-dismiss" data-command="update-report" data-id="${escapeHtml(r.id)}" data-status="dismissed">Ignorer</button>
        ` : ''}
      </div></td>
    </tr>
  `}).join('');
}

function openReportModal(id) {
  const r = allReports.find(x => x.id === id);
  if (!r) return;
  const status = reportStatus(r);
  currentReportId = id;
  const reporter = r.reporter || {};
  const reported = r.reported || {};
  document.getElementById('mr-reporter').textContent = `${reporter.full_name || 'Utilisateur'} (${reporter.email || 'Email inconnu'})`;
  document.getElementById('mr-reported').textContent = `${reported.full_name || 'Utilisateur'} (${reported.email || 'Email inconnu'})`;
  document.getElementById('mr-reason').textContent = r.reason || 'Raison inconnue';
  document.getElementById('mr-desc').textContent = r.description || 'Aucune description fournie';
  document.getElementById('mr-date').textContent = r.admin_updated_at
    ? `${fmtDate(r.created_at)} · dernière action admin ${fmtDate(r.admin_updated_at)}`
    : fmtDate(r.created_at);
  document.getElementById('mr-status').innerHTML = chipReport(status);
  document.getElementById('mr-booking').textContent = r.booking_id || 'Aucune réservation liée';
  const frozen = !!r.retention?.frozen;
  document.getElementById('mr-retention').innerHTML = `
    <div class="evidence-banner ${frozen ? 'frozen' : 'normal'}">
      <div class="evidence-icon">${frozen ? '🔒' : '✅'}</div>
      <div>
        <div class="evidence-title">${frozen ? 'Preuves gelées' : 'Conservation normale'}</div>
        <div class="evidence-text">${frozen ? 'La suppression automatique des médias et trajets liés à cette mission est suspendue tant que le dossier reste ouvert, averti ou suspendu.' : 'Aucun gel actif : les règles normales de suppression automatique peuvent continuer.'}</div>
      </div>
    </div>
    ${retentionDetails(r)}
  `;
  document.getElementById('mr-mission-details').innerHTML = missionDetailsHtml(r);
  document.getElementById('mr-note').value = r.admin_note || '';
  const actions = document.getElementById('mr-actions');
  if (status === 'open') {
    actions.innerHTML = `
      <button class="btn-sm btn-warn" data-command="update-report-modal" data-status="warned">⚠️ Avertir l'utilisateur</button>
      <button class="btn-sm btn-suspend" data-command="update-report-modal" data-status="suspended">🔴 Suspendre le compte</button>
      <button class="btn-sm btn-approve" data-command="update-report-modal" data-status="resolved">✅ Marquer résolu</button>
      <button class="btn-sm btn-dismiss" data-command="update-report-modal" data-status="dismissed">— Ignorer</button>
    `;
  } else if (status === 'warned') {
    actions.innerHTML = `
      <button class="btn-sm btn-suspend" data-command="update-report-modal" data-status="suspended">🔴 Suspendre le compte</button>
      <button class="btn-sm btn-approve" data-command="update-report-modal" data-status="resolved">✅ Marquer résolu</button>
      <button class="btn-sm btn-dismiss" data-command="update-report-modal" data-status="dismissed">— Ignorer</button>
      <button class="btn-sm btn-warn" data-command="update-report-modal" data-status="open">↩ Rouvrir</button>
    `;
  } else if (status === 'suspended') {
    actions.innerHTML = `
      <button class="btn-sm btn-approve" data-command="update-report-modal" data-status="resolved">✅ Marquer résolu</button>
      <button class="btn-sm btn-dismiss" data-command="update-report-modal" data-status="dismissed">— Ignorer</button>
      <button class="btn-sm btn-warn" data-command="update-report-modal" data-status="open">↩ Rouvrir</button>
    `;
  } else {
    actions.innerHTML = `<button class="btn-sm btn-warn" data-command="update-report-modal" data-status="open">↩ Rouvrir</button>`;
  }
  openModal('modal-report');
}

async function updateReportModal(status) {
  await updateReport(currentReportId, status, document.getElementById('mr-note').value);
  closeModal('modal-report');
}

async function updateReport(id, status, note = '') {
  try {
    const data = await adminAction('updateReport', { reportId: id, status, note });
    const idx = allReports.findIndex(r => r.id === id);
    if (idx !== -1) {
      const isFrozen = !!allReports[idx].booking_id && !['resolved', 'dismissed', 'closed'].includes(status);
      allReports[idx].status = status;
      allReports[idx].admin_note = data.report?.admin_note ?? note;
      allReports[idx].admin_updated_at = data.report?.admin_updated_at ?? new Date().toISOString();
      allReports[idx].retention = {
        ...(allReports[idx].retention || {}),
        frozen: isFrozen,
        reason: allReports[idx].booking_id
          ? (isFrozen ? 'Signalement ouvert : suppression automatique suspendue' : 'Signalement clôturé : rétention automatique normale')
          : 'Aucune réservation liée',
      };
    }
    renderReports(); updateReportStats(); updateBadges();
    updateDashboard();
    const msgs = { warned: '⚠️ Utilisateur averti', suspended: '🔴 Compte suspendu', resolved: '✅ Signalement résolu', dismissed: '— Signalement ignoré', open: '↩ Signalement rouvert' };
    showToast(msgs[status] || 'Mis à jour', status === 'suspended' ? 'error' : status === 'warned' ? 'warn' : 'success');
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}

async function loadBetaFeedback() {
  document.getElementById('beta-spin')?.classList.add('spinning');
  try {
    const data = await adminAction('listBetaFeedback');
    allBetaFeedback = data.feedback || [];
    renderBetaFeedback(); updateBetaStats(); updateBadges(); updateDashboard();
  } catch(e) {
    const tbody = document.getElementById('beta-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--warn);">⚠️ Erreur : ${e.message}</td></tr>`;
  }
  document.getElementById('beta-spin')?.classList.remove('spinning');
}

function updateBetaStats() {
  document.getElementById('b-open').textContent = allBetaFeedback.filter(f => betaStatus(f) === 'open').length;
  document.getElementById('b-progress').textContent = allBetaFeedback.filter(f => betaStatus(f) === 'in_progress').length;
  document.getElementById('b-resolved').textContent = allBetaFeedback.filter(f => betaStatus(f) === 'resolved').length;
  document.getElementById('b-total').textContent = allBetaFeedback.length;
}
function setBetaFilter(f, el) {
  betaFilter = f;
  document.querySelectorAll('#page-beta .filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active'); renderBetaFeedback();
}
function filterBetaFeedback() { renderBetaFeedback(); }
function renderBetaFeedback() {
  const search = (document.getElementById('beta-search')?.value || '').toLowerCase();
  const data = allBetaFeedback.filter(item => {
    const user = item.user || {};
    const status = betaStatus(item);
    const haystack = `${user.full_name || ''} ${user.email || ''} ${item.category || ''} ${item.message || ''} ${item.platform || ''}`.toLowerCase();
    const matchFilter = betaFilter === 'all' || status === betaFilter;
    const matchSearch = !search || haystack.includes(search);
    return matchFilter && matchSearch;
  });
  const tbody = document.getElementById('beta-tbody');
  if (!tbody) return;
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Aucun retour bêta trouvé</td></tr>'; return; }
  tbody.innerHTML = data.map(item => {
    const user = item.user || {};
    const noteMeta = item.admin_note
      ? `<div class="report-note-meta">Note admin${item.admin_updated_at ? ` <span>· ${fmtDate(item.admin_updated_at)}</span>` : ''}</div>`
      : '';
    return `
      <tr>
        <td><div class="user-cell"><div class="avatar">${initials(user.full_name || '')}</div><div><div class="user-name">${escapeHtml(user.full_name || 'Utilisateur')}</div><div class="user-email">${escapeHtml(user.email || 'Email inconnu')}</div></div></div></td>
        <td>${escapeHtml(betaCategoryLabel(item.category))}</td>
        <td><div class="feedback-snippet">${escapeHtml(item.message || '')}</div>${noteMeta}</td>
        <td>${chipBeta(betaStatus(item))}</td>
        <td><span class="mono">${escapeHtml(deviceSummary(item))}</span></td>
        <td><span class="date">${fmtDate(item.created_at)}</span></td>
        <td><div class="actions">
          <button class="btn-sm btn-view" data-command="open-beta" data-id="${escapeHtml(item.id)}">Voir</button>
          ${betaStatus(item) === 'open' ? `<button class="btn-sm btn-warn" data-command="update-beta" data-id="${escapeHtml(item.id)}" data-status="in_progress">En cours</button>` : ''}
          ${!['resolved', 'dismissed'].includes(betaStatus(item)) ? `<button class="btn-sm btn-approve" data-command="update-beta" data-id="${escapeHtml(item.id)}" data-status="resolved">Traité</button>` : ''}
        </div></td>
      </tr>
    `;
  }).join('');
}

function openBetaModal(id) {
  const item = allBetaFeedback.find(x => x.id === id);
  if (!item) return;
  currentBetaId = id;
  const user = item.user || {};
  document.getElementById('mb-user').textContent = `${user.full_name || 'Utilisateur'} (${user.email || 'Email inconnu'})`;
  document.getElementById('mb-category').textContent = betaCategoryLabel(item.category);
  document.getElementById('mb-message').textContent = item.message || '';
  document.getElementById('mb-device').textContent = deviceSummary(item);
  document.getElementById('mb-date').textContent = item.admin_updated_at
    ? `${fmtDate(item.created_at)} · dernière action admin ${fmtDate(item.admin_updated_at)}`
    : fmtDate(item.created_at);
  document.getElementById('mb-status').innerHTML = chipBeta(betaStatus(item));
  document.getElementById('mb-note').value = item.admin_note || '';
  const actions = document.getElementById('mb-actions');
  actions.innerHTML = `
    <button class="btn-sm btn-warn" data-command="update-beta-modal" data-status="in_progress">Mettre en cours</button>
    <button class="btn-sm btn-approve" data-command="update-beta-modal" data-status="resolved">Marquer traité</button>
    <button class="btn-sm btn-dismiss" data-command="update-beta-modal" data-status="dismissed">Ignorer</button>
    <button class="btn-sm btn-view" data-command="update-beta-modal" data-status="open">Rouvrir</button>
  `;
  openModal('modal-beta');
}

async function updateBetaModal(status) {
  await updateBetaFeedback(currentBetaId, status, document.getElementById('mb-note').value);
  closeModal('modal-beta');
}

async function updateBetaFeedback(id, status, note = '') {
  try {
    const data = await adminAction('updateBetaFeedback', { feedbackId: id, status, note });
    const idx = allBetaFeedback.findIndex(item => item.id === id);
    if (idx !== -1) {
      allBetaFeedback[idx] = { ...allBetaFeedback[idx], ...(data.feedback || {}), status, admin_note: data.feedback?.admin_note ?? note, admin_updated_at: data.feedback?.admin_updated_at ?? new Date().toISOString() };
    }
    renderBetaFeedback(); updateBetaStats(); updateBadges(); updateDashboard();
    const msgs = { open: 'Retour rouvert', in_progress: 'Retour mis en cours', resolved: 'Retour traité', dismissed: 'Retour ignoré' };
    showToast(msgs[status] || 'Retour mis à jour', status === 'dismissed' ? 'warn' : 'success');
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}

function updateBadges() {
  const pv = allVerifications.filter(v => v.status === 'pending').length;
  const pr = allReports.filter(r => reportStatus(r) === 'open').length;
  const pb = allBetaFeedback.filter(f => betaStatus(f) === 'open').length;
  const bv = document.getElementById('badge-verif');
  const br = document.getElementById('badge-reports');
  const bb = document.getElementById('badge-beta');
  bv.textContent = pv; bv.style.display = pv > 0 ? '' : 'none';
  br.textContent = pr; br.style.display = pr > 0 ? '' : 'none';
  if (bb) { bb.textContent = pb; bb.style.display = pb > 0 ? '' : 'none'; }
}
function updateDashboard() {
  const pendingVerifs = allVerifications.filter(v => v.status === 'pending');
  const openReports = allReports.filter(r => reportStatus(r) === 'open');
  const openBeta = allBetaFeedback.filter(f => betaStatus(f) === 'open');
  const frozenReports = allReports.filter(r => r.retention?.frozen);
  const suspendedReports = allReports.filter(r => reportStatus(r) === 'suspended');

  document.getElementById('d-verif-pending').textContent = pendingVerifs.length;
  document.getElementById('d-report-open').textContent = openReports.length;
  document.getElementById('d-frozen').textContent = frozenReports.length;
  document.getElementById('d-beta-open').textContent = openBeta.length;
  document.getElementById('d-suspended').textContent = suspendedReports.length;

  const actionItems = [
    ...pendingVerifs.slice(0, 4).map(v => ({
      type: 'Identité',
      title: v.full_name || 'Utilisateur',
      sub: `${v.email || 'Email inconnu'} · ${fmtDate(v.created_at)}`,
      pill: 'À vérifier',
      page: 'verifications',
      command: 'open-verification',
      id: v.id,
    })),
    ...openReports.slice(0, 5).map(r => ({
      type: 'Signalement',
      title: `${r.reporter?.full_name || 'Utilisateur'} → ${r.reported?.full_name || 'Utilisateur'}`,
      sub: `${r.reason || 'Raison inconnue'} · ${fmtDate(r.created_at)}`,
      pill: r.retention?.frozen ? 'Preuves gelées' : 'Ouvert',
      page: 'reports',
      command: 'open-report',
      id: r.id,
    })),
    ...openBeta.slice(0, 4).map(item => ({
      type: 'Retour bêta',
      title: `${betaCategoryLabel(item.category)} · ${item.user?.full_name || 'Utilisateur'}`,
      sub: `${deviceSummary(item)} · ${fmtDate(item.created_at)}`,
      pill: 'Ouvrir',
      page: 'beta',
      command: 'open-beta',
      id: item.id,
    })),
  ].slice(0, 8);

  const target = document.getElementById('dash-action-list');
  if (!target) return;
  if (!actionItems.length) {
    target.innerHTML = '<div class="empty" style="padding:24px;">Rien d’urgent pour le moment</div>';
    return;
  }
  target.innerHTML = actionItems.map(item => `
    <div class="ops-item">
      <div class="ops-main">
        <div class="ops-sub">${escapeHtml(item.type)}</div>
        <div class="ops-name">${escapeHtml(item.title)}</div>
        <div class="ops-sub">${escapeHtml(item.sub)}</div>
      </div>
      <button class="ops-pill" data-command="${escapeHtml(item.command)}" data-page="${escapeHtml(item.page)}" data-id="${escapeHtml(item.id)}">${escapeHtml(item.pill)}</button>
    </div>
  `).join('');
}

document.addEventListener('input', event => {
  if (event.target.id === 'verif-search') filterVerifications();
  if (event.target.id === 'report-search') filterReports();
  if (event.target.id === 'beta-search') filterBetaFeedback();
});

document.addEventListener('click', event => {
  const target = event.target.closest('[data-command]');
  if (!target) return;

  const command = target.dataset.command;
  const id = target.dataset.id;
  const status = target.dataset.status;
  const page = target.dataset.page;

  if (command === 'set-rating') setRating(Number(target.dataset.v));
  else if (command === 'submit-testimonial') submitTestimonial();
  else if (command === 'login') doLogin();
  else if (command === 'verify-mfa') verifyMfaCode();
  else if (command === 'logout') doLogout();
  else if (command === 'show-page') showPage(page, target);
  else if (command === 'jump-page') jumpToPage(page);
  else if (command === 'refresh-all') refreshAll();
  else if (command === 'load-verifications') loadVerifications();
  else if (command === 'load-reports') loadReports();
  else if (command === 'load-beta') loadBetaFeedback();
  else if (command === 'filter-verifications') setVerifFilter(target.dataset.filter, target);
  else if (command === 'filter-reports') setReportFilter(target.dataset.filter, target);
  else if (command === 'filter-beta') setBetaFilter(target.dataset.filter, target);
  else if (command === 'close-modal') closeModal(target.dataset.modal);
  else if (command === 'open-verification') { if (page) jumpToPage(page); openVerifModal(id); }
  else if (command === 'update-verification') updateVerif(id, status);
  else if (command === 'update-verification-modal') updateVerifModal(status);
  else if (command === 'open-report') { if (page) jumpToPage(page); openReportModal(id); }
  else if (command === 'update-report') updateReport(id, status);
  else if (command === 'update-report-modal') updateReportModal(status);
  else if (command === 'open-beta') { if (page) jumpToPage(page); openBetaModal(id); }
  else if (command === 'update-beta') updateBetaFeedback(id, status);
  else if (command === 'update-beta-modal') updateBetaModal(status);
});

async function initAdminSession() {
  if (_token) return;
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await prepareMfa();
  } catch (_) {
    await supabaseClient.auth.signOut();
  }
}

initAdminSession();
