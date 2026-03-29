/**
 * api.js — Supabase-backed API layer for Smart Attendance System
 */

const SUPABASE_URL = 'https://mlfybftuwplodvgmdwlg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1sZnliZnR1d3Bsb2R2Z21kd2xnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NTY0OTcsImV4cCI6MjA5MDMzMjQ5N30.iOFnZbbYtnq5ZvzwqHT_nPbL6tAXCjBDROaC8ByfP2A';

let _supabaseClient = null;
function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    _supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabaseClient;
  }
  throw new Error('Supabase client not loaded');
}

function getAudioExtensionFromMime(mimeType = '') {
  const m = String(mimeType).toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  return 'webm';
}

function getAudioContentType(blob, fallback = 'audio/webm') {
  if (blob && typeof blob.type === 'string' && blob.type.startsWith('audio/')) {
    return blob.type;
  }
  return fallback;
}

// ─── Auth Token Helpers ───────────────────────────────────────────
const Auth = {
  getToken() {
    const session = JSON.parse(localStorage.getItem('sas_session') || 'null');
    return session?.access_token || null;
  },
  getUser() {
    return JSON.parse(localStorage.getItem('sas_user') || 'null');
  },
  setUser(user) {
    localStorage.setItem('sas_user', JSON.stringify(user));
  },
  removeUser() {
    localStorage.removeItem('sas_user');
    localStorage.removeItem('sas_session');
  },
  isLoggedIn() {
    const token = this.getToken();
    if (!token) return false;
    // Fix 7 – also check token expiry; Supabase sets expires_at (Unix seconds) on the session
    try {
      const session = JSON.parse(localStorage.getItem('sas_session') || 'null');
      if (session?.expires_at && session.expires_at * 1000 < Date.now()) {
        this.removeUser();   // clear stale session so the next requireAuth() redirects cleanly
        return false;
      }
    } catch (_) {}
    return true;
  },
  async logout() {
    try { await getSupabase().auth.signOut(); } catch(e) {}
    this.removeUser();
    window.location.href = 'login.html';
  }
};

// ─── Auth Endpoints ───────────────────────────────────────────────
const AuthAPI = {
  async login(credentials) {
    const sb = getSupabase();
    const { data, error } = await sb.auth.signInWithPassword({
      email: credentials.username.includes('@') ? credentials.username : credentials.username + '@attendai.demo',
      password: credentials.password
    });
    if (error) throw { status: 401, data: { detail: error.message } };

    localStorage.setItem('sas_session', JSON.stringify(data.session));

    const userId = data.user.id;
    const { data: profile } = await sb.from('profiles').select('*').eq('user_id', userId).single();
    const { data: roleData } = await sb.from('user_roles').select('role').eq('user_id', userId).single();

    const user = {
      id: userId,
      username: profile?.email || data.user.email,
      email: profile?.email || data.user.email,
      first_name: profile?.first_name || '',
      last_name: profile?.last_name || '',
      roll_number: profile?.roll_number || '',
      department: profile?.department || '',
      role: roleData?.role || 'student',
      name: (profile?.first_name || '') + ' ' + (profile?.last_name || ''),
      voice_sample_url: profile?.voice_sample_url || null  // ← carry voice URL in session
    };
    Auth.setUser(user);
    return { token: data.session.access_token, user };
  },

  async register(userData) {
    const sb = getSupabase();
    const email = userData.email;
    const { data, error } = await sb.auth.signUp({
      email: email,
      password: userData.password,
      options: {
        data: {
          first_name: userData.first_name,
          last_name: userData.last_name
        }
      }
    });
    if (error) throw { status: 400, data: { detail: error.message } };

    if (data.user) {
      // ── Upload voice sample to Supabase Storage ──────────────────
      let voice_sample_url = null;
      if (userData.voiceBlob) {
        try {
          const voiceMimeType = getAudioContentType(userData.voiceBlob, 'audio/webm');
          const voiceExt = getAudioExtensionFromMime(voiceMimeType);
          const fileName = `voice_${data.user.id}_enroll.${voiceExt}`;
          const { error: uploadError } = await sb.storage
            .from('voice-samples')
            .upload(fileName, userData.voiceBlob, {
              contentType: voiceMimeType,
              upsert: true
            });
          if (!uploadError) {
            const { data: urlData } = sb.storage
              .from('voice-samples')
              .getPublicUrl(fileName);
            voice_sample_url = urlData?.publicUrl || null;
          }
        } catch (e) {
          console.warn('Voice upload failed (non-critical):', e);
        }
      }

      // ── Update profile with all fields including voice URL ────────
      await sb.from('profiles').update({
        roll_number: userData.roll_number || null,
        department: userData.department || null,
        first_name: userData.first_name,
        last_name: userData.last_name,
        voice_sample_url: voice_sample_url  // ← NEW: saved voiceprint URL
      }).eq('user_id', data.user.id);

      const role = userData.role || 'student';
      await fetch(SUPABASE_URL + '/functions/v1/manage-users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
          'apikey': SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ action: 'assign_role', user_id: data.user.id, role: role })
      });
    }

    return { user: data.user, message: 'Registration successful' };
  },

  async me() {
    const user = Auth.getUser();
    if (!user) throw { status: 401, data: { detail: 'Not logged in' } };
    return user;
  }
};

