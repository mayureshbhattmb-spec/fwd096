// Club directory enhancements: search/filter, saved clubs, and application tracker.
(() => {
  const cards = [...document.querySelectorAll('#clubCards .card')];
  // Build the application dropdown from the club cards already on the page.
  const clubSelect = document.getElementById('clubSelect');
  if (clubSelect) {
    clubSelect.replaceChildren(new Option('Choose a club', ''));
    cards.forEach(card => {
      const clubName = card.querySelector('h3')?.textContent.trim();
      if (clubName) clubSelect.add(new Option(clubName, clubName));
    });
    if (!cards.length) {
      clubSelect.replaceChildren(new Option('No clubs are currently listed', ''));
      clubSelect.disabled = true;
    }
  }
  const search = document.getElementById('clubSearch');
  const category = document.getElementById('clubCategory');
  const savedButton = document.getElementById('showSaved');
  const savedCount = document.getElementById('savedCount');
  const count = document.getElementById('clubResultCount');
  const SAVED_KEY = 'campusPortalSavedClubs';
  const APP_KEY = 'campusPortalDemoApplications';
  let saved = new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'));
  let onlySaved = false;
  const nameOf = card => card.querySelector('h3').textContent.trim();

  function updateSavedButtons() {
    cards.forEach(card => {
      const button = card.querySelector('.save-club');
      const isSaved = saved.has(nameOf(card));
      button.textContent = isSaved ? '★ Saved' : '☆ Save club';
      button.setAttribute('aria-pressed', String(isSaved));
    });
    savedCount.textContent = saved.size;
  }
  function filterCards() {
    const q = search.value.trim().toLowerCase();
    const type = category.value;
    let shown = 0;
    cards.forEach(card => {
      const matches = nameOf(card).toLowerCase().includes(q) ||
        card.querySelector('p').textContent.toLowerCase().includes(q);
      const visible = matches && (type === 'all' || card.dataset.category === type) &&
        (!onlySaved || saved.has(nameOf(card)));
      card.hidden = !visible;
      if (visible) shown++;
    });
    count.textContent = `${shown} club${shown === 1 ? '' : 's'} shown`;
    savedButton.textContent = onlySaved ? 'Show all clubs' : `Saved clubs ${saved.size}`;
  }
  cards.forEach(card => card.querySelector('.save-club').addEventListener('click', () => {
    const name = nameOf(card);
    saved.has(name) ? saved.delete(name) : saved.add(name);
    localStorage.setItem(SAVED_KEY, JSON.stringify([...saved]));
    updateSavedButtons(); filterCards();
  }));
  search.addEventListener('input', filterCards);
  category.addEventListener('change', filterCards);
  savedButton.addEventListener('click', () => { onlySaved = !onlySaved; filterCards(); });
  updateSavedButtons(); filterCards();

  // Demo tracker stores applications in this browser; it is not a server submission.
  const form = document.getElementById('applicationForm');
  const list = document.getElementById('applicationList');
  function renderApplications() {
    const apps = JSON.parse(localStorage.getItem(APP_KEY) || '[]');
    if (!apps.length) { list.innerHTML = '<p>No demo applications submitted yet.</p>'; return; }
    list.replaceChildren();
    apps.forEach(app => {
      const item = document.createElement('div');
      item.className = 'application-item';
      const title = document.createElement('strong'); title.textContent = app.club;
      const status = document.createElement('span'); status.className = 'status'; status.textContent = app.status;
      const detail = document.createElement('p'); detail.textContent = `${app.course} · ${app.year} · Submitted ${app.date}`;
      item.append(title, ' ', status, detail); list.append(item);
    });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const club = document.getElementById('clubSelect').value;
    if (!club) { document.getElementById('applicationMessage').textContent = 'Choose a club first.'; return; }
    const apps = JSON.parse(localStorage.getItem(APP_KEY) || '[]');
    if (apps.some(app => app.club === club)) {
      document.getElementById('applicationMessage').textContent = 'You already have a demo application for this club.';
      return;
    }
    apps.push({club, course: document.getElementById('studentCourse').value,
      year: document.getElementById('studentYear').value, date: new Date().toLocaleDateString(),
      status: 'Submitted (demo)'});
    localStorage.setItem(APP_KEY, JSON.stringify(apps));
    document.getElementById('applicationMessage').textContent = 'Demo application saved in this browser.';
    renderApplications();
  });
  document.getElementById('refreshApplications')?.addEventListener('click', renderApplications);
  renderApplications();
})();

