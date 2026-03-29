/**
 * login.js — Login page logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  if (Auth.isLoggedIn()) {
    window.location.href = 'dashboard.html';
    return;
  }

  const form        = document.getElementById('loginForm');
  const submitBtn   = document.getElementById('submitBtn');
  const emailInput  = document.getElementById('email');
  const passInput   = document.getElementById('password');
  const togglePass  = document.getElementById('togglePass');
  const errorBox    = document.getElementById('errorBox');

  // Toggle password visibility
  togglePass?.addEventListener('click', () => {
    const isText = passInput.type === 'text';
    passInput.type = isText ? 'password' : 'text';
    togglePass.textContent = isText ? '👁' : '🙈';
  });

  // Form submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();

    const email    = emailInput.value.trim();
    const password = passInput.value;

    // Basic validation
    if (!email || !password) {
      showError('Please fill in all fields.');
      return;
    }

    setLoading(true);

    try {
      const data = await AuthAPI.login({ username: email, password });
      // Session and user are already stored by AuthAPI.login()

      Toast.success('Login successful! Redirecting…');
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
    } catch (err) {
      showError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  });

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? '<span class="spinner"></span> Signing in…'
      : 'Sign In';
  }

  function showError(msg) {
    if (!errorBox) return;
    errorBox.textContent = msg;
    errorBox.classList.remove('hidden');
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = '';
    errorBox.classList.add('hidden');
  }
});