// ─── Course Endpoints ──────────────────────────────────────────────
const CourseAPI = {
  async list() {
    const sb = getSupabase();
    const { data, error } = await sb.from('courses').select('*').order('code');
    if (error) throw { status: 500, data: { detail: error.message } };
    return data.map(c => ({
      id: c.id, code: c.code, name: c.name, department: c.department,
      semester: c.semester, year: c.year, faculty_id: c.faculty_id,
      start_time: c.start_time, end_time: c.end_time,
      is_live: c.is_live || false,
      room_name: c.room_name || null,
      classroom_lat: c.classroom_lat || null,
      classroom_lng: c.classroom_lng || null
    }));
  },
  async listLive() {
    const sb = getSupabase();
    const { data, error } = await sb.from('courses').select('*').eq('is_live', true).order('code');
    if (error) throw { status: 500, data: { detail: error.message } };
    return data.map(c => ({
      id: c.id, code: c.code, name: c.name, department: c.department,
      semester: c.semester, year: c.year, faculty_id: c.faculty_id,
      start_time: c.start_time, end_time: c.end_time,
      is_live: true,
      room_name: c.room_name || null,
      classroom_lat: c.classroom_lat || null,
      classroom_lng: c.classroom_lng || null
    }));
  },
  async detail(id) {
    const sb = getSupabase();
    const { data, error } = await sb.from('courses').select('*').eq('id', id).single();
    if (error) throw { status: 404, data: { detail: error.message } };
    return data;
  },
  async create(d) {
    const sb = getSupabase();
    const { data, error } = await sb.from('courses').insert(d).select().single();
    if (error) throw { status: 400, data: { detail: error.message } };
    return data;
  },
  async update(id, d) {
    const sb = getSupabase();
    const { data, error } = await sb.from('courses').update(d).eq('id', id).select().single();
    if (error) throw { status: 400, data: { detail: error.message } };
    return data;
  },
  async delete(id) {
    const sb = getSupabase();
    const { error } = await sb.from('courses').delete().eq('id', id);
    if (error) throw { status: 400, data: { detail: error.message } };
  }
};

