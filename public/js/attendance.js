/**
 * attendance.js — Face capture & attendance marking logic
 */

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();

  const video        = document.getElementById('camVideo');
  const canvas       = document.getElementById('camCanvas');
  const startBtn     = document.getElementById('startCamBtn');
  const captureBtn   = document.getElementById('captureBtn');
  const retakeBtn    = document.getElementById('retakeBtn');
  const submitBtn    = document.getElementById('submitAttendanceBtn');
  const statusText   = document.getElementById('camStatus');
  const previewBox   = document.getElementById('previewBox');
  const courseSelect = document.getElementById('courseSelect');
  const manualForm   = document.getElementById('manualForm');
  const tabBtns      = document.querySelectorAll('.tab-btn');
  const tabPanels    = document.querySelectorAll('.tab-panel');

  let stream = null;
  let capturedBlob = null;

  // ─── Tabs ─────────────────────────────────────────────────────
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab)?.classList.remove('hidden');
    });
  });

  // ─── Load Courses ──────────────────────────────────────────────
  async function loadCourses() {
    try {
      const courses = await CourseAPI.list();
      [courseSelect, document.getElementById('manualCourse')].forEach(sel => {
        if (!sel) return;
        sel.innerHTML = '<option value="">— Select course —</option>';
        courses.forEach(c => {
          sel.innerHTML += `<option value="${c.id}">${esc(c.code)} &mdash; ${esc(c.name)}</option>`;
        });
      });
    } catch (err) {
      Toast.error('Failed to load courses: ' + getErrorMessage(err));
    }
  }

  loadCourses();

  // ─── Camera ───────────────────────────────────────────────────
  startBtn?.addEventListener('click', async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      video.srcObject = stream;
      video.play();

      startBtn.classList.add('hidden');
      captureBtn.classList.remove('hidden');
      previewBox.classList.add('hidden');
      updateStatus('🟢 Camera active — position your face in the frame');
    } catch (err) {
      Toast.error('Camera access denied. Please allow camera permissions.');
      updateStatus('⚠️ Camera unavailable');
    }
  });

  captureBtn?.addEventListener('click', () => {
    const ctx = canvas.getContext('2d');
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      capturedBlob = blob;
      const url = URL.createObjectURL(blob);

      // Show preview
      const img = document.getElementById('capturedImg');
      if (img) { img.src = url; }
      previewBox.classList.remove('hidden');
      video.classList.add('hidden');

      captureBtn.classList.add('hidden');
      retakeBtn.classList.remove('hidden');
      submitBtn.classList.remove('hidden');

      updateStatus('📸 Photo captured — verify and submit');
    }, 'image/jpeg', 0.85);
  });

  retakeBtn?.addEventListener('click', () => {
    capturedBlob = null;
    video.classList.remove('hidden');
    previewBox.classList.add('hidden');
    captureBtn.classList.remove('hidden');
    retakeBtn.classList.add('hidden');
    submitBtn.classList.add('hidden');
    updateStatus('🟢 Camera active — position your face in the frame');
  });

  // ─── Face Submit ───────────────────────────────────────────────
  submitBtn?.addEventListener('click', async () => {
    const courseId = courseSelect.value;
    if (!courseId) { Toast.warning('Please select a course first.'); return; }
    if (!capturedBlob) { Toast.warning('Please capture a photo first.'); return; }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Processing…';
    updateStatus('🔍 Identifying face…');

    try {
      const fd = new FormData();
      fd.append('image', capturedBlob, 'attendance.jpg');
      fd.append('course_id', courseId);

      const result = await AttendanceAPI.markFace(fd);
      updateStatus('✅ Attendance marked successfully!');
      Toast.success(`Attendance recorded for ${result.student_name || 'student'}`);
      refreshTodayList(courseId);

      // Reset camera state after 3s
      setTimeout(() => {
        retakeBtn?.click();
        updateStatus('Ready for next student');
      }, 3000);
    } catch (err) {
      updateStatus('❌ ' + getErrorMessage(err));
      Toast.error(getErrorMessage(err));
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Attendance';
    }
  });

  // ─── Manual Form ──────────────────────────────────────────────
  manualForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = document.getElementById('manualStudent').value.trim();
    const courseId  = document.getElementById('manualCourse').value;
    const status    = document.getElementById('manualStatus').value;
    const date      = document.getElementById('manualDate').value;

    if (!studentId || !courseId) {
      Toast.warning('Please fill Student ID and Course.'); return;
    }

    const btn = manualForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving…';

    try {
      await AttendanceAPI.mark({ student_id: studentId, course_id: courseId, status, date });
      Toast.success('Attendance saved!');
      manualForm.reset();
      refreshTodayList(courseId);
    } catch (err) {
      Toast.error(getErrorMessage(err));
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Attendance';
    }
  });

  // ─── Today's Attendance List ───────────────────────────────────
  async function refreshTodayList(courseId) {
    const tbody = document.getElementById('todayTbody');
    if (!tbody || !courseId) return;

    tbody.innerHTML = `<tr><td colspan="4" class="text-center"><span class="spinner"></span></td></tr>`;

    try {
      const records = await AttendanceAPI.today(courseId);
      if (!records.length) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">No records yet for today.</td></tr>`;
        return;
      }
      tbody.innerHTML = records.map(r => `
        <tr>
          <td>${esc(r.student_id)}</td>
          <td>${esc(r.student_name)}</td>
          <td>${formatTime(r.marked_at)}</td>
          <td><span class="badge badge-${statusBadge(r.status)}">${esc(r.status)}</span></td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-red">Failed to load records</td></tr>`;
    }
  }

  courseSelect?.addEventListener('change', () => refreshTodayList(courseSelect.value));

  // ─── Helpers ──────────────────────────────────────────────────
  function updateStatus(msg) {
    if (statusText) statusText.textContent = msg;
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(s) {
    return s === 'Present' ? 'teal' : s === 'Late' ? 'amber' : 'red';
  }

  // Cleanup on leave
  window.addEventListener('beforeunload', () => {
    stream?.getTracks().forEach(t => t.stop());
  });
});

// ── Role-based UI: hide manual entry for students ──
document.addEventListener('DOMContentLoaded', () => {
  const user = Auth.getUser();
  if (user && user.role === 'student') {
    // Hide the manual tab button
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.dataset.tab === 'manualTab') {
        btn.style.display = 'none';
      }
    });
    // Hide manual tab content
    const manualTab = document.getElementById('manualTab');
    if (manualTab) manualTab.style.display = 'none';
    // Hide Quick Actions that are admin/faculty only
    const quickLinks = document.querySelectorAll('a[href="attendance.html#manual"]');
    quickLinks.forEach(l => l.style.display = 'none');
  }
});
