/**
 * courses.js — Course management logic
 */
let allCourses = [];
let facultyMap = {};

function formatTime12(t) {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hr12 = hr % 12 || 12;
  return hr12 + ':' + m + ' ' + ampm;
}

document.addEventListener('DOMContentLoaded', async () => {
  requireAuth();
  const user = Auth.getUser();

  if (!user || user.role === 'student') {
    window.location.href = 'dashboard.html';
    return;
  }

  document.getElementById('userName').textContent = user.name || user.username;
  document.getElementById('userRole').textContent = user.role;
  document.getElementById('userAvatar').textContent = (user.first_name || 'U')[0].toUpperCase();
  document.getElementById('logoutBtn').addEventListener('click', () => Auth.logout());

  if (user.role === 'faculty') {
    const fl = document.getElementById('facultyNavLink');
    if (fl) fl.style.display = 'none';
  }

  // Only admin can add courses
  if (user.role !== 'admin') {
    document.getElementById('addCourseBtn').style.display = 'none';
  }

  // Toggle form
  document.getElementById('addCourseBtn').addEventListener('click', () => {
    resetForm();
    document.getElementById('addCourseForm').style.display = '';
  });
  document.getElementById('cancelAddBtn').addEventListener('click', () => {
    document.getElementById('addCourseForm').style.display = 'none';
  });

  await loadFacultyOptions();
  await loadCourses();

  document.getElementById('filterDept').addEventListener('change', renderCourses);
  document.getElementById('filterSem').addEventListener('change', renderCourses);

  // Form submit — handles both create & update
  document.getElementById('courseForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('cError');
    const successBox = document.getElementById('cSuccess');
    errBox.classList.add('hidden');
    successBox.classList.add('hidden');

    const btn = document.getElementById('cSubmitBtn');
    const editId = document.getElementById('cEditId').value;
    const isEdit = !!editId;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> ' + (isEdit ? 'Updating…' : 'Creating…');

    try {
      const courseData = {
        code: document.getElementById('cCode').value.trim(),
        name: document.getElementById('cName').value.trim(),
        department: document.getElementById('cDepartment').value || null,
        semester: document.getElementById('cSemester').value || null,
        year: document.getElementById('cYear').value ? parseInt(document.getElementById('cYear').value) : null,
        faculty_id: document.getElementById('cFaculty').value || null,
        start_time: document.getElementById('cStartTime').value || null,
        end_time: document.getElementById('cEndTime').value || null,
        room_name: document.getElementById('cRoomName').value.trim() || null,
        classroom_lat: document.getElementById('cLat').value ? parseFloat(document.getElementById('cLat').value) : null,
        classroom_lng: document.getElementById('cLng').value ? parseFloat(document.getElementById('cLng').value) : null
      };

      if (isEdit) {
        await CourseAPI.update(editId, courseData);
        successBox.textContent = 'Course updated successfully!';
        Toast.success('Course updated!');
      } else {
        await CourseAPI.create(courseData);
        successBox.textContent = 'Course created successfully!';
        Toast.success('Course added!');
      }
      successBox.classList.remove('hidden');
      resetForm();
      await loadCourses();
    } catch (err) {
      errBox.textContent = getErrorMessage(err);
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = isEdit ? 'Update Course' : 'Create Course';
    }
  });

  // GPS capture button
  document.getElementById('captureGPSBtn')?.addEventListener('click', () => {
    const btn = document.getElementById('captureGPSBtn');
    btn.disabled = true;
    btn.textContent = '📡 Getting location…';
    if (!navigator.geolocation) {
      Toast.error('GPS not available on this device.');
      btn.disabled = false;
      btn.textContent = '📍 Capture GPS';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        document.getElementById('cLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('cLng').value = pos.coords.longitude.toFixed(6);
        btn.disabled = false;
        btn.textContent = '📍 Capture GPS';
        Toast.success('GPS coordinates captured!');
      },
      err => {
        Toast.error('Could not get location. Please allow GPS access.');
        btn.disabled = false;
        btn.textContent = '📍 Capture GPS';
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
});

function resetForm() {
  document.getElementById('courseForm').reset();
  document.getElementById('cEditId').value = '';
  document.getElementById('formTitle').textContent = 'Add New Course';
  document.getElementById('cSubmitBtn').textContent = 'Create Course';
  document.getElementById('cCode').removeAttribute('readonly');
  document.getElementById('cError').classList.add('hidden');
  document.getElementById('cSuccess').classList.add('hidden');
}

function populateEditForm(course) {
  document.getElementById('cEditId').value = course.id;
  document.getElementById('cCode').value = course.code;
  document.getElementById('cCode').setAttribute('readonly', true);
  document.getElementById('cName').value = course.name;
  document.getElementById('cDepartment').value = course.department || '';
  document.getElementById('cSemester').value = course.semester || '';
  document.getElementById('cYear').value = course.year || '';
  document.getElementById('cFaculty').value = course.faculty_id || '';
  document.getElementById('cStartTime').value = course.start_time || '';
  document.getElementById('cEndTime').value = course.end_time || '';
  document.getElementById('cRoomName').value = course.room_name || '';
  document.getElementById('cLat').value = course.classroom_lat || '';
  document.getElementById('cLng').value = course.classroom_lng || '';
  document.getElementById('formTitle').textContent = 'Edit Course — ' + course.code;
  document.getElementById('cSubmitBtn').textContent = 'Update Course';
  document.getElementById('addCourseForm').style.display = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadFacultyOptions() {
  try {
    const sb = getSupabase();
    const { data: facultyRoles } = await sb.from('user_roles').select('user_id').eq('role', 'faculty');
    if (!facultyRoles || !facultyRoles.length) return;
    const ids = facultyRoles.map(r => r.user_id);
    const { data: profiles } = await sb.from('profiles').select('*').in('user_id', ids).order('first_name');
    const select = document.getElementById('cFaculty');
    (profiles || []).forEach(p => {
      facultyMap[p.user_id] = (p.first_name || '') + ' ' + (p.last_name || '');
      const opt = document.createElement('option');
      opt.value = p.user_id;
      opt.textContent = facultyMap[p.user_id] + (p.department ? ' (' + p.department + ')' : '');
      select.appendChild(opt);
    });
  } catch (_) {}
}

async function loadCourses() {
  const container = document.getElementById('courseList');
  container.innerHTML = '<div class="text-center" style="padding:24px;"><span class="spinner"></span></div>';
  try {
    allCourses = await CourseAPI.list();
    renderCourses();
  } catch (err) {
    container.innerHTML = '<p class="text-muted text-center" style="padding:24px;">Error loading courses.</p>';
  }
}

async function toggleLive(courseId, newState) {
  try {
    await CourseAPI.update(courseId, { is_live: newState });
    Toast.success(newState ? 'Course is now LIVE!' : 'Course taken offline.');
    await loadCourses();
  } catch (err) {
    Toast.error(getErrorMessage(err));
  }
}

function renderCourses() {
  const container = document.getElementById('courseList');
  const deptFilter = document.getElementById('filterDept').value;
  const semFilter = document.getElementById('filterSem').value;
  const user = Auth.getUser();
  const canEdit = user && (user.role === 'admin' || user.role === 'faculty');

  let filtered = allCourses;
  if (deptFilter) filtered = filtered.filter(c => c.department === deptFilter);
  if (semFilter) filtered = filtered.filter(c => c.semester === semFilter);

  document.getElementById('courseCount').textContent = filtered.length;

  if (!filtered.length) {
    container.innerHTML = '<p class="text-muted text-center" style="padding:24px;">No courses found.</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Department</th>
            <th>Semester</th>
            <th>Year</th>
            <th>Time</th>
            <th>Room</th>
            <th>Faculty</th>
            <th>Status</th>
            ${canEdit ? '<th>Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${filtered.map(c => `
            <tr>
              <td style="color:var(--text-primary);font-weight:600;">${esc(c.code)}</td>
              <td>${esc(c.name)}</td>
              <td>${esc(c.department) || '—'}</td>
              <td>${esc(c.semester) || '—'}</td>
              <td>${esc(c.year) || '—'}</td>
              <td>${c.start_time ? formatTime12(c.start_time) + ' – ' + formatTime12(c.end_time) : '—'}</td>
              <td>${esc(c.room_name) || '—'}</td>
              <td>${c.faculty_id ? (esc(facultyMap[c.faculty_id]) || '—') : '—'}</td>
              <td>
                <span class="badge ${c.is_live ? 'badge-teal' : 'badge-gray'}">${c.is_live ? '🟢 Live' : '⚪ Offline'}</span>
              </td>
              ${canEdit ? `
                <td style="white-space:nowrap;">
                  <button class="btn ${c.is_live ? 'btn-ghost' : 'btn-primary'} btn-sm go-live-btn" data-id="${c.id}" data-live="${c.is_live}" style="margin-right:4px;">
                    ${c.is_live ? '⏹ Stop' : '▶ Go Live'}
                  </button>
                  <button class="btn btn-outline btn-sm edit-course-btn" data-id="${c.id}" style="margin-right:4px;">✏️ Edit</button>
                  ${user.role === 'admin' ? `<button class="btn btn-danger btn-sm delete-course-btn" data-id="${c.id}" data-name="${esc(c.code)}">🗑 Delete</button>` : ''}
                </td>
              ` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Go Live handlers
  document.querySelectorAll('.go-live-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const courseId = btn.dataset.id;
      const isLive = btn.dataset.live === 'true';
      toggleLive(courseId, !isLive);
    });
  });

  // Edit handlers
  document.querySelectorAll('.edit-course-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const course = allCourses.find(c => c.id === btn.dataset.id);
      if (course) populateEditForm(course);
    });
  });

  // Delete handlers
  document.querySelectorAll('.delete-course-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      const id = btn.dataset.id;
      if (!confirm(`Delete course "${name}"? This cannot be undone.`)) return;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span>';
      try {
        await CourseAPI.delete(id);
        Toast.success('Course deleted.');
        await loadCourses();
      } catch (err) {
        Toast.error(getErrorMessage(err));
        btn.disabled = false;
        btn.innerHTML = '🗑 Delete';
      }
    });
  });
}