// ─── Student Endpoints ─────────────────────────────────────────────
const StudentAPI = {
  async list() {
    const sb = getSupabase();
    const user = Auth.getUser();
    if (user?.role === 'student') {
      const { data } = await sb.from('profiles').select('*').eq('user_id', user.id);
      return (data || []).map(mapProfile);
    }
    const { data, error } = await sb.from('profiles').select('*').order('first_name');
    if (error) return [];
    const { data: studentRoles } = await sb.from('user_roles').select('user_id').eq('role', 'student');
    const studentIds = new Set((studentRoles || []).map(r => r.user_id));
    return (data || []).filter(p => studentIds.has(p.user_id)).map(mapProfile);
  },
  async detail(id) {
    const sb = getSupabase();
    const { data } = await sb.from('profiles').select('*').eq('roll_number', id).single();
    return data ? mapProfile(data) : null;
  },
  async report(studentId, params = {}) {
    const sb = getSupabase();
    let query = sb.from('attendance').select('*, courses(code, name)');
    const { data: profile } = await sb.from('profiles').select('user_id').eq('roll_number', studentId).single();
    if (profile) {
      query = query.eq('student_id', profile.user_id);
    }
    if (params.from_date) query = query.gte('date', params.from_date);
    if (params.to_date) query = query.lte('date', params.to_date);
    const { data } = await query.order('date', { ascending: false });
    return data || [];
  }
};

function mapProfile(p) {
  return {
    id: p.user_id,
    student_id: p.roll_number || p.user_id?.substring(0, 8),
    name: (p.first_name || '') + ' ' + (p.last_name || ''),
    email: p.email,
    roll_number: p.roll_number,
    department: p.department
  };
}

// ─── Attendance Endpoints ─────────────────────────────────────────
const AttendanceAPI = {
  async mark(data) {
    const sb = getSupabase();
    const user = Auth.getUser();
    let studentUserId = data.student_id;
    if (data.student_id && !data.student_id.includes('-')) {
      const { data: profile } = await sb.from('profiles').select('user_id').eq('roll_number', data.student_id).single();
      if (profile) studentUserId = profile.user_id;
    }
    const record = {
      student_id: studentUserId,
      course_id: data.course_id,
      status: data.status || 'Present',
      method: data.method || 'Manual',
      date: data.date || new Date().toISOString().split('T')[0],
      geo_verified: data.geo_verified || false,
      marked_by: user?.id
    };
    if (data.remarks) record.remarks = data.remarks;
    const { data: result, error } = await sb.from('attendance').upsert(record, { onConflict: 'student_id,course_id,date' }).select().single();
    if (error) throw { status: 400, data: { detail: error.message } };
    return result;
  },
  async markFace(formData) {
    const courseId = formData.get('course_id');
    const user = Auth.getUser();
    return this.mark({
      student_id: user?.id,
      course_id: courseId,
      status: 'Present',
      method: 'Voice',
      geo_verified: true
    });
  },
  async today(courseId) {
    const sb = getSupabase();
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await sb.from('attendance')
      .select('*, profiles!attendance_student_id_fkey(first_name, last_name, roll_number)')
      .eq('course_id', courseId)
      .eq('date', today)
      .order('marked_at', { ascending: false });
    if (error) return [];
    return (data || []).map(r => ({
      student_id: r.profiles?.roll_number || r.student_id?.substring(0, 8),
      student_name: (r.profiles?.first_name || '') + ' ' + (r.profiles?.last_name || ''),
      marked_at: r.marked_at,
      status: r.status
    }));
  },
  async getByDate(date, courseId) {
    const sb = getSupabase();
    const { data } = await sb.from('attendance')
      .select('*, profiles!attendance_student_id_fkey(first_name, last_name, roll_number)')
      .eq('course_id', courseId)
      .eq('date', date);
    return data || [];
  },

  // ── NEW: verify voice biometric via Edge Function ─────────────────
  async verifyVoice(userId, audioBlob) {
    const sb = getSupabase();
    // 1. Upload the recording to a temp path in Storage
    const voiceMimeType = getAudioContentType(audioBlob, 'application/octet-stream');
    const voiceExt = getAudioExtensionFromMime(voiceMimeType);
    const tempFileName = `voice_${userId}_verify_${Date.now()}.${voiceExt}`;
    const { error: uploadError } = await sb.storage
      .from('voice-samples')
      .upload(tempFileName, audioBlob, { contentType: voiceMimeType, upsert: true });
    if (uploadError) throw new Error('Failed to upload voice recording: ' + uploadError.message);

    // 2. Call the Edge Function to compare against enrolled sample
    const res = await fetch(SUPABASE_URL + '/functions/v1/verify-voice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ user_id: userId, recorded_file: tempFileName, recorded_mime: voiceMimeType })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Voice verification service error');
    return json; // { match: bool, confidence: string, score: number }
  }
};

