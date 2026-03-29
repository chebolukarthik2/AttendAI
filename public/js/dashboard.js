/**
 * dashboard.js — Dashboard data population & charts
 * Requires Chart.js (loaded via CDN in dashboard.html)
 */

document.addEventListener('DOMContentLoaded', async () => {
  requireAuth();

  const user = Auth.getUser();
  if (user) {
    const nameEl = document.getElementById('userName');
    const roleEl = document.getElementById('userRole');
    const avatarEl = document.getElementById('userAvatar');
    const greetEl  = document.getElementById('greetName');

    if (nameEl)   nameEl.textContent   = user.username || user.name || 'User';
    if (roleEl)   roleEl.textContent   = user.role || 'Member';
    if (avatarEl) avatarEl.textContent = (user.username || 'U')[0].toUpperCase();
    if (greetEl)  greetEl.textContent  = user.first_name || user.username || 'there';
  }

  // Sidebar mobile toggle
  const menuBtn = document.getElementById('menuToggle');
  const sidebar = document.querySelector('.sidebar');
  menuBtn?.addEventListener('click', () => sidebar?.classList.toggle('open'));

  // Logout
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    Auth.logout();
  });

  // ─── Load Dashboard Data ─────────────────────────────────────
  await Promise.allSettled([
    loadStats(),
    loadRecentActivity(),
    loadWeeklyChart()
  ]);
});

// ─── Stats ────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const stats = await DashboardAPI.stats();

    setStatCard('totalStudents',  stats.total_students);
    setStatCard('presentToday',   stats.present_today);
    setStatCard('totalCourses',   stats.total_courses);
    setStatCard('avgAttendance',  (stats.avg_attendance || 0).toFixed(1) + '%');

    // Mini donut
    if (stats.present_today != null && stats.total_students) {
      const pct = Math.round((stats.present_today / stats.total_students) * 100);
      animateProgressBar('attendanceBar', pct);
    }
  } catch (err) {
    console.warn('Stats failed:', err);
  }
}

function setStatCard(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value ?? '—';
    el.closest('.stat-card')?.classList.add('fade-in');
  }
}

function animateProgressBar(id, pct) {
  const fill = document.getElementById(id);
  if (!fill) return;
  fill.style.width = '0%';
  requestAnimationFrame(() => {
    setTimeout(() => { fill.style.width = pct + '%'; }, 100);
  });
  const label = document.getElementById('attendancePct');
  if (label) label.textContent = pct + '%';
}

// ─── Recent Activity ──────────────────────────────────────────────
async function loadRecentActivity() {
  const list = document.getElementById('activityList');
  if (!list) return;

  list.innerHTML = '<div class="text-center"><span class="spinner"></span></div>';

  try {
    const activities = await DashboardAPI.recentActivity();
    if (!activities.length) {
      list.innerHTML = '<p class="text-muted text-center">No recent activity.</p>';
      return;
    }
    list.innerHTML = activities.map(a => `
      <div class="activity-item flex gap-md" style="padding:12px 0;border-bottom:1px solid var(--border);">
        <div class="stat-icon ${activityColor(a.type)}" style="flex-shrink:0;">${activityIcon(a.type)}</div>
        <div>
          <p style="font-size:0.875rem;color:var(--text-primary);margin:0;">${esc(a.message)}</p>
          <p style="font-size:0.75rem;color:var(--text-muted);margin:2px 0 0;">${formatRelativeTime(a.timestamp)}</p>
        </div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<p class="text-muted text-center">Could not load activity.</p>';
  }
}

function activityIcon(type) {
  const map = { attendance: '✓', alert: '⚠', register: '👤', course: '📚', system: '⚙' };
  return map[type] || '•';
}
function activityColor(type) {
  const map = { attendance: 'teal', alert: 'amber', register: 'purple', course: 'teal', system: 'gray' };
  return map[type] || 'gray';
}
function formatRelativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Weekly Attendance Chart ──────────────────────────────────────
async function loadWeeklyChart() {
  const ctx = document.getElementById('weeklyChart');
  if (!ctx) return;

  // Demo data as fallback
  let labels   = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let present  = [78, 82, 75, 88, 70, 60];
  let absent   = [22, 18, 25, 12, 30, 40];

  try {
    const data = await DashboardAPI.weeklyTrend();
    if (data.labels)  labels  = data.labels;
    if (data.present) present = data.present;
    if (data.absent)  absent  = data.absent;
  } catch (_) {}

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Present',
          data: present,
          backgroundColor: 'rgba(0,212,170,0.7)',
          borderRadius: 6,
          borderSkipped: false
        },
        {
          label: 'Absent',
          data: absent,
          backgroundColor: 'rgba(239,68,68,0.5)',
          borderRadius: 6,
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8a9ab8', font: { family: 'Outfit', size: 12 }, boxWidth: 12, borderRadius: 4 }
        },
        tooltip: {
          backgroundColor: '#111827',
          borderColor: '#1e2d45',
          borderWidth: 1,
          titleColor: '#e8edf5',
          bodyColor: '#8a9ab8',
          padding: 10
        }
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8a9ab8', font: { family: 'Outfit' } }
        },
        y: {
          beginAtZero: true,
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#8a9ab8', font: { family: 'Outfit' } }
        }
      }
    }
  });
}

// ─── Donut Chart for today ─────────────────────────────────────────
async function loadDonutChart() {
  const ctx = document.getElementById('todayDonut');
  if (!ctx) return;

  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Present', 'Absent', 'Late'],
      datasets: [{
        data: [72, 20, 8],
        backgroundColor: ['rgba(0,212,170,0.8)', 'rgba(239,68,68,0.7)', 'rgba(245,158,11,0.7)'],
        borderWidth: 0,
        hoverOffset: 4
      }]
    },
    options: {
      cutout: '70%',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#8a9ab8', font: { family: 'Outfit', size: 12 }, boxWidth: 10, borderRadius: 3 }
        },
        tooltip: {
          backgroundColor: '#111827',
          borderColor: '#1e2d45',
          borderWidth: 1,
          titleColor: '#e8edf5',
          bodyColor: '#8a9ab8'
        }
      }
    }
  });
}

// Trigger donut after DOM ready if canvas exists
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('todayDonut')) loadDonutChart();
});

// ── Role-based UI for dashboard ──
document.addEventListener('DOMContentLoaded', () => {
  const user = Auth.getUser();
  if (user && user.role === 'student') {
    // Hide manual attendance link
    document.querySelectorAll('a[href="attendance.html#manual"]').forEach(l => l.style.display = 'none');
    // Hide "Register New Student" link
    document.querySelectorAll('a[href="register.html"]').forEach(l => {
      if (l.textContent.includes('Register')) l.style.display = 'none';
    });
    // Hide management sidebar section for students
    document.querySelectorAll('.sidebar-section-label').forEach(label => {
      if (label.textContent.trim() === 'Management') {
        label.style.display = 'none';
        let next = label.nextElementSibling;
        while (next && !next.classList.contains('sidebar-section-label')) {
          next.style.display = 'none';
          next = next.nextElementSibling;
        }
      }
    });
  }
  // Hide faculty link for non-admin (faculty role)
  if (user && user.role === 'faculty') {
    const facultyLink = document.getElementById('facultyNavLink');
    if (facultyLink) facultyLink.style.display = 'none';
  }
});
