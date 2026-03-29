import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceKey)

    const body = await req.json()
    const { action, user_id, role, email, password, first_name, last_name, roll_number, department } = body

    if (action === 'assign_role') {
      const { error } = await supabase.from('user_roles').upsert(
        { user_id, role },
        { onConflict: 'user_id,role' }
      )
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'create_user') {
      const { data: userData, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name, last_name }
      })
      if (createError) throw createError

      if (userData.user) {
        await supabase.from('profiles').update({
          roll_number: roll_number || null,
          department: department || null,
          first_name,
          last_name
        }).eq('user_id', userData.user.id)

        await supabase.from('user_roles').upsert(
          { user_id: userData.user.id, role: role || 'student' },
          { onConflict: 'user_id,role' }
        )
      }

      return new Response(JSON.stringify({ success: true, user_id: userData.user?.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (action === 'delete_user') {
      // Check if the user being deleted is an admin — prevent admin deletion
      const { data: targetRole } = await supabase.from('user_roles').select('role').eq('user_id', user_id).single()
      if (targetRole && targetRole.role === 'admin') {
        return new Response(JSON.stringify({ error: 'Cannot remove an administrator account. Admins are protected.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { error } = await supabase.auth.admin.deleteUser(user_id)
      if (error) throw error
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (action === 'seed_demo') {
      const users = [
        { email: 'admin@attendai.demo', password: 'Admin@123', role: 'admin', first_name: 'Admin', last_name: 'User', department: 'Administration' },
        { email: 'faculty@attendai.demo', password: 'Faculty@123', role: 'faculty', first_name: 'Dr. Ramesh', last_name: 'Kumar', department: 'Computer Science' },
        { email: 'student@attendai.demo', password: 'Student@123', role: 'student', first_name: 'Priya', last_name: 'Sharma', roll_number: '2021CS001', department: 'Computer Science' },
        { email: 'student2@attendai.demo', password: 'Student@123', role: 'student', first_name: 'Arjun', last_name: 'Patel', roll_number: '2021CS002', department: 'Computer Science' },
        { email: 'student3@attendai.demo', password: 'Student@123', role: 'student', first_name: 'Meera', last_name: 'Singh', roll_number: '2021EC001', department: 'Electronics & Communication' },
      ]

      const createdUsers: any[] = []
      for (const u of users) {
        const { data, error } = await supabase.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { first_name: u.first_name, last_name: u.last_name }
        })
        if (error && !error.message.includes('already been registered')) {
          console.error('Error creating user:', u.email, error.message)
          continue
        }
        const userId = data?.user?.id
        if (userId) {
          await supabase.from('profiles').update({
            roll_number: u.roll_number || null,
            department: u.department,
            first_name: u.first_name,
            last_name: u.last_name
          }).eq('user_id', userId)

          await supabase.from('user_roles').upsert(
            { user_id: userId, role: u.role },
            { onConflict: 'user_id,role' }
          )
          createdUsers.push({ email: u.email, role: u.role, id: userId })
        }
      }

      const facultyUser = createdUsers.find(u => u.role === 'faculty')
      const courses = [
        { code: 'CS301', name: 'Data Structures & Algorithms', department: 'Computer Science', semester: 'Fall', year: 2025, faculty_id: facultyUser?.id },
        { code: 'CS302', name: 'Database Management Systems', department: 'Computer Science', semester: 'Fall', year: 2025, faculty_id: facultyUser?.id },
        { code: 'EC201', name: 'Digital Electronics', department: 'Electronics & Communication', semester: 'Fall', year: 2025 },
      ]

      const createdCourses: any[] = []
      for (const c of courses) {
        const { data, error } = await supabase.from('courses').upsert(c, { onConflict: 'code' }).select().single()
        if (!error && data) createdCourses.push(data)
      }

      const students = createdUsers.filter(u => u.role === 'student')
      for (const s of students) {
        for (const c of createdCourses) {
          await supabase.from('enrollments').upsert(
            { student_id: s.id, course_id: c.id },
            { onConflict: 'student_id,course_id' }
          )
        }
      }

      const today = new Date()
      for (const s of students) {
        for (const c of createdCourses) {
          for (let dayOffset = 1; dayOffset <= 15; dayOffset++) {
            const date = new Date(today)
            date.setDate(today.getDate() - dayOffset)
            if (date.getDay() === 0 || date.getDay() === 6) continue

            const statuses = ['Present', 'Present', 'Present', 'Present', 'Late', 'Absent']
            const status = statuses[Math.floor(Math.random() * statuses.length)]
            const methods = ['Voice', 'Manual']
            const method = methods[Math.floor(Math.random() * methods.length)]

            await supabase.from('attendance').upsert({
              student_id: s.id,
              course_id: c.id,
              date: date.toISOString().split('T')[0],
              status,
              method,
              geo_verified: method === 'Voice',
              marked_by: facultyUser?.id || s.id
            }, { onConflict: 'student_id,course_id,date' })
          }
        }
      }

      return new Response(JSON.stringify({ success: true, users: createdUsers.map(u => ({ email: u.email, role: u.role })) }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})