// ─── Report Endpoints ──────────────────────────────────────────────
const ReportAPI = {
  async generate(params) {
    const sb = getSupabase();
    const user = Auth.getUser();
    let query = sb.from('attendance').select('*, courses(code, name), profiles!attendance_student_id_fkey(first_name, last_name, roll_number)');

    if (user?.role === 'student') {
      query = query.eq('student_id', user.id);
    }

    if (params.course_id) query = query.eq('course_id', params.course_id);
    if (params.from_date) query = query.gte('date', params.from_date);
    if (params.to_date) query = query.lte('date', params.to_date);
    if (params.status) query = query.eq('status', params.status);
    if (params.method) query = query.eq('method', params.method);

    if (params.student_id) {
      const { data: profile } = await sb.from('profiles').select('user_id').eq('roll_number', params.student_id).single();
      if (profile) query = query.eq('student_id', profile.user_id);
      else return { total: 0, present: 0, absent: 0, late: 0, records: [], student_summary: [], trend: { labels: [], values: [] } };
    }

    const { data, error } = await query.order('date', { ascending: false });

    if (error || !data || data.length === 0) {
      return { total: 0, present: 0, absent: 0, late: 0, records: [], student_summary: [], trend: { labels: [], values: [] } };
    }

    const present = data.filter(r => r.status === 'Present').length;
    const absent = data.filter(r => r.status === 'Absent').length;
    const late = data.filter(r => r.status === 'Late').length;

    const records = data.map(r => ({
      date: r.date,
      student_id: r.profiles?.roll_number || r.student_id?.substring(0, 8),
      student_name: (r.profiles?.first_name || '') + ' ' + (r.profiles?.last_name || ''),
      course: r.courses ? r.courses.code + ' — ' + r.courses.name : '—',
      status: r.status,
      marked_at: r.marked_at,
      method: r.method,
      geo_verified: r.geo_verified
    }));

    const studentMap = {};
    data.forEach(r => {
      const sid = r.profiles?.roll_number || r.student_id?.substring(0, 8);
      if (!studentMap[sid]) {
        studentMap[sid] = {
          student_id: sid,
          name: (r.profiles?.first_name || '') + ' ' + (r.profiles?.last_name || ''),
          course: r.courses ? r.courses.code + ' — ' + r.courses.name : '—',
          present: 0, absent: 0, late: 0, total: 0
        };
      }
      studentMap[sid][r.status.toLowerCase()]++;
      studentMap[sid].total++;
    });
    const student_summary = Object.values(studentMap).map(s => ({
      ...s,
      percentage: s.total > 0 ? ((s.present + s.late) / s.total * 100) : 0
    }));

    const weekMap = {};
    data.forEach(r => {
      const d = new Date(r.date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split('T')[0];
      if (!weekMap[key]) weekMap[key] = { total: 0, present: 0 };
      weekMap[key].total++;
      if (r.status === 'Present' || r.status === 'Late') weekMap[key].present++;
    });
    const sortedWeeks = Object.keys(weekMap).sort();
    const trend = {
      labels: sortedWeeks.map(w => 'Week ' + w.substring(5)),
      values: sortedWeeks.map(w => weekMap[w].total > 0 ? Math.round(weekMap[w].present / weekMap[w].total * 100) : 0)
    };

    return { total: data.length, present, absent, late, records, student_summary, trend };
  },

  async summary(params) {
    return this.generate(params);
  },

  async exportCSV(params) {
    const data = await this.generate(params);
    let csv = 'Date,Student ID,Student Name,Course,Status,Method,Geo-verified\n';
    (data.records || []).forEach(r => {
      csv += `${r.date},${r.student_id},"${r.student_name}",${r.course},${r.status},${r.method},${r.geo_verified}\n`;
    });
    return new Blob([csv], { type: 'text/csv' });
  }
};

// ─── Dashboard Endpoint ────────────────────────────────────────────
const DashboardAPI = {
  async stats() {
    const sb = getSupabase();
    const user = Auth.getUser();
    const today = new Date().toISOString().split('T')[0];

    let totalStudents = 0;
    let presentToday = 0;
    let totalCourses = 0;

    const { data: courses } = await sb.from('courses').select('id');
    totalCourses = courses?.length || 0;

    if (user?.role === 'student') {
      const { data: todayAtt } = await sb.from('attendance').select('status').eq('student_id', user.id).eq('date', today);
      presentToday = (todayAtt || []).filter(r => r.status === 'Present' || r.status === 'Late').length;
      totalStudents = 1;
    } else {
      const { data: studentRoles } = await sb.from('user_roles').select('user_id').eq('role', 'student');
      totalStudents = studentRoles?.length || 0;

      const { data: todayAtt } = await sb.from('attendance').select('status').eq('date', today);
      presentToday = (todayAtt || []).filter(r => r.status === 'Present' || r.status === 'Late').length;
    }

    const avgAttendance = totalStudents > 0 ? (presentToday / totalStudents * 100) : 0;

    return {
      total_students: totalStudents,
      present_today: presentToday,
      total_courses: totalCourses,
      avg_attendance: avgAttendance
    };
  },

  async recentActivity() {
    const sb = getSupabase();
    const user = Auth.getUser();
    let query = sb.from('attendance').select('*, profiles!attendance_student_id_fkey(first_name, last_name, roll_number)');

    if (user?.role === 'student') {
      query = query.eq('student_id', user.id);
    }

    const { data } = await query.order('marked_at', { ascending: false }).limit(10);
    return (data || []).map(r => ({
      type: 'attendance',
      message: `${r.profiles?.first_name || 'Student'} ${r.profiles?.last_name || ''} marked ${r.status} via ${r.method}`,
      timestamp: r.marked_at
    }));
  },

  async weeklyTrend() {
    const sb = getSupabase();
    const user = Auth.getUser();
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];

    let query = sb.from('attendance').select('date, status');
    if (user?.role === 'student') {
      query = query.eq('student_id', user.id);
    }
    query = query.gte('date', weekStartStr);

    const { data } = await query;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const present = new Array(7).fill(0);
    const absent = new Array(7).fill(0);

    (data || []).forEach(r => {
      const d = new Date(r.date).getDay();
      if (r.status === 'Present' || r.status === 'Late') present[d]++;
      else absent[d]++;
    });

    return { labels: days, present, absent };
  }
};