// Demo sign-in/register flow (browser-local only; not production authentication).
(() => {
  const byId = id => document.getElementById(id);
  const authPanel = byId('authPanel'), studentPanel = byId('studentPanel'), adminPanel = byId('adminPanel');
  const authForm = byId('authForm');
  if (!authForm) return;
  const USERS_KEY = 'campusPortalDemoUsers';
  const SESSION_KEY = 'campusPortalDemoSession';
  let mode = 'login';
  const users = () => JSON.parse(localStorage.getItem(USERS_KEY) || '{}');
  const setMessage = message => { byId('authMessage').textContent = message; };
  function showMode(next) {
    mode = next;
    const registering = mode === 'register';
    byId('authHeading').textContent = registering ? 'Create student account' : 'Student sign in';
    byId('nameField').classList.toggle('portal-hidden', !registering);
    byId('fullName').required = registering;
    byId('password').autocomplete = registering ? 'new-password' : 'current-password';
    byId('authSubmit').textContent = registering ? 'Create account' : 'Sign in';
    byId('showLogin').classList.toggle('secondary', registering);
    byId('showRegister').classList.toggle('secondary', !registering);
    setMessage('');
  }
  function renderSession() {
    const email = localStorage.getItem(SESSION_KEY);
    const signedIn = !!email && !!users()[email];
    authPanel.classList.toggle('visible', !signedIn);
    studentPanel.classList.toggle('visible', signedIn);
    if (adminPanel) adminPanel.classList.remove('visible');
    byId('sessionMessage').textContent = signedIn ? `Signed in as ${email}` : '';
    byId('navAuth').textContent = signedIn ? 'My dashboard' : 'Sign in';
    if (signedIn) byId('welcomeHeading').textContent = `Welcome, ${users()[email].name}`;
  }
  byId('signInButton').addEventListener('click', event => {
    event.preventDefault();
    const signedIn = !!localStorage.getItem(SESSION_KEY);
    if (signedIn) studentPanel.scrollIntoView({behavior:'smooth', block:'start'});
    else { authPanel.classList.add('visible'); showMode('login'); authPanel.scrollIntoView({behavior:'smooth', block:'center'}); }
  });
  byId('navAuth').addEventListener('click', event => {
    if (!localStorage.getItem(SESSION_KEY)) {
      event.preventDefault(); authPanel.classList.add('visible'); showMode('login');
    }
  });
  byId('showLogin').addEventListener('click', () => showMode('login'));
  byId('showRegister').addEventListener('click', () => showMode('register'));
  authForm.addEventListener('submit', event => {
    event.preventDefault();
    const email = byId('email').value.trim().toLowerCase();
    const password = byId('password').value;
    const store = users();
    if (mode === 'register') {
      const name = byId('fullName').value.trim();
      if (!name) return setMessage('Enter your full name.');
      if (store[email]) return setMessage('An account with this email already exists. Sign in instead.');
      store[email] = {name, password};
      localStorage.setItem(USERS_KEY, JSON.stringify(store));
      localStorage.setItem(SESSION_KEY, email);
      authForm.reset(); renderSession();
    } else {
      if (!store[email] || store[email].password !== password) return setMessage('Email or password is incorrect.');
      localStorage.setItem(SESSION_KEY, email);
      authForm.reset(); renderSession();
    }
  });
  function signOut() { localStorage.removeItem(SESSION_KEY); renderSession(); showMode('login'); }
  byId('logoutButton')?.addEventListener('click', signOut);
  byId('adminLogout')?.addEventListener('click', signOut);
  showMode('login'); renderSession();
})();