// ─── Toast ─────────────────────────────────────────────────────────
const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(message, type = 'success', duration = 3500) {
    this.init();
    const icons = { success: '✓', error: '✕', warning: '⚠' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${message}</span>`;
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); }
};

// Fix 6 – XSS: HTML-escape any string before inserting into innerHTML
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.esc = esc;

function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

function getErrorMessage(err) {
  if (!err || !err.data) return 'An unexpected error occurred.';
  const d = err.data;
  if (typeof d === 'string') return d;
  if (d.detail) return d.detail;
  const msgs = [];
  for (const [key, val] of Object.entries(d)) {
    const v = Array.isArray(val) ? val.join(', ') : val;
    msgs.push(key === 'non_field_errors' ? v : `${key}: ${v}`);
  }
  return msgs.join(' | ') || 'An error occurred.';
}

// Export globals
window.Auth = Auth;
window.AuthAPI = AuthAPI;
window.AttendanceAPI = AttendanceAPI;
window.CourseAPI = CourseAPI;
window.StudentAPI = StudentAPI;
window.ReportAPI = ReportAPI;
window.DashboardAPI = DashboardAPI;
window.Toast = Toast;
window.requireAuth = requireAuth;
window.getErrorMessage = getErrorMessage;
window.getSupabase = getSupabase;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
